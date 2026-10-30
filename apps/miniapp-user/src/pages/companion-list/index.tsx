import { useEffect, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import CompanionCard from '@/components/companion-card'
import EmptyState from '@/components/empty-state'
import { fetchNearbyCompanions } from '@/services/companion'
import { useRequireAuth } from '@/utils/hooks'
import type { CompanionPublicDTO } from '@/types'

// ============================================================================
// 陪聊员列表：排序（距离/评分/价格）+ 标签筛选
// ============================================================================

const SORTS: { key: 'distance' | 'rating' | 'price'; label: string }[] = [
  { key: 'distance', label: '离我近' },
  { key: 'rating', label: '评分高' },
  { key: 'price', label: '价格低' },
]

const TAG_FILTERS = ['全部', '粤语', '普通话', '散步', '烹饪', '象棋', '养生操']

export default function CompanionListPage() {
  useRequireAuth()
  const router = Taro.getCurrentInstance().router
  const elderUserId = router?.params?.elderUserId // 子女代下单入口带入
  const [sort, setSort] = useState<'distance' | 'rating' | 'price'>('distance')
  const [tag, setTag] = useState('全部')
  const [list, setList] = useState<CompanionPublicDTO[]>([])

  const load = async () => {
    const res = await fetchNearbyCompanions({
      sort,
      tags: tag === '全部' ? undefined : tag,
    })
    setList(res.list)
  }

  // 筛选条件变化即刷新
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, tag])

  return (
    <PageWrap>
      {/* 排序 */}
      <View className="row px-28" style="padding: 24rpx 0; gap: 24rpx;">
        {SORTS.map((s) => (
          <Text
            key={s.key}
            className={sort === s.key ? 't-strong t-brand' : 't-sub'}
            onClick={() => {
              setSort(s.key)
              load()
            }}
          >
            {s.label}
          </Text>
        ))}
      </View>

      {/* 标签筛选 */}
      <View className="row px-28" style="flex-wrap: wrap; gap: 16rpx; padding-bottom: 16rpx;">
        {TAG_FILTERS.map((t) => (
          <Text
            key={t}
            className={tag === t ? 'tag' : 'tag-plain'}
            style={tag === t ? 'font-size: 26rpx;' : 'font-size: 26rpx;'}
            onClick={() => {
              setTag(t)
              load()
            }}
          >
            {t}
          </Text>
        ))}
      </View>

      {list.length === 0 ? (
        <EmptyState icon="🔍" title="没有符合条件的陪聊员" desc="换个标签或排序试试" />
      ) : (
        list.map((c) => (
          <CompanionCard
            key={c.id}
            companion={c}
            onBook={() =>
              Taro.navigateTo({
                url: `/pages/booking/index?companionId=${c.id}${elderUserId ? `&elderUserId=${elderUserId}` : ''}`,
              })
            }
            onClick={() =>
              Taro.navigateTo({
                url: `/pages/companion-detail/index?id=${c.id}${elderUserId ? `&elderUserId=${elderUserId}` : ''}`,
              })
            }
          />
        ))
      )}
    </PageWrap>
  )
}
