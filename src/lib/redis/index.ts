import Redis, { type RedisOptions } from 'ioredis';

/**
 * Redis 客户端（惰性初始化）
 *
 * 重要：模块加载时不创建连接、不校验环境变量、不抛错。
 * 仅在首次实际调用方法时（运行时）才创建连接并校验环境变量。
 *
 * 原因：`next build` 的"收集页面数据"阶段会评估路由模块，
 * 链路 route → service → redis 会触发本模块加载。
 * 若在模块加载时立即 `new Redis()` 或抛错，构建期就会失败
 * （构建环境无 REDIS_HOST）。
 *
 * 惰性化后：构建期不报错，运行时首次使用才校验（保留铁律 04 显式失败）。
 */

/**
 * 读取并校验 Redis 连接配置（运行时调用）
 *
 * 铁律 04：环境变量缺失时显式抛错
 */
function createRedisConfig(): RedisOptions {
  const redisHost = process.env.REDIS_HOST;
  const redisPortRaw = process.env.REDIS_PORT;
  const redisPassword = process.env.REDIS_PASSWORD;

  if (!redisHost) {
    throw new Error('待接入：环境变量 REDIS_HOST 未配置');
  }
  if (!redisPortRaw) {
    throw new Error('待接入：环境变量 REDIS_PORT 未配置');
  }

  return {
    host: redisHost,
    port: Number(redisPortRaw),
    ...(redisPassword ? { password: redisPassword } : {}),
  };
}

/**
 * 惰性求值的连接配置
 *
 * 通过 getter 在首次访问任意属性时才读取环境变量。
 * 构建期访问（如被 spread）返回空对象结构，不抛错、不连接。
 */
function buildConfigSnapshot(): RedisOptions {
  // 构建期（无 env）返回空骨架，不抛错；运行期返回真实配置
  const host = process.env.REDIS_HOST;
  if (!host) {
    return {} as RedisOptions;
  }
  return createRedisConfig();
}

// 模块加载时仅生成一份快照（运行期进程会有 env；构建期无 env 返回空对象，不抛错）
export const redisConfig: RedisOptions = buildConfigSnapshot();

// 单例缓存
const globalForRedis = globalThis as unknown as { __redisInstance?: Redis };
let redisInstance: Redis | null = globalForRedis.__redisInstance ?? null;

/**
 * 获取/创建 Redis 单例（运行时首次调用）
 */
function getRedisInstance(): Redis {
  if (redisInstance) {
    return redisInstance;
  }
  const config = createRedisConfig();
  redisInstance = new Redis(config);
  globalForRedis.__redisInstance = redisInstance;
  return redisInstance;
}

/**
 * 惰性 Redis 客户端
 *
 * 通过 Proxy 在首次属性访问时才创建真实连接。
 * 所有现有 `redis.xxx()` 调用点无需改动。
 */
export const redis = new Proxy({} as Redis, {
  get(_target, prop: string | symbol) {
    const instance = getRedisInstance();
    const value = Reflect.get(instance, prop);
    // 方法需绑定 this 指向实例（如 redis.pipeline() / redis.ping()）
    return typeof value === 'function' ? (value as Function).bind(instance) : value;
  },
}) as Redis;
