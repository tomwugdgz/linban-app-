// 裂变营销 API（契约 §5 未覆盖，全部为前端补充端点，待后端补登记）
import { http } from './request';
import type {
  Commission,
  Coupon,
  CouponInput,
  Distributor,
  GiftCard,
  InviteRule,
  PageQuery,
  PageResult,
  UserCoupon,
} from '@/shared/types';

export const giftCardApi = {
  list(params: PageQuery & { status?: string; keyword?: string }) {
    return http.get<PageResult<GiftCard>>('/admin/gift-cards', params);
  },
  issue(data: {
    faceAmountFen: number;
    durationMinutes: number;
    buyerName: string;
    recipientName: string;
    message?: string;
    expiresAt?: string;
  }) {
    return http.post<GiftCard>('/admin/gift-cards/issue', data);
  },
};

export const distributorApi = {
  list(params: PageQuery & { status?: string; keyword?: string }) {
    return http.get<PageResult<Distributor>>('/admin/distributors', params);
  },
  /** 结算并打款该团长全部待结算佣金 */
  settleAll(distributorId: string) {
    return http.post<{ settledCount: number; settledAmountFen: string }>(`/admin/distributors/${distributorId}/settle-all`);
  },
};

export const commissionApi = {
  list(params: PageQuery & { status?: string; distributorId?: string }) {
    return http.get<PageResult<Commission>>('/admin/commissions', params);
  },
  settle(id: string) {
    return http.post<Commission>(`/admin/commissions/${id}/settle`);
  },
};

/**
 * 优惠券（契约 §5 未覆盖，全部为[前端补充]端点，待霍承钧补登记）。
 * 字段口径严格对齐 schema:1421 coupons；金额类字段一律字符串传「分」，
 * 端点落地时若契约改字段名，只需改 marketing.ts，页面不动。
 */
export const couponApi = {
  list(params: PageQuery & { status?: string; keyword?: string }) {
    return http.get<PageResult<Coupon>>('/admin/coupons', params);
  },
  /** 新建券模板；后端落 status=DRAFT，不直接投放（先审核再 ACTIVE） */
  create(data: CouponInput) {
    return http.post<Coupon>('/admin/coupons', data);
  },
  /**
   * 编辑券模板（[前端补充]端点，schema:1421 的 updated_at 需要它才有意义）。
   * TODO(契约 §5.x): 端点未登记；规则待主理人裁定——已发放的券改面值会让存量券
   * 面值与模板不一致，建议后端在 claimed_count > 0 时拒绝改value（返回 10001/10003）。
   */
  update(id: string, data: Partial<CouponInput>) {
    return http.put<Coupon>(`/admin/coupons/${id}`, data);
  },
  pause(id: string) {
    return http.post<Coupon>(`/admin/coupons/${id}/pause`);
  },
  resume(id: string) {
    return http.post<Coupon>(`/admin/coupons/${id}/resume`);
  },
  /** 投放（草稿 → 投放中）。TODO(契约): 与 create 同批待登记 */
  publish(id: string) {
    return http.post<Coupon>(`/admin/coupons/${id}/publish`);
  },
  /** 结束投放（活动到期/预算用尽）。结束后不可恢复，故与 pause 分离 */
  end(id: string) {
    return http.post<Coupon>(`/admin/coupons/${id}/end`);
  },
  /** 发放（后台定向发券） */
  grant(id: string, count: number) {
    return http.post<{ granted: number }>(`/admin/coupons/${id}/grant`, { count });
  },
  userCoupons(id: string, params: PageQuery) {
    return http.get<PageResult<UserCoupon>>(`/admin/coupons/${id}/user-coupons`, params);
  },
};

export const inviteRuleApi = {
  list() {
    return http.get<InviteRule[]>('/admin/invite-rules');
  },
  update(id: string, data: { rewardValue?: string; inviteeCondition?: string; enabled?: boolean }) {
    return http.put<InviteRule>(`/admin/invite-rules/${id}`, data);
  },
};
