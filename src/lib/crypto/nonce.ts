import { redis } from '@/lib/redis';

/**
 * 防重放：时间戳校验 + Nonce 去重（SPEC §2.6.1 第 3/4 项）
 *
 * - 时间戳 5 分钟有效期
 * - Nonce 32 位随机串，Redis SET NX EX 600 去重
 */

/** 时间戳有效窗口（秒），超出视为过期 */
const TIMESTAMP_WINDOW_SECONDS = 300; // 5 分钟
/** Nonce 缓存时长（秒） */
const NONCE_TTL_SECONDS = 600; // 10 分钟

/**
 * 校验时间戳是否在有效窗口内
 * @param ts 秒级时间戳
 */
export function checkTimestamp(ts: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - ts) <= TIMESTAMP_WINDOW_SECONDS;
}

/**
 * Nonce 去重检查
 *
 * 使用 Redis SET NX EX 实现：首次写入成功返回 true（未重复），
 * 已存在返回 false（重复，疑似重放攻击）。
 *
 * @param nonce 32 位随机串
 * @returns true=未重复（放行），false=重复（拒绝）
 */
export async function checkNonce(nonce: string): Promise<boolean> {
  const key = `nonce:${nonce}`;
  // SET key 1 NX EX 600：仅当 key 不存在时设置，并设过期
  const result = await redis.set(key, '1', 'EX', NONCE_TTL_SECONDS, 'NX');
  return result === 'OK';
}
