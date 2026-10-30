import { Text, View } from '@tarojs/components'

// ============================================================================
// 分步进度条（预约流程 4 步 / 入驻四审 6 步）
// steps: [{ label }]，current 从 0 开始
// ============================================================================

interface Props {
  steps: string[]
  current: number
}

export default function StepProgress({ steps, current }: Props) {
  return (
    <View className="row" style="align-items: flex-start; padding: 24rpx 28rpx;">
      {steps.map((label, i) => (
        <View key={label} className="col flex-1" style="align-items: center; gap: 12rpx;">
          <View className="row" style="align-items: center; width: 100%;">
            <View style={`flex: 1; height: 4rpx; background: ${i === 0 ? 'transparent' : i <= current ? 'var(--brand)' : 'var(--line)'};`} />
            <View
              style={`width: 44rpx; height: 44rpx; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24rpx; font-weight: 600; ${
                i < current
                  ? 'background: var(--brand); color: #fff;'
                  : i === current
                  ? 'background: var(--brand-light); color: var(--brand-deep); border: 2rpx solid var(--brand);'
                  : 'background: #f6efe9; color: var(--text-weak);'
              }`}
            >
              {i < current ? '✓' : i + 1}
            </View>
            <View style={`flex: 1; height: 4rpx; background: ${i === steps.length - 1 ? 'transparent' : i < current ? 'var(--brand)' : 'var(--line)'};`} />
          </View>
          <Text
            className="t-weak"
            style={`font-size: 22rpx; color: ${i <= current ? 'var(--brand-deep)' : 'var(--text-weak)'};`}
          >
            {label}
          </Text>
        </View>
      ))}
    </View>
  )
}
