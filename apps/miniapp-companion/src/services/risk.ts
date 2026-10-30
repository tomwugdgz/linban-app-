// ============================================================================
// 风控服务（举报 / 投诉 / 我的投诉）
// ----------------------------------------------------------------------------
// 对齐服务端 apps/server/src/modules/risk/risk.routes.ts 的三个用户侧端点。
//
// **分工边界（勿重复实现）**：SOS 走 `order.ts` 的 `reportSos`，不在本文件。
//   原因：SOS 是「订单动作」——服务端POST /risk/sos 依赖 orderId 且会改订单状态
//   （sosSuspendable → SUSPENDED），归到 order.ts 的动作链里语义更顺；
//   本文件只管「不直接改订单状态」的举报与投诉。
//
// 三条端侧铁律：
// 1. **金额一律字符串**：compensationAmountFen 服务端是 BigInt.toString()，
//    前端禁浮点、禁 Number()，展示前走 utils/format.fenToYuan。
// 2. **description 长度 10–1000 前端先校验**：服务端 zod 是 .min(10).max(1000)，
//    不先校验就提交等于让用户白跑一趟再吃一个 10009。
// 3. **20005 不是「提交失败」**：服务端对「同订单同举报人已有 PENDING」抛
//    20005 REPORT_ALREADY_HANDLED，语义是「你已举报过，正在核查」，
//    页面文案必须与真失败区分，否则用户以为没提交成功又点一次。
// ============================================================================

import { http } from './request'
import type { MyComplaintView, PageResult } from '@/types'

/** 飞单举报类型（服务端 z.enum，对齐 §8 防飞单机制 5：查实奖励 ¥20 券） */
export type ReportType = 'FLY_ORDER' | 'OFF_PLATFORM_PAY' | 'OTHER'

/** 投诉类型（服务端 z.enum） */
export type ComplaintType = 'SERVICE_QUALITY' | 'ATTITUDE' | 'SAFETY' | 'CHARGE' | 'OTHER'

/** 举报/投诉描述的字数边界（与服务端 zod 保持一致，改这里必须同步服务端） */
export const DESC_MIN = 10
export const DESC_MAX = 1000

/** 证据文件数量上限（服务端 z.array(idSchema).max(9)） */
const EVIDENCE_MAX = 9

/** 提交入参（举报与投诉共用字段结构，服务端 schema 完全一致） */
export interface RiskSubmitInput {
  orderId: string
  description: string
  /** 证据文件ID列表（file_meta.id，来自图片上传接口），最多 9 个 */
  evidenceFileIds?: string[]
}

/** 提交结果（服务端返回 `{ reportNo|complaintNo, status }`） */
export interface RiskSubmitResult {
  /** 举报单号或投诉单号 */
  no: string
  /** 提交后的状态，服务端固定 PENDING */
  status: string
}

/** 端侧长度校验：返回 null 表示通过，否则返回可直接展示给用户的原因 */
export function validateDescription(desc: string): string | null {
  const len = desc.trim().length
  if (len === 0) return '请先填写具体情况'
  if (len < DESC_MIN) return `请至少填写 ${DESC_MIN} 个字，让平台能判断是否需要立案`
  if (len > DESC_MAX) return `请控制在 ${DESC_MAX} 字以内，当前 ${len} 字`
  return null
}

/**
 * 端侧校验失败的本地错误（不发请求）。
 * 用 10009 SYSTEM_PARAM_INVALID 与服务端 zod 失败对齐，页面可复用同一套文案处理。
 */
export class LocalValidationError extends Error {
  code = 10009
  constructor(message: string) {
    super(message)
    this.name = 'LocalValidationError'
  }
}

/** 提交前统一校验：长度不达标就地拦下，不浪费一次往返 */
function assertDescription(desc: string): string {
  const err = validateDescription(desc)
  if (err) throw new LocalValidationError(err)
  return desc.trim()
}

/**
 * 提交飞单举报（POST /risk/reports）
 *
 * 服务端约束（risk.routes.ts）：
 * - `type` 必填枚举；`description` 10–1000 字；`evidenceFileIds` 最多 9 个；
 * - 被服务的陪聊员不能举报自己服务的订单 → 20006；
 * - 同订单同举报人已有 PENDING → 20005「举报已受理，请耐心等待核查」
 *   （**这是"已提交"不是"失败"**，页面要分开文案）。
 *
 * @param type 举报类型
 * @param input 订单号 + 描述 + 证据
 */
export async function submitReport(
  type: ReportType,
  input: RiskSubmitInput,
): Promise<RiskSubmitResult> {
  // 长度校验前置：服务端 zod 是 .min(10).max(1000)，不先拦就是白跑一趟再吃 10009
  const description = assertDescription(input.description)
  const res = await http.post<{ reportNo?: string; complaintNo?: string; status?: string }>(
    '/risk/reports',
    {
      orderId: input.orderId,
      type,
      description,
      ...(input.evidenceFileIds && input.evidenceFileIds.length
        ? { evidenceFileIds: input.evidenceFileIds.slice(0, EVIDENCE_MAX) }
        : {}),
    },
  )
  return { no: res.reportNo || '', status: res.status || 'PENDING' }
}

/**
 * 提交服务纠纷投诉（POST /risk/complaints）
 *
 * 服务端固定 priority='NORMAL'，端上不传；受理后会推 IM 系统消息给投诉人。
 *
 * @param type 投诉类型
 * @param input 订单号 + 描述 + 证据
 */
export async function submitComplaint(
  type: ComplaintType,
  input: RiskSubmitInput,
): Promise<RiskSubmitResult> {
  // 同submitReport：长度校验前置，不浪费往返
  const description = assertDescription(input.description)
  const res = await http.post<{ reportNo?: string; complaintNo?: string; status?: string }>(
    '/risk/complaints',
    {
      orderId: input.orderId,
      type,
      description,
      ...(input.evidenceFileIds && input.evidenceFileIds.length
        ? { evidenceFileIds: input.evidenceFileIds.slice(0, EVIDENCE_MAX) }
        : {}),
    },
  )
  return { no: res.complaintNo || '', status: res.status || 'PENDING' }
}

/**
 * 我的投诉列表（GET /risk/complaints/mine）
 *
 * 主理人裁定（2026-10）：服务端 `take: 50` 硬编码不是分页，投诉超 50 条后用户
 * 看不到自己的历史 —— 改为真分页（page/pageSize 参数 + `{list,total,page,pageSize}`
 * 信封），已请霍承钧改服务端返回。
 *
 * 过渡期兼容：服务端**当前仍是裸数组**（risk.routes.ts `data: list.map(...)`），
 * 所以这里同时接受两种形态 —— 拿到数组就包成第1 页，拿到信封就用信封。
 * 这样服务端改完前端不用再动，也避免现在线上取到 undefined 后 list.map 崩。
 * 待霍承钧改完并联调确认后，可删掉数组分支。
 *
 * 字段 compensationAmountFen 是**字符串**（BigInt 序列化，前端禁转 Number）。
 */
export async function fetchMyComplaints(
  page = 1,
  pageSize = 20,
): Promise<PageResult<MyComplaintView>> {
  const raw = await http.get<MyComplaintView[] | PageResult<MyComplaintView>>(
    `/risk/complaints/mine?page=${page}&pageSize=${pageSize}`,
  )
  // 分页信封（服务端改造后）
  if (raw && !Array.isArray(raw) && Array.isArray((raw as PageResult<MyComplaintView>).list)) {
    return raw as PageResult<MyComplaintView>
  }
  // 裸数组（服务端现状）→ 包成第 1 页
  // 🔴 裸数组兼容分支（2026-10-22 主理人裁定：服务端改分页信封后删除）
  //    现状：服务端仍返回裸数组（`take:50`），此分支兜住
  //    删除条件：服务端改为分页信封 + 联调确认
  //    ⚠️ 提前删会导致过渡期直接崩 —— 不是「字段读不到」，
  //       是「raw.list 不是数组 → .map 不是函数」→ 页面白屏。
  const list = Array.isArray(raw) ? raw : []
  return { list, total: list.length, page: 1, pageSize: list.length }
}