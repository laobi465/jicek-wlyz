import { redis } from '@/lib/redis';

/**
 * 限流与风控（SPEC §2.6.1 第 11/12 项 + §2.6.2 第 10 项）
 *
 * - 滑动窗口限流：单设备单 action 5 次/秒，单 IP 100 次/分钟
 * - 异常流量风控：同卡密 5 分钟内 >3 不同 IP → 锁定
 * - 共享检测：同卡密 24 小时内 >2 不同设备 → 黑名单池
 */

/** 单设备单 action 限流：5 次/秒 */
const DEVICE_RATE_LIMIT = 5;
const DEVICE_RATE_WINDOW = 1; // 秒

/** 单 IP 限流：100 次/分钟 */
const IP_RATE_LIMIT = 100;
const IP_RATE_WINDOW = 60; // 秒

/** 卡密 IP 风控：5 分钟内 >3 个不同 IP */
const CARD_IP_WINDOW = 300; // 5 分钟
const CARD_IP_THRESHOLD = 3;

/** 共享检测：24 小时内 >2 个不同设备 */
const SHARE_WINDOW = 86400; // 24 小时
const SHARE_THRESHOLD = 2;

/**
 * 滑动窗口限流（Redis 有序集合实现）
 *
 * @param key Redis 键
 * @param limit 窗口内最大请求数
 * @param windowSeconds 窗口大小（秒）
 * @returns true=允许，false=超限
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  // 管道：移除窗口外旧记录 + 添加当前请求 + 统计窗口内数量 + 设置过期
  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(key, 0, windowStart);
  pipeline.zadd(key, now, `${now}:${Math.random()}`);
  pipeline.zcard(key);
  pipeline.pexpire(key, windowSeconds * 1000);
  const results = await pipeline.exec();
  const count = results?.[2]?.[1] as number;
  return count <= limit;
}

/**
 * 单设备单 action 限流（5 次/秒）
 */
export async function checkDeviceRate(
  appKey: string,
  machineCode: string,
  action: string,
): Promise<boolean> {
  return rateLimit(
    `ratelimit:device:${appKey}:${machineCode}:${action}`,
    DEVICE_RATE_LIMIT,
    DEVICE_RATE_WINDOW,
  );
}

/**
 * 单 IP 限流（100 次/分钟）
 */
export async function checkIpRate(ip: string): Promise<boolean> {
  return rateLimit(`ratelimit:ip:${ip}`, IP_RATE_LIMIT, IP_RATE_WINDOW);
}

/**
 * 卡密 IP 风控：5 分钟内 >3 个不同 IP → 返回 false（锁定）
 *
 * @param cardCode 卡密码
 * @param ip 当前请求 IP
 * @returns true=正常，false=异常（超阈值）
 */
export async function checkCardIpRisk(
  cardCode: string,
  ip: string,
): Promise<boolean> {
  const key = `risk:cardip:${cardCode}`;
  // 使用集合记录窗口内不同 IP
  const pipeline = redis.pipeline();
  pipeline.zadd(key, Date.now(), ip);
  pipeline.zremrangebyscore(key, 0, Date.now() - CARD_IP_WINDOW * 1000);
  pipeline.zcard(key);
  pipeline.pexpire(key, CARD_IP_WINDOW * 1000);
  const results = await pipeline.exec();
  const distinctIps = results?.[2]?.[1] as number;
  return distinctIps <= CARD_IP_THRESHOLD;
}

/**
 * 共享检测：24 小时内 >2 个不同设备 → 返回 false（疑似共享）
 *
 * @param cardCode 卡密码
 * @param machineCode 设备机器码
 * @returns true=正常，false=疑似共享（超阈值）
 */
export async function checkShareRisk(
  cardCode: string,
  machineCode: string,
): Promise<boolean> {
  const key = `risk:share:${cardCode}`;
  const pipeline = redis.pipeline();
  pipeline.zadd(key, Date.now(), machineCode);
  pipeline.zremrangebyscore(key, 0, Date.now() - SHARE_WINDOW * 1000);
  pipeline.zcard(key);
  pipeline.pexpire(key, SHARE_WINDOW * 1000);
  const results = await pipeline.exec();
  const distinctDevices = results?.[2]?.[1] as number;
  return distinctDevices <= SHARE_THRESHOLD;
}
