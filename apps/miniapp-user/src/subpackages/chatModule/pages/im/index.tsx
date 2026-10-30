import { useCallback, useEffect, useRef, useState } from 'react'
import { Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import { getOrCreateConversation, markRead, sendMessage } from '@/services/im'
import { recorderManager } from '@/services/wx/wechat'
import { useRequireAuth } from '@/utils/hooks'
import { formatTime } from '@/utils/format'
import type { ConversationDetail, MessageDTO } from '@/types'
import { im_sender_role } from '@linban/shared'

// ============================================================================
// 内置 IM（分包 chatModule）
// - 会话必须挂订单（红线：禁止脱离订单私聊）；
// - 服务端同步风控：命中手机号/微信号/外链模式 → BLOCKED（客户端只展示）；
// - 语音消息：按住说话（mock 用文本模拟 ASR；真实上传语音走 COS STS）。
// ============================================================================

export default function ImPage() {
  useRequireAuth()
  const router = Taro.getCurrentInstance().router
  const orderId = router?.params?.orderId || ''
  const [conv, setConv] = useState<ConversationDetail | null>(null)
  const [messages, setMessages] = useState<MessageDTO[]>([])
  const [draft, setDraft] = useState('')
  const [voiceMode, setVoiceMode] = useState(false)
  const [recording, setRecording] = useState(false)
  const scrollTo = useRef('')

  const load = useCallback(async () => {
    if (!orderId) return
    const c = await getOrCreateConversation(orderId)
    setConv(c)
    setMessages(c.messages)
    markRead(c.id).catch(() => undefined)
  }, [orderId])

  useEffect(() => {
    load()
  }, [load])

  const appendSent = (sent: MessageDTO[]) => {
    setMessages((prev) => [...prev, ...sent])
    // 滚动到底部（Taro 中用 scroll-into-view）
    setTimeout(() => {
      scrollTo.current = `msg_${Date.now()}`
    }, 50)
  }

  const handleSendText = async () => {
    const text = draft.trim()
    if (!text || !conv) return
    setDraft('')
    const sent = await sendMessage(conv.id, { msgType: 'TEXT', content: text })
    appendSent(sent)
  }

  const onVoiceStart = () => {
    setRecording(true)
    recorderManager()?.start({ duration: 60000, format: 'mp3' })
  }

  const onVoiceEnd = async () => {
    setRecording(false)
    recorderManager()?.stop()
    if (!conv) return
    // TODO(联调)：真实 = 录音文件 → COS STS 直传 → fileUrl；mock 用短语模拟 ASR
    const simulated = ['我快到家了，您到了吗？', '今天麻烦您多陪我妈坐会儿', '好的，谢谢您'].slice(
      0,
      1,
    )[0]
    const sent = await sendMessage(conv.id, { msgType: 'VOICE', content: simulated, voiceDurationMs: 3200 })
    appendSent(sent)
  }

  return (
    <PageWrap>
      {/* 风控提示条 */}
      <View style="background: var(--warning-bg); padding: 16rpx 28rpx;">
        <Text className="t-sub" style="color: var(--warning);">
          平台沟通全程留痕：请勿交换手机号/微信，私下交易不受平台保障。
        </Text>
      </View>

      {/* 消息列表 */}
      <View className="col gap-24 px-28" style="padding: 24rpx 0 220rpx;">
        {messages.map((m) => {
          if (m.senderRole === im_sender_role.SYSTEM) {
            return (
              <View key={m.id} id={`msg_${m.id}`} className="bubble bubble-system" style="align-self: center;">
                {m.content}
              </View>
            )
          }
          const mine = m.senderRole === im_sender_role.USER
          if (m.status === 'BLOCKED') {
            return (
              <View key={m.id} id={`msg_${m.id}`} className="col" style={`align-items: ${mine ? 'flex-end' : 'flex-start'};`}>
                <View className="bubble" style="background: var(--danger-bg); color: var(--danger);">
                  [已被平台拦截] {m.content}
                </View>
              </View>
            )
          }
          return (
            <View
              key={m.id}
              id={`msg_${m.id}`}
              className="row gap-16"
              style={{ justifyContent: mine ? 'flex-end' : 'flex-start' }}
            >
              {!mine ? (
                <View className="avatar" style="width: 64rpx; height: 64rpx; font-size: 28rpx;">
                  {conv?.peer?.nickname?.slice(0, 1) || '陪'}
                </View>
              ) : null}
              <View className="col" style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: '8rpx' }}>
                {m.msgType === 'VOICE' ? (
                  <View className={`bubble ${mine ? 'bubble-mine' : 'bubble-peer'} row gap-16`}>
                    <Text>🎙️</Text>
                    <Text>{Math.ceil((m.voiceDurationMs || 0) / 1000)} 秒</Text>
                  </View>
                ) : (
                  <View className={`bubble ${mine ? 'bubble-mine' : 'bubble-peer'}`}>{m.content}</View>
                )}
                <Text className="t-weak" style="font-size: 20rpx;">
                  {formatTime(m.createdAt)}
                </Text>
              </View>
            </View>
          )
        })}
        <View id={scrollTo.current} />
      </View>

      {/* 输入区 */}
      <View className="bottom-bar">
        {voiceMode ? (
          <View
            className={`btn-primary flex-1 ${recording ? '' : 'press-breathe'}`}
            style={recording ? 'background: var(--danger);' : ''}
            onTouchStart={onVoiceStart}
            onTouchEnd={onVoiceEnd}
          >
            {recording ? '松开发送语音' : '按住 说语音'}
          </View>
        ) : (
          <Input
            className="input-box flex-1"
            placeholder="说点什么…"
            value={draft}
            confirmType="send"
            onConfirm={handleSendText}
            onInput={(e) => setDraft(e.detail.value)}
          />
        )}
        <View className="btn-ghost" onClick={() => setVoiceMode(!voiceMode)}>
          {voiceMode ? '键盘' : '语音'}
        </View>
        {!voiceMode ? (
          <View className="btn-primary" style="min-width: 130rpx;" onClick={handleSendText}>
            发送
          </View>
        ) : null}
      </View>
    </PageWrap>
  )
}
