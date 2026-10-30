// ============================================================================
// 邻伴 · adapters 层统一出口（第三方能力：全部 interface + mock 实现）
// ----------------------------------------------------------------------------
// 纪律（架构铁律 5）：
//   · 无凭证环境一律 mock，禁止硬编码密钥、禁止直连真实 API；
//   · 每个适配器文件头标注真实集成点与所需凭证（.env.example 全量）；
//   · 业务代码只依赖 interface，切换实现不动业务（分账执行器为范式）。
// ============================================================================

export * from './wechat/auth';
export * from './wechat/pay';
export * from './face';
export * from './realname';
export * from './privacy-number';
export * from './asr-tts';
export * from './llm';
export * from './map';
export * from './insurance';
export * from './sms';
export * from './split-executor';
