// ============================================================================
// 脱敏规则（架构 §10 / §5.3）：手机号/身份证/姓名/地址/银行卡 展示级脱敏
// 约定：后端已在出参脱敏的字段（*_masked）直接展示；本文件兜底防直出。
// ============================================================================

/** 手机号：138****1234（保留前 3 后 4） */
export function maskPhone(phone?: string | null): string {
  if (!phone) return '-';
  const s = String(phone);
  if (s.length !== 11) return s.replace(/.(?=.{2})/g, '*');
  return `${s.slice(0, 3)}****${s.slice(7)}`;
}

/** 身份证：保留前 3 后 4，如 440************123 */
export function maskIdCard(idCard?: string | null): string {
  if (!idCard) return '-';
  const s = String(idCard);
  if (s.length < 8) return '****';
  return `${s.slice(0, 3)}${'*'.repeat(s.length - 7)}${s.slice(-4)}`;
}

/** 姓名：张** / 欧阳**；单字姓名全脱敏 */
export function maskName(name?: string | null): string {
  if (!name) return '-';
  const s = String(name).trim();
  if (s.length <= 1) return '*';
  return `${s[0]}${'*'.repeat(s.length - 1)}`;
}

/** 银行卡：保留后 4 位 */
export function maskBankCard(card?: string | null): string {
  if (!card) return '-';
  const s = String(card).replace(/\s/g, '');
  if (s.length <= 4) return '****';
  return `**** **** **** ${s.slice(-4)}`;
}

/** 地址：保留区/县级 + 街道级，隐藏门牌号（架构 §10 位置脱敏） */
export function maskAddress(address?: string | null): string {
  if (!address) return '-';
  // 去掉门牌号段（数字+号/栋/室/楼 组合）
  return String(address).replace(/\d+(号|栋|室|楼|单元|层|座)/g, '**').replace(/\d+$/g, '**');
}

/** 设备指纹：保留前 8 位 */
export function maskDevice(fp?: string | null): string {
  if (!fp) return '-';
  const s = String(fp);
  return s.length <= 8 ? s : `${s.slice(0, 8)}…`;
}
