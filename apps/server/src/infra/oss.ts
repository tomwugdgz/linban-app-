// ============================================================================
// 邻伴 · COS 对象存储客户端（infra 层，stub 实现）
// ----------------------------------------------------------------------------
// 策略（DATABASE.md §6.3 / 架构 §3.3）：
//   · DB 只存 object_key（如 verification/2026/09/<uuid>.jpg），内容只进
//     COS 私有桶，API 永不返回 objectKey 明文；
//   · 前端直传走 COS STS 5min 临时密钥（本模块签发）；
//   · L4 文件（人脸底照/活体视频）每次访问另写 audit_logs（file 模块做）。
//
// 真实集成点 TODO（无凭证不调真实 API）：
//   · SDK：cos-nodejs-sdk-v5（npm i cos-nodejs-sdk-v5）
//   · 凭证：COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION /
//     COS_STS_ROLE_ARN（见 .env.example）
//   · STS：cam:GetFederationToken 或 AssumeRole（RoleArn + 短策略）
// ============================================================================

import { randomUUID } from 'node:crypto';
import type { access_level } from '@linban/shared';

/** COS 客户端接口（业务只依赖此接口，便于测试替身与切换实现） */
export interface OssClient {
  /** 签发前端直传 STS 临时密钥（5min，限定前缀） */
  issueStsCredentials(input: StsIssueInput): Promise<StsCredential>;
  /** 删除对象（文件模块下架/投诉证据清除） */
  deleteObject(objectKey: string): Promise<void>;
  /** 对象是否存在（上传回调校验） */
  objectExists(objectKey: string): Promise<boolean>;
  /** 生成受控对象键（业务前缀 + 年/月 + uuid，防遍历） */
  buildObjectKey(input: { prefix: string; date?: Date; ext?: string }): string;
  /** 是否可用（stub 恒 true；真实实现探测 Bucket） */
  healthy(): Promise<boolean>;
}

export interface StsIssueInput {
  /** 业务前缀（如 verification/、idcard/），限定直传范围 */
  keyPrefix: string;
  /** 访问级别（L4 需额外审计，仅影响策略标签） */
  accessLevel: access_level;
  /** 上传者用户 ID（策略条件绑定） */
  uploaderId: string;
}

export interface StsCredential {
  tmpSecretId: string;
  tmpSecretKey: string;
  sessionToken: string;
  startTime: number;
  expiredTime: number;
  bucket: string;
  region: string;
  allowKeyPrefix: string;
}

/** 对象键前缀白名单（防任意目录写入） */
export const OBJECT_KEY_PREFIXES = [
  'verification/',
  'idcard/',
  'criminal/',
  'training/',
  'complaint/',
  'report/',
  'avatar/',
  'voice/',
  'sos/',
] as const;

/**
 * Stub 实现：返回结构合理但凭证无效的假数据，绝不访问真实 COS。
 * 生产切换：新建 TencentOssClient implements OssClient（cos-nodejs-sdk-v5），
 * 在 infra/index.ts 按配置替换导出，业务代码零改动。
 */
export class StubOssClient implements OssClient {
  async issueStsCredentials(input: StsIssueInput): Promise<StsCredential> {
    const now = Math.floor(Date.now() / 1000);
    return {
      tmpSecretId: 'STUB-TMP-SECRET-ID',
      tmpSecretKey: 'STUB-TMP-SECRET-KEY',
      sessionToken: 'STUB-SESSION-TOKEN',
      startTime: now,
      expiredTime: now + 300, // 5min
      bucket: process.env.COS_BUCKET || 'linban-stub-1250000000',
      region: process.env.COS_REGION || 'ap-guangzhou',
      allowKeyPrefix: input.keyPrefix,
    };
  }

  async deleteObject(_objectKey: string): Promise<void> {
    // TODO(真实集成)：cos.deleteObject({ Bucket, Region, Key })
    // stub：仅记录，不产生副作用
  }

  async objectExists(_objectKey: string): Promise<boolean> {
    // TODO(真实集成)：cos.headObject
    // stub：假数据一律视为存在（上传回调联调用）
    return true;
  }

  buildObjectKey(input: { prefix: string; date?: Date; ext?: string }): string {
    if (!OBJECT_KEY_PREFIXES.includes(input.prefix as (typeof OBJECT_KEY_PREFIXES)[number])) {
      throw new Error(`非法对象键前缀: ${input.prefix}（白名单: ${OBJECT_KEY_PREFIXES.join(', ')}）`);
    }
    const d = input.date ?? new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const ext = input.ext ? `.${input.ext.replace(/^\./, '')}` : '';
    // 与 DATABASE.md §6.3 示例一致：verification/2026/09/21/<uuid>.jpg
    return `${input.prefix}${y}/${m}/${randomUUID()}${ext}`;
  }

  async healthy(): Promise<boolean> {
    return true; // stub 恒健康
  }
}

/** 是否配置了真实 COS 凭证（file 模块据此决定 stub/真实） */
export function isOssConfigured(): boolean {
  return Boolean(process.env.COS_BUCKET && process.env.COS_SECRET_ID && process.env.COS_SECRET_KEY);
}

/** 工厂：配置了真实凭证也暂返回 stub（真实实现 TODO 见文件头），
 *  业务只依赖 OssClient 接口，切换实现零改动。 */
export function getOssClient(): OssClient {
  if (isOssConfigured()) {
    console.warn('[adapter:oss] 检测到 COS 凭证，但真实实现未完成，暂回落 stub');
  }
  return new StubOssClient();
}
