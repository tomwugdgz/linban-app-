// ============================================================================
// 邻伴 · 语音识别（ASR）与语音合成（TTS）适配器（adapters 层，架构 §3.3）
// ----------------------------------------------------------------------------
// ASR：老人语音 → 文本（适老场景：一句话识别 / 录音文件识别）
// TTS：文本 → 适老音色语音（老人播报、AI 陪聊回复）
//
// 真实集成点 TODO：
//   · SDK：tencentcloud-sdk-nodejs（asr / tts 模块）；
//   · ASR：SentenceRecognition（一句话，引擎模型 ASR_ENGINE_MODEL_TYPE=16k_zh）
//     或 CreateRecTask（录音文件识别，异步 + 回调）；
//   · TTS：TextToSpeech / TextToVoice（voice type TTS_VOICE_TYPE=101001 等适老音色）；
//   · 凭证：TENCENTCLOUD_SECRET_ID / SECRET_KEY / REGION；
//   · 音频存放：COS 私有桶（object_key 落 ai_messages）。
// ============================================================================

import { AppError } from '@linban/shared';

// ---- ASR ----

export interface AsrAdapter {
  /** 一句话识别（小程序录音实时流场景，base16k 单声道） */
  recognizeSentence(input: { audioBase64: string; engineModelType?: string }): Promise<AsrResult>;
  /** 录音文件识别（异步任务式，返回任务号；结果经回调或轮询） */
  recognizeFile(input: { objectKey: string; engineModelType?: string }): Promise<{ taskId: string }>;
  /** 查询文件识别结果 */
  queryTask(taskId: string): Promise<AsrResult & { status: 'RUNNING' | 'SUCCESS' | 'FAILED' }>;
}

export interface AsrResult {
  text: string;
  /** 置信度 0–1 */
  confidence: number;
}

export class MockAsrAdapter implements AsrAdapter {
  async recognizeSentence(input: { audioBase64: string }): Promise<AsrResult> {
    if (!input.audioBase64) throw new AppError(18002, '语音识别缺少音频数据');
    // mock：返回固定转写（联调用）；真实实现接腾讯云 ASR
    return { text: '今天天气不错，想找人聊聊天', confidence: 0.95 };
  }

  async recognizeFile(input: { objectKey: string }): Promise<{ taskId: string }> {
    if (!input.objectKey) throw new AppError(18002, '语音识别缺少音频对象');
    return { taskId: `mock_asr_task_${input.objectKey.length}` };
  }

  async queryTask(_taskId: string): Promise<AsrResult & { status: 'RUNNING' | 'SUCCESS' | 'FAILED' }> {
    return { text: '我想预约明天下午的陪聊服务', confidence: 0.93, status: 'SUCCESS' };
  }
}

export class RealAsrAdapter implements AsrAdapter {
  async recognizeSentence(_input: { audioBase64: string }): Promise<AsrResult> {
    // TODO(真实集成)：asr.SentenceRecognition（EngSerViceType/SubServiceType/VoiceFormat）
    throw new AppError(90004, '真实 ASR 未实现');
  }
  async recognizeFile(_input: { objectKey: string }): Promise<{ taskId: string }> {
    // TODO(真实集成)：asr.CreateRecTask（EngineModelType + 回调地址）
    throw new AppError(90004, '真实 ASR 文件识别未实现');
  }
  async queryTask(_taskId: string): Promise<AsrResult & { status: 'RUNNING' | 'SUCCESS' | 'FAILED' }> {
    // TODO(真实集成)：asr.DescribeTaskStatus
    throw new AppError(90004, '真实 ASR 任务查询未实现');
  }
}

export function getAsrAdapter(): AsrAdapter {
  return new MockAsrAdapter();
}

// ---- TTS ----

export interface TtsAdapter {
  /** 文本 → 语音（返回 COS objectKey + 时长） */
  synthesize(input: { text: string; voiceType?: string }): Promise<TtsResult>;
}

export interface TtsResult {
  audioObjectKey: string;
  durationMs: number;
}

export class MockTtsAdapter implements TtsAdapter {
  async synthesize(input: { text: string }): Promise<TtsResult> {
    if (!input.text) throw new AppError(18003, '语音合成缺少文本');
    // mock：按字数估算时长（5 字/秒）
    return {
      audioObjectKey: `voice/mock-tts-${input.text.length}-${Date.now()}.mp3`,
      durationMs: Math.ceil((input.text.length / 5) * 1000),
    };
  }
}

export class RealTtsAdapter implements TtsAdapter {
  async synthesize(_input: { text: string; voiceType?: string }): Promise<TtsResult> {
    // TODO(真实集成)：tts.TextToVoice（VoiceType=TTS_VOICE_TYPE，音频落 COS）
    throw new AppError(90004, '真实 TTS 未实现');
  }
}

export function getTtsAdapter(): TtsAdapter {
  return new MockTtsAdapter();
}
