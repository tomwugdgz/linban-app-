import { View } from '@tarojs/components'
import type { PropsWithChildren } from 'react'

// ============================================================================
// 两步确认弹窗（适老化：关键操作必须二次确认）
// 用法：<ConfirmModal visible title confirmText danger onConfirm onCancel />
// ============================================================================

interface Props {
  visible: boolean
  title: string
  content?: string
  confirmText?: string
  cancelText?: string
  /** 危险操作（取消订单/SOS/注销）用红色主按钮 */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
  children?: PropsWithChildren<unknown>
}

export default function ConfirmModal({
  visible,
  title,
  content,
  confirmText = '确认',
  cancelText = '再想想',
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  if (!visible) return null
  return (
    <View className="modal-mask" onClick={onCancel}>
      <View className="modal-box" onClick={(e) => e.stopPropagation()}>
        <View className="t-title" style="text-align: center;">
          {title}
        </View>
        {content ? (
          <View className="t-sub mt-16" style="text-align: center;">
            {content}
          </View>
        ) : null}
        <View className="row gap-16 mt-24">
          <View className="btn-ghost flex-1" onClick={onCancel}>
            {cancelText}
          </View>
          <View
            className={`flex-1 ${danger ? 'btn-danger' : 'btn-primary'}`}
            style={danger ? 'background: var(--danger); color: #fff;' : ''}
            onClick={onConfirm}
          >
            {confirmText}
          </View>
        </View>
      </View>
    </View>
  )
}
