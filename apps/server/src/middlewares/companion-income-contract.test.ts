// ============================================================================
// 邻伴 · 陪聊员资金三端点接线契约测试（静态溯源式）
// ----------------------------------------------------------------------------
// 与 revenue-endpoint-contract.test.ts 同一手法：读真源文件 + 断结构。
// 守护三条线：
//   ① 横向越权（companionId 必须来自 token）
//   ② 隐私（密文绝不出参）
//   ③ 口径同源（展示与扣减共用 domain 定义，不允许各写一份 where）
//
// ⚠️ **B 档声明：断言的是源码文本匹配，不保证运行时行为**（2026-10 分诊落笔）
//   主理人裁定「不整份挪成运行时断言，按脆性分诊」后，本文件定级 **B 档**：
//   - **本文件只保证「源码里有这段文本」**，**不保证「运行时真的这样」**。
//     例：`not.toMatch(/bankAccountCipher/)` 证明「源码里没写这个字段」，
//     但不证明「运行时出参里真的没有密文」—— 后者由
//     `outbound-cipher-guard.test.ts`（密文出参巡检）守。
//   - **为什么仍用源码断言**：路由出参结构是 handler 内拼装出来的，
//     **运行时拿不到**；「横向越权」要验的是「companionId 从 token 取」这件事
//     在源码里的来源，运行时打请求需要真实 DB（本项目无 MySQL 实例）。
//   - **不覆盖什么**（明确声明，避免后来人误以为「查过了，没事」）：
//     ① 运行时实际行为（见上）
//     ② 取不到路由块时的行为 —— **抛错而非降级**（见下方 routeBlock 注释）
// ============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SERVER_ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(SERVER_ROOT, rel), 'utf8');

const routes = read('modules/payment/payment.routes.ts');
const svc = read('modules/payment/companion-income.service.ts');
const domain = read('domain/companion-income.ts');
const crypto = read('common/crypto.ts');
const sharedDtos = read('../../../packages/shared/src/dto.ts');

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 取某路径路由的注册块。
 *
 * 终点必须匹配 `\n});`（handler 以 `});` 收尾），**不能**用 `\n);`：
 * 找不到就退化成固定长度截断 —— 那样「块内不含 X」的断言会因
 * 取样不全而**假通过**。这类「因为工具切歪了所以断言没生效」
 * 与断言写错一样危险，故这里找不到终点就抛错而非降级。
 */
function routeBlock(src: string, path: string): string {
  const idx = src.indexOf(`'${path}'`);
  if (idx < 0) throw new Error(`路径未找到：${path}`);
  const start = Math.max(src.lastIndexOf('.get(', idx), src.lastIndexOf('.post(', idx));
  if (start < 0) throw new Error(`未找到注册起点：${path}`);
  const end = src.indexOf('\n});', idx);
  if (end < 0) throw new Error(`未找到注册终点（\\n});）：${path}`);
  return src.slice(start, end + 4);
}

describe('§1 三个端点齐备且挂在 paymentRouter', () => {
  it('GET /payments/income/overview', () => {
    expect(routes).toContain("paymentRouter.get('/income/overview'");
  });

  it('GET /payments/sharings/mine', () => {
    expect(routes).toContain("paymentRouter.get('/sharings/mine'");
  });

  it('GET /payments/withdrawals', () => {
    expect(routes).toContain("paymentRouter.get('/withdrawals'");
  });

  it('三者均挂 authMiddleware', () => {
    for (const p of ['/income/overview', '/sharings/mine', '/withdrawals']) {
      expect(routeBlock(routes, p)).toContain('authMiddleware');
    }
  });

  it('/payments 复数前缀由 routes/index.ts 挂载（与契约 §3.3 一致）', () => {
    expect(read('routes/index.ts')).toContain("apiRouter.use('/payments', paymentRouter)");
  });
});

describe('§2 横向越权：companionId 一律来自 token，绝不接受端上传参', () => {
  it('三个端点的取数都以 req.user!.userId 为入口', () => {
    for (const p of ['/income/overview', '/sharings/mine', '/withdrawals']) {
      expect(routeBlock(routes, p)).toContain('req.user!.userId');
    }
  });

  it('service 层三函数第一参数均为 userId（不是 companionId）', () => {
    expect(svc).toMatch(/export async function getIncomeOverview\(userId: bigint\)/);
    expect(svc).toMatch(/export async function listMySharings\(\s*userId: bigint/);
    expect(svc).toMatch(/export async function listMyWithdrawals\(userId: bigint\)/);
  });

  it('companionId 一律经 requireCompanion(userId) 反查得到', () => {
    expect(svc).toContain('async function requireCompanion(userId: bigint)');
    expect(svc).toContain('where: { user_id: userId }');
  });

  it('**不接受端上传 companionId / companionUserId 参数**（改了就能看别人收入）', () => {
    for (const p of ['/income/overview', '/sharings/mine', '/withdrawals']) {
      const block = stripComments(routeBlock(routes, p));
      expect(block).not.toContain('companionId');
      expect(block).not.toContain('companionUserId');
    }
  });

  it('分账明细 where 带order.companion_id 限定（不靠 order_id 猜）', () => {
    expect(svc).toContain('where = { order: { companion_id: companion.id } }');
  });

  it('陪聊员主档不存在抛 13001（与既有提现端点同一码）', () => {
    expect(svc).toContain('13001');
  });
});

describe('§3 隐私：银行卡密文绝不出参（L3 加密铁律）', () => {
  it('提现列表 select 只取 bank_account_cipher，不取 account_name_cipher', () => {
    const clean = stripComments(svc);
    expect(clean).toContain('bank_account_cipher: true');
    //开户名同样敏感，且端侧 WithdrawalView 根本不用它
    expect(clean).not.toContain('account_name_cipher: true');
  });

  it('出参只给 bankAccountMasked，无任何 cipher 字段', () => {
    const clean = stripComments(svc);
    expect(clean).toContain('bankAccountMasked: maskedBankAccountOf(');
    expect(clean).not.toMatch(/bankAccountCipher|bank_account_cipher:\s*w\./);
  });

  it('**路由文件**出参也不得带 cipher（POST 端点在 routes 里拼出参，第一版漏扫了这里）', () => {
    // 这条是补自身漏洞：初版只扫 service，把routes 里
    // `data: { ..., cipher: w.bank_account_cipher }` 注进去，断言全绿。
    // 「不泄漏密文」必须同时覆盖两个拼出参的位置。
    const clean = stripComments(routes);
    expect(clean).not.toMatch(/cipher:\s*w\.bank_account_cipher/);
    expect(clean).not.toContain('accountNameCipher');
    expect(clean).not.toContain('bankAccountCipher');
  });

  it('maskedBankAccountOf 三条分支齐备：明文回落 / 解密 / 失败降级', () => {
    expect(svc).toContain("const PLAIN_DEV = 'PLAIN_DEV:'");
    expect(svc).toContain('cipher.startsWith(PLAIN_DEV)');
    expect(svc).toContain('safeDecrypt(cipher)');
    expect(svc).toContain("const BANK_MASK_UNAVAILABLE = '****'");
  });

  it('解密失败降级而非抛出（不因一条脏数据让整页500）', () => {
    expect(svc).toContain('if (!plain) return BANK_MASK_UNAVAILABLE');
  });

  it('safeDecrypt 已导出（两处脱敏通道复用同一实现，不各自 try/catch）', () => {
    expect(crypto).toMatch(/export function safeDecrypt\(/);
  });

  it('POST /payments/withdrawals 也复用同一脱敏通道（两处口径不漂移）', () => {
    expect(routes).toContain('bankAccountMasked: maskedBankAccountOf(w.bank_account_cipher)');
    expect(routes).not.toContain('maskIdCard');
  });

  it('POST 端点已移除 maskIdCard import（不再有第二套卡号脱敏）', () => {
    expect(stripComments(routes)).not.toContain('maskIdCard');
  });
});

describe('§4 口径同源：展示与扣减共用 domain（防资金超发）', () => {
  it('GET 概览聚合的 where 用 domain 的状态集合，不重写状态字面量', () => {
    expect(svc).toContain('[...LOCKED_WITHDRAWAL_STATUSES]');
    expect(svc).toContain('[...SETTLED_WITHDRAWAL_STATUSES]');
  });

  it('POST 提现的余额判定同样 import domain 定义', () => {
    expect(routes).toContain('LOCKED_WITHDRAWAL_STATUSES,');
    expect(routes).toContain('buildIncomeOverview');
    expect(routes).toContain('canWithdraw');
  });

  it('POST 端点**不再自带一份** withdrawn aggregate（此前漏 PENDING_REVIEW 可超发）', () => {
    const block = stripComments(routeBlock(routes, '/withdrawals'));
    // 注册块里不应出现手写的 status: { in: [...] } 字面量集合
    expect(block).not.toMatch(/status:\s*\{\s*in:\s*\[[^\]]*'[A-Z_]+'/);
  });

  it('余额装配统一走 buildIncomeOverview（负值钳 0 在域层生效）', () => {
    expect(domain).toContain('const raw = agg.totalSharedFen - agg.lockedFen');
    expect(domain).toContain('raw > 0n ? raw : 0n');
  });

  it('拒绝原因用 15015 且按 reason 分档文案（不给前端一个笼统的「失败」）', () => {
    expect(routes).toContain('15015');
    expect(routes).toContain("decision.reason === 'AMOUNT_NOT_POSITIVE'");
  });

  it('LOCKED_WITHDRAWAL_STATUSES 含 PENDING_REVIEW（超发防线）', () => {
    expect(domain).toMatch(/LOCKED_WITHDRAWAL_STATUSES[\s\S]{0,200}'PENDING_REVIEW'/);
  });
});

describe('§5 本月入账用 shared_at 而非 created_at', () => {
  it('本月聚合条件落在 shared_at 上', () => {
    expect(svc).toContain('shared_at: { gte: from, lt: to }');
  });

  it('不用 created_at 界定本月（created_at 是下单冻结时间，会把上月单算成本月收入）', () => {
    const clean = stripComments(svc);
    expect(clean).not.toMatch(/created_at:\s*\{\s*gte/);
  });

  it('月份边界用 UTC（跨时区会把订单划到错月）', () => {
    expect(svc).toContain('Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)');
  });

  it('区间为闭开 [from, lt: to]，月末当月最后一条不会漏', () => {
    expect(svc).toMatch(/gte: from,\s*lt: to/);
  });
});

describe('§6 分页与稳定性', () => {
  it('分账明细按 id 倒序（排序不稳定则翻页有重复/漏项）', () => {
    expect(svc).toContain("orderBy: { id: 'desc' }");
  });

  it('pageSize 上限 100（防止 pageSize=99999 拖库）', () => {
    expect(routeBlock(routes, '/sharings/mine')).toContain('max(100)');
  });

  it('分页出参含 list/total/page/pageSize（端侧 PageResult 形状）', () => {
    expect(routeBlock(routes, '/sharings/mine')).toContain('total: r.total');
    expect(routeBlock(routes, '/sharings/mine')).toContain('page: q.page');
  });

  it('提现记录出参是数组（非分页），与端侧 WithdrawalView[] 一致', () => {
    expect(svc).toMatch(/listMyWithdrawals\(userId: bigint\): Promise<WithdrawalMineRow\[\]>/);
  });

  it('提现记录有 take 上限并打 warn（不静默出残缺列表）', () => {
    expect(svc).toContain('take: 200');
    expect(svc).toContain('withdrawal-row-cap-hit');
  });
});

describe('§7 金额出参纪律（BigInt → string）', () => {
  it('概览五项全部 toString 化', () => {
    for (const f of ['availableFen', 'pendingFen', 'totalSharedFen', 'totalWithdrawnFen', 'monthSharedFen']) {
      expect(svc).toContain(`${f}: m.${f}.toString()`);
    }
  });

  it('分账明细四个金额字段全部字符串化', () => {
    for (const f of ['frozenAmountFen', 'platformCommissionFen', 'companionIncomeFen']) {
      expect(svc).toContain(`${f}: r.`);
    }
    expect(svc).toContain('frozen_amount_fen.toString()');
  });

  it('commissionRateBp 是 number（基点整数，非金额，不字符串化）', () => {
    expect(svc).toContain('commissionRateBp: r.commission_rate_bp');
    expect(sharedDtos).toContain('commissionRateBp: number');
  });

  it('时长来自订单而非分账表（分账表不存 duration）', () => {
    expect(svc).toContain('durationMinutes: r.order.duration_minutes');
  });
});