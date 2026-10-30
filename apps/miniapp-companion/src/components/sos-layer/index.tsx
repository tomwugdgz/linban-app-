import { useEffect, useState } from 'react'
import { Input, Text, View } from '@tarojs/components'
import PageWrap from '../page-wrap'

// ============================================================================
// SOS 紧急求助红色浮层（不可撤销动作 · 前端唯一防线）
// ----------------------------------------------------------------------------
// 为什么必须做重：服务端 POST /risk/sos 一次调用即触发「CRITICAL 风控事件 +
// 到岗态立即 SUSPENDED + URGENT 投诉工单 + 紧急联系人模板短信 + 绑定子女 IM 通知」，
// **服务端不做二次确认**，所以防误触责任全在前端。误触的代价是惊动客服、
// 骚扰老人家属、订单无理由挂起。
//
// 四道防线（缺一不可）：
// 1. **红色全屏浮层**：入口常驻、不隐藏；浮层内不提供任何"稍后再说"式默认焦点；
// 2. **订单号 + 老人称呼回显**：让人能一眼确认没点错单（多单在跑时尤其重要）；
// 3. **3 秒倒计时**才放开确认按钮：挡住扫点式误触；倒计时期间按钮 disabled；
// 4. **提交中 loading + 禁止重复点击**：幂等键由 request.ts 的 Idempotency-Key 头
//    自动带，这里**不再自己造键**（造两套会导致服务端幂等判定失效）。
//
// 成功后按 suspended 分两种文案（服务端只有到岗态才挂起单）：
//   true  → 「订单已挂起，平台值守正在介入」
//   false → 「求助已发出，平台值守正在介入」
// ============================================================================

/** 防误触倒计时秒数 */
const COUNTDOWN_SEC = 3

export interface SosLayerProps {
  visible: boolean
  /** 订单号（回显，防点错单） */
  orderNo: string
  /** 老人称呼（回显，防点错单） */
  elderName: string
  submitting: boolean
  onCancel: () => void
  onConfirm: (description: string) => void
}

export default function SosLayer({
  visible,
  orderNo,
  elderName,
  submitting,
  onCancel,
  onConfirm,
}: SosLayerProps) {
  const [remain, setRemain] = useState(COUNTDOWN_SEC)
  const [desc, setDesc] = useState('')

  // 每次打开重置倒计时与描述：上一次的内容不该带进这一次
  useEffect(() => {
    if (visible) {
      setRemain(COUNTDOWN_SEC)
      setDesc('')
    }
  }, [visible])

  useEffect(() => {
    if (!visible || remain <= 0) return
    const timer = setTimeout(() => setRemain((n) => n - 1), 1000)
    return () => clearTimeout(timer)
  }, [visible, remain])

  if (!visible) return null

  const countable = remain > 0
  // 提交中一律禁止再次触发，避免重复建风控事件与重复短信
  const disabled = countable || submitting

  return (
    <PageWrap>
      <View className="sos-layer">
        <View className="sos-layer-badge">
          <Text className="sos-layer-badge-text">SOS</Text>
        </View>

        <Text className="sos-layer-title">确认发出紧急求助？</Text>
        <Text className="sos-layer-sub">此操作**不可撤销**，发出后无法自行取消</Text>

        {/* 不可撤销的后果：把「会惊动谁」讲清楚，避免用户事后说"我不知道" */}
        <View className="sos-layer-warn">
          <Text className="sos-layer-warn-text">发出后平台将立即执行：</Text>
          <Text className="sos-layer-warn-text">· 订单立即挂起（若处于服务中）</Text>
          <Text className="sos-layer-warn-text">· 平台值守客服介入，工单优先处理</Text>
          <Text className="sos-layer-warn-text">· 自动通知老人的紧急联系人与绑定子女</Text>
          <Text className="sos-layer-warn-text">· 订单恢复或终止由客服裁决，你无法在端上操作</Text>
        </View>

        {/* 回显订单与老人：防点错单 */}
        <View className="sos-layer-check">
          <View className="row-between">
            <Text className="t-weak">订单号</Text>
            <Text className="t-strong">{orderNo}</Text>
          </View>
          <View className="row-between">
            <Text className="t-weak">服务对象</Text>
            <Text className="t-strong">{elderName}</Text>
          </View>
          <Text className="t-weak">请核对无误后再发出。发错单会惊动无关人员。</Text>
        </View>

        {/* 事由（可选）：填了能让客服提前判断紧急程度，不填服务端兜底「一键求助」 */}
        <View className="sos-layer-field">
          <Text className="t-sub">补充说明（选填，最多 500 字）</Text>
          <View className="input-box mt-16">
            <Input
              placeholder="例如：老人身体不适 / 现场有异常情况"
              maxlength={500}
              value={desc}
              disabled={submitting}
              onInput={(e) => setDesc(e.detail.value)}
            />
          </View>
        </View>

        <View
          className={`sos-layer-btn ${disabled ? 'disabled' : ''}`}
          onClick={() => {
            if (disabled) return
            onConfirm(desc.trim())
          }}
        >
          {submitting
            ? '正在发出…'
            : countable
              ? `请确认（${remain} 秒后可发出）`
              : '确认发出求助'}
        </View>

        <View
          className="sos-layer-cancel"
          onClick={() => {
            // 提交中不允许取消：请求已发出，中途关闭会让用户以为没发出去
            if (submitting) return
            onCancel()
          }}
        >
          {submitting ? '发出中，请勿关闭' : '取消'}
        </View>
      </View>
    </PageWrap>
  )
}