import crypto from 'crypto';

/**
 * 彩虹易支付签名工具（SPEC §2.6.4 第 4 项 SSRF 白名单：仅易支付回调域名）
 *
 * 彩虹易支付官方签名协议：
 * 1. 参与签名的参数：剔除 sign / sign_type / 空值参数
 * 2. 参数名按 ASCII 升序排序
 * 3. 拼接为 key1=value1&key2=value2&...&keyN=valueN
 * 4. 末尾拼接商户密钥：...&keyN=valueN{KEY}（注意：直接拼接，无 &key=）
 * 5. MD5 取小写 32 位 hex
 *
 * 安全设计：
 * - 使用常量时间比较（timingSafeEqual）防止时序攻击
 * - 商户密钥从数据库 SystemConfig 读取，不硬编码
 */

/** 签名算法（彩虹易支付固定 MD5） */
const SIGN_TYPE = 'MD5';

/**
 * 构建签名原串
 *
 * 步骤：
 * 1. 过滤掉 sign / sign_type / value 为空的参数
 * 2. 按 key ASCII 升序排序
 * 3. 拼接为 k1=v1&k2=v2&...&kN=vN
 * 4. 末尾拼接商户密钥（无分隔符）
 *
 * @param params 待签名参数
 * @param key 商户密钥
 * @returns 签名原串
 */
function buildSignSource(
  params: Record<string, string | number | undefined>,
  key: string,
): string {
  // 过滤空值与 sign/sign_type
  const filtered = Object.entries(params).filter(
    ([k, v]) =>
      k !== 'sign' &&
      k !== 'sign_type' &&
      v !== undefined &&
      v !== null &&
      v !== '',
  );

  // 按 key ASCII 升序排序
  filtered.sort(([a], [b]) => a.localeCompare(b));

  // 拼接 k=v
  const joined = filtered.map(([k, v]) => `${k}=${v}`).join('&');

  // 末尾拼接商户密钥（无 & 分隔符）
  return `${joined}${key}`;
}

/**
 * 计算签名（MD5 小写）
 *
 * @param params 待签名参数
 * @param key 商户密钥
 * @returns 32 位小写 hex MD5
 */
export function signEpayParams(
  params: Record<string, string | number | undefined>,
  key: string,
): string {
  if (!key) {
    throw new Error('待接入：易支付商户密钥未配置');
  }
  const source = buildSignSource(params, key);
  return crypto.createHash(SIGN_TYPE.toLowerCase()).update(source, 'utf8').digest('hex');
}

/**
 * 验证签名（常量时间比较，防时序攻击）
 *
 * @param params 回调参数（含 sign）
 * @param key 商户密钥
 * @param sign 待验证的签名
 * @returns 是否匹配
 */
export function verifyEpaySign(
  params: Record<string, string | number | undefined>,
  key: string,
  sign: string,
): boolean {
  if (!sign || !key) return false;

  const expected = signEpayParams(params, key);

  // 长度不一致直接返回（timingSafeEqual 要求同长度）
  if (expected.length !== sign.length) return false;

  // 常量时间比较，防时序攻击
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(sign, 'utf8'),
  );
}
