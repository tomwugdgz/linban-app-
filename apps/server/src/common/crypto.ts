// ============================================================================
// 邻伴 · 加密与盲索引（common 层，DATABASE.md §6.2）
// ----------------------------------------------------------------------------
// 算法：AES-256-GCM（认证加密，防篡改）。
//   密文格式：base64( 版本号 1B ‖ IV(12B) ‖ 密文 ‖ Tag(16B) )
//   密钥轮换：CRYPTO_MASTER_KEY 支持逗号分隔多把（轮换期加密用第一把，
//   解密按密文首字节版本号选密钥）；HMAC 盲索引密钥同理。
// 盲索引：phone_hmac = HMAC-SHA256(盲索引密钥, normalizedPhone) → hex64。
//   normalized = 去除非数字、剥离 +86/86 区号。
//
// 安全纪律：
//   · 业务代码禁止直接碰密钥，只经本模块三函数；
//   · 未配置密钥时 fail-fast（AppError 90005），杜绝「默认密钥」后门；
//   · 日志对明文/密文脱敏（logger redact 同源处理）。
// ============================================================================

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { AppError } from '@linban/shared';

/** 当前密文版本号（轮换时递增；旧版本解密不删） */
const CIPHER_VERSION = 1;
/** IV 长度（GCM 推荐 12B） */
const IV_LENGTH = 12;
/** Tag 长度（GCM 128bit） */
const TAG_LENGTH = 16;

/** 读取主密钥列表（逗号分隔；第一把为当前加密密钥） */
function getMasterKeys(): Buffer[] {
  const raw = process.env.CRYPTO_MASTER_KEY;
  if (!raw) {
    throw new AppError(90005, 'CRYPTO_MASTER_KEY 未配置（base64 32B，可用 openssl rand -base64 32 生成）');
  }
  const keys = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const buf = Buffer.from(s, 'base64');
      if (buf.length !== 32) {
        throw new AppError(90005, 'CRYPTO_MASTER_KEY 须为 base64 编码的 32 字节（256bit）');
      }
      return buf;
    });
  if (keys.length === 0) {
    throw new AppError(90005, 'CRYPTO_MASTER_KEY 解析为空');
  }
  return keys;
}

/** 读取盲索引密钥 */
function getHmacKey(): Buffer {
  const raw = process.env.CRYPTO_HMAC_KEY;
  if (!raw) {
    throw new AppError(90005, 'CRYPTO_HMAC_KEY 未配置（base64 32B，可用 openssl rand -base64 32 生成）');
  }
  const buf = Buffer.from(raw.trim(), 'base64');
  if (buf.length !== 32) {
    throw new AppError(90005, 'CRYPTO_HMAC_KEY 须为 base64 编码的 32 字节（256bit）');
  }
  return buf;
}

/** 是否已配置加密（服务启动自检用） */
export function isCryptoConfigured(): boolean {
  return Boolean(process.env.CRYPTO_MASTER_KEY && process.env.CRYPTO_HMAC_KEY);
}

/**
 * 加密（AES-256-GCM）。
 * @returns base64(版本号1B ‖ IV 12B ‖ 密文 ‖ Tag 16B)
 */
export function encrypt(plaintext: string): string {
  const keys = getMasterKeys();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', keys[0]!, iv);
  cipher.setAAD(Buffer.from([CIPHER_VERSION])); // 版本号作附加认证数据，防调包
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([CIPHER_VERSION]), iv, enc, tag]).toString('base64');
}

/**
 * 解密（按密文首字节版本号选密钥）。
 * @throws AppError(90005) 密钥不匹配/密文被篡改/格式非法
 */
export function decrypt(ciphertext: string): string {
  let buf: Buffer;
  try {
    buf = Buffer.from(ciphertext, 'base64');
  } catch {
    throw new AppError(90005, '密文 base64 解码失败');
  }
  if (buf.length < 1 + IV_LENGTH + TAG_LENGTH) {
    throw new AppError(90005, '密文长度不足，格式非法');
  }
  const version = buf[0]!;
  const iv = buf.subarray(1, 1 + IV_LENGTH);
  const tag = buf.subarray(buf.length - TAG_LENGTH);
  const enc = buf.subarray(1 + IV_LENGTH, buf.length - TAG_LENGTH);

  const keys = getMasterKeys();
  // 版本号 → 密钥索引：当前版本用 keys[0]；历史版本依次尝试其余密钥
  const candidates = version === CIPHER_VERSION ? keys : keys.slice(1);
  for (const key of candidates) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from([version]));
      decipher.setAuthTag(tag);
      const out = Buffer.concat([decipher.update(enc), decipher.final()]);
      return out.toString('utf8');
    } catch {
      // 换下一把密钥试
    }
  }
  throw new AppError(90005, `解密失败：密钥不匹配或密文被篡改（版本 ${version}）`);
}

/** 手机号归一化（去空格/区号，支持等值检索） */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('86')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('1')) return digits;
  return digits;
}

/**
 * 盲索引（HMAC-SHA256 hex64）。
 * 注意：不支持模糊/范围检索（业务无此需求，DATABASE.md §6.2）。
 */
export function hmacIndex(value: string, normalize = false): string {
  const key = getHmacKey();
  const payload = normalize ? normalizePhone(value) : value;
  return createHmac('sha256', key).update(payload, 'utf8').digest('hex');
}

/** 恒定时间比较（防时序侧信道；用于验证类场景） */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** 手机号脱敏（日志/前端展示：138****8888） */
export function maskPhone(phone: string): string {
  const n = normalizePhone(phone);
  if (n.length !== 11) return '***';
  return `${n.slice(0, 3)}****${n.slice(7)}`;
}

/** 身份证号脱敏（前 3 后 4） */
export function maskIdCard(id: string): string {
  if (id.length < 8) return '***';
  return `${id.slice(0, 3)}***********${id.slice(-4)}`;
}

/**
 * 地址分档可见性（主理人裁定，2026-10；铁律：服务动作可留痕 + 线下人身安全）。
 *
 * 为什么地址要分档而不只是"脱敏"：老人可能独居，地址在服务开始前泄露的代价
 * **不可逆**（ Unlike 手机号可以换号，地址泄露意味着陌生人知道老人住哪）。
 * 但陪聊员必须能导航到小区，否则接单无意义——所以切点不是"给不给"，
 * 而是"什么时候给"：到岗核销（动态码 + 人脸已过）意味着人与订单已在物理
 * 空间绑定，此时给全量是合理的。
 *
 * | 档位 | 用途 | 效果 |
 * |---|---|---|
 * | community | 未到岗的陪聊员 / 管理端列表默认 | 区+ 街道 + 小区名，**无门牌/楼栋/房号** |
 * | full | 到岗核销后/ risk:read 角色 | 全量 |
 *
 * 失败兜底：解密异常一律返回固定文案，**绝不把密文或异常栈吐给前端**——
 * 密文本身也是信息（长度会泄漏原文长度），异常栈则是信息泄露的直接入口。
 */
export type AddressVisibility = 'community' | 'full';

/** 解密失败/未配置密钥时的统一兜底文案（不区分具体原因，避免探测） */
export const ADDRESS_UNAVAILABLE = '地址已加密，请联系客服';

/**
 * 地址分档脱敏。
 * @param cipher orders.address_cipher（AES-256-GCM 密文）
 * @param level community=小区级（不给门牌）；full=全量
 */
export function maskAddress(cipher: string | null | undefined, level: AddressVisibility): string {
  if (!cipher) return ADDRESS_UNAVAILABLE;
  // 开发回落形态：密钥未配置时存`PLAIN_DEV:<原文>`（见 order.service 建单）。
  // 这里必须显式识别——否则 decrypt() 会抛，整条地址对开发环境全变兜底文案。
  const devPrefix = 'PLAIN_DEV:';
  const plain = cipher.startsWith(devPrefix)
    ? cipher.slice(devPrefix.length)
    : safeDecrypt(cipher);
  if (!plain) return ADDRESS_UNAVAILABLE;
  if (level === 'full') return plain;
  return maskAddressToCommunity(plain);
}

/**
 * 解密失败返回 null 而非抛出（供脱敏类函数复用，避免各处重复 try/catch）。
 *
 * 导出理由：提现列表（GET /payments/withdrawals）也要把 bank_account_cipher
 * 解密后脱敏展示，与 maskAddress 同一诉求。此前它是私有的，
 * 结果 address 有脱敏通道、bank_account 没有 —— 将来有人写第二种 try/catch，
 * 就出现两套「解密失败怎么处理」的定义，其中一套大概率是抛 500。
 * 一个只服务自己的私有函数，在这里其实制造了分歧。
 */
export function safeDecrypt(cipher: string): string | null {
  try {
    return decrypt(cipher);
  } catch {
    return null;
  }
}

/**
 * 地址降级到小区级（纯函数，便于单测边界）。
 *
 * 策略：**截断到小区/路段名，剥掉其后的门牌与房号**。用正则切而不是按长度切——
 * 按长度切会在「XX 路 12 号」这种短地址上失效，而短地址往往门牌占比更高。
 *
 * 识别为「门牌及之后」的特征（命中任一即在此处截断）：
 *   · 数字 + 号/楼/栋/单元/室/门/座/层/楼（如12 号、3 栋、1203 室）
 *   · 「号院」之间的门牌数字单独出现时保留（「X 号院」是小区名不是门牌）
 */
export function maskAddressToCommunity(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) return ADDRESS_UNAVAILABLE;
  // 常见的「小区/大院」后缀先行保留（如「珠江新城 X 号院」）
  const communityMatch = /^(.*?(?:小区|大院|花园|新村|公寓|家园|苑|号院))/.exec(trimmed);
  if (communityMatch?.[1]) return communityMatch[1];
  // 否则截断到第一个「门牌类后缀」之前。
  // 门牌号的占位形态在真实数据里是混合的：`12号`、`X号`、`A-3栋` 都见过，
  // 所以前缀必须允许数字**或字母**，只匹配数字会让「赤岗街X号3栋」漏掉门牌段。
  const doorMatch = /^(.*?)(?=[A-Za-z0-9]+\s*(?:号|楼|栋|单元|室|门|座|层|弄|巷|村|院))/u.exec(trimmed);
  if (doorMatch?.[1]?.trim()) return doorMatch[1].trim();
  // 无门牌特征：退化为截到「路/ 街 / 大道 / 弄」为止。
  // 注意 `区` 必须排除在匹配集之外——行政区名在「路」之前，若参与匹配会
  // 把「广州市天河区天河北路」截成「广州市天河区」，反而把信息全丢了
  //（小区名恰好被切掉，比多显示门牌更糟）。
  const roadMatch = /^(.*?(?:大道|路|街|弄|巷))/u.exec(trimmed);
  if (roadMatch?.[1]) return roadMatch[1];
  return '******';
}
