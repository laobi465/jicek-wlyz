import { rsaVerify } from './rsa';

/**
 * SDK 请求签名验证（SPEC §2.6.1 第 1 项）
 *
 * 签名原文 = `${METHOD}\n${PATH}\n${TS}\n${NONCE}\n${BODY}`
 * 算法：RSA-2048 + SHA-256，客户端私钥签名，服务端公钥验签
 */

/**
 * 构造签名原文
 * 顺序严格按 SPEC §2.3：METHOD\nPATH\nTS\nNONCE\nBODY
 */
export function buildSignatureOriginal(
  method: string,
  path: string,
  ts: string,
  nonce: string,
  body: string,
): string {
  return `${method}\n${path}\n${ts}\n${nonce}\n${body}`;
}

/**
 * 验证 SDK 请求签名
 *
 * @param method HTTP 方法（大写）
 * @param path 请求路径
 * @param ts 时间戳（秒级字符串）
 * @param nonce 随机串
 * @param body 原始请求体字符串
 * @param signature 客户端签名（base64）
 * @param publicKey 应用 RSA 公钥（服务端持有）
 */
export function verifyRequestSignature(
  method: string,
  path: string,
  ts: string,
  nonce: string,
  body: string,
  signature: string,
  publicKey: string,
): boolean {
  const original = buildSignatureOriginal(method, path, ts, nonce, body);
  return rsaVerify(publicKey, original, signature);
}
