import { Queue, Worker, type ConnectionOptions, type Processor } from 'bullmq';
import { redisConfig } from '@/lib/redis';

// 队列名称枚举
export enum QueueName {
  /** APK 注入（异步重打包 + 签名） */
  APK_INJECTION = 'apk-injection',
  /** 卡密批量生成 */
  CARD_GENERATION = 'card-generation',
  /** 通知（邮件 / 短信 / 站内信） */
  NOTIFICATION = 'notification',
}

// BullMQ 专用连接配置：maxRetriesPerRequest 必须为 null
// 复用 redis 客户端配置，不硬编码任何主机/端口/密码
const bullMQConnection: ConnectionOptions = {
  ...redisConfig,
  maxRetriesPerRequest: null,
};

/**
 * 通用 Queue 工厂
 * 每个 Queue 基于连接配置创建独立的 Redis 连接，避免相互阻塞
 */
export function createQueue<T = unknown>(name: QueueName): Queue<T> {
  return new Queue<T>(name, { connection: bullMQConnection });
}

/**
 * 通用 Worker 工厂
 * @param name 队列名称
 * @param processor 任务处理函数
 */
export function createWorker<T = unknown, R = unknown>(
  name: QueueName,
  processor: Processor<T, R>,
): Worker<T, R> {
  return new Worker<T, R>(name, processor, { connection: bullMQConnection });
}
