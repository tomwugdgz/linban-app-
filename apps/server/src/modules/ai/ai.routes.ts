// ============================================================================
// 邻伴 · ai 模块：AI 陪聊会话（骨架 + 核心接口）
// ----------------------------------------------------------------------------
// 已实现：会话创建/结束、单轮文本交互（LLM 适配器 + 降级链）、
//         危机信号标记（emotion_tags + crisis_flag）。
// TODO：ASR/TTS 管道接入 ai-pipeline 队列（重活异步）；
//       内容安全（腾讯云文本审核）与人工抽检（ai_sample_rate）；
//       老人画像（ai_profiles）滚动摘要回写。
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '@linban/shared';
import { authMiddleware, roleGuard } from '../../middlewares/auth';
import { parseOrThrow } from '../../common/validation';
import { prisma } from '../../infra/prisma';
import { chatWithFallback, getLlmAdapter } from '../../adapters/llm';
import { getAsrAdapter } from '../../adapters/asr-tts';
import { getTtsAdapter } from '../../adapters/asr-tts';
import { genBizNo } from '../../common/ids';

export const aiRouter = Router();

/** 适老系统提示词（架构 §3.3：语气适老、话轮短、无医疗断言） */
const ELDER_SYSTEM_PROMPT = `你是「邻伴」的陪聊助手小伴，陪伴广州社区的老人聊天。
要求：
1. 语气亲切、语速慢、话轮短（每次不超过 80 字）；
2. 多倾听、多提问（家常/往事/兴趣爱好），不打断；
3. 不提供医疗诊断与用药建议，健康话题引导联系子女或社区医生；
4. 发现老人情绪持续低落或提到危险信号，温和回应并建议联系家人。`;

/** POST /ai/sessions —— 创建 AI 陪聊会话 */
aiRouter.post('/sessions', authMiddleware, roleGuard('ELDER'), async (req, res, next) => {
  try {
    const session = await prisma.ai_sessions.create({
      data: {
        session_no: genBizNo('task').replace('TSK', 'AI'),
        user_id: req.user!.userId,
        status: 'ACTIVE',
      },
    });
    await prisma.ai_profiles.upsert({
      where: { user_id: req.user!.userId },
      create: { user_id: req.user!.userId },
      update: {},
    });
    res.json({ code: 0, data: { sessionNo: session.session_no, status: session.status }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** POST /ai/sessions/:sessionNo/turn —— 单轮交互（文本；语音走 /turn/voice） */
aiRouter.post('/sessions/:sessionNo/turn', authMiddleware, roleGuard('ELDER'), async (req, res, next) => {
  try {
    const schema = z.object({ text: z.string().min(1).max(500) });
    const { text } = parseOrThrow(schema, req.body);
    const session = await prisma.ai_sessions.findUnique({ where: { session_no: req.params.sessionNo! } });
    if (!session || session.user_id !== req.user!.userId) throw new AppError(18001, '会话不存在');
    if (session.status !== 'ACTIVE') throw new AppError(18001, '会话已结束');

    // 近 10 轮上下文（MVP 简化：直接取最近消息；滚动摘要 TODO）
    const history = await prisma.ai_messages.findMany({
      where: { session_id: session.id },
      orderBy: { id: 'desc' },
      take: 10,
    });
    const messages = [
      { role: 'system' as const, content: ELDER_SYSTEM_PROMPT },
      ...history.reverse().map((m) => ({ role: m.role.toLowerCase() as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: text },
    ];

    const started = Date.now();
    const llm = await chatWithFallback({ messages });
    const latency = Date.now() - started;

    // 危机信号简易检测（TODO: 接入内容安全 + 情绪模型）
    const crisis = /(不想活|自杀|跳楼|药.*死|没人管|遗书)/i.test(text) || /(自杀|危险)/i.test(llm.text);

    await prisma.$transaction([
      prisma.ai_messages.create({
        data: { session_id: session.id, role: 'USER', content: text, latency_ms: latency },
      }),
      prisma.ai_messages.create({
        data: {
          session_id: session.id,
          role: 'ASSISTANT',
          content: llm.text,
          llm_provider: llm.provider,
          llm_model: llm.model,
          prompt_tokens: llm.usage?.promptTokens ?? null,
          completion_tokens: llm.usage?.completionTokens ?? null,
          latency_ms: llm.latencyMs,
        },
      }),
      prisma.ai_sessions.update({
        where: { id: session.id },
        data: {
          message_count: { increment: 2 },
          last_message_at: new Date(),
          crisis_flag: crisis ? true : session.crisis_flag,
        },
      }),
    ]);

    if (crisis) {
      // TODO(risk/support)：创建 SOS 工单 + 通知子女（危机链路）
    }

    res.json({
      code: 0,
      data: {
        sessionNo: session.session_no,
        userText: text,
        assistantText: llm.text,
        crisisFlag: crisis,
        llmProvider: llm.provider,
        llmModel: llm.model,
        latencyMs: llm.latencyMs,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** POST /ai/sessions/:sessionNo/turn/voice —— 语音轮（ASR→LLM→TTS 同步编排） */
aiRouter.post('/sessions/:sessionNo/turn/voice', authMiddleware, roleGuard('ELDER'), async (req, res, next) => {
  try {
    const schema = z.object({ audioObjectKey: z.string().min(1).max(512) });
    const { audioObjectKey } = parseOrThrow(schema, req.body);
    const session = await prisma.ai_sessions.findUnique({ where: { session_no: req.params.sessionNo! } });
    if (!session || session.user_id !== req.user!.userId) throw new AppError(18001, '会话不存在');

    const asr = getAsrAdapter();
    const asrResult = await asr.recognizeSentence({ audioBase64: '' });
    // 文件识别异步化 TODO：录音文件走 ai-pipeline 队列；此处一句话识别同步返回
    const llm = await chatWithFallback({
      messages: [
        { role: 'system', content: ELDER_SYSTEM_PROMPT },
        { role: 'user', content: asrResult.text },
      ],
    });
    const tts = getTtsAdapter();
    const audio = await tts.synthesize({ text: llm.text });

    await prisma.$transaction([
      prisma.ai_messages.create({
        data: {
          session_id: session.id,
          role: 'USER',
          content: asrResult.text,
          asr_text: asrResult.text,
          audio_object_key: audioObjectKey,
        },
      }),
      prisma.ai_messages.create({
        data: {
          session_id: session.id,
          role: 'ASSISTANT',
          content: llm.text,
          audio_object_key: audio.audioObjectKey,
          audio_duration_ms: audio.durationMs,
          llm_provider: llm.provider,
          llm_model: llm.model,
        },
      }),
      prisma.ai_sessions.update({ where: { id: session.id }, data: { message_count: { increment: 2 }, last_message_at: new Date() } }),
    ]);

    res.json({
      code: 0,
      data: {
        sessionNo: session.session_no,
        userText: asrResult.text,
        assistantText: llm.text,
        audioObjectKey: audio.audioObjectKey,
        audioDurationMs: audio.durationMs,
        llmProvider: llm.provider,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** POST /ai/sessions/:sessionNo/end —— 结束会话 */
aiRouter.post('/sessions/:sessionNo/end', authMiddleware, roleGuard('ELDER'), async (req, res, next) => {
  try {
    const session = await prisma.ai_sessions.findUnique({ where: { session_no: req.params.sessionNo! } });
    if (!session || session.user_id !== req.user!.userId) throw new AppError(18001, '会话不存在');
    await prisma.ai_sessions.updateMany({
      where: { id: session.id, status: 'ACTIVE' },
      data: { status: 'ENDED', ended_at: new Date() },
    });
    res.json({ code: 0, data: { status: 'ENDED' }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** GET /ai/sessions —— 我的会话列表 */
aiRouter.get('/sessions', authMiddleware, roleGuard('ELDER'), async (req, res, next) => {
  try {
    const list = await prisma.ai_sessions.findMany({
      where: { user_id: req.user!.userId },
      orderBy: { started_at: 'desc' },
      take: 50,
    });
    res.json({
      code: 0,
      data: list.map((s) => ({
        sessionNo: s.session_no,
        status: s.status,
        messageCount: s.message_count,
        crisisFlag: s.crisis_flag,
        startedAt: s.started_at.toISOString(),
        lastMessageAt: s.last_message_at?.toISOString() ?? null,
      })),
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

void getLlmAdapter;
