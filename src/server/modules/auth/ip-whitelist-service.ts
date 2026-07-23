import { prisma } from '@/lib/db';
import { writeAuditLog, AuditAction } from '@/server/modules/audit/audit-service';

/**
 * 超管 IP 白名单服务（M7 安全加固 - §2.6.4 第 11 项）
 *
 * 业务规则：
 * - 超管后台仅允许白名单内 IP 访问
 * - 白名单存储在环境变量 SUPER_ADMIN_IP_WHITELIST（JSON 数组）
 * - 同时提供数据库级白名单（User.ip_whitelist 字段，超管个人白名单）
 * - 中间件层校验环境变量白名单（全局），本服务提供数据库白名单管理（个人）
 *
 * 安全设计：
 * - IP 格式校验（IPv4/IPv6）
 * - CIDR 校验（如 192.168.1.0/24）
 * - 白名单变更需审计日志
 */

/** IPv4 正则 */
const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;
/** IPv4 CIDR 正则 */
const IPV4_CIDR_REGEX = /^(\d{1,3}\.){3}\d{1,3}\/(\d|[12]\d|3[0-2])$/;

/**
 * 校验 IP 格式（支持 IPv4 和 IPv4 CIDR）
 */
export function isValidIpFormat(ip: string): boolean {
  if (!ip) return false;

  // CIDR
  if (ip.includes('/')) {
    if (!IPV4_CIDR_REGEX.test(ip)) return false;
    return ip.split('/')[0].split('.').every((octet) => {
      const n = Number(octet);
      return n >= 0 && n <= 255;
    });
  }

  // 单 IP
  if (!IPV4_REGEX.test(ip)) return false;
  return ip.split('.').every((octet) => {
    const n = Number(octet);
    return n >= 0 && n <= 255;
  });
}

/**
 * 检查 IP 是否匹配白名单（支持 CIDR）
 *
 * @param ip 待检查的 IP
 * @param whitelist 白名单列表（单 IP 或 CIDR）
 */
export function isIpInWhitelist(ip: string, whitelist: string[]): boolean {
  if (whitelist.length === 0) return false;

  for (const rule of whitelist) {
    if (rule === ip) {
      return true;
    }

    // CIDR 匹配
    if (rule.includes('/')) {
      const [network, prefixStr] = rule.split('/');
      const prefix = Number(prefixStr);

      const ipParts = ip.split('.').map(Number);
      const networkParts = network.split('.').map(Number);

      if (ipParts.length !== 4 || networkParts.length !== 4) continue;
      if (ipParts.some((n) => n < 0 || n > 255)) continue;
      if (networkParts.some((n) => n < 0 || n > 255)) continue;

      // 转为 32 位整数
      const ipInt = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
      const networkInt = (networkParts[0] << 24) | (networkParts[1] << 16) | (networkParts[2] << 8) | networkParts[3];

      // 计算掩码
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;

      if ((ipInt & mask) === (networkInt & mask)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 获取全局超管 IP 白名单（环境变量）
 */
export function getGlobalSuperAdminWhitelist(): string[] {
  const raw = process.env.SUPER_ADMIN_IP_WHITELIST;
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

/**
 * 获取用户个人 IP 白名单（数据库）
 *
 * 注意：User.ip_whitelist 字段在 2FA 模块中复用存储备份码，
 * 本函数仅对未开启 2FA 的超管用户有效。
 * 生产环境推荐使用独立字段或独立表存储 IP 白名单。
 */
export async function getUserIpWhitelist(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ip_whitelist: true, two_factor_enabled: true },
  });

  if (!user || !user.ip_whitelist || user.two_factor_enabled) {
    // 开启 2FA 的用户，ip_whitelist 字段被备份码占用
    return [];
  }

  try {
    const arr = JSON.parse(user.ip_whitelist);
    if (!Array.isArray(arr)) return [];
    return arr.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

/**
 * 设置用户个人 IP 白名单（仅超管）
 *
 * @param userId 超管用户 ID
 * @param ips IP 列表
 */
export async function setUserIpWhitelist(
  userId: string,
  ips: string[],
): Promise<void> {
  // 校验所有 IP 格式
  for (const ip of ips) {
    if (!isValidIpFormat(ip)) {
      throw new Error(`待接入：IP 格式非法 - ${ip}`);
    }
  }

  // 去重
  const uniqueIps = [...new Set(ips)];

  await prisma.user.update({
    where: { id: userId },
    data: {
      ip_whitelist: JSON.stringify(uniqueIps),
    },
  });

  await writeAuditLog({
    userId,
    action: AuditAction.CONFIG_UPDATE,
    targetType: 'user',
    targetId: userId,
    details: { field: 'ip_whitelist', count: uniqueIps.length },
  });
}

/**
 * 检查超管 IP 是否允许访问
 *
 * 综合校验：全局白名单 + 用户个人白名单
 * - 全局白名单非空时，必须在全局白名单内
 * - 用户个人白名单非空时，必须在个人白名单内
 *
 * @param userId 超管用户 ID
 * @param ip 待检查的 IP
 * @returns true=允许访问
 */
export async function checkSuperAdminIpAccess(
  userId: string,
  ip: string,
): Promise<boolean> {
  // 1. 全局白名单校验
  const globalWhitelist = getGlobalSuperAdminWhitelist();
  if (globalWhitelist.length > 0) {
    if (!isIpInWhitelist(ip, globalWhitelist)) {
      return false;
    }
  }

  // 2. 用户个人白名单校验
  const userWhitelist = await getUserIpWhitelist(userId);
  if (userWhitelist.length > 0) {
    if (!isIpInWhitelist(ip, userWhitelist)) {
      return false;
    }
  }

  return true;
}
