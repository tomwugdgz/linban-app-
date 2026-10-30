// ============================================================================
// MoneyText：金额展示统一入口（分→¥元；资金场景加 tabular-nums 防跳动）
// ============================================================================
import { fenToYuan } from '@/shared/format';

export function MoneyText({ fen, strong }: { fen?: string | null; strong?: boolean }) {
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: strong ? 600 : undefined }}>
      {fenToYuan(fen)}
    </span>
  );
}
