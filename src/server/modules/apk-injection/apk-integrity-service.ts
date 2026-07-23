import { createHash } from 'crypto';
import { ErrorCode } from '@/lib/security/error-code';

/**
 * APK 完整性校验与签名验证服务（SPEC §2.6.3 APK 注入安全 21 项）
 *
 * 职责：
 * 1. APK 文件基础校验（magic number + 大小 + 文件名）
 * 2. SHA-256 完整性哈希计算
 * 3. 注入配置参数白名单校验（防命令注入，§2.6.3 第 21 项）
 * 4. APK 签名哈希校验（§2.6.3 第 1 项 SDK 自签名校验）
 *
 * 安全设计：
 * - 所有外部参数严格白名单校验
 * - 文件名净化（防路径穿越）
 * - apktool 参数仅允许预定义集合
 */

/** APK 文件 magic number：ZIP 格式头 PK\x03\x04 */
const APK_MAGIC_NUMBER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** APK 文件大小上限 500MB（SPEC §2.6.4 第 16 项） */
export const MAX_APK_SIZE = 500 * 1024 * 1024;

/** 允许的 APK 文件扩展名 */
const ALLOWED_EXTENSIONS = ['.apk'];

/** 允许的 SDK 版本（白名单） */
const ALLOWED_SDK_VERSIONS = ['1.0.0', '1.1.0', '1.2.0'] as const;

/** 允许的 SDK 包名前缀（白名单） */
const ALLOWED_SDK_PACKAGE_PREFIX = 'com.jicek.wlyz.';

// ---------------------------------------------------------------------------
// 注入配置类型定义
// ---------------------------------------------------------------------------

/**
 * 注入配置（白名单字段）
 *
 * 所有字段必须经过 sanitize，禁止传入任意字符串至 apktool 命令行
 */
export interface InjectionConfig {
  /** 应用 AppKey */
  appKey: string;
  /** 服务端验证 URL */
  serverUrl: string;
  /** SDK 版本 */
  sdkVersion: string;
  /** SDK 包名 */
  sdkPackage: string;
  /** 是否启用反调试（§2.6.3 第 3/8 项） */
  enableAntiDebug: boolean;
  /** 是否启用 VMP 虚拟化（§2.6.3 第 4/12 项） */
  enableVmp: boolean;
  /** 是否启用字符串加密（§2.6.3 第 13 项） */
  enableStringEncrypt: boolean;
  /** 是否启用控制流平坦化（§2.6.3 第 14 项） */
  enableControlFlowFlatten: boolean;
  /** 是否启用 SO 加壳（§2.6.3 第 15 项） */
  enableSoPack: boolean;
  /** 是否启用防内存 dump（§2.6.3 第 16 项） */
  enableAntiDump: boolean;
  /** 是否启用反模拟器（§2.6.3 第 10 项） */
  enableAntiEmulator: boolean;
  /** 是否启用防多开/虚拟空间（§2.6.3 第 11 项） */
  enableAntiVirtualSpace: boolean;
  /** 是否启用 Java + Native 双层签名校验（§2.6.3 第 6 项） */
  enableDualSignatureCheck: boolean;
  /** 是否启用全文件完整性校验（§2.6.3 第 7 项） */
  enableFullIntegrityCheck: boolean;
  /** 是否启用在线心跳保活（§2.6.3 第 17 项） */
  enableHeartbeat: boolean;
  /** 心跳超时阈值（秒，离线超阈值自动失效） */
  heartbeatTimeoutSec: number;
  /** 是否启用硬件级设备指纹（§2.6.3 第 18 项） */
  enableHardwareFingerprint: boolean;
}

/** 默认注入配置（所有安全项默认开启） */
export const DEFAULT_INJECTION_CONFIG: InjectionConfig = {
  appKey: '',
  serverUrl: '',
  sdkVersion: '1.2.0',
  sdkPackage: 'com.jicek.wlyz.sdk',
  enableAntiDebug: true,
  enableVmp: true,
  enableStringEncrypt: true,
  enableControlFlowFlatten: true,
  enableSoPack: false, // 默认关闭，需要 Themida/VMProtect 商业授权
  enableAntiDump: true,
  enableAntiEmulator: true,
  enableAntiVirtualSpace: true,
  enableDualSignatureCheck: true,
  enableFullIntegrityCheck: true,
  enableHeartbeat: true,
  heartbeatTimeoutSec: 300, // 5 分钟
  enableHardwareFingerprint: true,
};

// ---------------------------------------------------------------------------
// APK 文件校验结果
// ---------------------------------------------------------------------------

export interface ApkValidationResult {
  valid: boolean;
  error?: string;
  errorCode?: number;
  fileSize?: number;
  sha256?: string;
}

// ---------------------------------------------------------------------------
// 1. APK 文件基础校验
// ---------------------------------------------------------------------------

/**
 * 校验 APK 文件
 *
 * 检查项：
 * 1. magic number（PK\x03\x04 ZIP 头）
 * 2. 文件大小（≤ 500MB）
 * 3. 文件扩展名（.apk）
 * 4. 文件非空
 *
 * @param buffer APK 文件 Buffer
 * @param filename 文件名
 */
export function validateApkFile(
  buffer: Buffer,
  filename: string,
): ApkValidationResult {
  // 1. 文件非空
  if (!buffer || buffer.length === 0) {
    return {
      valid: false,
      error: 'APK 文件为空',
      errorCode: ErrorCode.APK_FORMAT_INVALID,
    };
  }

  // 2. 文件大小校验
  if (buffer.length > MAX_APK_SIZE) {
    return {
      valid: false,
      error: `APK 文件大小超限，最大允许 ${MAX_APK_SIZE / 1024 / 1024}MB，当前 ${buffer.length / 1024 / 1024}MB`,
      errorCode: ErrorCode.APK_SIZE_EXCEEDED,
    };
  }

  // 3. magic number 校验（PK\x03\x04）
  if (buffer.length < 4 || !buffer.subarray(0, 4).equals(APK_MAGIC_NUMBER)) {
    return {
      valid: false,
      error: 'APK 文件格式错误，缺少 ZIP magic number',
      errorCode: ErrorCode.APK_FORMAT_INVALID,
    };
  }

  // 4. 文件扩展名校验
  const lowerFilename = filename.toLowerCase();
  const hasValidExt = ALLOWED_EXTENSIONS.some((ext) => lowerFilename.endsWith(ext));
  if (!hasValidExt) {
    return {
      valid: false,
      error: `文件扩展名非法，仅支持 ${ALLOWED_EXTENSIONS.join('/')}`,
      errorCode: ErrorCode.APK_FORMAT_INVALID,
    };
  }

  return {
    valid: true,
    fileSize: buffer.length,
  };
}

// ---------------------------------------------------------------------------
// 2. SHA-256 完整性哈希
// ---------------------------------------------------------------------------

/**
 * 计算文件 SHA-256
 */
export function computeFileSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * 校验文件 SHA-256 是否匹配
 *
 * 使用常量时间比较，防时序攻击
 */
export function verifyFileSha256(
  buffer: Buffer,
  expectedSha256: string,
): boolean {
  const actual = computeFileSha256(buffer);
  // 常量时间比较
  if (actual.length !== expectedSha256.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expectedSha256.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// 3. 注入配置白名单校验（防命令注入）
// ---------------------------------------------------------------------------

/**
 * 构建并校验注入配置（白名单）
 *
 * 所有字段必须经过 sanitize：
 * - appKey/serverUrl/sdkPackage 仅允许字母数字点下划线连字符冒号斜杠
 * - sdkVersion 必须在白名单内
 * - 布尔字段强制转换为 boolean
 * - heartbeatTimeoutSec 限制范围 [60, 3600]
 */
export function buildInjectionConfig(
  input: Partial<InjectionConfig>,
): InjectionConfig {
  const config: InjectionConfig = { ...DEFAULT_INJECTION_CONFIG };

  // 必填字段
  if (!input.appKey) {
    throw new Error('待接入：appKey 必填');
  }
  config.appKey = sanitizeAlphanumeric(input.appKey);

  if (!input.serverUrl) {
    throw new Error('待接入：serverUrl 必填');
  }
  config.serverUrl = sanitizeUrl(input.serverUrl);

  // SDK 版本白名单
  if (input.sdkVersion) {
    if (!isAllowedSdkVersion(input.sdkVersion)) {
      throw new Error(`待接入：SDK 版本不在白名单内，允许版本：${ALLOWED_SDK_VERSIONS.join('/')}`);
    }
    config.sdkVersion = input.sdkVersion;
  }

  // SDK 包名白名单前缀
  if (input.sdkPackage) {
    config.sdkPackage = sanitizePackageName(input.sdkPackage);
  }

  // 布尔字段
  config.enableAntiDebug = Boolean(input.enableAntiDebug);
  config.enableVmp = Boolean(input.enableVmp);
  config.enableStringEncrypt = Boolean(input.enableStringEncrypt);
  config.enableControlFlowFlatten = Boolean(input.enableControlFlowFlatten);
  config.enableSoPack = Boolean(input.enableSoPack);
  config.enableAntiDump = Boolean(input.enableAntiDump);
  config.enableAntiEmulator = Boolean(input.enableAntiEmulator);
  config.enableAntiVirtualSpace = Boolean(input.enableAntiVirtualSpace);
  config.enableDualSignatureCheck = Boolean(input.enableDualSignatureCheck);
  config.enableFullIntegrityCheck = Boolean(input.enableFullIntegrityCheck);
  config.enableHeartbeat = Boolean(input.enableHeartbeat);
  config.enableHardwareFingerprint = Boolean(input.enableHardwareFingerprint);

  // 心跳超时范围限制
  if (input.heartbeatTimeoutSec !== undefined) {
    const t = Number(input.heartbeatTimeoutSec);
    if (!Number.isFinite(t) || t < 60 || t > 3600) {
      throw new Error('待接入：heartbeatTimeoutSec 必须在 60-3600 秒范围内');
    }
    config.heartbeatTimeoutSec = t;
  }

  return config;
}

// ---------------------------------------------------------------------------
// 4. APK 签名哈希校验
// ---------------------------------------------------------------------------

/**
 * 校验 APK 签名哈希是否匹配开发者预登记值
 *
 * §2.6.3 第 1 项：SDK 自签名校验，启动时校验宿主 APK 签名哈希
 *
 * @param actualSignatureHash 实际签名哈希
 * @param registeredSignatureHash 开发者后台预登记哈希
 */
export function verifyApkSignatureHash(
  actualSignatureHash: string,
  registeredSignatureHash: string,
): boolean {
  if (!actualSignatureHash || !registeredSignatureHash) {
    return false;
  }
  // 常量时间比较
  if (actualSignatureHash.length !== registeredSignatureHash.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < actualSignatureHash.length; i++) {
    diff |= actualSignatureHash.charCodeAt(i) ^ registeredSignatureHash.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// 净化函数（防命令注入）
// ---------------------------------------------------------------------------

/**
 * 净化字母数字串（AppKey 等）
 * 仅允许：字母、数字、点、下划线、连字符
 */
function sanitizeAlphanumeric(input: string): string {
  const sanitized = input.replace(/[^a-zA-Z0-9._-]/g, '');
  if (sanitized.length === 0 || sanitized.length > 128) {
    throw new Error('待接入：appKey 长度非法（1-128 字符）');
  }
  return sanitized;
}

/**
 * 净化 URL
 * 仅允许：http/https 协议 + 字母数字点下划线连字符冒号斜杠
 */
function sanitizeUrl(input: string): string {
  // 协议白名单
  if (!/^https?:\/\//i.test(input)) {
    throw new Error('待接入：serverUrl 必须以 http:// 或 https:// 开头');
  }
  const sanitized = input.replace(/[^a-zA-Z0-9._:/-]/g, '');
  if (sanitized.length > 1024) {
    throw new Error('待接入：serverUrl 长度超限（≤1024 字符）');
  }
  return sanitized;
}

/**
 * 净化包名
 * 必须以 com.jicek.wlyz. 开头，仅允许字母数字点下划线
 */
function sanitizePackageName(input: string): string {
  if (!input.startsWith(ALLOWED_SDK_PACKAGE_PREFIX)) {
    throw new Error(`待接入：sdkPackage 必须以 ${ALLOWED_SDK_PACKAGE_PREFIX} 开头`);
  }
  const sanitized = input.replace(/[^a-zA-Z0-9._]/g, '');
  if (sanitized.length > 256) {
    throw new Error('待接入：sdkPackage 长度超限（≤256 字符）');
  }
  return sanitized;
}

/**
 * SDK 版本白名单校验
 */
function isAllowedSdkVersion(version: string): boolean {
  return (ALLOWED_SDK_VERSIONS as readonly string[]).includes(version);
}

// ---------------------------------------------------------------------------
// 5. 构造 apktool 命令参数（白名单严格校验）
// ---------------------------------------------------------------------------

/**
 * apktool 命令参数白名单构造器
 *
 * §2.6.3 第 21 项：apktool 参数白名单，命令注入防护
 *
 * 仅允许以下参数组合：
 * - apktool d <apk> -o <output> -f  （反编译）
 * - apktool b <input> -o <output>   （重打包）
 *
 * 禁止任何额外参数（如 --frame-path 指向任意路径）
 */
export function buildApktoolDecompileCommand(
  apkPath: string,
  outputPath: string,
): string[] {
  // 路径净化：仅允许字母数字点下划线连字符斜杠
  const safeApkPath = sanitizePath(apkPath);
  const safeOutputPath = sanitizePath(outputPath);

  return ['d', safeApkPath, '-o', safeOutputPath, '-f'];
}

export function buildApktoolRebuildCommand(
  inputPath: string,
  outputPath: string,
): string[] {
  const safeInputPath = sanitizePath(inputPath);
  const safeOutputPath = sanitizePath(outputPath);

  return ['b', safeInputPath, '-o', safeOutputPath];
}

/**
 * 路径净化
 * 仅允许：字母数字点下划线连字符斜杠（防止路径穿越和命令注入）
 */
function sanitizePath(path: string): string {
  // 禁止 .. 防路径穿越
  if (path.includes('..')) {
    throw new Error('待接入：路径包含非法字符 ..');
  }
  // 禁止 shell 元字符
  if (/[;&|`$(){}!#\n\r]/.test(path)) {
    throw new Error('待接入：路径包含 shell 元字符');
  }
  // 仅允许字母数字点下划线连字符斜杠
  const sanitized = path.replace(/[^a-zA-Z0-9._/\-]/g, '');
  if (sanitized.length === 0 || sanitized.length > 512) {
    throw new Error('待接入：路径长度非法');
  }
  return sanitized;
}
