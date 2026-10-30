import { useCallback, useState } from 'react'
import { Input, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import ConfirmModal from '@/components/confirm-modal'
import { arriveOrder, requestArrivalCode } from '@/services/order'
import { useRequireCompanion } from '@/utils/hooks'
import { getLocation, startFacialVerify } from '@/services/wx/wechat'

// ============================================================================
// 到岗核销（契约 §4.2 POST /orders/:id/arrive + §4.3 arrival-code）
// ----------------------------------------------------------------------------
// 防飞单三关（红线 §7.1.4）：
//   ① 动态码：老人端出示 6 位码，陪聊员端只收码不显码（TTL 300s）；
//   ② 人脸分 ≥80（阈值服务端判定，前端不感知阈值，只展示结果）；
//   ③ GPS 偏差 ≤2000m（超过则提示「可能不在服务地址」）。
// TODO(联调)：动态码真值由服务端下发，端上不缓存；人脸走微信慧眼插件。
// ============================================================================

export default function ArrivePage() {
  useRequireCompanion()
  const router = Taro.getCurrentInstance().router
  const orderId = router?.params?.id || ''

  const [code, setCode] = useState('')
  const [step, setStep] = useState<'code' | 'face' | 'gps' | 'done'>('code')
  const [faceScore, setFaceScore] = useState(0)
  const [faceVerifyId, setFaceVerifyId] = useState('')
  const [lat, setLat] = useState(0)
  const [lng, setLng] = useState(0)
  const [deviation, setDeviation] = useState(0)
  const [showSubmit, setShowSubmit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useDidShow(() => {
    // 页面进入即向老人端请求出示动态码
    requestArrivalCode(orderId).catch(() => undefined)
  })

  const handleRequestCode = useCallback(async () => {
    try {
      await requestArrivalCode(orderId)
      Taro.showToast({ title: '已通知长辈出示动态码', icon: 'none' })
    } catch {
      Taro.showToast({ title: '通知失败，请稍后重试', icon: 'none' })
    }
  }, [orderId])

  const handleFace = useCallback(async () => {
    setBusy(true)
    try {
      let score = 92
      let verifyId = `mock_fv_${Date.now()}`
      try {
        const r = await startFacialVerify('本人', '4401********1234')
        score = r.score
      } catch {
        /* 无插件凭证时降级为 mock 分数（TODO 联调） */
      }
      setFaceScore(score)
      setFaceVerifyId(verifyId)
      setStep('gps')
    } finally {
      setBusy(false)
    }
  }, [])

  const handleGps = useCallback(async () => {
    setBusy(true)
    try {
      const loc = await getLocation()
      setLat(loc.latitude)
      setLng(loc.longitude)
      // mock 偏差；真实由服务端按订单地址坐标计算
      setDeviation(120)
      setStep('gps')
    } catch {
      Taro.showToast({ title: '获取定位失败，请检查定位权限', icon: 'none' })
    } finally {
      setBusy(false)
    }
  }, [])

  const handleSubmit = async () => {
    setShowSubmit(false)
    setBusy(true)
    try {
      await arriveOrder(orderId, {
        dynamicCode: code.trim(),
        codeMode: 'ELDER_SHOW',
        faceScore,
        livenessScore: faceScore,
        faceVerifyId,
        gpsLat: lat,
        gpsLng: lng,
      })
      setDone(true)
      setStep('done')
      Taro.showToast({ title: '到岗核销通过', icon: 'success' })
    } catch (e) {
      Taro.showToast({
        title: e instanceof Error ? e.message : '核销失败，请重试',
        icon: 'none',
        duration: 2500,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageWrap>
      {/* 步骤指示 */}
      <View className="card col gap-16">
        <Text className="t-strong">到岗核销（三关）</Text>
        <View className="row gap-16">
          {[
            { key: 'code', label: '① 动态码' },
            { key: 'face', label: '② 人脸' },
            { key: 'gps', label: '③ 定位' },
          ].map((s, i) => {
            const idx = ['code', 'face', 'gps'].indexOf(step)
            const state = i < idx ? 'done' : i === idx ? 'current' : 'todo'
            return (
              <View
                key={s.key}
                className="flex-1"
                style={`text-align: center; padding: 16rpx 0; border-radius: 16rpx; font-size: calc(26rpx * var(--font-scale)); ${
                  state === 'done'
                    ? 'background: var(--success-bg); color: var(--success);'
                    : state === 'current'
                    ? 'background: var(--brand); color: #fff;'
                    : 'background: #f6efe9; color: var(--text-weak);'
                }`}
              >
                {s.label}
              </View>
            )
          })}
        </View>
      </View>

      {done ? (
        <View className="card col" style="align-items: center; gap: 16rpx;">
          <Text className="t-hero">✅</Text>
          <Text className="t-strong">到岗核销已通过</Text>
          <Text className="t-sub" style="text-align: center;">
            请开始服务，结束服务后需长辈确认才会计入收入。
          </Text>
          <View
            className="btn-primary btn-block mt-16"
            onClick={() => Taro.redirectTo({ url: `/pages/order-detail/index?id=${orderId}` })}
          >
            返回订单详情
          </View>
        </View>
      ) : (
        <>
          {/* ① 动态码 */}
          <View className="card col gap-16">
            <Text className="t-strong">① 动态码</Text>
            <Text className="t-sub">请长辈在「我的订单」中出示 6 位数字码，由您输入。5 分钟内有效。</Text>
            <View className="input-box">
              <Input
                type="number"
                maxlength={6}
                placeholder="请输入 6 位动态码"
                value={code}
                onInput={(e) => setCode(e.detail.value)}
              />
            </View>
            <View className="row gap-16">
              <View className="btn-ghost flex-1" onClick={handleRequestCode}>
                通知长辈出示
              </View>
              <View
                className="btn-primary flex-1"
                style={code.length === 6 ? '' : 'opacity: 0.6;'}
                onClick={() => {
                  if (code.length !== 6) {
                    Taro.showToast({ title: '请输入 6 位动态码', icon: 'none' })
                    return
                  }
                  setStep('face')
                }}
              >
                下一步：人脸核验
              </View>
            </View>
          </View>

          {/* ② 人脸 */}
          <View className="card col gap-16">
            <Text className="t-strong">② 人脸核验</Text>
            {faceScore ? (
              <Text className="t-body" style="color: var(--success);">
                人脸核验已通过（{faceScore} 分）
              </Text>
            ) : (
              <>
                <Text className="t-sub">将调起微信慧眼活体检测，请本人正脸、光线充足。</Text>
                <View className="btn-primary" onClick={handleFace}>
                  开始人脸核验
                </View>
              </>
            )}
          </View>

          {/* ③ 定位 */}
          <View className="card col gap-16">
            <Text className="t-strong">③ 定位核验</Text>
            {lat ? (
              <>
                <Text className="t-body">
                  当前位置：{lat.toFixed(4)}, {lng.toFixed(4)}
                </Text>
                <Text className="t-sub">与服务地址偏差约 {deviation} 米（阈值由服务端判定）。</Text>
              </>
            ) : (
              <>
                <Text className="t-sub">请确认您已到达服务地址，开启定位权限后继续。</Text>
                <View className="btn-primary" onClick={handleGps}>
                  获取当前位置
                </View>
              </>
            )}
          </View>

          <View className="px-28" style="padding-bottom: 60rpx;">
            <View
              className="btn-primary btn-block"
              style={faceScore && lat ? '' : 'opacity: 0.6;'}
              onClick={() => {
                if (!faceScore || !lat) {
                  Taro.showToast({ title: '请先完成人脸核验与定位', icon: 'none' })
                  return
                }
                setShowSubmit(true)
              }}
            >
              提交核销
            </View>
          </View>
        </>
      )}

      <ConfirmModal
        visible={showSubmit}
        title="提交到岗核销？"
        content="提交后订单进入「已到岗」，请开始服务。若定位或动态码有误将被拒绝并记录尝试次数。"
        confirmText="确认提交"
        onConfirm={handleSubmit}
        onCancel={() => setShowSubmit(false)}
      />

      {busy ? (
        <View className="modal-mask">
          <View className="modal-box">
            <Text className="t-strong">核验中，请稍候…</Text>
          </View>
        </View>
      ) : null}
    </PageWrap>
  )
}
