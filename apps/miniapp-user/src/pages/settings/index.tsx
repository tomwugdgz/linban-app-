import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import ConfirmModal from '@/components/confirm-modal'
import { useRequireAuth } from '@/utils/hooks'
import { resetDb } from '@/services/mock/db'
import { config } from '@/services/request'
import { useSettingsStore } from '@/stores/settings'
import { requestCancel } from '@/services/user'
import { CS_PHONE } from '@/constants'
import { useState } from 'react'

// ============================================================================
// 设置：大字模式 / 语音优先 / 演示数据重置 / 注销说明 / 关于
// ============================================================================

const FONT_OPTIONS: { key: 'normal' | 'large' | 'xlarge'; label: string; desc: string }[] = [
  { key: 'normal', label: '标准', desc: '默认字号' },
  { key: 'large', label: '大字', desc: '放大 25%，适合多数老人' },
  { key: 'xlarge', label: '特大', desc: '放大 50%，视力减弱首选' },
]

export default function SettingsPage() {
  useRequireAuth()
  const fontScale = useSettingsStore((s) => s.fontScale)
  const setFontScale = useSettingsStore((s) => s.setFontScale)
  const voiceFirst = useSettingsStore((s) => s.voiceFirst)
  const setVoiceFirst = useSettingsStore((s) => s.setVoiceFirst)
  const [showCancel, setShowCancel] = useState(false)
  const [showReset, setShowReset] = useState(false)

  return (
    <PageWrap>
      {/* 大字模式 */}
      <View className="card">
        <Text className="t-strong">大字模式</Text>
        <Text className="t-sub mt-16" style="display: block;">
          全站文字与按钮同步缩放（CSS 变量驱动）
        </Text>
        <View className="col gap-16 mt-16">
          {FONT_OPTIONS.map((o) => (
            <View
              key={o.key}
              className="row-between"
              style={`background: ${fontScale === o.key ? 'var(--brand-light)' : '#f8f3ee'}; border-radius: 16rpx; padding: 24rpx;`}
              onClick={() => setFontScale(o.key)}
            >
              <View className="col">
                <Text className="t-strong">{o.label}</Text>
                <Text className="t-weak">{o.desc}</Text>
              </View>
              <View
                style={`width: 36rpx; height: 36rpx; border-radius: 50%; border: 2rpx solid ${
                  fontScale === o.key ? 'var(--brand)' : 'var(--text-weak)'
                }; background: ${fontScale === o.key ? 'var(--brand)' : 'transparent'}; display: flex; align-items: center; justify-content: center;`}
              >
                {fontScale === o.key ? <Text style="color: #fff; font-size: 24rpx;">✓</Text> : null}
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* 语音优先 */}
      <View className="card row-between">
        <View className="col flex-1">
          <Text className="t-strong">语音优先</Text>
          <Text className="t-sub">AI 陪聊默认按住说话，键盘输入作为兜底</Text>
        </View>
        <View className={`switch ${voiceFirst ? 'on' : ''}`} onClick={() => setVoiceFirst(!voiceFirst)}>
          <View className="switch-knob" />
        </View>
      </View>

      {/* 演示数据重置（仅 mock） */}
      {config.USE_MOCK ? (
        <View className="card">
          <Text className="t-strong">演示数据</Text>
          <Text className="t-sub mt-16" style="display: block;">
            当前为 mock 模式（无后端演示）。重置后恢复种子订单/券/卡数据。
          </Text>
          <View className="btn-ghost mt-16" onClick={() => setShowReset(true)}>
            重置演示数据
          </View>
        </View>
      ) : null}

      {/* 注销 */}
      <View className="card">
        <Text className="t-strong">注销账号</Text>
        <Text className="t-sub mt-16" style="display: block;">
          注销后有 15 天冷静期，到期匿名化。有进行中订单或未结算资金时无法注销。
        </Text>
        <View className="btn-danger mt-16" onClick={() => setShowCancel(true)}>
          申请注销
        </View>
      </View>

      {/* 关于 */}
      <View className="card">
        <Text className="t-strong">关于邻伴</Text>
        <Text className="t-sub mt-16" style="display: block;">
          版本 0.1.0（MVP 演示） · 广州单城
        </Text>
        <Text className="t-sub">客服 {CS_PHONE}</Text>
      </View>

      <ConfirmModal
        visible={showReset}
        title="重置演示数据？"
        content="将恢复初始种子数据（订单、优惠券、时长卡等），便于反复演示全链路。"
        confirmText="重置"
        onConfirm={() => {
          resetDb()
          setShowReset(false)
          Taro.showToast({ title: '已重置', icon: 'success' })
        }}
        onCancel={() => setShowReset(false)}
      />
      <ConfirmModal
        visible={showCancel}
        title="申请注销账号？"
        content="15 天冷静期内可撤销；到期后数据匿名化，资金订单记录依法保留。"
        confirmText="申请注销"
        danger
        onConfirm={async () => {
          try {
            await requestCancel()
            Taro.showToast({ title: '注销申请已提交', icon: 'success' })
          } catch {
            /* request 层已 toast */
          }
          setShowCancel(false)
        }}
        onCancel={() => setShowCancel(false)}
      />
    </PageWrap>
  )
}
