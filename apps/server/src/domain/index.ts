// ============================================================================
// 邻伴 · domain 层统一出口（纯函数，零 IO，全部有单测覆盖）
// ----------------------------------------------------------------------------
// 纪律（架构 §2.3）：状态转移表、分账门闩、抽成、信用分、时段守卫的
// 「唯一逻辑副本」都在本层；service 层只做组装与副作用，不重复实现规则。
// ============================================================================

export * from './order-state-machine';
export * from './application-state-machine';
export * from './sharing-gate';
export * from './commission';
export * from './credit-rules';
export * from './slot-guard';
export * from './dispatch';
export * from './safety-suspend';
export * from './activity';
export * from './activity-consent';
