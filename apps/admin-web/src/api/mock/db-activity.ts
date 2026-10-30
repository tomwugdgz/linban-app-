// ============================================================================
// 健康活动感知 · mock 数据种子（契约 §10 / 架构 §13 / PRD MODULE-ACTIVITY-SENSE.md）
// ----------------------------------------------------------------------------
// 量级口径：对齐 PRD「社区级试点」—— 在管老人约 260 位、探针在册 300+、
// 近 7 日告警 40+ 条。不用 1–2 条玩具数据，避免运营看不出分布问题。
//
// 隐私红线在本文件的具体落法：
//   1) 老人一律以「姓+**」脱敏 + 年龄，不生成任何姓名全量/手机号/住址门牌；
//   2) 原始特征（SSID/BSSID/MAC/逐分钟序列）**一律不落 mock 数据**，
//      页面也无对应字段——数据结构层面就杜绝泄漏可能；
//   3) UNKNOWN 老人单列且必带 unknownReason，不与正常状态混排；
//   4) 信号过期（超 activity_signal_ttl=21600s）单列 stale 标记，
//      运营不得把「没采到数据」读成「老人没事」。
// ============================================================================
import { ACTIVITY_EXPLAIN_LABEL } from '@/shared/enums';

// ---------------- 社区与老人基础盘 ----------------
export const ACTIVITY_COMMUNITIES = [
  '天河区华颖社区',
  '越秀区北京街',
  '海珠区赤岗街',
  '荔湾区金花街',
  '白云区三元里',
  '天河区石牌街',
  '番禺区市桥街',
];

const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡林郭何高罗郑梁谢宋唐许韩冯邓曹'.split('');

/** UNKNOWN 的原因文案（按依据码给不同说法，运营才知道下一步做什么） */
const UNKNOWN_REASON: Record<string, string> = {
  PROBE_OFFLINE: '探针离线未回传信号，已停止采集，不做任何健康推断',
  SIGNAL_EXPIRED: '最近有效信号超过 6 小时有效期（activity_signal_ttl），按规则强制回落',
  INSUFFICIENT_DATA: '有效采集窗口不足 5 分钟，样本不足以分级',
};

export interface MockActivityElder {
  id: string;
  nameMasked: string;
  age: number;
  /** A7 社区字段：null = 档案未关联社区（正常业务态，非数据错误） */
  community: string | null;
  status: string;
  confidence: number;
  explainCode: string;
  lastSignalAt?: string;
  freshnessSec: number;
  stale: boolean;
  unknownReason?: string;
  sparkline: number[];
  deviceStatus: string;
  consentStatus: string;
  consentScopeLevel: string;
  orderCount30d: number;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261026); // 与主 db 不同种子，避免两处序列耦合
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

/**
 * 生成 UTC ISO（东八区口径）。
 * 注意 hour 是**东八区小时**：先按 +8 得到「东八区墙上时间」，再减 8 小时换回 UTC。
 * 不能写成 setUTCHours(hour - 8) —— 那样 hour<8 时会溢出到前一日 UTC，
 * 东八区日期比 UTC 快一天时，「今日」看板就会凭空少掉凌晨那几个小时的告警。
 */
function isoDaysAgo(daysAgo: number, hour = 10, minute = 0): string {
  const d = new Date(Date.now() + 8 * 3600_000); // 对齐到东八区
  d.setUTCHours(hour, minute, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return new Date(d.getTime() - 8 * 3600_000).toISOString();
}

/** 近 7 日日期串（东八区） */
export function last7Days(): string[] {
  const out: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setUTCHours(16 - 8, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * 状态分布（260 位在管老人，贴近真实运营分布）：
 * ACTIVE 42% / LOW 18% / STILL 6% / AWAY 22% / UNKNOWN 12%
 * UNKNOWN 占比刻意做高（12%），提醒运营「这部分人我们其实不知道」——
 * 这正是 PRD 要的「禁止假装确定」。
 */
const STATUS_POOL: string[] = [
  ...Array<string>(42).fill('ACTIVE'),
  ...Array<string>(18).fill('LOW'),
  ...Array<string>(6).fill('STILL'),
  ...Array<string>(22).fill('AWAY'),
  ...Array<string>(12).fill('UNKNOWN'),
];

/** 各状态的依据码候选（与 domain/activity.ts 判定分支一一对应） */
const EXPLAIN_POOL: Record<string, string[]> = {
  ACTIVE: ['ACTIVE_HIGH'],
  LOW: ['LOW_ACTIVITY'],
  STILL: ['STILL_NO_MOTION'],
  AWAY: ['AWAY_CONFIRMED'],
  UNKNOWN: ['PROBE_OFFLINE', 'SIGNAL_EXPIRED', 'INSUFFICIENT_DATA'],
};

/** 单通道置信度硬上限 0.6（PRD 红线①：单通道不得直接下健康结论） */
function confidenceFor(status: string): number {
  if (status === 'UNKNOWN') return Number((0.1 + rand() * 0.2).toFixed(2));
  if (status === 'STILL') return Number((0.35 + rand() * 0.2).toFixed(2)); // 久静需双通道才敢升级
  return Number((0.45 + rand() * 0.15).toFixed(2)); // ≤ 0.6
}

/** 近 7 日活跃分钟折线：按当日状态给不同量级的活跃分钟 */
function sparklineFor(status: string): number[] {
  const base =
    status === 'ACTIVE' ? int(120, 420)
    : status === 'LOW' ? int(20, 90)
    : status === 'STILL' ? int(0, 2)
    : status === 'AWAY' ? int(0, 8)
    : 0; // UNKNOWN 不产生活跃分钟（没采到就是没采到，不做插值）
  return Array.from({ length: 7 }, (_, i) => {
    if (status === 'UNKNOWN') return 0;
    // 近几日有衰减趋势（呼应 ACTIVITY_DROP 触发器），制造可下钻的差异
    const decay = status === 'LOW' || status === 'STILL' ? 1 - i * 0.09 : 1 - i * 0.03;
    return Math.max(0, Math.round(base * Math.max(decay, 0.15) * (0.8 + rand() * 0.4)));
  });
}

export const activityElders: MockActivityElder[] = Array.from({ length: 260 }, (_, i) => {
  const status = STATUS_POOL[i % STATUS_POOL.length];
  const explainCode = pick(EXPLAIN_POOL[status]!);
  // A7：约 12% 老人档案未关联社区——真实业务态，页面须中性灰呈现而非报错
  const community = rand() < 0.12 ? null : ACTIVITY_COMMUNITIES[i % ACTIVITY_COMMUNITIES.length]!;
  const age = int(62, 91);
  // 设备状态：正常在管多为 ONLINE；AWAY 多为探针离线；UNKNOWN 三种设备态都可能
  const deviceStatus =
    status === 'AWAY' ? pick(['OFFLINE', 'ONLINE', 'OFFLINE'])
    : status === 'UNKNOWN' ? pick(['OFFLINE', 'PENDING', 'ONLINE', 'OFFLINE'])
    : pick(['ONLINE', 'ONLINE', 'ONLINE', 'OFFLINE']);
  // UNKNOWN 且依据码是 PROBE_OFFLINE/SIGNAL_EXPIRED → 数据必然过期
  const stale = explainCode === 'PROBE_OFFLINE' || explainCode === 'SIGNAL_EXPIRED' || rand() < 0.12;
  const freshnessSec = stale ? int(21601, 604800) : int(120, 21000);
  const lastSignalAt = isoDaysAgo(0, 8 + int(0, 10), int(0, 59));
  return {
    id: String(i + 1),
    nameMasked: `${pick(SURNAMES)}**`,
    age,
    community,
    status,
    confidence: confidenceFor(status),
    explainCode,
    lastSignalAt,
    freshnessSec,
    stale,
    unknownReason: status === 'UNKNOWN' ? UNKNOWN_REASON[explainCode] : undefined,
    sparkline: sparklineFor(status),
    deviceStatus,
    // 双层知情同意（PRD 红线④）：约 8% 尚未完成/已撤销，采集侧本应拒绝（22001/22006）
    consentStatus: rand() < 0.08 ? pick(['PENDING', 'REVOKED']) : 'GRANTED',
    consentScopeLevel: pick(['TREND', 'TREND', 'ALERT_ONLY', 'DAILY_SUMMARY']),
    orderCount30d: rand() < 0.45 ? int(1, 6) : 0,
  };
});

// ---------------- 近 7 日活跃趋势（看板折线） ----------------
export interface MockActivityTrend {
  date: string;
  activeCount: number;
  lowCount: number;
  stillCount: number;
  awayCount: number;
  unknownCount: number;
}
export const activityTrend: MockActivityTrend[] = last7Days().map((date, i) => ({
  date,
  activeCount: int(96, 118) - i * 2,
  lowCount: int(38, 52),
  stillCount: int(9, 18),
  awayCount: int(48, 66),
  unknownCount: int(26, 36),
}));

/** 活跃时段分布（0–23 时在线老人数）：双峰（上午买菜 + 下午活动） */
export const activityActiveSlots: { hour: number; activeElderCount: number }[] = Array.from(
  { length: 24 },
  (_, hour) => {
    const base = hour >= 6 && hour <= 8 ? 60 : hour >= 9 && hour <= 11 ? 130 : hour >= 12 && hour <= 13 ? 70 : hour >= 14 && hour <= 18 ? 120 : hour >= 19 && hour <= 21 ? 85 : hour >= 22 ? 30 : 8;
    return { hour, activeElderCount: Math.max(2, Math.round(base * (0.85 + rand() * 0.3))) };
  },
);

// ---------------- 健康告警（health_alerts，状态自闭环） ----------------
export interface MockHealthAlert {
  id: string;
  alertNo: string;
  elderId: string;
  elderNameMasked: string;
  community: string | null;
  type: string;
  level: string;
  status: string;
  confidence: number;
  explainCode: string;
  crossVerifySatisfied: boolean;
  triggeredStatus: string;
  triggeredAt: string;
  ackBy?: string;
  ackAt?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  resolveNote?: string;
  complaintNo?: string;
  orderNo?: string;
  stillMinutes?: number;
}

const ALERT_TYPE_EXPLAIN: Record<string, { explain: string; status: string }> = {
  STILL_TOO_LONG: { explain: 'STILL_NO_MOTION', status: 'STILL' },
  DEVICE_OFFLINE: { explain: 'PROBE_OFFLINE', status: 'UNKNOWN' },
  LOW_TREND: { explain: 'LOW_ACTIVITY', status: 'LOW' },
  NOCTURNAL_ACTIVITY: { explain: 'LOW_ACTIVITY', status: 'LOW' },
  FALL_SUSPECT: { explain: 'STILL_NO_MOTION', status: 'STILL' },
  RESPIRATORY_TREND: { explain: 'LOW_ACTIVITY', status: 'LOW' },
};
const ALERT_TYPES = ['STILL_TOO_LONG', 'DEVICE_OFFLINE', 'LOW_TREND', 'NOCTURNAL_ACTIVITY', 'FALL_SUSPECT', 'RESPIRATORY_TREND'];

/** 状态分布：待处置 22% / 已确认 / 处置中 / 已处置 / 误报 / 已升级（贴近真实工单积压） */
const ALERT_STATUS_POOL = [
  ...Array<string>(11).fill('OPEN'),
  ...Array<string>(8).fill('ACKNOWLEDGED'),
  ...Array<string>(6).fill('PROCESSING'),
  ...Array<string>(16).fill('RESOLVED'),
  ...Array<string>(5).fill('DISMISSED'),
  ...Array<string>(2).fill('ESCALATED'),
];

const HANDLERS = ['霍承钧', '苏映棠', '夏小笺', '顾图南'];

export const healthAlerts: MockHealthAlert[] = Array.from({ length: 48 }, (_, i) => {
  const type = ALERT_TYPES[i % ALERT_TYPES.length]!;
  const meta = ALERT_TYPE_EXPLAIN[type]!;
  const status = ALERT_STATUS_POOL[i % ALERT_STATUS_POOL.length]!;
  const elder = activityElders[(i * 5 + 3) % activityElders.length]!;
  // 级别：STILL_TOO_LONG 与 FALL_SUSPECT 更容易升到 URGENT；置信度低的不给 URGENT
  const confidence = Number((0.3 + rand() * 0.3).toFixed(2));
  const level =
    type === 'FALL_SUSPECT' ? (rand() < 0.6 ? 'URGENT' : 'WARN')
    : type === 'STILL_TOO_LONG' ? (confidence < 0.4 ? 'WARN' : rand() < 0.3 ? 'URGENT' : 'WARN')
    : type === 'LOW_TREND' ? 'REMIND'
    : 'WARN';
  // 交叉验证：单通道一律 false（PRD 红线①），URGENT 必须 true 才能 escalate
  const crossVerifySatisfied = level === 'URGENT' ? rand() < 0.45 : rand() < 0.7;
  const handled = ['RESOLVED', 'DISMISSED', 'ESCALATED', 'PROCESSING', 'ACKNOWLEDGED'].includes(status);
  // 时间轴按「同一班次内」推算：ack/resolve 必须晚于触发，且首次响应落在
  // 8–180 分钟区间（REMIND 无人及时响应属正常，不计入均值口径的 extremes）。
  // 否则看板的「平均首次响应」会被跨天随机数污染成几十小时，运营会误判团队失能。
  const triggeredDaysAgo = int(0, 6);
  const triggeredHour = int(0, 23);
  const triggeredMin = int(0, 59);
  const triggeredAt = isoDaysAgo(triggeredDaysAgo, triggeredHour, triggeredMin);
  const ackDelayMin = level === 'URGENT' ? int(3, 25) : int(15, 180);
  const resolveDelayMin = ackDelayMin + int(20, 240);
  const at = new Date(new Date(triggeredAt).getTime() + ackDelayMin * 60000);
  const rt = new Date(new Date(triggeredAt).getTime() + resolveDelayMin * 60000);
  return {
    id: String(i + 1),
    alertNo: `HAL${String(20261000 + i + 1)}`,
    elderId: elder.id,
    elderNameMasked: `${elder.nameMasked}·${elder.age} 岁`,
    community: elder.community,
    type,
    level,
    status,
    confidence,
    explainCode: meta.explain,
    crossVerifySatisfied,
    triggeredStatus: meta.status,
    triggeredAt,
    ackBy: handled ? pick(HANDLERS) : undefined,
    ackAt: handled ? at.toISOString() : undefined,
    resolvedBy: ['RESOLVED', 'DISMISSED', 'ESCALATED'].includes(status) ? pick(HANDLERS) : undefined,
    resolvedAt: ['RESOLVED', 'DISMISSED', 'ESCALATED'].includes(status) ? rt.toISOString() : undefined,
    resolveNote: status === 'DISMISSED' ? '老人外出旅游，信号中断属正常，误报'
      : status === 'RESOLVED' ? pick(['已电话联系家属确认老人平安', '社区上门核实，探针已重新联网', '家属确认老人身体无碍，关闭告警'])
      : status === 'ESCALATED' ? '交叉验证通过，已升级并落工单转紧急联系人'
      : undefined,
    complaintNo: status === 'ESCALATED' ? `CMP${String(88000 + i)}` : undefined,
    orderNo: rand() < 0.3 ? `LX${String(26000000 + i)}` : undefined,
    stillMinutes: type === 'STILL_TOO_LONG' ? int(245, 900) : undefined,
  };
});

// ---------------- 引流漏斗（activity_touchpoints 7 触点，契约 §10.5） ----------------
export const FUNNEL_TOUCHPOINTS = [
  'INSTALL',
  'ACTIVATION',
  'CONSENT_GRANTED',
  'DATA_AVAILABLE',
  'ALERT_RAISED',
  'FIRST_ORDER',
  'REORDER',
] as const;

/** 全量漏斗基数（30 日窗口）：装机 1,860 → 首单 214 */
export const funnelBase: Record<string, number> = {
  INSTALL: 1860,
  ACTIVATION: 1524,
  CONSENT_GRANTED: 1402,
  DATA_AVAILABLE: 1078,
  ALERT_RAISED: 726,
  FIRST_ORDER: 341,
  REORDER: 214,
};

/** 分渠道明细（按小区维度；其他维度由 mock server 按同一比例派生） */
/**
 * 小区维度的渠道。
 *
 * channelKey 口径（宋砚秋 DDL 落盘后对齐）：**必须是 `communities.community_code`**
 * （如 `GZ_TH_HUAYING`），不是 `C1..C7` 这种数组下标派生值。
 *
 * 为什么不能按下标：下标只在mock 内部自洽——一旦真接后端，
 * 运营新增一个社区会让数组顺序变化，同一个 channelKey 指向另一个小区，
 * 漏斗归因**静默错位**且不报错。community_code 是稳定业务主键。
 * 页面展示用 channelLabel（= community_name 全称，带行政区前缀）。
 */
export const funnelChannels: { channelKey: string; channelLabel: string; weight: number }[] = [
  { channelKey: 'GZ_TH_HUAYING', channelLabel: '天河区华颖社区', weight: 0.22 },
  { channelKey: 'GZ_YX_BEIJINGJIE', channelLabel: '越秀区北京街', weight: 0.19 },
  { channelKey: 'GZ_HZ_CHIGANGJIE', channelLabel: '海珠区赤岗街', weight: 0.16 },
  { channelKey: 'GZ_LW_JINHUAJIE', channelLabel: '荔湾区金花街', weight: 0.14 },
  { channelKey: 'GZ_BY_SANYUANLI', channelLabel: '白云区三元里', weight: 0.12 },
  { channelKey: 'GZ_TH_SHIPAIJIE', channelLabel: '天河区石牌街', weight: 0.10 },
  { channelKey: 'GZ_PY_SHIQIAOJIE', channelLabel: '番禺区市桥街', weight: 0.07 },
];

// ---------------- 线下触点（渠道归因维度，非漏斗层级） ----------------
/**
 * PRD §护城河：亲邻社区媒体（门禁/单元门/开门 App）提供线下信任锚。
 * 架构 §98 明确「亲邻社区媒体为流量与信任入口，不进入系统调用链（线下触点 + 开门 App 跳转小程序）」。
 *
 * 落位口径：activity_touchpoints.metadata（Json，schema 注释「归因上下文（渠道/文案位等）」），
 *故这些值不进枚举、走 metadata.channel —— 前端也只按字符串展示，不硬编码为共享枚举。
 *
 * 关键区分（team-lead 采纳的口径）：线下触点是**渠道归因维度**，不是漏斗层级。
 * 漏斗回答「同一个人从安装到复购的转化路径」，渠道回答「他从哪个触点来」，两者正交。
 */
export interface MockOfflineTouchpoint {
  /**
   * 渠道键= **共享包 `activity_touch_channel` 枚举值**（与 schema逐字一致）。
   *
   * 曾经我自造过GATE_BANNER / UNIT_DOOR / GROUP_BUY / OPEN_DOOR_APP 一套，
   * 但契约 §13.9 已落七值枚举，mock 必须与之一致——
   * 否则真接后端时 channelKey 对不上，渠道归因会整体失效且不报错。
   */
  key: string;
  label: string;
  /** 触点说明（运营据此判断该在哪加投放） */
  desc: string;
  weight: number;
  /**
   * 层间转化率倍率（索引 i 表示「从第 i 层到第 i+1 层」这一步的倍率，i=0..5，共 6 个值）。
   *
   * 为什么不用「每层绝对值倍率」：那样会让某层数超过上层，产出「同意数 = 装机数 = 100% 同意率」
   * 这类荒谬数据，只能靠单调性保底压平——掩盖问题而非解决。
   * 改成**层间转化率倍率**后，每一步都独立可控且天然单调（乘法保证 ≤1 时必然递减）。
   */
  stepLift: number[];
  /** 该触点的现场引导建议（最大流失环节引用时拼进建议文案） */
  onsiteAdvice: string;
}

/** 基准漏斗的层间转化率（30 日窗口，实测值） */
const BASE_STEP_RATE = [0.82, 0.92, 0.77, 0.66, 0.47, 0.62];

export const OFFLINE_TOUCHPOINTS: MockOfflineTouchpoint[] = [
  {
    key: 'MEDIA_SCREEN',
    label: '门禁广告屏',
    desc: '小区门禁闸机屏滚动播放，用户进出门必经',
    weight: 0.31,
    // 曝光量最大但「路过的老人」占比高 → 装机多、激活与同意偏低（漏斗前段强、后段弱）
    stepLift: [0.98, 0.78, 0.95, 0.82, 0.78, 0.85],
    onsiteAdvice: '在门禁广告屏二维码旁加「扫码即送 5 元体验券」引导，并安排团长在闸机口协助扫码',
  },
  {
    key: 'MEDIA_STICKER',
    label: '单元门贴纸',
    desc: '贴在单元门上，targeting 本楼栋住户，信任锚最强',
    weight: 0.24,
    // 触达精准但曝光量小：同意率最高（线下信任锚 + 本楼栋熟人效应），但装机绝对量低。
    // 同意率高不等于 100%——总有人不装也不授权，同意率上限受「是否愿意让子女代看」意愿约束。
    stepLift: [1.05, 1.12, 1.06, 0.92, 1.05, 1.02],
    onsiteAdvice: '单元门贴纸配「本楼栋专属团长」二维码，由团长当面讲解隐私边界，同意率提升最明显',
  },
  {
    key: 'DISTRIBUTOR',
    label: '团长地推',
    desc: '社区团长台前摆摊，子女社区活动现场',
    weight: 0.27,
    // 人工讲解最充分 → 同意与数据可用最强，但触达量受限
    stepLift: [0.96, 1.14, 1.16, 0.84, 1.0, 1.12],
    onsiteAdvice: '团长地推现场演示「子女看父母活跃度」，当场完成绑定可加赠时长卡',
  },
  {
    key: 'OPENING_APP',
    label: '开门 App 跳转',
    desc: '亲邻开门 App 首页挂角，直跳小程序落地页',
    weight: 0.18,
    // 数字化触点，量小但全程无人工介入 → 同意率偏低（无人讲解隐私边界）
    stepLift: [1.02, 0.7, 0.95, 0.88, 0.84, 0.9],
    onsiteAdvice: '开门 App 跳转落地页首屏必须先讲清「不采摄像头/麦克风、不出户」，再给授权入口',
  },
];

/**
 * 由层间转化率倍率推导各层人数（乘积式，天然单调递减）。
 * @param tps 触点序列（7 层）
 * @param reach 首层（装机）基数
 * @param stepLift 6 个层间倍率，i 表示第 i 层 → 第 i+1 层
 */
export function funnelCountsFromStepLift(
  tps: readonly string[],
  reach: number,
  stepLift: number[],
): number[] {
  const counts = [reach];
  for (let i = 0; i < tps.length - 1; i++) {
    const rate = Math.min(BASE_STEP_RATE[i]! * (stepLift[i] ?? 1), 0.97); // 单步上限 97%，防 100% 同意
    counts.push(Math.round(counts[i]! * rate));
  }
  return counts;
}

export { ACTIVITY_EXPLAIN_LABEL };
// ============================================================================
// 订阅营收 mock（契约 §13.6 GET /admin/activity/revenue，权限 revenue:read）
// ----------------------------------------------------------------------------
// 🔴 **Q8 账务隔离**：订阅收入是**独立科目**，不进陪聊分账池。
// 本文件造的数据与分账（profit_sharings 等）**完全无关**，前端也不许把两者相加。
//
// **摊分口径必须与服务端 domain/revenue.ts 的 prorateSubscription 一致**：
// 累计比例差分法 cum(n) = floor(priceFen · n / totalDays)，
// amount = cum(toOffset) − cum(fromOffset)。
// 为什么要复刻而不是造个假数：mock 与服务端口径一旦分叉，
// 前端在 mock 下「对得上」的数字切真机就变了 —— 而这种差异没有任何测试会发现。
//
// **跨界订阅是本端点最容易出错的地方**（承钧 2026-10 特别提醒）：
// 年费用户 start_at 早于窗口起、end_at 晚于窗口止，若 where 错卡
// `start_at >= windowStart`，整批年费用户会被漏掉，表现为「老用户越多营收越低」。
// 故这里**刻意造一批跨界订阅**（含 1 条整年有效的年费单）。
// ============================================================================

export interface MockSubscription {
  subscriptionNo: string;
  tier: 'FREE' | 'PRO' | 'INSTITUTIONAL';
  status: string;
  /** 订阅价（分） */
  priceFen: string;
  /** 生效起点（含） */
  startAt: string;
  /** 失效点（不含） */
  endAt: string;
  /** 机构名（INSTITUTIONAL 档有值） */
  institutionalName?: string;
}

/** 距今 n 天的 UTC 零点（东八区口径的日期串） */
function dayOffsetIso(daysFromNow: number, hour = 0): string {
  const d = new Date();
  d.setUTCHours(hour, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString();
}

/**
 * 订阅种子数据。
 *
 * 刻意覆盖的场景（每种都有对应的服务端分支，前端/测试都能验到）：
 *   ① PRO 月费，本月内开始 → 整月计入
 *   ② PRO 月费，**上上月开始、跨过窗口** → 摊分计入（跨界，最易错）
 *   ③ PRO 年费 ¥4900（490000 分），**整年有效** → 每月只确认约 1/12
 *   ④ INSTITUTIONAL 机构订阅 → 第三档
 *   ⑤ FREE 档 → 排除原因 FREE_TIER_ZERO_PRICE
 *   ⑥ PENDING 未确认 → 排除原因 STATUS_NOT_CONFIRMABLE
 *   ⑦ SUSPENDED 暂停 → 排除原因 STATUS_NOT_CONFIRMABLE
 *   ⑧ 完全在窗口之外 → 排除原因 NO_OVERLAP
 */
export const mockSubscriptions: MockSubscription[] = [
  {
    subscriptionNo: 'SUB20261001001',
    tier: 'PRO',
    status: 'ACTIVE',
    priceFen: '4900',
    startAt: dayOffsetIso(-10),
    endAt: dayOffsetIso(20),
  },
  {
    // 跨界月费：开始早于窗口起、结束晚于窗口止 → 摊分计入
    subscriptionNo: 'SUB20260801002',
    tier: 'PRO',
    status: 'ACTIVE',
    priceFen: '4900',
    startAt: dayOffsetIso(-70),
    endAt: dayOffsetIso(40),
  },
  {
    // 整年有效的年费单：¥490 = 49000 分（这里用 49000 表示年费）
    subscriptionNo: 'SUB20260101003',
    tier: 'PRO',
    status: 'ACTIVE',
    priceFen: '49000',
    startAt: dayOffsetIso(-300),
    endAt: dayOffsetIso(65),
  },
  {
    subscriptionNo: 'SUB20260715004',
    tier: 'INSTITUTIONAL',
    status: 'ACTIVE',
    priceFen: '19900',
    startAt: dayOffsetIso(-95),
    endAt: dayOffsetIso(95),
    institutionalName: '天河区华颖社区养老服务站',
  },
  {
    subscriptionNo: 'SUB20261005005',
    tier: 'INSTITUTIONAL',
    status: 'EXPIRED',
    priceFen: '19900',
    startAt: dayOffsetIso(-60),
    endAt: dayOffsetIso(-5),
    institutionalName: '越秀区北京街长者服务中心',
  },
  {
    subscriptionNo: 'SUB20260901006',
    tier: 'FREE',
    status: 'ACTIVE',
    priceFen: '0',
    startAt: dayOffsetIso(-30),
    endAt: dayOffsetIso(335),
  },
  {
    subscriptionNo: 'SUB20261012007',
    tier: 'PRO',
    status: 'PENDING',
    priceFen: '4900',
    startAt: dayOffsetIso(-2),
    endAt: dayOffsetIso(28),
  },
  {
    subscriptionNo: 'SUB20260920008',
    tier: 'PRO',
    status: 'SUSPENDED',
    priceFen: '4900',
    startAt: dayOffsetIso(-40),
    endAt: dayOffsetIso(50),
  },
  {
    subscriptionNo: 'SUB20260501009',
    tier: 'PRO',
    status: 'CANCELLED',
    priceFen: '4900',
    startAt: dayOffsetIso(-180),
    endAt: dayOffsetIso(-90),
  },
  {
    subscriptionNo: 'SUB20261020010',
    tier: 'PRO',
    status: 'ACTIVE',
    priceFen: '4900',
    startAt: dayOffsetIso(-15),
    endAt: dayOffsetIso(15),
  },
];

/** 可确认态（与服务端 domain/revenue.ts 的 REVENUE_CONFIRMABLE_STATUSES 一致） */
const REVENUE_CONFIRMABLE_STATUSES = ['ACTIVE', 'EXPIRED', 'CANCELLED'] as const;

/** 档位固定序（服务端 TIER_ORDER，前端**不排序**，按服务端返回的序展示） */
export const REVENUE_TIER_ORDER = ['FREE', 'PRO', 'INSTITUTIONAL'] as const;

/** 排除原因中文文案（键与服务端 RevenueExcludeReason 逐字一致） */
export const REVENUE_REASON_LABEL: Record<string, string> = {
  COUNTED: '已计入',
  STATUS_NOT_CONFIRMABLE: '状态不可确认（未生效/已暂停）',
  FREE_TIER_ZERO_PRICE: '免费档（零成本）',
  ZERO_PRICE: '订阅价为 0',
  NO_OVERLAP: '与统计窗口无重叠',
  INVALID_SPAN: '订阅区间非法（结束 ≤ 开始）',
};

/** 档位中文名 */
export const REVENUE_TIER_LABEL: Record<string, string> = {
  FREE: '免费档',
  PRO: '个人付费档',
  INSTITUTIONAL: '机构订阅档',
};

/** 状态中文名 */
export const REVENUE_STATUS_LABEL: Record<string, string> = {
  PENDING: '待生效',
  ACTIVE: '生效中',
  EXPIRED: '已到期',
  CANCELLED: '已取消',
  SUSPENDED: '已暂停',
};

/** 天数差（毫秒 → 天，向上取整到整日边界） */
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

/**
 * 单订阅的窗口内确认收入（**与服务端 prorateSubscription 同一算法**）。
 *
 * 累计比例差分：cum(n) = floor(price · n / totalDays)，amount = cum(to) − cum(from)。
 * 直接算 floor(price · overlap / total) 会随窗口起点漂移，逐日相加恒溢出。
 *
 * ⚠️ 这里用 number 而非 bigint：mock 是种子数据不是账务计算，
 * 且金额量级远小于 2^53。但**除法必须是整数除法**（Math.floor），
 * 与服务端 bigint 整除语义一致 —— 用浮点除法会让 mock 与服务端差 1 分。
 */
export function prorateSubscriptionMock(
  s: MockSubscription,
  windowStart: string,
  windowEnd: string,
): { counted: boolean; proratedFen: number; reason: string; totalDays: number; overlapDays: number } {
  const totalDays = daysBetween(s.startAt, s.endAt);
  if (!REVENUE_CONFIRMABLE_STATUSES.includes(s.status as (typeof REVENUE_CONFIRMABLE_STATUSES)[number])) {
    return { counted: false, proratedFen: 0, reason: 'STATUS_NOT_CONFIRMABLE', totalDays, overlapDays: 0 };
  }
  // 档位优先于金额：FREE 档即便被脏数据错配了非零价也不计（否则凭空造收入）
  if (s.tier === 'FREE') {
    return { counted: false, proratedFen: 0, reason: 'FREE_TIER_ZERO_PRICE', totalDays, overlapDays: 0 };
  }
  const price = Number(s.priceFen);
  if (price <= 0) {
    return { counted: false, proratedFen: 0, reason: 'ZERO_PRICE', totalDays, overlapDays: 0 };
  }
  if (totalDays <= 0) {
    return { counted: false, proratedFen: 0, reason: 'INVALID_SPAN', totalDays, overlapDays: 0 };
  }
  // 区间重叠（闭开区间 [start, end)）
  const from = s.startAt > windowStart ? s.startAt : windowStart;
  const to = s.endAt < windowEnd ? s.endAt : windowEnd;
  const overlapDays = daysBetween(from, to);
  if (overlapDays <= 0) {
    return { counted: false, proratedFen: 0, reason: 'NO_OVERLAP', totalDays, overlapDays: 0 };
  }
  const fromOffset = daysBetween(s.startAt, from);
  const toOffset = fromOffset + overlapDays;
  const cum = (n: number) => Math.floor((price * n) / totalDays);
  return {
    counted: true,
    proratedFen: cum(toOffset) - cum(fromOffset),
    reason: 'COUNTED',
    totalDays,
    overlapDays,
  };
}
