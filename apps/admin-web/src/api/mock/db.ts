// ============================================================================
// Mock 数据种子：确定性伪随机（mulberry32），每次刷新数据一致。
// 数据形态与 schema.prisma 对齐；所有金额为「分」的字符串。
// 无后端环境下供管理后台完整联调；接真实后端后本目录整体弃用。
// ============================================================================
import { ROLE_DEFAULT_PERMISSIONS } from '@/shared/permissions';
import { SYSTEM_CONFIG_DEFAULTS } from '@linban/shared';

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
const rand = mulberry32(20260921);
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

const SURNAMES = '张王李刘陈杨黄赵吴周徐孙马朱胡林郭何高罗郑梁谢宋唐许韩冯邓曹彭曾肖田董潘蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦方白邹孟熊秦邱江尹薛段雷侯龙史陶黎贺顾毛郝龚邵万钱严戴莫孔向汤'.split('');
const GIVEN = ['伟', '芳', '娜', '秀英', '敏', '静', '丽', '强', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '超', '秀霞', '平', '刚', '桂英', '华', '玉', '萍', '红', '梅', '兰', '竹', '云飞', '建国', '鹏', '宇', '欣怡', '梓萱', '浩然', '雨轩', '淑华', '德海', '春花', '国栋', '雪梅', '永强', '慧珍', '俊杰', '雅静'];
const COMPANION_TAGS = ['粤语', '棋牌', '散步', '老歌戏曲', '书法绘画', '时事新闻', '宠物', '太极拳'];

export const mockNames = (n: number): string[] => {
  const names: string[] = [];
  for (let i = 0; i < n; i++) names.push(pick(SURNAMES) + pick(GIVEN));
  return names;
};

/** 生成 UTC ISO 时间：daysAgo 天前的固定时分 */
function iso(daysAgo: number, hour = 10, minute = 0): string {
  const d = new Date(Date.UTC(2026, 8, 21, hour - 8, minute, 0)); // 本地视角 2026-09-21 10:00
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

const phone = () => `13${int(0, 9)}${String(int(0, 99999999)).padStart(8, '0')}`;
const pad = (n: number, len: number) => String(n).padStart(len, '0');

// ---------------- 陪聊员 ----------------
export interface MockCompanion {
  id: string;
  userId: string;
  name: string;
  phone: string;
  status: string;
  level: number;
  creditScore: number;
  hourlyRateFen: string;
  serviceRadiusM: number;
  tags: string[];
  ratingAvg: number;
  ratingCount: number;
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  depositBalanceFen: string;
  createdAt: string;
}
export const companions: MockCompanion[] = Array.from({ length: 42 }, (_, i) => {
  const status = i < 26 ? 'ACTIVE' : i < 33 ? 'PENDING' : i < 37 ? 'SUSPENDED' : i < 39 ? 'BANNED' : 'RETIRED';
  const total = status === 'ACTIVE' ? int(20, 260) : int(0, 15);
  return {
    id: String(i + 1),
    userId: String(1000 + i),
    name: mockNames(1)[0],
    phone: phone(),
    status,
    level: int(1, 5),
    creditScore: status === 'BANNED' ? int(20, 45) : int(62, 100),
    hourlyRateFen: String(int(40, 120) * 100),
    serviceRadiusM: pick([1000, 2000, 3000, 5000]),
    tags: [pick(COMPANION_TAGS), pick(COMPANION_TAGS)],
    ratingAvg: Number((3.6 + rand() * 1.4).toFixed(1)),
    ratingCount: int(5, 120),
    totalOrders: total,
    completedOrders: Math.floor(total * 0.9),
    cancelledOrders: Math.floor(total * 0.1),
    depositBalanceFen: status === 'BANNED' ? '0' : '50000',
    createdAt: iso(int(30, 300)),
  };
});

// ---------------- 四审申请 ----------------
export interface MockApplication {
  id: string;
  applicationNo: string;
  companionId: string;
  stage: string;
  realnameStatus: string;
  realnameComment?: string;
  realnameOcrBizId?: string;
  realnameReviewedAt?: string;
  faceStatus: string;
  faceScore?: number;
  faceComment?: string;
  faceVerifyId?: string;
  facePhotoUrl?: string;
  criminalStatus: string;
  criminalComment?: string;
  criminalMaterialUrl?: string;
  trainingCompletedAt?: string;
  examScore?: number;
  examAttemptNo: number;
  depositAmountFen?: string;
  depositPaidAt?: string;
  submittedAt: string;
  decidedAt?: string;
  rejectReason?: string;
}
const APP_STAGES = ['APPLIED', 'REALNAME_OK', 'FACE_OK', 'CRIMINAL_OK', 'TRAINING', 'EXAM_OK', 'DEPOSIT_OK', 'ACTIVE', 'SUSPENDED', 'BANNED'];
export const applications: MockApplication[] = Array.from({ length: 26 }, (_, i) => {
  const comp = companions[i];
  const stageIdx = Math.min(i % APP_STAGES.length, APP_STAGES.length - 1);
  const stage = APP_STAGES[stageIdx];
  const passed = (s: string) => APP_STAGES.indexOf(stage) > APP_STAGES.indexOf(s);
  return {
    id: String(i + 1),
    applicationNo: `APP202609${pad(i + 1, 4)}`,
    companionId: comp.id,
    stage,
    realnameStatus: passed('APPLIED') ? 'PASSED' : 'PENDING',
    realnameOcrBizId: `OCR${int(100000, 999999)}`,
    realnameReviewedAt: passed('APPLIED') ? iso(int(1, 20), 14, 30) : undefined,
    faceStatus: passed('REALNAME_OK') ? 'PASSED' : 'PENDING',
    faceScore: passed('REALNAME_OK') ? int(82, 98) : undefined,
    faceVerifyId: passed('REALNAME_OK') ? `HV${int(100000, 999999)}` : undefined,
    facePhotoUrl: passed('REALNAME_OK') ? 'https://mock.cos.example/face-photo.jpg?sig=xxx' : undefined,
    criminalStatus: passed('FACE_OK') ? 'PASSED' : 'PENDING',
    criminalMaterialUrl: passed('FACE_OK') ? 'https://mock.cos.example/criminal-cert.jpg?sig=xxx' : undefined,
    trainingCompletedAt: passed('CRIMINAL_OK') ? iso(int(1, 15), 16) : undefined,
    examScore: passed('CRIMINAL_OK') ? int(80, 99) : undefined,
    examAttemptNo: 1,
    depositAmountFen: passed('EXAM_OK') ? '50000' : undefined,
    depositPaidAt: passed('EXAM_OK') ? iso(int(1, 10), 11) : undefined,
    submittedAt: iso(int(1, 30), 9, int(0, 59)),
    decidedAt: ['ACTIVE', 'BANNED'].includes(stage) ? iso(1, 18) : undefined,
    rejectReason: stage === 'BANNED' ? '人脸比对未通过且补充材料超时' : undefined,
  };
});

// ---------------- 订单 ----------------
export interface MockOrder {
  id: string;
  orderNo: string;
  status: string;
  serviceType: string;
  durationMinutes: number;
  serviceDate: string;
  slotStart: string;
  slotEnd: string;
  hourlyRateFen: string;
  originalAmountFen: string;
  couponDeductFen: string;
  giftCardDeductFen: string;
  totalAmountFen: string;
  userId: string;
  elderName: string;
  elderPhone: string;
  companionId?: string;
  address: string;
  distanceM: number;
  nightOrder: boolean;
  cancelReason?: string;
  refundAmountFen: string;
  remark?: string;
  createdAt: string;
  completedAt?: string;
}
const ORDER_STATUS_POOL = ['COMPLETED', 'COMPLETED', 'COMPLETED', 'CLOSED', 'IN_SERVICE', 'ACCEPTED', 'PENDING_CONFIRM', 'SUSPENDED', 'CANCELLED', 'REFUNDED', 'PAID', 'DISPATCHED', 'CREATED'];
export const orders: MockOrder[] = Array.from({ length: 86 }, (_, i) => {
  const comp = companions[int(0, 25)];
  const duration = pick([60, 90, 120, 180]);
  const rate = Number(comp.hourlyRateFen);
  const original = Math.round((rate * duration) / 60);
  const coupon = rand() < 0.25 ? pick([500, 1000, 2000]) : 0;
  const gift = rand() < 0.15 ? pick([3000, 6000]) : 0;
  const total = Math.max(original - coupon - gift, 0);
  const status = ORDER_STATUS_POOL[i % ORDER_STATUS_POOL.length];
  const daysAgo = int(0, 60);
  return {
    id: String(i + 1),
    orderNo: `LB20260921${pad(i + 1, 6)}`,
    status,
    serviceType: i % 9 === 0 ? 'ACCOMPANY' : 'CHAT',
    durationMinutes: duration,
    serviceDate: iso(daysAgo).slice(0, 10),
    slotStart: iso(daysAgo, 9, 0),
    slotEnd: iso(daysAgo, 9, 0).slice(0, 13) + String(duration).padStart(2, '0') + ':00.000Z',
    hourlyRateFen: comp.hourlyRateFen,
    originalAmountFen: String(original),
    // 券抵扣额是「后端算好的实扣分」，mock 直接生成，不从券模板 value 推算。
    // 契约 §5.7.6.1：单位随券 type 变（DURATION 是分钟不是分），前端自行推算必资损。
    couponDeductFen: String(coupon),
    giftCardDeductFen: String(gift),
    totalAmountFen: String(total),
    userId: String(2000 + int(0, 60)),
    elderName: mockNames(1)[0],
    elderPhone: phone(),
    companionId: comp.id,
    address: `广州市天河区${pick(['天河南', '石牌', '五山', '林和', '沙东'])}街道${int(1, 200)}号${pick(['小区', '花园', '大厦', '大院'])}`,
    distanceM: int(200, 4200),
    nightOrder: rand() < 0.05,
    cancelReason: status === 'CANCELLED' ? pick(['陪聊员临时有事', '老人身体不适', '家属代取消']) : undefined,
    refundAmountFen: status === 'REFUNDED' ? String(total) : '0',
    remark: rand() < 0.2 ? '老人听力较弱，需放慢语速' : undefined,
    createdAt: iso(daysAgo, int(8, 20), int(0, 59)),
    completedAt: ['COMPLETED', 'CLOSED'].includes(status) ? iso(daysAgo, 18) : undefined,
  };
});

// ---------------- 分账流水（已支付订单一条 FROZEN/SHARED/RETURNED）----------------
export interface MockSharing {
  id: string;
  sharingNo: string;
  orderId: string;
  orderNo: string;
  paymentId: string;
  status: string;
  frozenAmountFen: string;
  platformCommissionFen: string;
  companionIncomeFen: string;
  commissionRateBp: number;
  companionName: string;
  wxTransactionId: string;
  wxSharingOrderNo?: string;
  sharedAt?: string;
  returnAmountFen: string;
  wxReturnNo?: string;
  returnedAt?: string;
  returnReason?: string;
  retryCount: number;
  lastError?: string;
  manualTicketNo?: string;
  createdAt: string;
}
export const sharings: MockSharing[] = orders
  .filter((o) => !['CREATED', 'CANCELLED'].includes(o.status))
  .map((o, i) => {
    const bp = o.nightOrder ? 800 : 500;
    const frozen = Number(o.totalAmountFen);
    const commission = Math.round((frozen * bp) / 10000);
    const status = o.status === 'REFUNDED' ? 'RETURNED' : ['COMPLETED', 'CLOSED'].includes(o.status) ? 'SHARED' : 'FROZEN';
    const comp = companions.find((c) => c.id === o.companionId)!;
    return {
      id: String(i + 1),
      sharingNo: `SHR20260921${pad(i + 1, 6)}`,
      orderId: o.id,
      orderNo: o.orderNo,
      paymentId: String(3000 + i),
      status,
      frozenAmountFen: String(frozen),
      platformCommissionFen: String(commission),
      companionIncomeFen: String(frozen - commission),
      commissionRateBp: bp,
      companionName: comp.name,
      wxTransactionId: `42${int(1000000000, 9999999999)}`,
      wxSharingOrderNo: status === 'SHARED' ? `SH${int(100000, 999999)}` : undefined,
      sharedAt: status === 'SHARED' ? iso(1, 3) : undefined,
      returnAmountFen: status === 'RETURNED' ? String(frozen) : '0',
      wxReturnNo: status === 'RETURNED' ? `RT${int(100000, 999999)}` : undefined,
      returnedAt: status === 'RETURNED' ? iso(1, 3) : undefined,
      returnReason: status === 'RETURNED' ? '客服裁决全额退款，分账回退' : undefined,
      retryCount: status === 'FROZEN' && rand() < 0.15 ? int(1, 3) : 0,
      lastError: status === 'FROZEN' && rand() < 0.15 ? '微信分账接口超时' : undefined,
      manualTicketNo: status === 'FROZEN' && rand() < 0.1 ? `TK${int(10000, 99999)}` : undefined,
      createdAt: o.createdAt,
    };
  });

// ---------------- 提现单 ----------------
export interface MockWithdrawal {
  id: string;
  withdrawalNo: string;
  companionId: string;
  amountFen: string;
  feeFen: string;
  actualAmountFen: string;
  bankName: string;
  bankAccount: string;
  accountName: string;
  status: string;
  faceVerified: boolean;
  smsVerified: boolean;
  rejectReason?: string;
  wxBatchNo?: string;
  createdAt: string;
  reviewedAt?: string;
}
const WITHDRAWAL_STATUS_POOL = ['PENDING_REVIEW', 'PENDING_REVIEW', 'PENDING_REVIEW', 'APPROVED', 'PROCESSING', 'SUCCESS', 'REJECTED', 'FAILED'];
export const withdrawals: MockWithdrawal[] = Array.from({ length: 22 }, (_, i) => {
  const comp = companions[int(0, 25)];
  const amount = int(100, 800) * 100;
  const fee = 100;
  return {
    id: String(i + 1),
    withdrawalNo: `WDR20260921${pad(i + 1, 5)}`,
    companionId: comp.id,
    amountFen: String(amount),
    feeFen: String(fee),
    actualAmountFen: String(amount - fee),
    bankName: pick(['工商银行', '建设银行', '农业银行', '中国银行', '招商银行']),
    bankAccount: `62${pad(int(0, 99999999), 8)}${pad(int(0, 9999999), 7)}`,
    accountName: comp.name,
    status: WITHDRAWAL_STATUS_POOL[i % WITHDRAWAL_STATUS_POOL.length],
    faceVerified: true,
    smsVerified: true,
    rejectReason: WITHDRAWAL_STATUS_POOL[i % WITHDRAWAL_STATUS_POOL.length] === 'REJECTED' ? '银行卡户名与实名不一致' : undefined,
    wxBatchNo: pick(['', `BT${int(100000, 999999)}`]) || undefined,
    createdAt: iso(int(0, 12), 11, int(0, 59)),
    reviewedAt: iso(0, 15, 30),
  };
});

// ---------------- 对账批次 ----------------
export interface MockRecon {
  id: string;
  batchNo: string;
  batchDate: string;
  channel: string;
  localCount: number;
  localAmountFen: string;
  wxCount: number;
  wxAmountFen: string;
  matchCount: number;
  diffCount: number;
  diffAmountFen: string;
  status: string;
  diffDetail?: { bizNo: string; local: string; wx: string; reason: string }[];
  resolveNote?: string;
  resolvedAt?: string;
  createdAt: string;
}
export const reconciliations: MockRecon[] = Array.from({ length: 16 }, (_, i) => {
  const channel = ['WX_PAY', 'WX_SHARING', 'WX_REFUND', 'WX_WITHDRAW'][i % 4];
  const localCount = int(80, 400);
  const localAmount = localCount * int(8000, 20000);
  const hasDiff = i % 5 === 0;
  const diffCount = hasDiff ? int(1, 3) : 0;
  const diffAmount = diffCount * int(1000, 9000);
  return {
    id: String(i + 1),
    batchNo: `RC${iso(i).slice(0, 10).replace(/-/g, '')}${channel.slice(3, 6)}`,
    batchDate: iso(i).slice(0, 10),
    channel,
    localCount,
    localAmountFen: String(localAmount),
    wxCount: localCount - diffCount,
    wxAmountFen: String(localAmount - diffAmount),
    matchCount: localCount - diffCount,
    diffCount,
    diffAmountFen: String(diffAmount),
    status: hasDiff ? (i === 5 ? 'RESOLVED' : 'DIFF') : 'MATCHED',
    diffDetail: hasDiff
      ? Array.from({ length: diffCount }, (_, d) => ({
          bizNo: `LB2026092${pad(d + 1, 5)}`,
          local: `¥${(int(1000, 9000) / 100).toFixed(2)}`,
          wx: '未查询到',
          reason: pick(['微信侧无此交易单号', '金额不一致', '重复支付回调']),
        }))
      : undefined,
    resolveNote: i === 5 ? '已与微信客服核实，为测试环境脏数据，忽略' : undefined,
    resolvedAt: i === 5 ? iso(2, 10) : undefined,
    createdAt: iso(i, 3, 0),
  };
});

// ---------------- 营销 ----------------
export interface MockGiftCard {
  id: string;
  cardNo: string;
  buyerName: string;
  recipientName: string;
  boundUserName?: string;
  faceAmountFen: string;
  durationMinutes: number;
  balanceAmountFen: string;
  balanceDurationMinutes: number;
  status: string;
  message?: string;
  purchasedAt: string;
  boundAt?: string;
  expiresAt?: string;
}
export const giftCards: MockGiftCard[] = Array.from({ length: 28 }, (_, i) => {
  const face = pick([20000, 50000, 100000]);
  const dur = face === 20000 ? 120 : face === 50000 ? 300 : 600;
  const status = ['ACTIVE', 'ACTIVE', 'ACTIVE', 'USED', 'EXPIRED', 'REFUNDED'][i % 6];
  return {
    id: String(i + 1),
    cardNo: `GC${iso(i).slice(0, 10).replace(/-/g, '')}${pad(i + 1, 4)}`,
    buyerName: mockNames(1)[0],
    recipientName: mockNames(1)[0],
    boundUserName: rand() < 0.7 ? mockNames(1)[0] : undefined,
    faceAmountFen: String(face),
    durationMinutes: dur,
    balanceAmountFen: status === 'USED' ? '0' : String(face),
    balanceDurationMinutes: status === 'USED' ? 0 : dur,
    status,
    message: pick(['妈妈，天冷了记得找人聊聊', '祝老爸身体健康', '母亲节快乐']),
    purchasedAt: iso(int(0, 60), 12),
    boundAt: rand() < 0.7 ? iso(int(0, 30), 12) : undefined,
    expiresAt: iso(-int(30, 300), 12),
  };
});

export interface MockDistributor {
  id: string;
  distributorNo: string;
  name: string;
  phone: string;
  communityName: string;
  inviteCode: string;
  status: string;
  totalCommissionFen: string;
  settledCommissionFen: string;
  pendingCommissionFen: string;
  createdAt: string;
}
export const distributors: MockDistributor[] = Array.from({ length: 9 }, (_, i) => {
  const total = int(200, 3000) * 100;
  const settled = Math.floor(total * 0.6);
  return {
    id: String(i + 1),
    distributorNo: `DT${pad(i + 1, 4)}`,
    name: mockNames(1)[0],
    phone: phone(),
    communityName: pick(['天河区华颖社区', '越秀区北京街', '海珠区赤岗街', '荔湾区金花街', '白云区三元里']) + `第${i + 1}分队`,
    inviteCode: `INV${pad(int(0, 9999), 4)}`,
    status: i === 8 ? 'FROZEN' : 'ACTIVE',
    totalCommissionFen: String(total),
    settledCommissionFen: String(settled),
    pendingCommissionFen: String(total - settled),
    createdAt: iso(int(30, 200)),
  };
});

export interface MockCommission {
  id: string;
  commissionNo: string;
  distributorId: string;
  orderId?: string;
  orderNo?: string;
  relatedUserName: string;
  type: string;
  amountFen: string;
  status: string;
  settledAt?: string;
  paidAt?: string;
  createdAt: string;
}
export const commissions: MockCommission[] = Array.from({ length: 36 }, (_, i) => {
  const dist = distributors[int(0, 7)];
  const isInvite = i % 5 === 0;
  const order = orders[int(0, 40)];
  const status = ['PENDING', 'PENDING', 'SETTLED', 'PAID', 'CANCELLED'][i % 5];
  return {
    id: String(i + 1),
    commissionNo: `CMS${pad(i + 1, 6)}`,
    distributorId: dist.id,
    orderId: isInvite ? undefined : order.id,
    orderNo: isInvite ? undefined : order.orderNo,
    relatedUserName: mockNames(1)[0],
    type: isInvite ? 'INVITE_REWARD' : 'ORDER_COMMISSION',
    amountFen: String(isInvite ? int(500, 2000) : int(200, 3000)),
    status,
    settledAt: status !== 'PENDING' ? iso(int(0, 20), 10) : undefined,
    paidAt: status === 'PAID' ? iso(int(0, 10), 10) : undefined,
    createdAt: iso(int(0, 40), 10),
  };
});

export interface MockCoupon {
  id: string;
  couponNo: string;
  name: string;
  type: string;
  /** 满减=减免分；时长=抵扣分钟（schema:1425 注释） */
  value: number;
  minSpendFen: string;
  validDays: number;
  totalCount: number;
  claimedCount: number;
  usedCount: number;
  status: string;
  scopeRules?: string;
  startAt?: string;
  endAt?: string;
  createdAt?: string;
  updatedAt?: string;
}
/**
 * 券模板 mock —— 刻意做出**核销率差异**，让运营一眼看出哪种券跑不动：
 * - CP0001 首单立减：门槛低 + 面值大 → 领了 1234 只用 856（69%），跑得动
 * - CP0002 重阳时长券：活动冲量 → 2000 领完 / 1543 核销（77%），最好的券
 * - CP0004 子女代付专享：门槛 ¥30 / 面值 ¥5 → 12 领 3 用（25%），**跑不动**
 * - CP0005 冬季暖心时长券：0 领 0 用 —— DRAFT 未投放，0 是"没发"，不是"跑不动"
 * - CP0006 老带新：门槛 ¥60 / 面值 ¥15 → 89 领 45 用（51%），中规中矩
 * 另有 CP0007「感知引流券」核销率 4%（19 领 1 用）—— 健康活动感知触点发的券，
 * 对应 PRD 裁定③「触达即发」：发得多、用得少，是这条链路当前最该盯的问题。
 */
export const coupons: MockCoupon[] = [
  {
    id: '1', couponNo: 'CPN0001', name: '新用户首单立减', type: 'FULL_REDUCTION', value: 1000,
    minSpendFen: '5000', validDays: 30, totalCount: 5000, claimedCount: 1234, usedCount: 856,
    status: 'ACTIVE', scopeRules: '{"serviceTypes":["CHAT"]}', startAt: iso(20), endAt: iso(-40),
    createdAt: iso(60, 9), updatedAt: iso(20, 9),
  },
  {
    id: '2', couponNo: 'CPN0002', name: '重阳节陪伴券', type: 'DURATION', value: 30,
    minSpendFen: '0', validDays: 15, totalCount: 2000, claimedCount: 2000, usedCount: 1543,
    status: 'ENDED', startAt: iso(45), endAt: iso(10),
    createdAt: iso(75, 9), updatedAt: iso(11, 9),
  },
  {
    id: '3', couponNo: 'CPN0003', name: '复购满减券', type: 'FULL_REDUCTION', value: 2000,
    minSpendFen: '12000', validDays: 30, totalCount: 0, claimedCount: 567, usedCount: 231,
    status: 'ACTIVE', scopeRules: '{"minOrderFen":12000}', startAt: iso(15),
    createdAt: iso(40, 9),
  },
  {
    // 核销率 25% —— 典型跑不动的券：门槛 ¥30 却只减¥5，老人觉得没用
    id: '4', couponNo: 'CPN0004', name: '子女代付专享券', type: 'FULL_REDUCTION', value: 500,
    minSpendFen: '3000', validDays: 60, totalCount: 1000, claimedCount: 12, usedCount: 3,
    status: 'PAUSED', scopeRules: '{"payerType":"FAMILY"}', startAt: iso(8),
    createdAt: iso(35, 9), updatedAt: iso(6, 15),
  },
  {
    id: '5', couponNo: 'CPN0005', name: '冬季暖心时长券', type: 'DURATION', value: 60,
    minSpendFen: '8000', validDays: 45, totalCount: 0, claimedCount: 0, usedCount: 0,
    status: 'DRAFT', createdAt: iso(5, 16),
  },
  {
    id: '6', couponNo: 'CPN0006', name: '老带新双方各得', type: 'FULL_REDUCTION', value: 1500,
    minSpendFen: '6000', validDays: 30, totalCount: 0, claimedCount: 89, usedCount: 45,
    status: 'ACTIVE', startAt: iso(30),
    createdAt: iso(50, 9),
  },
  {
    // 核销率 5% —— 健康活动感知触点发的引流券，触达即发但几乎不核销（当前最该盯的）
    id: '7', couponNo: 'CPN0007', name: '感知引流体验券', type: 'DURATION', value: 20,
    minSpendFen: '0', validDays: 7, totalCount: 10000, claimedCount: 419, usedCount: 22,
    status: 'ACTIVE', scopeRules: '{"source":["ACTIVITY_LEAD"]}', startAt: iso(12),
    createdAt: iso(14, 10), updatedAt: iso(3, 11),
  },
  {
    id: '8', couponNo: 'CPN0008', name: '端午孝心周满减', type: 'FULL_REDUCTION', value: 1200,
    minSpendFen: '10000', validDays: 20, totalCount: 3000, claimedCount: 1877, usedCount: 1301,
    status: 'ENDED', startAt: iso(100), endAt: iso(72),
    createdAt: iso(105, 9), updatedAt: iso(72, 9),
  },
];

export interface MockUserCoupon {
  id: string;
  couponId: string;
  couponName: string;
  userName: string;
  status: string;
  source: string;
  usedOrderNo?: string;
  receivedAt: string;
  expiredAt?: string;
}
export const userCoupons: MockUserCoupon[] = Array.from({ length: 40 }, (_, i) => {
  const c = coupons[i % coupons.length];
  const status = ['UNUSED', 'UNUSED', 'USED', 'EXPIRED'][i % 4];
  return {
    id: String(i + 1),
    couponId: c.id,
    couponName: c.name,
    userName: mockNames(1)[0],
    status,
    // 6 源轮转，与共享包 user_coupon_source 六值对齐（含 ACTIVITY_LEAD）
    source: ['MANUAL', 'REPURCHASE', 'INVITE', 'REPORT_REWARD', 'COMPLAINT', 'ACTIVITY_LEAD'][i % 6],
    usedOrderNo: status === 'USED' ? orders[i % orders.length].orderNo : undefined,
    receivedAt: iso(int(0, 40), 10),
    expiredAt: iso(-int(5, 60), 23),
  };
});

export interface MockInviteRule {
  id: string;
  name: string;
  rewardType: string;
  rewardValue: string;
  inviteeCondition: string;
  enabled: boolean;
  updatedAt?: string;
}
export const inviteRules: MockInviteRule[] = [
  { id: '1', name: '老带新·邀请人奖励', rewardType: 'COUPON', rewardValue: '6', inviteeCondition: '被邀请人完成首单', enabled: true, updatedAt: iso(3, 14) },
  { id: '2', name: '老带新·被邀请人奖励', rewardType: 'COUPON', rewardValue: '6', inviteeCondition: '注册后 7 日内完成首单', enabled: true, updatedAt: iso(3, 14) },
  { id: '3', name: '社区团长邀请奖励', rewardType: 'BALANCE', rewardValue: '3000', inviteeCondition: '被邀请人完成首单且订单实收 ≥ ¥60', enabled: true, updatedAt: iso(6, 14) },
];

// ---------------- 风控 ----------------
export interface MockComplaint {
  id: string;
  complaintNo: string;
  complainantName: string;
  complainantRole: string;
  targetType: string;
  targetId: string;
  orderId?: string;
  orderNo?: string;
  type: string;
  priority: string;
  description: string;
  status: string;
  handlerName?: string;
  compensationAmountFen: string;
  resultNote?: string;
  createdAt: string;
  handledAt?: string;
}
const COMPLAINT_TYPES = ['SERVICE_QUALITY', 'SAFETY', 'ATTITUDE', 'FEE', 'PRIVACY', 'OTHER'];
export const complaints: MockComplaint[] = Array.from({ length: 20 }, (_, i) => {
  const status = ['PENDING', 'PENDING', 'PROCESSING', 'RESOLVED', 'REJECTED'][i % 5];
  const order = orders[i % orders.length];
  return {
    id: String(i + 1),
    complaintNo: `CMP202609${pad(i + 1, 4)}`,
    complainantName: mockNames(1)[0],
    complainantRole: i % 3 === 0 ? 'COMPANION' : 'USER',
    targetType: i % 3 === 0 ? 'USER' : 'COMPANION',
    targetId: String(int(1, 40)),
    orderId: order.id,
    orderNo: order.orderNo,
    type: pick(COMPLAINT_TYPES),
    priority: ['LOW', 'NORMAL', 'NORMAL', 'HIGH', 'URGENT'][i % 5],
    description: pick([
      '陪聊员迟到 20 分钟，未提前沟通',
      '服务过程中频繁看手机，沟通态度敷衍',
      '老人反映陪聊员推销保健品',
      '服务时长与下单不符，提前离开',
      '沟通中提及线下交易，疑似飞单',
      '陪聊员投诉老人家属拖欠小费承诺',
    ]),
    status,
    handlerName: status === 'PENDING' ? undefined : mockNames(1)[0],
    compensationAmountFen: status === 'RESOLVED' ? String(pick([0, 1000, 2000, 5000])) : '0',
    resultNote: status === 'RESOLVED' ? '已联系双方核实，补偿优惠券并警告陪聊员' : status === 'REJECTED' ? '证据不足，驳回并留存记录' : undefined,
    createdAt: iso(int(0, 25), 10, int(0, 59)),
    handledAt: status === 'PENDING' || status === 'PROCESSING' ? undefined : iso(0, 16),
  };
});

export interface MockReport {
  id: string;
  reportNo: string;
  reporterName: string;
  reporterRole: string;
  targetType: string;
  targetId: string;
  targetName: string;
  orderId?: string;
  orderNo?: string;
  type: string;
  description: string;
  status: string;
  rewardStatus: string;
  rewardAmountFen: string;
  handlerName?: string;
  handleNote?: string;
  createdAt: string;
  handledAt?: string;
}
export const reports: MockReport[] = Array.from({ length: 16 }, (_, i) => {
  const status = ['PENDING', 'PENDING', 'SUBSTANTIATED', 'UNFOUNDED'][i % 4];
  const comp = companions[int(0, 25)];
  return {
    id: String(i + 1),
    reportNo: `RPT202609${pad(i + 1, 4)}`,
    reporterName: mockNames(1)[0],
    reporterRole: i % 2 === 0 ? 'USER' : 'COMPANION',
    targetType: 'COMPANION',
    targetId: comp.id,
    targetName: comp.name,
    orderId: orders[i % orders.length].id,
    orderNo: orders[i % orders.length].orderNo,
    // 🔴 事实源 = 服务端 zod `risk.routes.ts:36` 的 `z.enum(['FLY_ORDER','OFF_PLATFORM_PAY','OTHER'])`，
// **不是 schema 注释**。2026-10 核出四方分歧时schema 注释写的还是
// OFFLINE_PRICE/CONTACT_EXCHANGE/OTHER（内部建模名），端侧与服务端 zod 已一致。
// 业务语义上运营看到的是「飞单坐实」（FLY_ORDER），不是「线下价格」。
// 由 smoke.mjs 的「mock 举报类型 ≡ 服务端 zod」断言守住，改错会红。
type: ['FLY_ORDER', 'OFF_PLATFORM_PAY', 'OTHER'][i % 3],
    description: pick([
      '陪聊员私下说平台价太贵，加微信便宜一半',
      '服务结束后让我加他微信下次直接找他',
      '陪聊员透露可以线下现金交易',
    ]),
    status,
    rewardStatus: status === 'SUBSTANTIATED' ? (i % 8 === 2 ? 'PENDING' : 'PAID') : 'NONE',
    rewardAmountFen: status === 'SUBSTANTIATED' ? '2000' : '0',
    handlerName: status === 'PENDING' ? undefined : mockNames(1)[0],
    handleNote: status === 'PENDING' ? undefined : status === 'SUBSTANTIATED' ? 'IM 记录核实存在线下报价，属实' : '未发现违规沟通记录',
    createdAt: iso(int(0, 20), 10, int(0, 59)),
    handledAt: status === 'PENDING' ? undefined : iso(0, 15),
  };
});

export interface MockSamplingTask {
  id: string;
  taskNo: string;
  targetType: string;
  targetRef: string;
  subjectName: string;
  sampleRate: number;
  status: string;
  contentPreview: string;
  reviewerName?: string;
  reviewResult?: string;
  createdAt: string;
  reviewedAt?: string;
}
export const samplingTasks: MockSamplingTask[] = Array.from({ length: 24 }, (_, i) => {
  const status = ['PENDING', 'PENDING', 'REVIEWED'][i % 3];
  const result = status === 'REVIEWED' ? ['PASS', 'PASS', 'REJECT'][i % 3] : undefined;
  return {
    id: String(i + 1),
    taskNo: `TSK${pad(i + 1, 6)}`,
    targetType: ['AI_SESSION', 'AI_SESSION', 'IM_MESSAGE', 'REVISIT'][i % 4],
    targetRef: ['AS20260921', 'IM20260921', 'RV20260921'][i % 3] + pad(i + 1, 6),
    subjectName: mockNames(1)[0],
    sampleRate: 0.05,
    status,
    contentPreview: pick([
      '老人：今天天气好啊…陪聊：是啊张阿姨，适合去公园走走呢',
      '老人：我血压高是不是不能吃鸡蛋…AI：建议咨询医生哦',
      '陪聊员：加个微信下次便宜点（命中敏感词已拦截）',
      '老人：孩子们都忙，我一个人住…AI：那我陪您聊聊天',
    ]),
    reviewerName: status === 'REVIEWED' ? mockNames(1)[0] : undefined,
    reviewResult: result,
    createdAt: iso(int(0, 10), 9, int(0, 59)),
    reviewedAt: status === 'REVIEWED' ? iso(0, 14) : undefined,
  };
});

export interface MockRiskEvent {
  id: string;
  eventNo: string;
  type: string;
  level: string;
  subjectType: string;
  subjectId: string;
  subjectName: string;
  orderId?: string;
  orderNo?: string;
  ruleCode: string;
  hitDetail?: string;
  status: string;
  actionTaken?: string;
  handlerName?: string;
  handleNote?: string;
  createdAt: string;
  handledAt?: string;
}
const RISK_TYPES: [string, string, string][] = [
  ['SENSITIVE_WORD', 'IM_RULE_SW_001', '命中「加V/私下」敏感模式'],
  ['GPS_DEVIATION', 'VERIFY_RULE_GPS_002', '签到 GPS 偏差超阈值'],
  ['CANCEL_RATE', 'COMP_RULE_CR_003', '陪聊员取消率 > 30%'],
  ['OFFLINE_SUSPECT', 'IM_RULE_OS_004', '疑似线下交易沟通'],
  ['SOS', 'SOS_RULE_001', '老人端一键 SOS'],
  ['ABNORMAL_ORDER', 'ORDER_RULE_AO_005', '高频改价/短时间内重复下单'],
];

/**
 * 系统级事件（主体是接口而非用户）——服务端出参密文守卫自动落的那一类。
 *
 * 与用户风险**分两类生成**：主体是 API、subjectId 是端点路径、
 * hitDetail 是结构化 JSON 且**只含路径与键名不含值**（与承钧实现对齐）。
 * 混进用户风险那批会让前端那条「系统级 ≠ 用户风险」的分支在 mock 下永远走不到。
 */
const SYSTEM_RISK_EVENTS: MockRiskEvent[] = [
  {
    id: '901',
    eventNo: `RSK${pad(901, 6)}`,
    type: 'OUTBOUND_CIPHER_LEAK',
    level: 'CRITICAL',
    subjectType: 'API',
    subjectId: '/admin/orders',
    subjectName: '',
    orderId: '',
    orderNo: '',
    ruleCode: 'OUTBOUND_CIPHER_GUARD',
    hitDetail: JSON.stringify({
      requestId: 'req_mock_cipher_leak_001',
      method: 'GET',
      path: '/admin/orders',
      responseStatus: 200,
      strippedPaths: ['data.list[0].userPhone_cipher', 'data.list[0].userId_hmac'],
      strippedCount: 2,
      env: 'production',
    }),
    status: 'PENDING',
    createdAt: iso(0, 9, 30),
  },
];

/** 用户风险事件（主体是用户/订单/消息） */
const userRiskEvents: MockRiskEvent[] = Array.from({ length: 26 }, (_, i) => {
  const [type, rule, detail] = RISK_TYPES[i % RISK_TYPES.length];
  const status = ['PENDING', 'PENDING', 'PROCESSING', 'RESOLVED', 'FALSE_POSITIVE'][i % 5];
  const level = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'][i % 4];
  const order = orders[i % orders.length];
  return {
    id: String(i + 1),
    eventNo: `RSK${pad(i + 1, 6)}`,
    type,
    level,
    subjectType: type === 'SOS' ? 'ORDER' : i % 2 === 0 ? 'COMPANION' : 'IM_MESSAGE',
    subjectId: String(int(1, 40)),
    subjectName: mockNames(1)[0],
    orderId: order.id,
    orderNo: order.orderNo,
    ruleCode: rule,
    hitDetail: detail,
    status,
    actionTaken: status === 'PENDING' ? undefined : pick(['WARN', 'INTERCEPT', 'LIMIT', 'PENALTY', 'BAN']),
    handlerName: status === 'PENDING' ? undefined : mockNames(1)[0],
    handleNote: status === 'PENDING' ? undefined : '已按规则处置并通知当事人',
    createdAt: iso(int(0, 15), 10, int(0, 59)),
    handledAt: status === 'PENDING' ? undefined : iso(0, 17),
  };
});

/** 用户风险 + 系统级事件合并导出（系统级在前，运营打开页面第一眼就能看到 CRITICAL 告警） */
export const riskEvents: MockRiskEvent[] = [...SYSTEM_RISK_EVENTS, ...userRiskEvents];

// ---------------- 系统管理 ----------------
export interface MockAdmin {
  id: string;
  username: string;
  realName: string;
  phone: string;
  roleId: string;
  status: string;
  lastLoginAt?: string;
  createdAt: string;
}
export const adminAccounts: MockAdmin[] = [
  { id: '1', username: 'admin', realName: '岑执衡', phone: '13800000001', roleId: '1', status: 'ACTIVE', lastLoginAt: iso(0, 9, 12), createdAt: iso(200) },
  { id: '2', username: 'ops01', realName: '苏映棠', phone: '13800000002', roleId: '2', status: 'ACTIVE', lastLoginAt: iso(0, 8, 45), createdAt: iso(120) },
  { id: '3', username: 'ops02', realName: '顾图南', phone: '13800000003', roleId: '2', status: 'ACTIVE', lastLoginAt: iso(1, 10, 5), createdAt: iso(120) },
  { id: '4', username: 'finance01', realName: '宋砚秋', phone: '13800000004', roleId: '3', status: 'ACTIVE', lastLoginAt: iso(0, 9, 30), createdAt: iso(90) },
  { id: '5', username: 'cs01', realName: '霍承钧', phone: '13800000005', roleId: '4', status: 'ACTIVE', lastLoginAt: iso(2, 14, 20), createdAt: iso(60) },
  { id: '6', username: 'cs02', realName: '夏小笺', phone: '13800000006', roleId: '4', status: 'FROZEN', lastLoginAt: iso(10, 11), createdAt: iso(45) },
];

export interface MockRole {
  id: string;
  roleKey: string;
  name: string;
  description?: string;
  isSystem: boolean;
}
export const roles: MockRole[] = [
  { id: '1', roleKey: 'admin', name: '超级管理员', description: '全部权限，含系统与 RBAC 管理', isSystem: true },
  { id: '2', roleKey: 'ops', name: '运营', description: '审核、陪聊员、营销、风控运营', isSystem: true },
  { id: '3', roleKey: 'finance', name: '财务', description: '分账、提现、对账、抽成配置', isSystem: true },
  { id: '4', roleKey: 'cs', name: '客服', description: '订单裁决、投诉/举报处理', isSystem: true },
];

export interface MockConfig {
  configKey: string;
  configValue: string;
  valueType: string;
  description?: string;
  updatedBy?: string;
  updatedAt?: string;
}
/**
 * 系统配置种子：直接消费 @linban/shared 的 SYSTEM_CONFIG_DEFAULTS
 * （DATABASE.md §8 全量 15 项，含 team-lead 裁定③④ 与 split_mode），
 * 保证 mock 与真实库种子一致；updatedBy/updatedAt 为演示数据。
 */
export const systemConfigs: MockConfig[] = Object.entries(SYSTEM_CONFIG_DEFAULTS).map(([key, seed], i) => ({
  configKey: key,
  configValue: seed.value,
  valueType: seed.valueType,
  description: seed.description,
  updatedBy: i % 3 === 0 ? '系统' : i % 3 === 1 ? '岑执衡' : '宋砚秋',
  updatedAt: iso(2 + i, 15),
}));

// team-lead 新增规则：取消违约金 1000bp（后台可配）。
// 该键已由宋砚秋补入 @linban/shared 的 SYSTEM_CONFIG_DEFAULTS（constants.ts），
// 上面的 map 已自动包含它，**此处的 mock 层补位已删除**（避免第二份口径）。

/**
 * 配置变更历史（Mock）
 * ----------------------------------------------------------------------------
 * 落位口径：**不新建 config_change_logs 表**——schema 里配置变更与其它后台操作
 * 统一落`audit_logs`（module=system，变更前快照在 before_json / 变更后在 after_json）。
 * 故本mock 结构与 audit_logs 对齐，额外冗余 before/after 的**单键值对**便于列表直接展示。
 *
 * 页面须展示 requestId 与 IP：合规审计要能按 requestId 回溯到服务端日志，
 * 光有「谁改的」不足以定位问题。
 */
/**
 * 字段名对齐契约 §5.7.7：`configKey / beforeValue / afterValue / operator / changedAt / requestId`。
 * configLabel 是**前端补充字段**（契约未登记）：DB 里只有 key，中文名在前端映射，
 * 已列入偏差清单，霍承钧落地时可选择一并出参（前端两处都兼容）。
 */
export interface MockConfigChangeLog {
  id: string;
  /** 配置键（system_configs.config_key） */
  configKey: string;
  /** 配置项中文名（前端补充字段，便于财务/运营看懂改的是什么） */
  configLabel: string;
  /** 变更前值（字符串，金额类为分；原始落 audit_logs.before_json） */
  beforeValue: string;
  /** 变更后值（原始落 audit_logs.after_json） */
  afterValue: string;
  /** 操作人（契约字段名 operator，非 operatorName） */
  operator: string;
  requestId: string;
  ip: string;
  /** 变更时间（契约字段名 changedAt，非 createdAt） */
  changedAt: string;
}

/**
 * 变更历史刻意做成「不同操作人 + 不同配置域」，
 * 且覆盖几类典型场景：抽成下调（影响分账）、开关切换（夜间单）、阈值收紧（风控）、
 * 金额调整（举报奖励）、总开关关闭（健康感知下线）。
 * 全是同一个字段在改，会让页面看起来像玩具数据，也测不出按配置项筛选是否真的生效。
 */
export const configChangeLogs: MockConfigChangeLog[] = [
  { id: '1', configKey: 'commission_rate', configLabel: '平台抽成率', beforeValue: '600', afterValue: '500', operator: '岑执衡', requestId: 'req_881234', ip: '47.253.159.24', changedAt: iso(1, 15, 22) },
  { id: '2', configKey: 'activity_watch_enabled', configLabel: '健康活动感知总开关', beforeValue: 'true', afterValue: 'false', operator: '岑执衡', requestId: 'req_882910', ip: '47.253.159.24', changedAt: iso(2, 10, 8) },
  { id: '3', configKey: 'report_reward', configLabel: '举报飞单奖励额', beforeValue: '1000', afterValue: '2000', operator: '霍承钧', requestId: 'req_883517', ip: '119.29.34.61', changedAt: iso(3, 14, 55) },
  { id: '4', configKey: 'face_match_threshold', configLabel: '人脸匹配阈值', beforeValue: '0.75', afterValue: '0.82', operator: '宋砚秋', requestId: 'req_884032', ip: '119.29.34.77', changedAt: iso(4, 9, 12) },
  { id: '5', configKey: 'gps_max_deviation', configLabel: 'GPS 最大偏差（米）', beforeValue: '3000', afterValue: '2000', operator: '宋砚秋', requestId: 'req_885190', ip: '119.29.34.77', changedAt: iso(5, 11, 3) },
  { id: '6', configKey: 'night_confirm_timeout_min', configLabel: '夜间单子女确认超时（分钟）', beforeValue: '60', afterValue: '30', operator: '岑执衡', requestId: 'req_886402', ip: '47.253.159.24', changedAt: iso(6, 20, 41) },
  { id: '7', configKey: 'ai_sample_rate', configLabel: 'AI 抽检比例', beforeValue: '0.02', afterValue: '0.05', operator: '霍承钧', requestId: 'req_887015', ip: '119.29.34.61', changedAt: iso(8, 16, 30) },
  { id: '8', configKey: 'activity_signal_ttl', configLabel: '活动信号有效期（秒）', beforeValue: '43200', afterValue: '21600', operator: '顾图南', requestId: 'req_888230', ip: '113.240.18.9', changedAt: iso(10, 10, 5) },
  { id: '9', configKey: 'deposit_amount', configLabel: '保证金金额（分）', beforeValue: '50000', afterValue: '0', operator: '岑执衡', requestId: 'req_889644', ip: '47.253.159.24', changedAt: iso(13, 17, 50) },
  { id: '10', configKey: 'split_mode', configLabel: '分账执行模式', beforeValue: 'wechat_profit_sharing', afterValue: 'manual_settlement_fallback', operator: '霍承钧', requestId: 'req_890871', ip: '119.29.34.61', changedAt: iso(15, 23, 18) },
];

export interface MockAuditLog {
  id: string;
  adminId: string;
  adminName: string;
  action: string;
  module: string;
  targetType?: string;
  targetId?: string;
  requestId: string;
  ip: string;
  createdAt: string;
}
const AUDIT_ACTIONS: [string, string][] = [
  ['approve', 'companion'], ['reject', 'companion'], ['update', 'system'], ['view_l4', 'file'],
  ['approve', 'profit'], ['reject', 'profit'], ['handle', 'risk'], ['export', 'order'],
  ['create', 'marketing'], ['update', 'system'],
];
export const auditLogs: MockAuditLog[] = Array.from({ length: 80 }, (_, i) => {
  const [action, module] = AUDIT_ACTIONS[i % AUDIT_ACTIONS.length];
  const admin = adminAccounts[int(0, 5)];
  return {
    id: String(i + 1),
    adminId: admin.id,
    adminName: admin.realName,
    action,
    module,
    targetType: pick(['order', 'withdrawal', 'application', 'config', 'complaint', 'report']),
    targetId: String(int(1, 90)),
    requestId: `req_${int(100000, 999999)}`,
    ip: `47.253.159.${int(2, 250)}`,
    createdAt: iso(Math.floor(i / 6), int(8, 22), int(0, 59)),
  };
});

export interface MockBlacklist {
  id: string;
  targetType: string;
  targetId: string;
  targetName: string;
  deviceFingerprint?: string;
  reason: string;
  scope: string;
  status: string;
  expiresAt?: string;
  liftedAt?: string;
  liftReason?: string;
  createdAt: string;
}
export const blacklists: MockBlacklist[] = Array.from({ length: 14 }, (_, i) => {
  const targetType = ['USER', 'COMPANION', 'DEVICE'][i % 3];
  const status = i % 4 === 3 ? 'LIFTED' : 'ACTIVE';
  const comp = companions[int(0, 25)];
  return {
    id: String(i + 1),
    targetType,
    targetId: String(int(1, 40)),
    targetName: comp.name,
    deviceFingerprint: targetType === 'DEVICE' ? `fp_${int(10000000, 99999999)}abcdef` : undefined,
    reason: pick(['飞单坐实，保证金罚扣并清退', '私聊索要联系方式累计 3 次', '涉嫌诈骗被用户举报', '辱骂老人情节严重']),
    scope: ['PLATFORM', 'ORDER', 'IM', 'LOGIN'][i % 4],
    status,
    expiresAt: rand() < 0.3 ? iso(-int(10, 100)) : undefined,
    liftedAt: status === 'LIFTED' ? iso(int(1, 20), 12) : undefined,
    liftReason: status === 'LIFTED' ? '申诉成立，误封解除' : undefined,
    createdAt: iso(int(0, 60), 12),
  };
});

// ---------------- 登录账号（mock）----------------
export const mockLoginAccounts: Record<string, { password: string; roleId: string }> = {
  admin: { password: 'admin123', roleId: '1' },
  ops01: { password: 'ops123', roleId: '2' },
  finance01: { password: 'finance123', roleId: '3' },
  cs01: { password: 'cs123', roleId: '4' },
};

export const rolePermissions = (roleId: string): string[] => {
  const role = roles.find((r) => r.id === roleId);
  return role ? ROLE_DEFAULT_PERMISSIONS[role.roleKey] ?? [] : [];
};

export const mockAdminByUsername = (username: string) =>
  adminAccounts.find((a) => a.username === username);

export { iso as mockIso };
