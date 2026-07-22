import crypto from 'crypto';

/**
 * GitHub Webhook 签名验证工具
 *
 * GitHub 在每次推送 Webhook 时，会使用仓库配置的 Secret 生成 HMAC-SHA256 签名，
 * 并通过 `X-Hub-Signature-256` 请求头携带，格式为 `sha256=<hex 摘要>`。
 * 服务端必须用同一 Secret 重新计算摘要并与请求头中的签名比对，否则视为非法请求。
 */

/** GitHub 签名头部前缀，摘要在前缀之后 */
const SIGNATURE_PREFIX = 'sha256=';

/**
 * 验证 GitHub Webhook 签名
 *
 * 实现要点：
 * 1. 使用 HMAC-SHA256 算法计算摘要；
 * 2. 使用 `crypto.timingSafeEqual` 进行常量时间比较，防止时序攻击泄露密钥信息；
 * 3. 比较前严格校验长度，`timingSafeEqual` 要求两个 Buffer 长度相等。
 *
 * @param payload 原始请求体字符串（必须是未被 JSON.parse 改写的原始文本）
 * @param signature `X-Hub-Signature-256` 头部值，格式 `sha256=<hex>`
 * @param secret GitHub 仓库配置的 Webhook Secret
 * @returns 签名是否匹配
 */
export function verifyGithubSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  // 任一入参缺失直接拒绝，避免在异常输入下走入比较逻辑
  if (!payload || !signature || !secret) {
    return false;
  }

  // 签名头部必须以 "sha256=" 前缀开头，否则视为格式非法
  if (!signature.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const expected = signature.slice(SIGNATURE_PREFIX.length);

  // 使用 Secret 与原始 payload 计算 HMAC-SHA256 摘要（hex 字符串）
  const digest = crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');

  // 长度不一致直接返回 false（timingSafeEqual 要求同长度，否则抛出异常）
  if (digest.length !== expected.length) {
    return false;
  }

  // 常量时间比较，防止通过响应耗时差异推断密钥位
  return crypto.timingSafeEqual(
    Buffer.from(digest, 'utf8'),
    Buffer.from(expected, 'utf8'),
  );
}
