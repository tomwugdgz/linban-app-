import { useCallback, useState } from 'react'
import { Input, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import StepProgress from '@/components/step-progress'
import ConfirmModal from '@/components/confirm-modal'
import {
  completeTraining,
  fetchMyApplication,
  fetchMyCompanion,
  payDeposit,
  submitApplication,
  submitCriminal,
  submitExam,
  submitFace,
  submitRealname,
} from '@/services/companion'
import { startFacialVerify } from '@/services/wx/wechat'
import { useRequireAuth } from '@/utils/hooks'
import { fenToYuan } from '@/utils/format'
import { DEFAULT_DEPOSIT_FEN, ONBOARDING_STEPS, STEP_STATUS_META } from '@/constants'
import type { ApplicationStatusDTO, CompanionSelfView } from '@/types'
import { COMPANION_ROLE_LABELS, OPEN_COMPANION_ROLES, application_stage, companion_role, step_status } from '@linban/shared'

// ============================================================================
// 入驻四审分步流程（契约 §4.1）
// ----------------------------------------------------------------------------
// 状态机 10 态，端上按 5 个可视步骤呈现：
//   ① 实名（OCR + 二要素）→ ② 人脸底照（慧眼）→ ③ 无犯罪记录（人工审核）
//   → ④ 培训与考试（≥80 通过）→ ⑤ 缴保证金（¥500）→ ACTIVE 上架
// 红线 §7.2.2：不可跳态，每阶段结果服务端留痕，阶段推进只认服务端状态机。
// TODO(联调)：无犯罪材料需接 COS STS 直传（POST /files/sts），此处用文件名占位。
// ============================================================================

/**
 * 角色卡片短句说明（话术红线见 ARCHITECTURE §15.9 / PRD §3.2）。
 * 中文标签一律取 COMPANION_ROLE_LABELS，这里只放一句大白话说明；
 * 两档允许/禁止的用词边界以契约为准，不在代码里复述禁用词。
 */
const ROLE_BRIEF: Partial<Record<companion_role, string>> = {
  SHARED_SON: '陪聊天、教手机、陪着逛逛，按时计酬。',
  PROFESSIONAL: '可陪诊、辅助康复、留意健康情况。',
}

export default function OnboardingPage() {
  useRequireAuth()
  const [app, setApp] = useState<ApplicationStatusDTO | null>(null)
  const [self, setSelf] = useState<CompanionSelfView | null>(null)
  const [loaded, setLoaded] = useState(false)
  // 入驻申请时选择的供给角色，默认取两个开放值里的第一个
  const [selectedRole, setSelectedRole] = useState<companion_role>(OPEN_COMPANION_ROLES[0])
  const [name, setName] = useState('')
  const [idCard, setIdCard] = useState('')
  const [criminalFile, setCriminalFile] = useState('')
  const [examScore, setExamScore] = useState('88')
  const [busy, setBusy] = useState(false)
  const [showDeposit, setShowDeposit] = useState(false)

  const load = useCallback(async () => {
    const [a, s] = await Promise.all([
      fetchMyApplication().catch(() => null),
      fetchMyCompanion().catch(() => null),
    ])
    setApp(a)
    setSelf(s)
    if (s) setSelectedRole(s.role)
    setLoaded(true)
  }, [])

  useDidShow(load)

  /** 当前可视步骤序号（0-4） */
  const currentStep = (() => {
    if (!app) return 0
    switch (app.stage) {
      case application_stage.APPLIED:
        return 0
      case application_stage.REALNAME_OK:
        return 1
      case application_stage.FACE_OK:
        return 2
      case application_stage.CRIMINAL_OK:
        return 3
      case application_stage.TRAINING:
      case application_stage.EXAM_OK:
        return 4
      default:
        return 5
    }
  })()

  const run = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true)
    try {
      await fn()
      Taro.showToast({ title: okText, icon: 'success' })
      await load()
    } catch (e) {
      Taro.showToast({
        title: e instanceof Error ? e.message : '操作失败，请重试',
        icon: 'none',
        duration: 2500,
      })
    } finally {
      setBusy(false)
    }
  }

  const handleRealname = () =>
    run(() => submitRealname({ name, idCardNumber: idCard }), '实名认证已提交')

  const handleFace = () =>
    run(async () => {
      // TODO(联调)：真实走微信慧眼插件，失败由服务端 adapter 兜底
      let score = 92
      let verifyId = `mock_fv_${Date.now()}`
      try {
        const r = await startFacialVerify(name, idCard)
        score = r.score
      } catch {
        /* 无插件凭证时用 mock 分数 */
      }
      return submitFace({ faceScore: score, faceVerifyId: verifyId })
    }, '人脸核验通过')

  const handleCriminal = () =>
    run(() => submitCriminal({ fileId: `mock_file_${Date.now()}`, fileName: criminalFile || '无犯罪记录证明.pdf' }), '材料已提交，等待审核')

  const handleTraining = () => run(() => completeTraining(), '培训已完成')

  const handleExam = () => run(() => submitExam({ score: Number(examScore) || 88 }), '考试成绩已提交')

  const handleDeposit = async () => {
    setShowDeposit(false)
    await run(() => payDeposit({ amountFen: DEFAULT_DEPOSIT_FEN }), '保证金已缴纳')
  }

  /** 提交入驻申请（四审流起点）：带上选择的供给角色 */
  const handleApply = () =>
    run(
      () =>
        submitApplication({
          nickname: '张阿姨',
          hourlyRateFen: '12000',
          serviceRadiusM: 5000,
          tags: [],
          companionRole: selectedRole,
        }),
      '入驻申请已提交',
    )

  // 加载完成前不闪申请表单
  if (!loaded) {
    return (
      <PageWrap>
        <Text className="t-sub px-28 mt-24">加载中…</Text>
      </PageWrap>
    )
  }

  // 尚未提交申请：先选角色再提交（角色卡片只展示两个开放值，§15.9）
  if (!app) {
    return (
      <PageWrap>
        <View className="card">
          <Text className="t-title">申请入驻</Text>
          <Text className="t-sub mt-16" style="display: block;">
            选一个服务角色，提交后开始四项审核。
          </Text>
          <View className="col gap-16 mt-16">
            {OPEN_COMPANION_ROLES.map((r) => (
              <View
                key={r}
                className={`col gap-8 ${selectedRole === r ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setSelectedRole(r)}
              >
                <Text className="t-strong">{COMPANION_ROLE_LABELS[r]}</Text>
                <Text className="t-weak">{ROLE_BRIEF[r]}</Text>
              </View>
            ))}
          </View>
          <View className="btn-primary btn-block mt-24" onClick={handleApply}>
            提交入驻申请
          </View>
          <View className="btn-ghost btn-block mt-16" onClick={() => load()}>
            返回审核进度
          </View>
        </View>
      </PageWrap>
    )
  }

  return (
    <PageWrap>
      <StepProgress steps={ONBOARDING_STEPS.map((s) => s.title)} current={Math.min(currentStep, 4)} />

      {/* 当前服务角色（§15.9：我的资料/工作台可见角色） */}
      <View className="card">
        <View className="row-between">
          <Text className="t-sub">当前服务角色</Text>
          <Text className="t-strong">{self ? COMPANION_ROLE_LABELS[self.role] : '-'}</Text>
        </View>
        <View className="btn-ghost btn-block mt-16" onClick={() => setApp(null)}>
          修改角色并重新提交
        </View>
        <Text className="t-weak mt-16" style="display: block;">
          重新提交会从第一项审核重新开始。
        </Text>
      </View>

      {/* 状态说明 */}
      <View className="card">
        <Text className="t-sub">
          申请编号 {app.applicationNo} · 需按顺序完成各项审核，未通过需重新提交该步骤。
        </Text>
        {app.rejectReason ? (
          <Text className="t-body mt-16" style="display: block; color: var(--danger);">
            上次未通过原因：{app.rejectReason}
          </Text>
        ) : null}
      </View>

      {/* 步骤列表 */}
      <View className="card">
        {ONBOARDING_STEPS.map((step, i) => {
          const st = app.stepStatuses[step.key]
          const state = st === step_status.PASSED ? 'done' : i === currentStep ? 'current' : 'todo'
          return (
            <View key={step.key} className={`review-step ${state}`}>
              <View className="review-step-index">{st === step_status.PASSED ? '✓' : i + 1}</View>
              <View className="col flex-1 gap-8">
                <View className="row-between">
                  <Text className="t-strong">{step.title}</Text>
                  <Text
                    className="t-weak"
                    style={`color: ${STEP_STATUS_META[st].color};`}
                  >
                    {st === step_status.PASSED ? '已通过' : i === currentStep ? '待完成' : '未开始'}
                  </Text>
                </View>
                <Text className="t-sub">{step.desc}</Text>

                {/* 各步骤操作区 */}
                {i === currentStep ? (
                  <View className="col gap-16 mt-16">
                    {step.key === 'realname' ? (
                      <>
                        <View>
                          <Text className="field-label">真实姓名</Text>
                          <View className="input-box">
                            <Input
                              placeholder="请输入身份证上的姓名"
                              value={name}
                              onInput={(e) => setName(e.detail.value)}
                            />
                          </View>
                        </View>
                        <View>
                          <Text className="field-label">身份证号</Text>
                          <View className="input-box">
                            <Input
                              type="number"
                              maxlength={18}
                              placeholder="仅用于实名核验，提交后不可查看"
                              value={idCard}
                              onInput={(e) => setIdCard(e.detail.value)}
                            />
                          </View>
                        </View>
                        <View className="btn-primary" onClick={handleRealname}>
                          提交实名认证
                        </View>
                        <Text className="t-weak">
                          身份信息仅用于公安二要素核验，平台加密存储且不在端上回显。
                        </Text>
                      </>
                    ) : null}

                    {step.key === 'face' ? (
                      <>
                        <View className="btn-primary" onClick={handleFace}>
                          开始人脸核验
                        </View>
                        <Text className="t-weak">
                          将调起微信慧眼活体检测，需本人正脸、光线充足。
                        </Text>
                      </>
                    ) : null}

                    {step.key === 'criminal' ? (
                      <>
                        <View>
                          <Text className="field-label">无犯罪记录证明</Text>
                          <View className="input-box">
                            <Input
                              placeholder="请输入材料文件名（演示）"
                              value={criminalFile}
                              onInput={(e) => setCriminalFile(e.detail.value)}
                            />
                          </View>
                        </View>
                        <View className="btn-primary" onClick={handleCriminal}>
                          上传并提交审核
                        </View>
                        <Text className="t-weak">人工审核通常 1–3 个工作日，期间请保持手机畅通。</Text>
                      </>
                    ) : null}

                    {step.key === 'exam' ? (
                      <>
                        <Text className="t-sub">培训已完成，请参加考试（80 分及格）。</Text>
                        <View>
                          <Text className="field-label">考试成绩</Text>
                          <View className="input-box">
                            <Input
                              type="number"
                              maxlength={3}
                              value={examScore}
                              onInput={(e) => setExamScore(e.detail.value)}
                            />
                          </View>
                        </View>
                        <View className="btn-primary" onClick={handleTraining}>
                          标记培训完成
                        </View>
                        <View className="btn-ghost" onClick={handleExam}>
                          提交考试成绩
                        </View>
                      </>
                    ) : null}

                    {step.key === 'deposit' ? (
                      <>
                        <View className="row-between">
                          <Text className="t-sub">应缴保证金</Text>
                          <Text className="t-price">{fenToYuan(DEFAULT_DEPOSIT_FEN, true)}</Text>
                        </View>
                        <View className="btn-primary" onClick={() => setShowDeposit(true)}>
                          缴纳保证金
                        </View>
                        <Text className="t-weak">
                          保证金用于保障服务质量，正常退出且 30 天无纠纷将原路退还。
                        </Text>
                      </>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>
          )
        })}
      </View>

      {/* 考试信息 */}
      {app.examScore != null ? (
        <View className="card">
          <View className="row-between">
            <Text className="t-sub">考试成绩</Text>
            <Text className="t-strong">
              {app.examScore} 分（第 {app.examAttemptNo} 次）
            </Text>
          </View>
          {app.depositPaidAt ? (
            <View className="row-between mt-16">
              <Text className="t-sub">保证金缴纳</Text>
              <Text className="t-strong">{fenToYuan(app.depositAmountFen || '0', true)}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <ConfirmModal
        visible={showDeposit}
        title="确认缴纳保证金？"
        content={`将缴纳 ${fenToYuan(DEFAULT_DEPOSIT_FEN, true)} 保证金，缴纳后立即上架接单。`}
        confirmText="确认缴纳"
        onConfirm={handleDeposit}
        onCancel={() => setShowDeposit(false)}
      />

      {busy ? (
        <View className="modal-mask">
          <View className="modal-box">
            <Text className="t-strong">处理中，请稍候…</Text>
          </View>
        </View>
      ) : null}
    </PageWrap>
  )
}
