// ============================================================================
// 邻伴 · 健康活动感知 · 引流软文案库（A6 裁定：W-MVP 固定话术库，不做 AI 生成）
// ----------------------------------------------------------------------------
// 准绳：docs/API-CONTRACT.md §13.9 引流触发器；docs/MODULE-ACTIVITY-SENSE.md §4
//
// 为什么不用 AI 生成（主理人裁定，2026-10）：
//   这些文案会**直接发到老人手机上**。AI 生成的内容不可控、无审核链路，
//   一旦出现健康断言（如"检测到您父亲久静不动"）就是隐私红线事故——
//   本模块的健康推断仅参考、不作诊断，对外话术更不能下结论。
//   话术库可审、可改、可追溯，运营改文案不需要发版。
//
// 三条铁律（改文案时必须守住）：
//   ① 不得出现任何健康状态断言（不写"检测到""发现""异常""久静""无人活动"）；
//   ② 不得制造焦虑或催促（不写"再不陪伴就晚了""危险"）；
//   ③ 不得承诺服务结果（不写"保证""一定""彻底"）。
//   允许的写法：中性邀请 + 场景描述 + 自主决定权。
// ============================================================================

/** 文案适用场景 */
export const ACTIVITY_COPY_SCENE = {
  /** 探访邀约：邀请老人出门走动、见人聊天 */
  VISIT_INVITE: 'VISIT_INVITE',
  /** 时长卡承接：引导用已有权益约一次陪伴 */
  HOUR_CARD: 'HOUR_CARD',
  /** 子女告知：给子女看的知情说明（不是给老人的） */
  FAMILY_NOTICE: 'FAMILY_NOTICE',
  /** 复购关怀：首次服务后的回访 */
  REORDER_CARE: 'REORDER_CARE',
} as const;
export type ActivityCopyScene =
  (typeof ACTIVITY_COPY_SCENE)[keyof typeof ACTIVITY_COPY_SCENE];

/** 单条软文案 */
export interface ActivityCopy {
  /** 稳定 ID（运营改文案时用于追溯是哪一条，不随文案内容变） */
  id: string;
  /** 文案正文（短、口语、无术语；不得含健康断言） */
  text: string;
  /** 适用场景 */
  scene: ActivityCopyScene;
  /** 对应引流触发器 */
  trigger: 'ACTIVITY_DROP' | 'LOW_TREND' | 'NEWINSTALL_EXPERIENCE';
}

/**
 * 按触发器分组的软文案库。
 * 同一触发器给多条，让运营按渠道/小区轮换，避免用户反复收到同一句话。
 */
export const ACTIVITY_LEAD_COPY: Record<
  ActivityCopy['trigger'],
  readonly ActivityCopy[]
> = {
  // 触发器①：活跃量下降超阈值
  ACTIVITY_DROP: [
    {
      id: 'drop-visit-01',
      scene: ACTIVITY_COPY_SCENE.VISIT_INVITE,
      trigger: 'ACTIVITY_DROP',
      text: '最近天气不错，楼下公园正热闹。要不要约位小伙伴陪您下楼走走、聊聊天？',
    },
    {
      id: 'drop-visit-02',
      scene: ACTIVITY_COPY_SCENE.VISIT_INVITE,
      trigger: 'ACTIVITY_DROP',
      text: '这阵子家里闷得慌吧？约个伴儿一起喝茶、说说家常，时间您来定。',
    },
    {
      id: 'drop-card-01',
      scene: ACTIVITY_COPY_SCENE.HOUR_CARD,
      trigger: 'ACTIVITY_DROP',
      text: '您的陪伴时长卡还有余额，约一次不用出门，有人陪您说说话。',
    },
  ],
  // 触发器②：连续 N 天低活跃
  LOW_TREND: [
    {
      id: 'trend-visit-01',
      scene: ACTIVITY_COPY_SCENE.VISIT_INVITE,
      trigger: 'LOW_TREND',
      text: '认识个新朋友吧，社区里有几位叔叔阿姨也爱聊家常，可以介绍给您。',
    },
    {
      id: 'trend-card-01',
      scene: ACTIVITY_COPY_SCENE.HOUR_CARD,
      trigger: 'LOW_TREND',
      text: '好久没好好聊过天了吧？用时长卡约一次，2 小时慢慢说，不着急。',
    },
    {
      id: 'trend-family-01',
      scene: ACTIVITY_COPY_SCENE.FAMILY_NOTICE,
      trigger: 'LOW_TREND',
      text: '社区为长者安排了上门聊天服务，长辈如果愿意，可以让家人代为安排。',
    },
  ],
  // 触发器③：新装体验
  NEWINSTALL_EXPERIENCE: [
    {
      id: 'new-visit-01',
      scene: ACTIVITY_COPY_SCENE.VISIT_INVITE,
      trigger: 'NEWINSTALL_EXPERIENCE',
      text: '欢迎您来到邻伴。附近有很多陪聊的伙伴，第一次见面可以先聊聊熟悉的事。',
    },
    {
      id: 'new-card-01',
      scene: ACTIVITY_COPY_SCENE.HOUR_CARD,
      trigger: 'NEWINSTALL_EXPERIENCE',
      text: '新人有份体验券，能约一次上门陪伴，想用的时候随时点开就行。',
    },
    {
      id: 'new-family-01',
      scene: ACTIVITY_COPY_SCENE.FAMILY_NOTICE,
      trigger: 'NEWINSTALL_EXPERIENCE',
      text: '家人已为您开通邻伴关怀服务，陪伴全程走平台、有保障，过程可查。',
    },
  ],
};

/** 按场景取文案（给 recommend 端点用；无匹配则回落到同触发器首条） */
export function pickActivityCopy(
  trigger: ActivityCopy['trigger'],
  scene?: ActivityCopyScene,
): ActivityCopy {
  const pool = ACTIVITY_LEAD_COPY[trigger] ?? [];
  if (!pool.length) {
    throw new Error(`[activity-copy] 触发器 ${trigger} 没有配置文案`);
  }
  if (scene) {
    const hit = pool.find((c) => c.scene === scene);
    if (hit) return hit;
  }
  const first = pool[0];
  if (!first) {
    // 池非空但取不到首条（仅可能在数组被外部篡改时发生），不静默返回 undefined
    throw new Error(`[activity-copy] 触发器 ${trigger} 文案池异常为空`);
  }
  return first;
}

/** 全部文案（后台配置页展示与审校用） */
export function listActivityCopy(): ActivityCopy[] {
  return Object.values(ACTIVITY_LEAD_COPY).flat();
}
