import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';

/**
 * 设备管理服务（SPEC §2.1 模块 3）
 *
 * 职责：
 * 1. 机器码绑定（卡密激活时绑定设备）
 * 2. 心跳保活（更新在线状态 + 最后心跳时间）
 * 3. 在线/离线/黑名单状态管理
 * 4. 设备绑定上限校验
 * 5. 临时封禁
 *
 * 安全设计：
 * - 设备唯一键 [app_id, machine_code] 防重复
 * - 心跳时递增 sequence（防重放）
 * - 离线超阈值自动失效
 */

/** 心跳在线判定窗口（秒），超过此时间未心跳视为离线 */
const ONLINE_WINDOW_SECONDS = 300; // 5 分钟

/**
 * 绑定设备（卡密激活时调用）
 *
 * 流程：
 * 1. 校验设备绑定上限
 * 2. 创建或更新设备记录
 * 3. 关联卡密
 */
export async function bindDevice(
  appId: string,
  machineCode: string,
  cardKeyId: string,
  ip?: string,
) {
  // 校验设备绑定上限
  await checkDeviceLimit(appId, cardKeyId);

  // 创建或更新设备（唯一键 [app_id, machine_code]）
  const device = await prisma.device.upsert({
    where: {
      app_id_machine_code: { app_id: appId, machine_code: machineCode },
    },
    update: {
      card_key_id: cardKeyId,
      ip_address: ip ?? null,
      status: 'online',
      last_heartbeat: new Date(),
      sequence: { increment: 1 },
    },
    create: {
      app_id: appId,
      machine_code: machineCode,
      card_key_id: cardKeyId,
      ip_address: ip ?? null,
      status: 'online',
      last_heartbeat: new Date(),
      sequence: 1,
    },
  });

  // 更新在线状态到 Redis
  await redis.set(`device:online:${device.id}`, '1', 'EX', ONLINE_WINDOW_SECONDS);

  return device;
}

/**
 * 解绑设备
 */
export async function unbindDevice(deviceId: string): Promise<void> {
  await prisma.device.update({
    where: { id: deviceId },
    data: {
      card_key_id: null,
      status: 'offline',
    },
  });
  await redis.del(`device:online:${deviceId}`);
}

/**
 * 心跳保活
 *
 * - 更新最后心跳时间
 * - 递增 sequence（防重放）
 * - 刷新 Redis 在线状态
 */
export async function updateHeartbeat(
  deviceId: string,
  ip?: string,
) {
  const device = await prisma.device.update({
    where: { id: deviceId },
    data: {
      status: 'online',
      last_heartbeat: new Date(),
      sequence: { increment: 1 },
      ...(ip ? { ip_address: ip } : {}),
    },
  });

  await redis.set(`device:online:${deviceId}`, '1', 'EX', ONLINE_WINDOW_SECONDS);
  return device;
}

/**
 * 校验设备绑定上限
 *
 * @throws 如果卡密已绑定的设备数超过应用配置的 max_devices
 */
export async function checkDeviceLimit(
  appId: string,
  cardKeyId: string,
): Promise<void> {
  const app = await prisma.app.findUnique({
    where: { id: appId },
    select: { max_devices: true },
  });
  if (!app) throw new Error('待接入：应用不存在');

  const boundCount = await prisma.device.count({
    where: {
      app_id: appId,
      card_key_id: cardKeyId,
      status: { not: 'blacklisted' },
    },
  });

  if (boundCount >= app.max_devices) {
    throw new DeviceLimitExceededError(app.max_devices);
  }
}

/** 设备超过绑定上限错误 */
export class DeviceLimitExceededError extends Error {
  constructor(public readonly maxDevices: number) {
    super(`待接入：设备超过绑定上限 ${maxDevices}`);
    this.name = 'DeviceLimitExceededError';
  }
}

/**
 * 将设备加入黑名单
 */
export async function blacklistDevice(deviceId: string): Promise<void> {
  await prisma.device.update({
    where: { id: deviceId },
    data: { status: 'blacklisted' },
  });
  await redis.del(`device:online:${deviceId}`);
}

/**
 * 查询设备是否在线
 */
export async function isDeviceOnline(deviceId: string): Promise<boolean> {
  const exists = await redis.exists(`device:online:${deviceId}`);
  return exists === 1;
}

/**
 * 按 app + machineCode 查询设备
 */
export async function getDeviceByMachineCode(
  appId: string,
  machineCode: string,
) {
  return prisma.device.findUnique({
    where: {
      app_id_machine_code: { app_id: appId, machine_code: machineCode },
    },
  });
}

/**
 * 列出设备（开发者后台用，多条件过滤）
 *
 * 支持 appId / status / cardKeyId 过滤，include app，按 last_heartbeat desc。
 */
export async function listDevices(options: {
  appId?: string;
  status?: string;
  cardKeyId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ devices: Awaited<ReturnType<typeof prisma.device.findMany>>; total: number }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  const where: {
    app_id?: string;
    status?: string;
    card_key_id?: string;
  } = {};
  if (options.appId) where.app_id = options.appId;
  if (options.status) where.status = options.status;
  if (options.cardKeyId) where.card_key_id = options.cardKeyId;

  const [devices, total] = await Promise.all([
    prisma.device.findMany({
      where,
      include: { app: true },
      orderBy: { last_heartbeat: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.device.count({ where }),
  ]);

  return { devices, total };
}

/**
 * 按 ID 查询设备（include app，便于路由层校验归属）
 */
export async function getDeviceById(deviceId: string) {
  return prisma.device.findUnique({
    where: { id: deviceId },
    include: { app: true },
  });
}
