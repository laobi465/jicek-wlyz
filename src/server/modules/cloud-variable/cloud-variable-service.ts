import { prisma } from '@/lib/db';
import { rsaSign } from '@/lib/crypto/rsa';

/**
 * 云变量服务（SPEC §2.1 模块 5）
 *
 * 职责：
 * 1. 每应用独立 KV 配置池
 * 2. 登录后凭 token 读取
 * 3. 服务端签名防篡改
 *
 * 安全设计（SPEC §2.6.4 第 7 项）：
 * - 云变量写入时服务端私钥签名
 * - SDK 读取时校验签名，防止中间人篡改
 */

/** 平台 RSA 私钥（用于云变量签名） */
function getPlatformPrivateKey(): string {
  const key = process.env.PLATFORM_RSA_PRIVATE_KEY;
  if (!key) throw new Error('待接入：环境变量 PLATFORM_RSA_PRIVATE_KEY 未配置');
  return key;
}

/**
 * 获取应用的公开云变量（客户端可见）
 */
export async function getPublicVariables(appId: string) {
  return prisma.cloudVariable.findMany({
    where: { app_id: appId, is_public: true },
    select: {
      id: true,
      key: true,
      value: true,
      value_type: true,
      signature: true,
    },
  });
}

/**
 * 获取应用全部云变量（仅开发者后台 / 已验证会话）
 */
export async function getAllVariables(appId: string) {
  return prisma.cloudVariable.findMany({
    where: { app_id: appId },
    orderBy: { key: 'asc' },
  });
}

/**
 * 设置云变量（新增或更新）
 *
 * 写入时生成服务端签名（防篡改）：
 * 签名原文 = `${key}|${value}|${value_type}|${is_public}`
 */
export async function setVariable(
  appId: string,
  key: string,
  value: string,
  valueType: string = 'string',
  isPublic: boolean = false,
) {
  const privateKey = getPlatformPrivateKey();
  const original = `${key}|${value}|${valueType}|${isPublic}`;
  const signature = rsaSign(privateKey, original);

  return prisma.cloudVariable.upsert({
    where: {
      app_id_key: { app_id: appId, key },
    },
    update: {
      value,
      value_type: valueType,
      is_public: isPublic,
      signature,
    },
    create: {
      app_id: appId,
      key,
      value,
      value_type: valueType,
      is_public: isPublic,
      signature,
    },
  });
}

/**
 * 校验云变量签名（SDK 读取时使用）
 *
 * @param variable 云变量记录
 * @param publicKey 平台 RSA 公钥
 */
export function verifyVariableSignature(
  variable: { key: string; value: string; value_type: string; is_public: boolean; signature: string | null },
  publicKey: string,
): boolean {
  if (!variable.signature) return false;
  const original = `${variable.key}|${variable.value}|${variable.value_type}|${variable.is_public}`;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { rsaVerify } = require('@/lib/crypto/rsa') as typeof import('@/lib/crypto/rsa');
  return rsaVerify(publicKey, original, variable.signature);
}
