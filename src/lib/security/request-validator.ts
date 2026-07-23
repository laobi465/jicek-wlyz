/**
 * 请求头解析与校验（SPEC §2.3 请求头签名规范）
 *
 * 请求头格式：
 * X-App-Key:   <应用 AppKey>
 * X-Timestamp: <秒级时间戳>
 * X-Nonce:     <32 位随机串>
 * X-Signature: <RSA-2048 签名>
 * Content-Type: application/json
 */

/** 解析后的请求头 */
export interface RequestHeaders {
  appKey: string;
  timestamp: string;
  nonce: string;
  signature: string;
}

/** 头部字段名 */
export const HEADER_APP_KEY = 'x-app-key';
export const HEADER_TIMESTAMP = 'x-timestamp';
export const HEADER_NONCE = 'x-nonce';
export const HEADER_SIGNATURE = 'x-signature';

/** Nonce 最小长度（32 位） */
const NONCE_MIN_LENGTH = 32;

/**
 * 从 Headers 中解析签名相关字段
 * 任一缺失返回 null
 */
export function parseRequestHeaders(headers: Headers): RequestHeaders | null {
  const appKey = headers.get(HEADER_APP_KEY);
  const timestamp = headers.get(HEADER_TIMESTAMP);
  const nonce = headers.get(HEADER_NONCE);
  const signature = headers.get(HEADER_SIGNATURE);

  if (!appKey || !timestamp || !nonce || !signature) {
    return null;
  }
  return { appKey, timestamp, nonce, signature };
}

/**
 * 校验请求头格式合法性
 * @returns true=格式合法
 */
export function validateHeadersFormat(h: RequestHeaders): boolean {
  // AppKey 非空
  if (!h.appKey.trim()) return false;
  // 时间戳为纯数字
  if (!/^\d+$/.test(h.timestamp)) return false;
  // Nonce 长度 >= 32
  if (h.nonce.length < NONCE_MIN_LENGTH) return false;
  // 签名非空
  if (!h.signature.trim()) return false;
  return true;
}
