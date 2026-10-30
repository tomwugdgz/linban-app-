import { useCallback, useState } from 'react'
import { Input, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import { useAuthStore } from '@/stores/auth'
import { wxLogin } from '@/services/auth'
import { useSettingsStore } from '@/stores/settings'

// ============================================================================
// 陪聊员端登录：微信一键登录（主）+ 手机号验证码登录（备）
// - 微信 code 交服务端换 openid/session；无凭证时走 mock；
// - 登录后进入工作台（未通过四审会引导去入驻流程）。
// ============================================================================

export default function LoginPage() {
  const setLogin = useAuthStore((s) => s.setLogin)
  const fontScale = useSettingsStore((s) => s.fontScale)
  const setFontScale = useSettingsStore((s) => s.setFontScale)
  const [loading, setLoading] = useState(false)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [showPhone, setShowPhone] = useState(false)

  const doLogin = useCallback(async () => {
    setLoading(true)
    try {
      const res = await wxLogin('张阿姨')
      setLogin(res)
      Taro.showToast({ title: '登录成功', icon: 'success' })
      Taro.reLaunch({ url: '/pages/home/index' })
    } catch (e) {
      Taro.showToast({
        title: e instanceof Error ? e.message : '登录失败，请重试',
        icon: 'none',
      })
    } finally {
      setLoading(false)
    }
  }, [setLogin])

  const doPhoneLogin = useCallback(async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      Taro.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    if (!code) {
      Taro.showToast({ title: '请输入验证码', icon: 'none' })
      return
    }
    setLoading(true)
    try {
      const { phoneLogin } = await import('@/services/auth')
      const res = await phoneLogin(phone, code)
      setLogin(res)
      Taro.reLaunch({ url: '/pages/home/index' })
    } catch (e) {
      Taro.showToast({ title: e instanceof Error ? e.message : '登录失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }, [phone, code, setLogin])

  useDidShow(() => {
    // 已登录直接进工作台
    if (useAuthStore.getState().accessToken) {
      Taro.reLaunch({ url: '/pages/home/index' })
    }
  })

  return (
    <PageWrap>
      <View className="col px-28" style="padding-top: 120rpx; gap: 24rpx;">
        <Text className="t-hero">邻伴·陪聊员</Text>
        <Text className="t-sub">
          登录后即可接单、到岗核销、查看收入。首次使用请先完成实名与四项入驻审核。
        </Text>

        {/* 微信一键登录 */}
        <View
          className="btn-primary btn-block mt-24"
          style={loading ? 'opacity: 0.6;' : ''}
          onClick={doLogin}
        >
          {loading ? '登录中…' : '微信一键登录'}
        </View>

        <View className="row-between mt-16">
          <View className="divider flex-1" style="margin: 0;" />
          <Text className="t-weak" style="margin: 0 16rpx;">
            其他方式
          </Text>
          <View className="divider flex-1" style="margin: 0;" />
        </View>

        {!showPhone ? (
          <View className="btn-ghost btn-block" onClick={() => setShowPhone(true)}>
            手机号 + 验证码登录
          </View>
        ) : (
          <View className="card col gap-16">
            <View>
              <Text className="field-label">手机号</Text>
              <View className="input-box">
                <Input
                  type="number"
                  maxlength={11}
                  placeholder="请输入手机号"
                  value={phone}
                  onInput={(e) => setPhone(e.detail.value)}
                />
              </View>
            </View>
            <View>
              <Text className="field-label">验证码</Text>
              <View className="input-box">
                <Input
                  type="number"
                  maxlength={6}
                  placeholder="请输入验证码"
                  value={code}
                  onInput={(e) => setCode(e.detail.value)}
                />
              </View>
            </View>
            <View className="row gap-16">
              <View className="btn-ghost flex-1" onClick={() => setShowPhone(false)}>
                返回
              </View>
              <View className="btn-primary flex-1" onClick={doPhoneLogin}>
                登录
              </View>
            </View>
          </View>
        )}

        {/* 适老化：字号切换 */}
        <View className="card mt-24">
          <Text className="t-strong">字号设置</Text>
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
                className={`flex-1 ${fontScale === f.key ? 'btn-primary' : 'btn-ghost'}`}
                style={fontScale === f.key ? 'background: var(--brand);' : ''}
                onClick={() => setFontScale(f.key)}
              >
                {f.label}
              </View>
            ))}
          </View>
        </View>

        <Text className="t-weak" style="text-align: center; margin-top: 40rpx;">
          登录即表示同意《陪聊员服务协议》与《隐私政策》
        </Text>
      </View>
    </PageWrap>
  )
}
