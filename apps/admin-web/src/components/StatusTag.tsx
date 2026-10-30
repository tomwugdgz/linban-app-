// ============================================================================
// StatusTag：枚举中文映射 + 语义配色，一处定义全局复用
// ============================================================================
import { Tag } from 'antd';
import {
  ACTIVITY_CONSENT_SCOPE,
  ACTIVITY_CONSENT_STATUS,
  ACTIVITY_STATUS,
  ACTIVITY_SUBSCRIPTION_STATUS,
  ACTIVITY_SUBSCRIPTION_TIER,
  ACTIVITY_TOUCHPOINT_TYPE,
  APPLICATION_STAGE,
  COMPANION_STATUS,
  COMPLAINT_PRIORITY,
  COMPLAINT_STATUS,
  COUPON_STATUS,
  enumColor,
  enumLabel,
  GIFT_CARD_STATUS,
  HEALTH_ALERT_LEVEL,
  HEALTH_ALERT_STATUS,
  HEALTH_ALERT_TYPE,
  ORDER_STATUS,
  PROFIT_SHARING_STATUS,
  RECON_STATUS,
  REPORT_REWARD_STATUS,
  REPORT_STATUS,
  RISK_EVENT_STATUS,
  RISK_LEVEL,
  USER_COUPON_SOURCE,
  USER_COUPON_STATUS,
  WIFI_DEVICE_STATUS,
  WITHDRAWAL_STATUS,
  COMMISSION_STATUS,
  ADMIN_STATUS,
} from '@/shared/enums';
import type { EnumOption } from '@/shared/enums';

type EnumMap = Record<string, EnumOption<string>>;

/** 可渲染的枚举域（与下方 MAPS 一一对应） */
export type StatusTagKind =
  | 'order' | 'sharing' | 'withdrawal' | 'recon' | 'application' | 'companion'
  | 'complaint' | 'complaintPriority' | 'report' | 'reportReward' | 'riskEvent' | 'riskLevel'
  | 'giftCard' | 'coupon' | 'commission' | 'admin'
  | 'userCoupon' | 'couponSource'
  // 健康活动感知（契约 §10）
  | 'activityStatus' | 'alertType' | 'alertLevel' | 'alertStatus'
  | 'wifiDevice' | 'consentStatus' | 'consentScope' | 'touchpoint'
  | 'subscriptionTier' | 'subscriptionStatus';

const MAPS: Record<StatusTagKind, EnumMap> = {
  order: ORDER_STATUS,
  sharing: PROFIT_SHARING_STATUS,
  withdrawal: WITHDRAWAL_STATUS,
  recon: RECON_STATUS,
  application: APPLICATION_STAGE,
  companion: COMPANION_STATUS,
  complaint: COMPLAINT_STATUS,
  complaintPriority: COMPLAINT_PRIORITY,
  report: REPORT_STATUS,
  reportReward: REPORT_REWARD_STATUS,
  riskEvent: RISK_EVENT_STATUS,
  riskLevel: RISK_LEVEL,
  giftCard: GIFT_CARD_STATUS,
  coupon: COUPON_STATUS,
  commission: COMMISSION_STATUS,
  admin: ADMIN_STATUS,
  userCoupon: USER_COUPON_STATUS,
  couponSource: USER_COUPON_SOURCE,
  activityStatus: ACTIVITY_STATUS,
  alertType: HEALTH_ALERT_TYPE,
  alertLevel: HEALTH_ALERT_LEVEL,
  alertStatus: HEALTH_ALERT_STATUS,
  wifiDevice: WIFI_DEVICE_STATUS,
  consentStatus: ACTIVITY_CONSENT_STATUS,
  consentScope: ACTIVITY_CONSENT_SCOPE,
  touchpoint: ACTIVITY_TOUCHPOINT_TYPE,
  subscriptionTier: ACTIVITY_SUBSCRIPTION_TIER,
  subscriptionStatus: ACTIVITY_SUBSCRIPTION_STATUS,
};

export function StatusTag({ kind, value }: { kind: StatusTagKind; value?: string | null }) {
  const map = MAPS[kind];
  if (!value) return <Tag>-</Tag>;
  return <Tag color={enumColor(map, value)}>{enumLabel(map, value)}</Tag>;
}
