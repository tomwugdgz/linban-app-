import { useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import { useRequireAuth } from '@/utils/hooks'
import { REVIEW_TAGS } from '@/constants'
import { http } from '@/services/request'
import type { ReviewDTO } from '@/types'

// ============================================================================
// 评价页：星级 + 标签 + 文字 + 匿名（COMPLETED 后 7 天内；每单每方向一条）
// ============================================================================

export default function ReviewPage() {
  useRequireAuth()
  const router = Taro.getCurrentInstance().router
  const orderId = router?.params?.orderId || ''
  const [rating, setRating] = useState(5)
  const [tags, setTags] = useState<string[]>([])
  const [content, setContent] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const toggleTag = (t: string) => {
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
  }

  const submit = async () => {
    setSubmitting(true)
    try {
      await http.post<ReviewDTO>('/reviews', { orderId, rating, tags, content, isAnonymous: anonymous })
      Taro.showToast({ title: '评价成功，感谢反馈', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 800)
    } catch {
      /* request 层已 toast */
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageWrap>
      <View className="card col" style="align-items: center; gap: 24rpx;">
        <Text className="t-title">这次陪伴满意吗？</Text>
        <View className="row gap-16">
          {[1, 2, 3, 4, 5].map((n) => (
            <Text
              key={n}
              onClick={() => setRating(n)}
              style={`font-size: 64rpx; color: ${n <= rating ? '#F5A623' : '#E8DCD2'};`}
            >
              ★
            </Text>
          ))}
        </View>
        <Text className="t-sub">{rating >= 4 ? '谢谢您的鼓励' : rating >= 3 ? '我们会继续改进' : '很抱歉让您失望了'}</Text>
      </View>

      <View className="card">
        <Text className="t-strong">哪些方面做得好？（可多选）</Text>
        <View className="row gap-16 mt-16" style="flex-wrap: wrap;">
          {REVIEW_TAGS.map((t) => (
            <Text key={t} className={tags.includes(t) ? 'tag' : 'tag-plain'} style="font-size: 26rpx;" onClick={() => toggleTag(t)}>
              {t}
            </Text>
          ))}
        </View>
      </View>

      <View className="card">
        <Text className="t-strong">想说点什么</Text>
        <View className="input-box mt-16" style="min-height: 160rpx;">
          <Input
            style="width: 100%; font-size: 30rpx;"
            placeholder="陪聊员守时吗？聊得开心吗？（选填）"
            value={content}
            onInput={(e) => setContent(e.detail.value)}
          />
        </View>
        <View className="row-between mt-24">
          <Text className="t-sub">匿名评价</Text>
          <View className={`switch ${anonymous ? 'on' : ''}`} onClick={() => setAnonymous(!anonymous)}>
            <View className="switch-knob" />
          </View>
        </View>
        <Text className="t-weak mt-16">匿名后您的昵称不会展示给陪聊员</Text>
      </View>

      <View className="px-28" style="padding-bottom: 60rpx;">
        <View className="btn-primary btn-block" onClick={submit}>
          {submitting ? '提交中…' : '提交评价'}
        </View>
      </View>
    </PageWrap>
  )
}

// Input 显式引入（与 View/Text 同源）
import { Input } from '@tarojs/components'
