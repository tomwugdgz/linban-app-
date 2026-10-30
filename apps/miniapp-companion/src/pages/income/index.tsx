import { useCallback, useState } from 'react'
import { Input, Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import EmptyState from '@/components/empty-state'
import { fetchIncomeOverview } from '@/services/income'
import {
  applyWithdrawal,
  fetchSharingRecords,
  fetchSplitMode,
  fetchWithdrawals,
} from '@/services/payment'
import { useRequireCompanion } from '@/utils/hooks'
import { fenToYuan, formatDateTime, yuanToFen } from '@/utils/format'
import { genIdempotencyKey } from '@/utils/storage'
import {
  WITHDRAWAL_STATUS_META,
  WITHDRAW_MIN_FEN,
  WITHDRAW_MAX_FEN,
  WITHDRAW_WECHAT_ENABLED,
} from '@/constants'
import type { IncomeOverview, SharingRecordView, SplitModeView, WithdrawalView } from '@/types'

// ============================================================================
// 收入中心（余额 / 分账明细 / 提现）
// ----------------------------------------------------------------------------
// 三条硬规则（主理人派单二）：
// 1. 金额一律「分」传输与存储，展示前 ÷100（统一走 utils/format.fenToYuan）。
// 2. **待分账 / 分账中 / 已分账三态必须区分**：
//    FROZEN + 订单未完成 → 待分账（钱冻结着，防飞单财务基石）
//    FROZEN + 订单已完成 → 分账中（微信分账执行中，失败重试 <3 次后转人工）
//    SHARED              → 已分账（可提现）
//    页面必须能解释「为什么钱还没到账」——这是陪聊员最大的投诉来源。
// 3. **预估到手金额一律从服务端取**（分账明细里的 companionIncomeFen /
//    platformCommissionFen / commissionRateBp），前端不硬编码 5–10% 佣金。
// 提现为资金写操作：service 层带幂等键，重复提交不会重复出款。
// ============================================================================

/** 分账三态（由 sharing.status + 订单完成态派生，展示层不自行猜测） */
type SharingPhase = 'PENDING' | 'SHARING' | 'SHARED' | 'RETURNED'

const PHASE_META: Record<SharingPhase, { label: string; color: string; bg: string }> = {
  PENDING: { label: '待分账', color: '#8A7B6E', bg: '#f6efe9' },
  SHARING: { label: '分账中', color: '#B26B00', bg: '#FFF3E0' },
  SHARED: { label: '已分账', color: '#1F7A4D', bg: '#E8F5EE' },
  RETURNED: { label: '已回退', color: '#B3261E', bg: '#FDECEA' },
}

/** 「为什么钱还没到账」——按三态给可执行解释，不让陪聊员猜 */
const PHASE_EXPLAIN: Record<SharingPhase, string> = {
  PENDING: '服务尚未完成核销，款项处于冻结状态，完成并双方确认后进入分账。',
  SHARING: '服务已完成，微信分账指令执行中，通常几分钟内到账；若失败会自动重试，超过 3 次转平台人工结算。',
  SHARED: '已分账到你的账户，可在「可提现余额」中申请提现。',
  RETURNED: '该订单发生退款，分账已回退，此笔收入不计入可提现余额。',
}

export default function IncomePage() {
  useRequireCompanion()
  const [overview, setOverview] = useState<IncomeOverview | null>(null)
  const [sharings, setSharings] = useState<SharingRecordView[]>([])
  const [withdrawals, setWithdrawals] = useState<WithdrawalView[]>([])
  const [splitMode, setSplitMode] = useState<SplitModeView | null>(null)
  const [tab, setTab] = useState<'detail' | 'withdraw'>('detail')
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [amount, setAmount] = useState('')
  const [wechatPay, setWechatPay] = useState(false)
  const [bankName, setBankName] = useState('中国银行')
  const [bankAccount, setBankAccount] = useState('')
  const [accountName, setAccountName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [o, s, w, m] = await Promise.all([
      fetchIncomeOverview().catch(() => null),
      fetchSharingRecords().catch(() => null),
      fetchWithdrawals().catch(() => [] as WithdrawalView[]),
      fetchSplitMode().catch(() => null),
    ])
    setOverview(o)
    setSharings(s?.list || [])
    setWithdrawals(w)
    setSplitMode(m)
  }, [])

  useDidShow(load)
  usePullDownRefresh(load)

  /** 分账三态派生：SHARED/RETURNED 看 status，FROZEN 再看订单是否已完成 */
  const phaseOf = (s: SharingRecordView): SharingPhase => {
    if (s.status === 'SHARED') return 'SHARED'
    if (s.status === 'RETURNED') return 'RETURNED'
    // FROZEN：有分账时间说明分账指令已发起（分账中），否则仍是待分账
    return s.sharedAt ? 'SHARING' : 'PENDING'
  }

  /** 校验微信收款信息（切到微信收款时卡号必须是微信号而非银行卡号） */
  const validateWechatAccount = (): boolean => {
    const v = bankAccount.trim()
    if (!v) {
      Taro.showToast({ title: '请填写微信号', icon: 'none' })
      return false
    }
    // 微信号：6–20 位，字母开头，只含字母/数字/下划线/减号
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{5,19}$/.test(v)) {
      Taro.showToast({
        title: '微信号格式不对：6–20 位，字母开头',
        icon: 'none',
        duration: 2500,
      })
      return false
    }
    return true
  }

  const validateBankAccount = (): boolean => {
    const v = bankAccount.replace(/\s/g, '')
    if (!v) {
      Taro.showToast({ title: '请填写收款银行卡号', icon: 'none' })
      return false
    }
    if (!/^\d{16,19}$/.test(v)) {
      Taro.showToast({ title: '银行卡号应为 16–19 位数字', icon: 'none', duration: 2500 })
      return false
    }
    if (!accountName.trim()) {
      Taro.showToast({ title: '请填写收款人姓名', icon: 'none' })
      return false
    }
    return true
  }

  const handleWithdraw = async () => {
    const amountFen = yuanToFen(amount)
    if (!amountFen || amountFen <= 0) {
      Taro.showToast({ title: '请输入提现金额', icon: 'none' })
      return
    }
    if (amountFen < WITHDRAW_MIN_FEN || amountFen > WITHDRAW_MAX_FEN) {
      Taro.showToast({
        title: `单笔提现 ${fenToYuan(WITHDRAW_MIN_FEN, true)}–${fenToYuan(WITHDRAW_MAX_FEN, true)}`,
        icon: 'none',
        duration: 2500,
      })
      return
    }
    if (overview && amountFen > Number(overview.availableFen)) {
      Taro.showToast({ title: '超出可提现余额', icon: 'none' })
      return
    }
    if (!(wechatPay ? validateWechatAccount() : validateBankAccount())) return

    setShowWithdraw(false)
    setBusy(true)
    try {
      await applyWithdrawal(
        {
          amountFen: String(amountFen),
          bankName: wechatPay ? '微信零钱' : bankName.trim(),
          bankAccount: bankAccount.trim(),
          accountName: accountName.trim() || bankAccount.trim(),
          // TODO(联调)：人脸/短信二次验证的 verifyToken 由风控下发后随请求带上
          faceVerified: true,
          smsVerified: true,
        },
        // 资金动作必须带幂等键：同一笔提现的重试复用同一个键，避免重复出款
        genIdempotencyKey('wd'),
      )
      setAmount('')
      setBankAccount('')
      setAccountName('')
      Taro.showToast({ title: '提现申请已提交', icon: 'success' })
      load()
    } catch (e) {
      // 提现失败必须给出明确原因（余额不足 / 风控拦截 / 审核不通过），
      // 不允许只弹「操作失败」让陪聊员猜。
      Taro.showToast({
        title: e instanceof Error ? e.message : '提现失败，请稍后重试或联系客服',
        icon: 'none',
        duration: 2500,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageWrap>
      {/* 余额卡：今日 / 本月 / 累计三档金额 */}
      {overview ? (
        <View className="card" style="background: linear-gradient(135deg, #ff9a6e, #e55a1b);">
          <Text className="t-sub" style="color: #ffe8dc;">
            可提现余额
          </Text>
          <Text className="t-hero" style="color: #fff;">
            {fenToYuan(overview.availableFen, true)}
          </Text>
          <View className="row mt-16" style="gap: 32rpx;">
            <View className="col">
              <Text className="t-sub" style="color: #ffe8dc;">
                本月入账
              </Text>
              <Text className="t-strong" style="color: #fff;">
                {fenToYuan(overview.monthSharedFen, true)}
              </Text>
            </View>
            <View className="col">
              <Text className="t-sub" style="color: #ffe8dc;">
                待入账
              </Text>
              <Text className="t-strong" style="color: #fff;">
                {fenToYuan(overview.pendingFen, true)}
              </Text>
            </View>
            <View className="col">
              <Text className="t-sub" style="color: #ffe8dc;">
                累计入账
              </Text>
              <Text className="t-strong" style="color: #fff;">
                {fenToYuan(overview.totalSharedFen, true)}
              </Text>
            </View>
          </View>
          <Text className="t-weak mt-16" style="display: block; color: #ffe8dc;">
            累计提现 {fenToYuan(overview.totalWithdrawnFen, true)} · 服务核销完成前为「待分账」，暂不可提现
          </Text>
        </View>
      ) : null}

      {/* 分账模式兜底提示：人工结算模式下必须说清「钱由平台人工打」 */}
      {splitMode && splitMode.manualSettlement ? (
        <View className="px-28">
          <View className="card col gap-8" style="background: var(--warning-bg);">
            <Text className="t-strong" style="color: var(--warning);">
              当前为平台人工结算模式
            </Text>
            <Text className="t-weak">
              {splitMode.tip ||
                '资金由平台人工结算：服务完成并确认后，平台将人工打款到你的账户，预计 1-3 个工作日到账。'}
            </Text>
          </View>
        </View>
      ) : null}

      {/* 提现按钮 */}
      <View className="px-28">
        <View className="btn-primary btn-block" onClick={() => setShowWithdraw(true)}>
          申请提现
        </View>
      </View>

      {/* 分段 */}
      <View className="px-28" style="padding: 24rpx 28rpx;">
        <View className="segment">
          <View
            className={`segment-item ${tab === 'detail' ? 'active' : ''}`}
            onClick={() => setTab('detail')}
          >
            分账明细
          </View>
          <View
            className={`segment-item ${tab === 'withdraw' ? 'active' : ''}`}
            onClick={() => setTab('withdraw')}
          >
            提现记录
          </View>
        </View>
      </View>

      {tab === 'detail' ? (
        sharings.length === 0 ? (
          <EmptyState
            icon="💰"
            title="暂无分账记录"
            desc="完成服务并经双方确认后，收入会出现在这里"
          />
        ) : (
          sharings.map((s) => {
            const phase = phaseOf(s)
            const meta = PHASE_META[phase]
            return (
              <View key={s.sharingNo} className="card col gap-16">
                <View className="row-between">
                  <Text className="t-strong">单号 {s.orderNo}</Text>
                  <View className="status-chip" style={`color: ${meta.color}; background: ${meta.bg};`}>
                    {meta.label}
                  </View>
                </View>
                <View className="row-between">
                  <Text className="t-sub">预估到手</Text>
                  <Text className="t-price">{fenToYuan(s.companionIncomeFen, true)}</Text>
                </View>
                <View className="row-between">
                  <Text className="t-sub">订单金额</Text>
                  <Text className="t-body">{fenToYuan(s.frozenAmountFen, true)}</Text>
                </View>
                <View className="row-between">
                  <Text className="t-sub">平台服务费</Text>
                  <Text className="t-body">
                    {fenToYuan(s.platformCommissionFen, true)}（{(s.commissionRateBp / 100).toFixed(0)}%）
                  </Text>
                </View>
                <View className="row-between">
                  <Text className="t-sub">服务时长</Text>
                  <Text className="t-body">{s.durationMinutes ? `${s.durationMinutes} 分钟` : '—'}</Text>
                </View>
                <Text className="t-weak">
                  {PHASE_EXPLAIN[phase]}
                </Text>
                <Text className="t-weak">
                  {phase === 'SHARED'
                    ? `入账时间 ${s.sharedAt ? formatDateTime(s.sharedAt) : '—'}`
                    : `创建时间 ${formatDateTime(s.createdAt)}`}
                </Text>
              </View>
            )
          })
        )
      ) : withdrawals.length === 0 ? (
        <EmptyState
          icon="🧾"
          title="暂无提现记录"
          desc={`单笔 ${fenToYuan(WITHDRAW_MIN_FEN, true)}–${fenToYuan(WITHDRAW_MAX_FEN, true)}，提交后进入财务审核`}
        />
      ) : (
        withdrawals.map((w) => {
          const meta = WITHDRAWAL_STATUS_META[w.status] || { label: w.status, color: '#8A7B6E' }
          return (
            <View key={w.withdrawalNo} className="card row-between">
              <View className="col gap-8">
                <Text className="t-strong">{fenToYuan(w.amountFen, true)}</Text>
                <Text className="t-weak">
                  {w.withdrawalNo} · 收款 {w.bankAccountMasked}
                </Text>
              </View>
              <View className="status-chip" style={`color: ${meta.color}; background: #f6efe9;`}>
                {meta.label}
              </View>
            </View>
          )
        })
      )}

      {showWithdraw ? (
        <View className="modal-mask" onClick={() => setShowWithdraw(false)}>
          <View className="modal-box col gap-16" onClick={(e) => e.stopPropagation()}>
            <Text className="t-title">提现信息</Text>

            {/*
              收款方式：银行卡 / 微信零钱
              主理人裁定（2026-10）：MVP **只支持银行卡**——withdrawals 表只有
              bankName/bankAccount，而「微信商家转账到零钱」需要企业资质 + 单独开通，
              属于 W1 进件阻塞的一部分，Phase 4 再放行。
              代码（校验规则 / 提交分支）已完整保留，Phase 4 把下方开关置 true
              即可放出入口，不需要重写提现逻辑。
            */}
            <View className="segment">
              <View
                className={`segment-item ${!wechatPay ? 'active' : ''}`}
                onClick={() => setWechatPay(false)}
              >
                银行卡
              </View>
              {WITHDRAW_WECHAT_ENABLED ? (
                <View
                  className={`segment-item ${wechatPay ? 'active' : ''}`}
                  onClick={() => setWechatPay(true)}
                >
                  微信
                </View>
              ) : null}
            </View>

            <View>
              <Text className="field-label">提现金额（元）</Text>
              <View className="input-box">
                <Input
                  type="digit"
                  placeholder={`${fenToYuan(WITHDRAW_MIN_FEN)} – ${fenToYuan(WITHDRAW_MAX_FEN)}`}
                  value={amount}
                  onInput={(e) => setAmount(e.detail.value)}
                />
              </View>
              {overview ? (
                <Text className="t-weak">可提现 {fenToYuan(overview.availableFen, true)}</Text>
              ) : null}
            </View>

            {!wechatPay ? (
              <View>
                <Text className="field-label">开户银行</Text>
                <View className="input-box">
                  <Input value={bankName} onInput={(e) => setBankName(e.detail.value)} />
                </View>
              </View>
            ) : null}

            <View>
              <Text className="field-label">{wechatPay ? '微信号' : '银行卡号'}</Text>
              <View className="input-box">
                <Input
                  type={wechatPay ? 'text' : 'number'}
                  maxlength={wechatPay ? 20 : 24}
                  placeholder={wechatPay ? '请输入微信号（字母开头，6–20 位）' : '请输入收款银行卡号'}
                  value={bankAccount}
                  onInput={(e) => setBankAccount(e.detail.value)}
                />
              </View>
            </View>

            <View>
              <Text className="field-label">收款人姓名</Text>
              <View className="input-box">
                <Input
                  placeholder={wechatPay ? '微信号默认取微信昵称，可留空' : '请输入持卡人姓名'}
                  value={accountName}
                  onInput={(e) => setAccountName(e.detail.value)}
                />
              </View>
            </View>

            <Text className="t-weak">
              提现需完成人脸与短信二次验证（演示环境自动置为已验证）。资金到账以财务审核为准。
            </Text>

            <View className="row gap-16">
              <View className="btn-ghost flex-1" onClick={() => setShowWithdraw(false)}>
                取消
              </View>
              <View className="btn-primary flex-1" onClick={handleWithdraw}>
                提交
              </View>
            </View>
          </View>
        </View>
      ) : null}

      {busy ? (
        <View className="modal-mask">
          <View className="modal-box">
            <Text className="t-strong">提交中，请稍候…</Text>
          </View>
        </View>
      ) : null}
    </PageWrap>
  )
}