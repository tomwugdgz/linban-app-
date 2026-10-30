import { useCallback, useState } from 'react'
import { Text, View } from '@tarojs/components'
import { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import EmptyState from '@/components/empty-state'
import { fetchCreditLogs, fetchMyCompanion } from '@/services/companion'
import { useRequireCompanion } from '@/utils/hooks'
import { formatDateTime } from '@/utils/format'
import { CREDIT_LEVELS, CREDIT_LOG_META, CREDIT_RULES } from '@/constants'
import type { CompanionSelfView, CreditLogDTO } from '@/types'

// ============================================================================
// 信用分与规则（契约 §4.4 GET /companion/me/credit-logs）
// ----------------------------------------------------------------------------
// 红线 §7.2.4：信用分只读 —— 陪聊员端只能看 credit-logs，调整仅后台（留痕 operator）。
//
// 产品硬要求：**信用分是派单资格闸门**，所以页面顶部必须说清「分数低会怎样」：
// 只显示一个数字没有意义，陪聊员要能预判后果（限流 = 派单优先级下降、
// 冻结 = 接单大厅不可接单）。状态三态由服务端 self.status + self.limited 派生。
// ============================================================================

/** 派单资格三态：正常 / 限流中 / 冻结中 */
type CreditGate = 'NORMAL' | 'LIMITED' | 'FROZEN'

const GATE_META: Record<CreditGate, { label: string; color: string; bg: string; effect: string }> = {
  NORMAL: {
    label: '正常',
    color: '#1F7A4D',
    bg: '#E8F5EE',
    effect: '可正常在接单大厅抢单，信用分越高派单优先级越靠前。',
  },
  LIMITED: {
    label: '限流中',
    color: '#B26B00',
    bg: '#FFF3E0',
    effect: '仍可接单，但派单优先级明显下降、广播单抢单难度变大，收入会受影响。',
  },
  FROZEN: {
    label: '冻结中',
    color: '#B3261E',
    bg: '#FDECEA',
    effect: '已暂停接单：接单大厅不可抢单、无法开始新服务，需联系平台客服申诉核实后才能恢复。',
  },
}

/** 由服务端主档派生派单资格状态 */
function gateOf(self: CompanionSelfView | null): CreditGate {
  if (!self) return 'NORMAL'
  // SUSPENDED/BANNED = 平台侧冻结；limited = 信用限流
  if (self.status === 'SUSPENDED' || self.status === 'BANNED') return 'FROZEN'
  if (self.limited || self.status === 'PENDING') return 'LIMITED'
  return 'NORMAL'
}

export default function CreditPage() {
  useRequireCompanion()
  const [self, setSelf] = useState<CompanionSelfView | null>(null)
  const [logs, setLogs] = useState<CreditLogDTO[]>([])

  const load = useCallback(async () => {
    const [s, l] = await Promise.all([
      fetchMyCompanion().catch(() => null),
      fetchCreditLogs().catch(() => [] as CreditLogDTO[]),
    ])
    setSelf(s)
    setLogs(l)
  }, [])

  useDidShow(load)
  usePullDownRefresh(load)

  const score = self?.creditScore ?? 0
  const level = CREDIT_LEVELS.find((l) => score >= l.min) || CREDIT_LEVELS[CREDIT_LEVELS.length - 1]
  const gate = gateOf(self)
  const gateMeta = GATE_META[gate]

  return (
    <PageWrap>
      {/* 顶部后果说明：信用分是派单资格闸门，必须让陪聊员知道「低了会怎样」 */}
      {gate !== 'NORMAL' ? (
        <View className="px-28">
          <View className="card col gap-8" style={`background: ${gateMeta.bg};`}>
            <Text className="t-strong" style={{ color: gateMeta.color }}>
              {gate === 'FROZEN' ? '接单资格已冻结' : '派单已被限流'}
            </Text>
            <Text className="t-weak">{gateMeta.effect}</Text>
            <Text className="t-weak">如有异议请联系平台客服申诉，平台会核实后人工调整并留痕。</Text>
          </View>
        </View>
      ) : null}

      {/* 分数卡：大字号 + 派单资格状态标签 */}
      <View className="card" style={`background: ${gateMeta.bg};`}>
        <View className="row-between">
          <View className="col gap-8">
            <Text className="t-sub">我的信用分</Text>
            <Text className="t-hero" style={{ color: gateMeta.color }}>
              {score}
            </Text>
          </View>
          <View className="col" style={{ alignItems: 'flex-end' }}>
            <View className="row" style={{ 'gap': '12rpx' }}>
              <View className="status-chip" style={`color: ${level.color}; background: #fff;`}>
                {level.label}
              </View>
              <View className="status-chip" style={`color: ${gateMeta.color}; background: #fff;`}>
                {gateMeta.label}
              </View>
            </View>
            <Text className="t-weak mt-16" style="text-align: right;">
              {level.desc}
            </Text>
          </View>
        </View>
        <Text className="t-body mt-16" style="display: block;">
          {gateMeta.effect}
        </Text>
        {self?.limited ? (
          <Text className="t-body mt-16" style="display: block; color: var(--danger);">
            您当前被限制接单，请联系平台客服申诉。
          </Text>
        ) : null}
      </View>

      {/* 规则 */}
      <View className="card">
        <Text className="t-strong">信用分规则</Text>
        <View className="col mt-16">
          {CREDIT_RULES.map((r) => (
            <View
              key={r.title}
              className="row-between"
              style="'padding': '20rpx' 0; border-bottom: 1rpx solid var(--line);"
            >
              <View className="col flex-1 gap-8">
                <Text className="t-body">{r.title}</Text>
                <Text className="t-weak">{r.desc}</Text>
              </View>
              <Text className="t-strong" style="color: var(--brand-deep);">
                {r.value}
              </Text>
            </View>
          ))}
        </View>
        <Text className="t-weak mt-16" style="display: block;">
          信用分调整由平台后台操作并留痕，如对结果有异议请联系客服。
        </Text>
      </View>

      {/* 明细 */}
      <View className="card">
        <Text className="t-strong">信用分明细</Text>
        {logs.length === 0 ? (
          <EmptyState icon="⭐" title="暂无信用分变动" desc="完成服务并收到评价后会在这里显示" />
        ) : (
          <View className="col mt-16">
            {logs.map((l) => (
              <View
                key={l.id}
                className="row-between"
                style="'padding': '20rpx' 0; border-bottom: 1rpx solid var(--line);"
              >
                <View className="col flex-1 gap-8">
                  <Text className="t-body">{CREDIT_LOG_META[l.type] || l.type}</Text>
                  <Text className="t-weak">{l.reason}</Text>
                  <Text className="t-weak">{formatDateTime(l.createdAt)}</Text>
                </View>
                <View className="col" style={{ alignItems: 'flex-end' }}>
                  <Text
                    className="t-strong"
                    style={`color: ${l.changeScore >= 0 ? 'var(--success)' : 'var(--danger)'};`}
                  >
                    {l.changeScore >= 0 ? `+${l.changeScore}` : l.changeScore}
                  </Text>
                  <Text className="t-weak">{l.afterScore} 分</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </PageWrap>
  )
}
