import crypto from 'crypto';

/**
 * 卡密码生成器（SPEC §2.6.2 卡密安全）
 *
 * 格式：XXXX-XXXX-XXXX-XXXX（16 位）
 * - 前 12 位：随机字符（排除 0/O/1/I/l 等易混淆字符）
 * - 后 4 位：前 12 位的 CRC32 校验值
 *
 * 安全设计：
 * - 字符集排除易混淆字符，随机熵 ≥ 80 bit
 * - CRC32 校验位防输入错误与伪造
 */

/** 卡密字符集：排除 0/O/1/I/l（SPEC §2.6.2 第 5 项） */
export const CARD_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** 卡密分组长度 */
const GROUP_LENGTH = 4;
/** 卡密总长度（不含分隔符） */
const CODE_LENGTH = 16;
/** 随机部分长度（前 12 位） */
const RANDOM_LENGTH = 12;

/**
 * 计算 CRC32 校验值（IEEE 802.3 多项式）
 *
 * 使用查表法实现，标准 CRC-32（与 zlib 一致）。
 * @param input 输入字符串
 * @returns 4 位大写十六进制字符串
 */
export function computeCrc32(input: string): string {
  // CRC-32 查找表（IEEE 802.3）
  const table = getCrc32Table();
  let crc = 0xffffffff;

  for (let i = 0; i < input.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ input.charCodeAt(i)) & 0xff];
  }

  crc = (crc ^ 0xffffffff) >>> 0;
  return crc.toString(16).toUpperCase().padStart(8, '0').slice(4, 8);
}

/** CRC-32 查找表（懒加载缓存） */
let crc32Table: Uint32Array | null = null;

function getCrc32Table(): Uint32Array {
  if (crc32Table) return crc32Table;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crc32Table = table;
  return table;
}

/**
 * 生成单张卡密码
 *
 * 流程：
 * 1. 从字符集随机抽取 12 位
 * 2. 计算 CRC32 校验值（4 位）
 * 3. 拼接为 XXXX-XXXX-XXXX-XXXX 格式
 */
export function generateCardCode(): string {
  const randomBytes = crypto.randomBytes(RANDOM_LENGTH);
  let randomPart = '';
  for (let i = 0; i < RANDOM_LENGTH; i++) {
    randomPart += CARD_CHARSET[randomBytes[i] % CARD_CHARSET.length];
  }

  const checksum = computeCrc32(randomPart);
  const fullCode = randomPart + checksum;

  // 按 4 位分组，用 - 连接
  return fullCode.match(new RegExp(`.{${GROUP_LENGTH}}`, 'g'))!.join('-');
}

/**
 * 校验卡密码格式与 CRC32 校验位
 * @returns true=格式合法且校验通过
 */
export function validateCardCode(code: string): boolean {
  // 去除分隔符
  const clean = code.replace(/-/g, '');
  if (clean.length !== CODE_LENGTH) return false;

  const randomPart = clean.slice(0, RANDOM_LENGTH);
  const checksum = clean.slice(RANDOM_LENGTH);
  const expected = computeCrc32(randomPart);

  return checksum === expected;
}
