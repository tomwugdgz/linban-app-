import React, { useState } from 'react'
import { Switch, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import ConfirmModal from '@/components/confirm-modal'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'
import { CS_PHONE } from '@/constants'
import { clearCache } from '@/utils/storage'

// ============================================================================
// 设置：消息通知 / 隐私 / 字号 / 清除缓存 / 版本 / 客服 / 退出登录
// ----------------------------------------------------------------------------
// 通知开关目前落在本地（stores/settings → Storage），只控制端上提醒形态；
// TODO(联调)：订阅消息（微信小程序订阅消息）的开关要服务端下发模板 ID 并
//             调 wx.requestSubscribeMessage，不能只存本地，否则换端就失效。
// ============================================================================

/** 与 package.json version 保持一致；发版时同步 bump */
const APP_VERSION = '0.1.0'

export default function SettingsPage() {
  const fontScale = useSettingsStore((s) => s.fontScale)
  const setFontScale = useSettingsStore((s) => s.setFontScale)
  const voiceFirst = useSettingsStore((s) => s.voiceFirst)
  const setVoiceFirst = useSettingsStore((s) => s.setVoiceFirst)
  const notifyEnabled = useSettingsStore((s) => s.notifyEnabled)
  const setNotifyEnabled = useSettingsStore((s) => s.setNotifyEnabled)
  const notifyNewMessage = useSettingsStore((s) => s.notifyNewMessage)
  const setNotifyNewMessage = useSettingsStore((s) => s.setNotifyNewMessage)
  const privacyMaskOrderNo = useSettingsStore((s) => s.privacyMaskOrderNo)
  const setPrivacyMaskOrderNo = useSettingsStore((s) => s.setPrivacyMaskOrderNo)
  const logout = useAuthStore((s) => s.logout)
  const [showLogout, setShowLogout] = useState(false)
  const [cacheSize, setCacheSize] = useState('')

  const handleClearCache = () => {
    // 只清数据缓存（mock db / 设置 / 游标），**保留登录态**，
    // 否则清完就要重新登录，陪聊员会以为账号掉线。
    clearCache()
    setCacheSize('已清理')
    Taro.showToast({ title: '缓存已清理', icon: 'success' })
  }

  return (
    <PageWrap>
      {/* 消息通知 */}
      <View className="card col gap-8">
        <Text className="t-strong">消息通知</Text>
        <View className="row-between" style="padding: 16rpx 0;">
          <View className="col flex-1 gap-8">
            <Text className="t-body">接单提醒</Text>
            <Text className="t-weak">有匹配你时段的新单时提醒</Text>
          </View>
          <Switch
            checked={notifyEnabled}
            color="#FF6B35"
            disabled={!notifyEnabled}
            onChange={(e) => setNotifyEnabled(e.detail.value)}
          />
        </View>
        <View className="row-between" style="padding: 16rpx 0;">
          <View className="col flex-1 gap-8">
            <Text className="t-body">新消息提醒</Text>
            <Text className="t-weak">长辈在平台内发消息时提醒</Text>
          </View>
          <Switch
            checked={notifyNewMessage}
            color="#FF6B35"
            disabled={!notifyEnabled}
            onChange={(e) => setNotifyNewMessage(e.detail.value)}
          />
        </View>
        {!notifyEnabled ? (
          <Text className="t-weak">接单提醒已关闭，新消息提醒也一并暂停。</Text>
        ) : null}
      </View>

      {/* 隐私设置 */}
      <View className="card row-between">
        <View className="col flex-1 gap-8">
          <Text className="t-strong">订单号脱敏</Text>
          <Text className="t-weak">
            在列表与截图场景下隐藏完整订单号，避免服务记录外泄
          </Text>
        </View>
        <Switch
          checked={privacyMaskOrderNo}
          color="#FF6B35"
          onChange={(e) => setPrivacyMaskOrderNo(e.detail.value)}
        />
      </View>

      {/* 字号 */}
      <View className="card">
        <Text className="t-strong">字号</Text>
        <Text className="t-weak mt-16" style="display: block;">
          建议使用「大字」，服务过程中更好看清按钮与金额。
        </Text>
        <View className="row gap-16 mt-16">
          {(
            [
              { key: 'normal', label: '标准' },
              { key: 'large', label: '大字' },
              { key: 'xlarge', label: '超大' },
            ] as const
          ).map((f) => (
            <View
              key={f.key}
              className="flex-1"
              style={`text-align: center; padding: 24rpx 0; border-radius: 999rpx; font-size: calc(28rpx * var(--font-scale)); ${
                fontScale === f.key
                  ? 'background: var(--brand); color: #fff;'
                  : 'background: var(--brand-light); color: var(--brand-deep);'
              }`}
              onClick={() => setFontScale(f.key)}
            >
              {f.label}
            </View>
          ))}
        </View>
      </View>

      {/* 语音优先 */}
      <View className="card row-between">
        <View className="col flex-1 gap-8">
          <Text className="t-strong">语音优先</Text>
          <Text className="t-weak">优先展示语音消息与语音操作入口</Text>
        </View>
        <View
          className={`switch ${voiceFirst ? 'on' : ''}`}
          onClick={() => setVoiceFirst(!voiceFirst)}
        >
          <View className="switch-knob" />
        </View>
      </View>

      {/* 清除缓存 + 版本 */}
      <View className="card">
        <Text className="t-strong">存储与版本</Text>
        <View
          className="btn-ghost btn-block mt-16"
          onClick={handleClearCache}
        >
          清除缓存{cacheSize ? `（${cacheSize}）` : ''}
        </View>
        <Text className="t-weak mt-16" style="display: block;">
          清理不会退出登录。清理后首次打开会重新拉取服务端数据。
        </Text>
        <Text className="t-weak mt-16" style="display: block;">
          当前版本 v{APP_VERSION}
        </Text>
      </View>

      {/* 客服 */}
      <View className="card">
        <Text className="t-strong">联系客服</Text>
        <Text className="t-sub mt-16" style="display: block;">
          客服热线 {CS_PHONE}（每日 8:00–22:00）
        </Text>
        <View
          className="btn-ghost btn-block mt-16"
          onClick={() => Taro.makePhoneCall({ phoneNumber: CS_PHONE })}
        >
          📞 拨打客服热线
        </View>
      </View>

      {/* 退出 */}
      <View className="px-28" style="padding-bottom: 60rpx;">
        <View className="btn-danger btn-block" onClick={() => setShowLogout(true)}>
          退出登录
        </View>
      </View>

      <ConfirmModal
        visible={showLogout}
        title="确认退出登录？"
        content="退出后需重新登录才能接单，进行中的订单不受影响。"
        confirmText="退出登录"
        danger
        onConfirm={() => {
          setShowLogout(false)
          logout()
          Taro.reLaunch({ url: '/pages/login/index' })
        }}
        onCancel={() => setShowLogout(false)}
      />
    </PageWrap>
  )
}
