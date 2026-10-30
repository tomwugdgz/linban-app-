import { useState } from 'react'
import { Button, Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { phoneLogin, sendSmsCode, wxLogin } from '@/services/auth'
import PageWrap from '@/components/page-wrap'
import { useAuthStore } from '@/stores/auth'

// ============================================================================
// 登录页：微信一键登录（首选）+ 手机号验证码（备用）
// - 老人/子女双入口：role 决定视角（老人=自用；子女=代父母操作）
// - 首次登录需勾选《用户协议》《隐私政策》（微信登录规范）
// - mock：wx-login 直接下发演示 token；真实由后端 code 换 session
// ============================================================================

type Role = 'ELDER' | 'FAMILY'

export default function LoginPage() {
  const setLoginRole = useAuthStore((s) => s.setLoginRole)
  const [role, setRole] = useState<Role>('ELDER')
  const [agree, setAgree] = useState(false)
  const [mode, setMode] = useState<'main' | 'phone'>('main')
  const [loading, setLoading] = useState(false)

  // 手机号登录态
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [countdown, setCountdown] = useState(0)

  const goHome = () => Taro.reLaunch({ url: '/pages/home/index' })

  const showProtocol = () => {
    Taro.showModal({
      title: '用户协议与隐私政策（摘要）',
      content:
        '1. 我们仅收集提供服务所必需的信息（手机号用于账号与安全，位置用于附近匹配与到岗核销）；\n' +
        '2. 聊天内容经安全审核，严禁平台外私下交易；\n' +
        '3. 老人健康信息仅存「提醒边界」级偏好，不收集病历；\n' +
        '4. 资金由平台担保托管，服务完成双方确认后结算给陪聊员。',
      confirmText: '知道了',
      showCancel: false,
    })
  }

  const handleWxLogin = async () => {
    if (!agree) {
      Taro.showToast({ title: '请先阅读并同意用户协议', icon: 'none' })
      return
    }
    setLoading(true)
    try {
      setLoginRole(role)
      await wxLogin(role)
      Taro.showToast({ title: '登录成功', icon: 'success' })
      goHome()
    } catch {
      /* request 层已 toast */
    } finally {
      setLoading(false)
    }
  }

  const handlePhoneLogin = async () => {
    if (!agree) {
      Taro.showToast({ title: '请先阅读并同意用户协议', icon: 'none' })
      return
    }
    if (!/^1\d{10}$/.test(phone)) {
      Taro.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    if (!code) {
      Taro.showToast({ title: '请输入验证码', icon: 'none' })
      return
    }
    setLoading(true)
    try {
      setLoginRole(role)
      await phoneLogin(phone, code)
      goHome()
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }

  const handleSendCode = async () => {
    if (!/^1\d{10}$/.test(phone)) {
      Taro.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    await sendSmsCode(phone)
    setCountdown(60)
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer)
          return 0
        }
        return c - 1
      })
    }, 1000)
  }

  return (
    <PageWrap>
      <View className="col" style="padding: 120rpx 60rpx 0; align-items: center; gap: 24rpx;">
        <View className="avatar avatar-lg" style="font-size: 80rpx;">
          🤝
        </View>
        <Text className="t-hero">邻伴</Text>
        <Text className="t-sub" style="text-align: center;">
          同城真人陪聊 · 老人线
        </Text>
        <Text className="t-sub" style="text-align: center;">
          7×24 AI 陪伴，随时有人听您说话
        </Text>
      </View>

      {/* 角色选择：老人自用 / 子女代操作 */}
      <View className="card mt-24">
        <View className="field-label">请问您是？</View>
        <View className="row gap-16">
          <View
            className={`flex-1 card ${role === 'ELDER' ? '' : ''}`}
            style={`margin: 0; border: 4rpx solid ${role === 'ELDER' ? 'var(--brand)' : 'transparent'}; padding: 24rpx;`}
            onClick={() => setRole('ELDER')}
          >
            <Text className="t-strong">我是老人</Text>
            <Text className="t-sub" style="display: block; margin-top: 8rpx;">
              自己用，大字语音
            </Text>
          </View>
          <View
            className="flex-1 card"
            style={`margin: 0; border: 4rpx solid ${role === 'FAMILY' ? 'var(--brand)' : 'transparent'}; padding: 24rpx;`}
            onClick={() => setRole('FAMILY')}
          >
            <Text className="t-strong">我帮父母操作</Text>
            <Text className="t-sub" style="display: block; margin-top: 8rpx;">
              子女代下单/看进度
            </Text>
          </View>
        </View>
      </View>

      {mode === 'main' ? (
        <View className="px-28 mt-24 col gap-24">
          {/* 微信一键登录：open-type 由微信下发 code（新手机号流程用 getPhoneNumber） */}
          <Button
            className="btn-primary btn-block"
            disabled={loading}
            open-type="getPhoneNumber"
            onGetPhoneNumber={(e) => {
              // 真实流程：detail.code → POST /auth/phone 换绑手机号后再登录
              // TODO(联调)：后端 /auth/phone 就绪后在此交换手机号
              handleWxLogin()
            }}
          >
            微信一键登录
          </Button>
          <View className="btn-ghost btn-block" onClick={() => setMode('phone')}>
            用手机号登录
          </View>
        </View>
      ) : (
        <View className="card mt-24 col gap-24">
          <View className="field-label">手机号登录</View>
          <Input
            className="input-box"
            type="number"
            maxlength={11}
            placeholder="请输入手机号"
            value={phone}
            onInput={(e) => setPhone(e.detail.value)}
          />
          <View className="row gap-16">
            <Input
              className="input-box flex-1"
              type="number"
              maxlength={6}
              placeholder="验证码"
              value={code}
              onInput={(e) => setCode(e.detail.value)}
            />
            <View className="btn-ghost" onClick={handleSendCode} style="min-width: 200rpx;">
              {countdown > 0 ? `${countdown}s` : '获取验证码'}
            </View>
          </View>
          <View className="btn-primary btn-block" onClick={handlePhoneLogin}>
            登录
          </View>
          <View className="t-sub" style="text-align: center;" onClick={() => setMode('main')}>
            返回微信登录
          </View>
        </View>
      )}

      {/* 协议勾选（两步：点击协议先看内容） */}
      <View className="row px-28 mt-24" style="align-items: flex-start; gap: 16rpx;">
        <View
          className={`row`}
          style={`width: 36rpx; height: 36rpx; border-radius: 50%; border: 2rpx solid ${
            agree ? 'var(--brand)' : 'var(--text-weak)'
          }; background: ${agree ? 'var(--brand)' : 'transparent'}; align-items: center; justify-content: center; margin-top: 6rpx;`}
          onClick={() => setAgree(!agree)}
        >
          {agree ? <Text style="color: #fff; font-size: 24rpx;">✓</Text> : null}
        </View>
        <Text className="t-sub flex-1">
          我已阅读并同意
          <Text className="t-brand" onClick={showProtocol}>
            《用户协议》
          </Text>
          和
          <Text className="t-brand" onClick={showProtocol}>
            《隐私政策》
          </Text>
          ，理解平台资金托管与防飞单规则
        </Text>
      </View>

      <View className="t-weak px-28 mt-24" style="text-align: center;">
        广州单城 MVP 演示版 · 客服 020-8888-6666
      </View>
    </PageWrap>
  )
}
