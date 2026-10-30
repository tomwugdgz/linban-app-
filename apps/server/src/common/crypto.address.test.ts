// ============================================================================
// 地址分档可见性单测（主理人裁定 2026-10；线下人身安全）
// ----------------------------------------------------------------------------
// 为什么这组断言值钱：地址分档一旦回退，后果是**不可逆**的——
// 老人可能独居，门牌在服务开始前泄露意味着陌生人知道老人住哪。
// 而这类回退不会有任何报错（只是多显示了几个字），所以必须钉死。
// ============================================================================

import { beforeAll, describe, expect, it } from 'vitest';
import {
  ADDRESS_UNAVAILABLE,
  maskAddress,
  maskAddressToCommunity,
} from './crypto';

beforeAll(() => {
  process.env.CRYPTO_MASTER_KEY = Buffer.alloc(32, 9).toString('base64');
});

describe('maskAddressToCommunity（降级到小区级）', () => {
  it('保留小区名，剥掉门牌与房号', () => {
    expect(maskAddressToCommunity('广州市天河区珠江新城X号院3栋1203室'))
      .toBe('广州市天河区珠江新城X号院');
  });

  it('「X 号院」是小区名不是门牌，须保留（正则不能把号院吃掉）', () => {
    expect(maskAddressToCommunity('广州市天河区天河北路5号院'))
      .toBe('广州市天河区天河北路5号院');
  });

  it('短地址「路+ 门牌」也能正确截断（按长度切会失效，故按特征切）', () => {
    expect(maskAddressToCommunity('广州市天河区天路12号')).toBe('广州市天河区天路');
  });

  it('多种门牌后缀都能识别', () => {
    const cases = [
      ['海珠区赤岗街X号3栋', '海珠区赤岗街'],
      ['越秀区北京路100号2单元', '越秀区北京路'],
      ['荔湾区金花街8号301', '荔湾区金花街'],
      ['白云区三元里大道5号B座', '白云区三元里大道'],
      ['番禺区市桥街12号3层', '番禺区市桥街'],
    ] as const;
    for (const [input, expected] of cases) {
      expect(maskAddressToCommunity(input), `输入 ${input}`).toBe(expected);
    }
  });

  it('无门牌特征时退化到街道/路，不整体返回', () => {
    expect(maskAddressToCommunity('广州市天河区天河北路')).toBe('广州市天河区天河北路');
  });

  it('「小区 / 大院 / 花园 / 新村」后缀优先保留', () => {
    expect(maskAddressToCommunity('天河区珠江新城芳草园12栋3单元')).toBe('天河区珠江新城芳草园');
  });

  it('空输入返回兜底文案而非空串（空串会让前端显示成「无地址」，实际是解密失败）', () => {
    expect(maskAddressToCommunity('')).toBe(ADDRESS_UNAVAILABLE);
    expect(maskAddressToCommunity('   ')).toBe(ADDRESS_UNAVAILABLE);
  });

  it('任何输出都不得含数字门牌（防则漏网）', () => {
    const inputs = [
      '广州市天河区珠江新城X号院3栋1203室',
      '广州市天河区天河北路5号院2单元1801',
      '海珠区赤岗街X号3栋',
      '荔湾区金花街8号301',
    ];
    for (const s of inputs) {
      // community 档输出里不应再出现「数字+楼/栋/室/单元」组合
      expect(/\d+\s*(栋|单元|室|座)/.test(maskAddressToCommunity(s)), `输入 ${s}`).toBe(false);
    }
  });
});

describe('maskAddress（密文入口 + 失败兜底）', () => {
  it('解密失败返回固定兜底文案，绝不吐密文', () => {
    // 非法密文（非本系统格式）
    const result = maskAddress('not-a-valid-cipher', 'full');
    expect(result).toBe(ADDRESS_UNAVAILABLE);
    expect(result).not.toContain('not-a-valid-cipher');
  });

  it('密文本身不得出现在出参（长度会泄漏原文长度，且可离线爆破）', () => {
    const cipherLike = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const out = maskAddress(cipherLike, 'community');
    expect(out).toBe(ADDRESS_UNAVAILABLE);
    expect(out).not.toContain(cipherLike);
  });

  it('null / undefined / 空串一律兜底文案', () => {
    for (const v of [null, undefined, '']) {
      expect(maskAddress(v, 'full')).toBe(ADDRESS_UNAVAILABLE);
      expect(maskAddress(v, 'community')).toBe(ADDRESS_UNAVAILABLE);
    }
  });

  it('开发回落形态 PLAIN_DEV: 前缀能被识别（否则开发环境地址全变兜底）', () => {
    const devCipher = 'PLAIN_DEV:广州市天河区天河北路5号院2单元1801';
    expect(maskAddress(devCipher, 'full')).toBe('广州市天河区天河北路5号院2单元1801');
    expect(maskAddress(devCipher, 'community')).toBe('广州市天河区天河北路5号院');
  });

  it('失败文案不含异常信息（不区分密钥错/密文损坏/非本系统加密）', () => {
    // 三种不同失败原因必须给出**同一个**文案，否则可被用来探测
    const a = maskAddress('garbage', 'full');
    const b = maskAddress('x'.repeat(200), 'full');
    const c = maskAddress('PLAIN', 'full');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});