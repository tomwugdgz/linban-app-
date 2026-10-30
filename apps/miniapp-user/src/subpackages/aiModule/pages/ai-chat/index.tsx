import { useCallback, useEffect, useRef, useState } from 'react'
import { Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import { createAiSession, aiTurnText, aiTurnVoice } from '@/services/ai'
import { recorderManager } from '@/services/wx/wechat'
import { useRequireAuth } from '@/utils/hooks'
import { AI_TOPIC_PHRASES } from '@/constants'
import type { AiChatMessage } from '@/types'

// ============================================================================
// AI 陪聊页（分包 aiModule）
// - 语音优先：大按钮按住说话（录音中动画 → 识别中 → 播放中）；
// - 文字兜底：键盘输入（适老：可随时切换）；
// - 话题引导：快捷短语 chips；
// - 双线转化：AI 回复附带真人预约引导卡片；
// - 危机信号：命中即停自由发挥，引导家人/客服（架构 §10.2）。
// ----------------------------------------------------------------------------
// mock 说明：ASR 用快捷短语模拟（真实：RecorderManager + ASR 供应商，TODO）；
// TTS 播放用计时器模拟进度（真实：InnerAudioContext + audioUrl）。
// ============================================================================

type Phase = 'idle' | 'recording' | 'thinking' | 'playing'

export default function AiChatPage() {
  useRequireAuth()
  const [sessionNo, setSessionNo] = useState('')
  const [messages, setMessages] = useState<AiChatMessage[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [textMode, setTextMode] = useState(false)
  const [draft, setDraft] = useState('')
  const [crisis, setCrisis] = useState(false)
  const [suggestHuman, setSuggestHuman] = useState(false)
  const playTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollRef = useRef<string>('')

  // 初始化会话
  useEffect(() => {
    createAiSession()
      .then((s) => {
        setSessionNo(s.sessionNo)
        setMessages([
          {
            id: 'welcome',
            role: 'ASSISTANT',
            content: '王阿姨您好，我是小邻。按住下方大按钮跟我说话就行，想聊什么都行。',
            createdAt: new Date().toISOString(),
          },
        ])
      })
      .catch(() => Taro.showToast({ title: 'AI 会话创建失败', icon: 'none' }))
    return () => {
      if (playTimer.current) clearTimeout(playTimer.current)
    }
  }, [])

  const appendTurn = useCallback((userText: string, assistantText: string, audioMs: number) => {
    const nowIso = new Date().toISOString()
    setMessages((prev) => [
      ...prev,
      { id: `u_${Date.now()}`, role: 'USER', content: userText, createdAt: nowIso },
      { id: `a_${Date.now()}`, role: 'ASSISTANT', content: assistantText, createdAt: nowIso },
    ])
    // 模拟 TTS 播放进度（真实：InnerAudioContext 播放 audioUrl）
    setPhase('playing')
    if (playTimer.current) clearTimeout(playTimer.current)
    playTimer.current = setTimeout(() => setPhase('idle'), Math.min(audioMs, 6000))
  }, [])

  const sendVoice = useCallback(
    async (asrText: string) => {
      if (!sessionNo || !asrText) return
      setPhase('thinking')
      try {
        const turn = await aiTurnVoice(sessionNo, asrText)
        appendTurn(turn.userText, turn.assistantText, turn.audioDurationMs || 4000)
        if (turn.crisisFlag) setCrisis(true)
        setSuggestHuman(turn.crisisFlag || suggestHuman)
      } catch {
        setPhase('idle')
      }
    },
    [sessionNo, appendTurn, suggestHuman],
  )

  const sendText = useCallback(async () => {
    const text = draft.trim()
    if (!text || !sessionNo) return
    setDraft('')
    setPhase('thinking')
    try {
      const turn = await aiTurnText(sessionNo, text)
      appendTurn(turn.userText, turn.assistantText, turn.audioDurationMs || 4000)
      if (turn.crisisFlag) setCrisis(true)
      setSuggestHuman(turn.crisisFlag || suggestHuman)
    } catch {
      setPhase('idle')
    }
  }, [draft, sessionNo, appendTurn, suggestHuman])

  // 按住说话：录音事件接线（mock 不产生真实音频，ASR 文本用短语模拟）
  const onPressStart = () => {
    setPhase('recording')
    const recorder = recorderManager()
    recorder?.start({ duration: 60000, format: 'mp3' })
  }
  const onPressEnd = () => {
    const recorder = recorderManager()
    recorder?.stop()
    // TODO(联调)：真实链路 = 录音 tempFilePath → ASR 供应商 → asrText；
    // mock：随机选一个话题短语模拟「语音识别结果」。
    const simulated = AI_TOPIC_PHRASES[Math.floor(Math.random() * AI_TOPIC_PHRASES.length)]
    sendVoice(simulated)
  }

  const stopPlaying = () => {
    if (playTimer.current) clearTimeout(playTimer.current)
    setPhase('idle')
  }

  return (
    <PageWrap>
      {/* 消息列表 */}
      <View className="col gap-24 px-28" style="padding: 24rpx 0 260rpx;">
        {messages.map((m) =>
          m.role === 'USER' ? (
            <View key={m.id} className="row" style="justify-content: flex-end;">
              <View className="bubble bubble-mine">{m.content}</View>
            </View>
          ) : (
            <View key={m.id} className="row gap-16">
              <View className="avatar" style="width: 64rpx; height: 64rpx; font-size: 28rpx;">
                邻
              </View>
              <View className="bubble bubble-peer">{m.content}</View>
            </View>
          ),
        )}

        {/* 状态提示 */}
        {phase === 'recording' ? (
          <View className="row gap-16">
            <View className="avatar" style="width: 64rpx; height: 64rpx; font-size: 28rpx;">
              邻
            </View>
            <View className="bubble bubble-peer row gap-16">
              <View className="voice-wave">
                <View className="voice-wave-bar" />
                <View className="voice-wave-bar" />
                <View className="voice-wave-bar" />
                <View className="voice-wave-bar" />
                <View className="voice-wave-bar" />
              </View>
              <Text className="t-sub">正在听您说…（松开发送）</Text>
            </View>
          </View>
        ) : null}
        {phase === 'thinking' ? (
          <View className="row gap-16">
            <View className="avatar" style="width: 64rpx; height: 64rpx; font-size: 28rpx;">
              邻
            </View>
            <View className="bubble bubble-peer">
              <Text className="t-sub">小邻正在想…</Text>
            </View>
          </View>
        ) : null}

        {/* 危机提示 */}
        {crisis ? (
          <View className="bubble bubble-system" style="background: var(--danger-bg); color: var(--danger);">
            如您感到不适，请马上联系女儿或拨打客服 020-8888-6666；紧急情况请拨打 120。
          </View>
        ) : null}

        {/* 双线转化卡片 */}
        {suggestHuman ? (
          <View className="card" style="background: var(--brand-light); margin: 0;">
            <Text className="t-strong">想和真人聊聊？</Text>
            <Text className="t-sub mt-16" style="display: block;">
              附近有多位通过四审的陪聊员，可预约到家附近散步、坐坐、聊聊天。
            </Text>
            <View
              className="btn-primary mt-16"
              onClick={() => Taro.navigateTo({ url: '/pages/companion-list/index' })}
            >
              看看附近的真人陪聊员
            </View>
          </View>
        ) : null}

        <Text className="t-weak" style="text-align: center;">
          AI 回复仅供参考，不构成医疗建议 · 内容经安全审核
        </Text>
      </View>

      {/* 话题引导快捷短语 */}
      <View
        className="row"
        style="position: fixed; left: 0; right: 0; bottom: 220rpx; padding: 16rpx 28rpx; gap: 16rpx; overflow-x: auto; background: transparent;"
      >
        {AI_TOPIC_PHRASES.map((p) => (
          <Text
            key={p}
            className="tag-plain"
            style="font-size: 24rpx; flex-shrink: 0; background: #fff;"
            onClick={() => {
              setDraft(p)
              setTextMode(true)
            }}
          >
            {p}
          </Text>
        ))}
      </View>

      {/* 底部输入区 */}
      <View className="bottom-bar" style="flex-direction: column; align-items: stretch; gap: 16rpx;">
        {phase === 'playing' ? (
          <View className="row gap-24">
            <View className="flex-1 row gap-16" style="background: #f8f3ee; border-radius: 999rpx; padding: 20rpx 28rpx;">
              <View className="voice-wave" style="height: 36rpx;">
                <View className="voice-wave-bar" />
                <View className="voice-wave-bar" />
                <View className="voice-wave-bar" />
              </View>
              <Text className="t-sub">小邻正在说话…</Text>
            </View>
            <View className="btn-ghost" onClick={stopPlaying}>
              停止
            </View>
          </View>
        ) : textMode ? (
          <View className="row gap-16">
            <Input
              className="input-box flex-1"
              placeholder="打字也可以，慢慢来"
              value={draft}
              confirmType="send"
              onConfirm={sendText}
              onInput={(e) => setDraft(e.detail.value)}
            />
            <View className="btn-primary" style="min-width: 140rpx;" onClick={sendText}>
              发送
            </View>
            <View className="btn-ghost" onClick={() => setTextMode(false)}>
              说话
            </View>
          </View>
        ) : (
          <View
            className={`btn-primary btn-block ${phase === 'recording' ? '' : 'press-breathe'}`}
            style={phase === 'recording' ? 'background: var(--danger);' : ''}
            onTouchStart={onPressStart}
            onTouchEnd={onPressEnd}
          >
            {phase === 'recording' ? '松开发送' : '按住 说话'}
          </View>
        )}
        {!textMode && phase !== 'playing' ? (
          <Text className="t-weak" style="text-align: center;" onClick={() => setTextMode(true)}>
            不方便说话？点这里用键盘
          </Text>
        ) : null}
      </View>
    </PageWrap>
  )
}
