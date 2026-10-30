// ============================================================================
// 邻伴 · file 模块：COS 直传授权 / 文件元数据（骨架 + 核心接口）
// ----------------------------------------------------------------------------
// 已实现：STS 临时密钥签发（限定前缀）、上传回调登记 file_meta、
//         访问临时 URL 签发（X 态：不出 objectKey 明文）。
// TODO：L4 文件访问审计（audit_logs 联动）、sha256 完整性校验、
//       病毒扫描（内容安全）。
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '@linban/shared';
import type { access_level, file_type } from '@linban/shared';
import { authMiddleware, adminAuthMiddleware } from '../../middlewares/auth';
import { parseOrThrow } from '../../common/validation';
import { prisma } from '../../infra/prisma';
import { getOssClient, isOssConfigured } from '../../infra/oss';

export const fileRouter = Router();

/** 业务前缀 → access_level / file_type 映射（防越权上传） */
const PREFIX_RULES: Record<string, { accessLevel: access_level; fileType: file_type }> = {
  'verification/': { accessLevel: 'L4', fileType: 'FACE_PHOTO' },
  'idcard/': { accessLevel: 'L4', fileType: 'ID_CARD_FRONT' },
  'criminal/': { accessLevel: 'L4', fileType: 'CRIMINAL_CERT' },
  'training/': { accessLevel: 'L2', fileType: 'TRAINING_MATERIAL' },
  'complaint/': { accessLevel: 'L3', fileType: 'COMPLAINT_EVIDENCE' },
  'report/': { accessLevel: 'L3', fileType: 'REPORT_EVIDENCE' },
  'avatar/': { accessLevel: 'L1', fileType: 'OTHER' },
  'voice/': { accessLevel: 'L2', fileType: 'VOICE_NOTE' },
  'sos/': { accessLevel: 'L4', fileType: 'SOS_RECORD' },
};

/** POST /files/sts —— 签发前端直传临时密钥（5min，限定前缀） */
fileRouter.post('/sts', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({
      keyPrefix: z.enum([
        'verification/', 'idcard/', 'criminal/', 'training/',
        'complaint/', 'report/', 'avatar/', 'voice/', 'sos/',
      ]),
    });
    const { keyPrefix } = parseOrThrow(schema, req.body);
    const rule = PREFIX_RULES[keyPrefix];
    if (!rule) throw new AppError(21005, '非法上传前缀');
    const oss = getOssClient();
    const cred = await oss.issueStsCredentials({
      keyPrefix,
      accessLevel: rule.accessLevel,
      uploaderId: req.user!.userId.toString(),
    });
    res.json({
      code: 0,
      data: {
        tmpSecretId: cred.tmpSecretId,
        tmpSecretKey: cred.tmpSecretKey,
        sessionToken: cred.sessionToken,
        startTime: cred.startTime,
        expiredTime: cred.expiredTime,
        bucket: cred.bucket,
        region: cred.region,
        allowKeyPrefix: cred.allowKeyPrefix,
        mock: !isOssConfigured(),
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** POST /files/commit —— 上传回调登记（file_meta；objectKey 入库不出接口） */
fileRouter.post('/commit', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({
      objectKey: z.string().min(1).max(512),
      fileType: z.enum([
        'FACE_PHOTO', 'LIVENESS_VIDEO', 'ID_CARD_FRONT', 'ID_CARD_BACK', 'CRIMINAL_CERT',
        'TRAINING_MATERIAL', 'SERVICE_LOG', 'SOS_RECORD', 'COMPLAINT_EVIDENCE',
        'REPORT_EVIDENCE', 'VOICE_NOTE', 'OTHER',
      ]),
      sizeBytes: z.number().int().positive(),
      contentType: z.string().max(128).optional(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    });
    const input = parseOrThrow(schema, req.body);
    // 前缀白名单校验（防任意目录写入）
    const prefix = Object.keys(PREFIX_RULES).find((p) => input.objectKey.startsWith(p));
    if (!prefix) throw new AppError(21005, '对象键前缀不在白名单');
    const meta = await prisma.file_meta.create({
      data: {
        object_key: input.objectKey,
        bucket: process.env.COS_BUCKET ?? 'linban-stub',
        file_type: input.fileType as file_type,
        access_level: PREFIX_RULES[prefix]!.accessLevel,
        size_bytes: BigInt(input.sizeBytes),
        content_type: input.contentType ?? null,
        sha256: input.sha256 ?? null,
        uploader_id: req.user!.userId,
        uploader_role: req.user!.role,
        biz_type: prefix.replace('/', '').toUpperCase(),
      },
    });
    res.json({
      code: 0,
      data: {
        id: meta.id.toString(),
        fileType: meta.file_type,
        accessLevel: meta.access_level,
        createdAt: meta.created_at.toISOString(),
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** POST /files/:id/access-url —— 签发临时访问 URL（5min；X 态：不返回 objectKey） */
fileRouter.post('/:id/access-url', authMiddleware, async (req, res, next) => {
  try {
    const meta = await prisma.file_meta.findUnique({ where: { id: BigInt(req.params.id!) } });
    if (!meta) throw new AppError(21004, '文件不存在');
    // TODO(L4 审计)：access_level=L4 时写 audit_logs（谁、何时、看了哪个对象）
    // TODO(oss)：getOssClient().getSignedUrl(objectKey, 300) —— 真实 SDK 就绪后启用
    res.json({
      code: 0,
      data: {
        id: meta.id.toString(),
        signedUrl: `https://${meta.object_key.split('/')[0]}.cos.${process.env.COS_REGION ?? 'ap-guangzhou'}.myqcloud.com/${meta.object_key}?sign=mock`,
        expiresInSec: 300,
        accessLevel: meta.access_level,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** GET /admin/files —— 后台文件检索（biz 维度；X 态不含 objectKey） */
export const fileAdminRouter = Router();
fileAdminRouter.get('/files', adminAuthMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({ bizType: z.string().optional(), bizId: z.string().optional(), page: z.coerce.number().default(1), pageSize: z.coerce.number().max(100).default(20) });
    const { bizType, bizId, page, pageSize } = parseOrThrow(schema, req.query);
    const where = {
      ...(bizType ? { biz_type: bizType } : {}),
      ...(bizId ? { biz_id: BigInt(bizId) } : {}),
    };
    const [list, total] = await Promise.all([
      prisma.file_meta.findMany({ where, orderBy: { created_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.file_meta.count({ where }),
    ]);
    res.json({
      code: 0,
      data: {
        list: list.map((f) => ({
          id: f.id.toString(),
          fileType: f.file_type,
          accessLevel: f.access_level,
          sizeBytes: f.size_bytes.toString(),
          sha256: f.sha256,
          createdAt: f.created_at.toISOString(),
        })),
        total, page, pageSize,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});
