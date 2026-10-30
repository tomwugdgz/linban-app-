import { View } from '@tarojs/components'
import { ORDER_STATUS_META } from '@/constants'
import type { order_status } from '@/types'

// ============================================================================
// 订单状态标签：醒目状态色（语义色 + 文字双通道，适老化不依赖单色）
// ============================================================================

interface Props {
  status: order_status
  size?: 'normal' | 'large'
}

export default function OrderStatusTag({ status, size = 'normal' }: Props) {
  const meta = ORDER_STATUS_META[status]
  return (
    <View
      className="status-chip"
      style={`color: ${meta.color}; background: ${meta.bg}; font-size: ${
        size === 'large' ? 'calc(28rpx * var(--font-scale))' : 'calc(24rpx * var(--font-scale))'
      };`}
    >
      {meta.label}
    </View>
  )
}
