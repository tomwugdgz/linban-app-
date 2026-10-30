// ============================================================================
// 邻伴 · 大模型适配器（adapters 层：DeepSeek / 豆包 / 通义 可切换）
// ----------------------------------------------------------------------------
// AI 陪聊管道（架构 §3.3）：ASR → LLM → TTS。老人陪聊场景要求：
//   · 语气适老、话轮短、主动关怀、无医疗断言；
//   · 内容安全前置（敏感/危机信号检测，架构 §6.2 AI 陪聊小节）；
//   · 主模型故障自动降级到备用 provider。
//
// 真实集成点 TODO：
//   · DeepSeek：POST https://api.deepseek.com/v1/chat/completions（OpenAI 兼容）；
//   · 豆包：火山方舟 ark API；通义：阿里云百炼 dashscope；
//   · 凭证：LLM_API_KEY / LLM_BASE_URL / LLM_MODEL + LLM_FALLBACK_*；
//   · 均 OpenAI 兼容协议时可用统一 HTTP 客户端，仅 baseUrl/key/model 不同。
// ============================================================================

import { AppError } from '@linban/shared';

export type LlmProvider = 'deepseek' | 'doubao' | 'qwen';

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmChatInput {
  messages: LlmChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** 指定 provider（缺省取当前主模型） */
  provider?: LlmProvider;
}

export interface LlmChatResult {
  text: string;
  provider: LlmProvider;
  model: string;
  latencyMs: number;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface LlmAdapter {
  readonly provider: LlmProvider;
  chat(input: LlmChatInput): Promise<LlmChatResult>;
}

/** Mock：确定性陪聊回复（联调用），延迟 300ms 模拟真实 */
export class MockLlmAdapter implements LlmAdapter {
  constructor(readonly provider: LlmProvider) {}

  async chat(input: LlmChatInput): Promise<LlmChatResult> {
    const last = [...input.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    if (!last) throw new AppError(18004, 'LLM 请求缺少用户输入');
    await new Promise((r) => setTimeout(r, 300));
    const model = this.provider === 'deepseek' ? 'deepseek-chat' : this.provider === 'doubao' ? 'doubao-pro' : 'qwen-plus';
    return {
      text: `（${this.provider} 模拟回复）您刚才说：「${last.slice(0, 30)}」。愿闻其详，我陪着您聊。`,
      provider: this.provider,
      model,
      latencyMs: 300,
      usage: { promptTokens: Math.ceil(last.length / 2), completionTokens: 40 },
    };
  }
}

/** 真实适配器骨架（OpenAI 兼容协议，TODO: fetch 实现 + 失败降级） */
export class RealLlmAdapter implements LlmAdapter {
  constructor(
    readonly provider: LlmProvider,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async chat(input: LlmChatInput): Promise<LlmChatResult> {
    // TODO(真实集成)：POST {baseUrl}/chat/completions
    // { model, messages, temperature, max_tokens } + Authorization: Bearer
    // 失败（429/5xx/超时）→ 抛 AppError(18004)，由上层切 LLM_FALLBACK_PROVIDER
    if (!this.apiKey) throw new AppError(18004, `LLM provider ${this.provider} 未配置 API Key`);
    void input;
    throw new AppError(90004, `真实 LLM（${this.provider}）未实现`);
  }
}

/** 工厂：按 LLM_PROVIDER env 选择主模型；无凭证回落 mock */
export function getLlmAdapter(provider?: LlmProvider): LlmAdapter {
  const main = (provider ?? (process.env.LLM_PROVIDER as LlmProvider | undefined) ?? 'deepseek') as LlmProvider;
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1';
  const model = process.env.LLM_MODEL ?? 'deepseek-chat';
  if (!apiKey) {
    return new MockLlmAdapter(main);
  }
  console.warn(`[adapter:llm] 检测到 ${main} 凭证，但真实实现未完成，暂回落 mock`);
  return new MockLlmAdapter(main);
}

/** 降级链：主模型失败 → 备用 provider（架构 §3.3 LLM 可切换） */
export async function chatWithFallback(input: LlmChatInput): Promise<LlmChatResult> {
  const primary = getLlmAdapter();
  try {
    return await primary.chat(input);
  } catch (err) {
    const fallbackProvider = (process.env.LLM_FALLBACK_PROVIDER as LlmProvider | undefined) ?? undefined;
    if (!fallbackProvider || fallbackProvider === primary.provider) throw err;
    console.warn(`[adapter:llm] 主模型 ${primary.provider} 失败，降级 ${fallbackProvider}: ${(err as Error).message}`);
    return getLlmAdapter(fallbackProvider).chat(input);
  }
}
