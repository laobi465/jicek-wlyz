import Redis, { type RedisOptions } from 'ioredis';

// 从环境变量读取 Redis 配置，禁止硬编码主机/端口/密码
const redisHost = process.env.REDIS_HOST;
const redisPortRaw = process.env.REDIS_PORT;
const redisPassword = process.env.REDIS_PASSWORD;

if (!redisHost) {
  throw new Error('待接入：环境变量 REDIS_HOST 未配置');
}
if (!redisPortRaw) {
  throw new Error('待接入：环境变量 REDIS_PORT 未配置');
}

const redisPort = Number(redisPortRaw);

// 通用 Redis 连接配置，供 BullMQ 队列等模块复用
export const redisConfig: RedisOptions = {
  host: redisHost,
  port: redisPort,
  ...(redisPassword ? { password: redisPassword } : {}),
};

// ioredis 单例客户端，防止开发环境多实例
const globalForRedis = globalThis as unknown as { redis?: Redis };

export const redis = globalForRedis.redis ?? new Redis(redisConfig);

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;
