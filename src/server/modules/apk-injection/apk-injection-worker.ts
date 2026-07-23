import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createWorker,
  QueueName,
} from '@/lib/queue';
import {
  markTaskProcessing,
  markTaskSuccess,
  markTaskFailed,
  downloadApkFromObjectStorage,
} from './apk-injection-service';
import {
  computeFileSha256,
  buildApktoolDecompileCommand,
  buildApktoolRebuildCommand,
  buildInjectionConfig,
  type InjectionConfig,
} from './apk-integrity-service';
import { prisma } from '@/lib/db';

const execFileAsync = promisify(execFile);

/**
 * APK 注入 Worker（BullMQ 处理器）
 *
 * SPEC §2.6.3 APK 注入安全 21 项实现：
 * - 第 20 项：沙箱执行（独立 Docker 容器，宿主机隔离）
 * - 第 21 项：apktool 参数白名单（命令注入防护）
 *
 * 注入流程：
 * 1. 从对象存储下载原始 APK
 * 2. 创建临时工作目录（沙箱）
 * 3. apktool d 反编译 APK
 * 4. 注入 SDK smali 代码（应用入口 Application 类）
 * 5. 注入配置文件（assets/wlyz_config.json）
 * 6. apktool b 重新打包
 * 7. jarsigner / apksigner 签名
 * 8. 上传注入后 APK 至对象存储
 * 9. 更新任务状态
 *
 * 待接入项（铁律 04：未实现的明确抛错）：
 * - 对象存储下载/上传
 * - Docker 沙箱执行
 * - 平台签名 keystore
 */

// ---------------------------------------------------------------------------
// 任务数据类型
// ---------------------------------------------------------------------------

export interface ApkInjectionJobData {
  taskId: string;
  submitterId: string;
  originalObjectKey: string;
  originalSha256: string;
  injectionConfig: InjectionConfig;
}

// ---------------------------------------------------------------------------
// Worker 主入口
// ---------------------------------------------------------------------------

/**
 * 创建 APK 注入 Worker
 *
 * 注意：Worker 必须在独立进程启动（不在 Next.js 主进程），
 * 部署时通过 `node dist/workers/apk-injection-worker.js` 启动
 */
export function startApkInjectionWorker() {
  return createWorker<ApkInjectionJobData, void>(
    QueueName.APK_INJECTION,
    async (job) => {
      const { taskId, originalObjectKey, originalSha256, injectionConfig } = job.data;
      const startTime = Date.now();

      console.log(`[apk-injection] 开始处理任务 taskId=${taskId}`);

      // 1. 标记任务为处理中
      await markTaskProcessing(taskId);

      let workDir: string | null = null;

      try {
        // 2. 创建临时工作目录（沙箱）
        workDir = await createSandboxDir(taskId);
        console.log(`[apk-injection] 沙箱目录: ${workDir}`);

        // 3. 从对象存储下载原始 APK
        const apkBuffer = await downloadApkFromObjectStorage(originalObjectKey);

        // 4. 二次校验 SHA-256 完整性
        const actualSha256 = computeFileSha256(apkBuffer);
        if (actualSha256 !== originalSha256) {
          throw new Error(
            `原始 APK SHA-256 校验失败: expected=${originalSha256}, actual=${actualSha256}`,
          );
        }

        // 5. 写入原始 APK 到沙箱
        const originalApkPath = join(workDir, 'original.apk');
        await writeFile(originalApkPath, apkBuffer);

        // 6. 反编译 APK
        const decompileDir = join(workDir, 'decompiled');
        await mkdir(decompileDir, { recursive: true });
        await runApktoolDecompile(originalApkPath, decompileDir);

        // 7. 注入 SDK smali 代码
        await injectSdkSmaliCode(decompileDir, injectionConfig);

        // 8. 注入配置文件
        await injectConfigFile(decompileDir, injectionConfig);

        // 9. 重新打包 APK
        const unsignedApkPath = join(workDir, 'unsigned.apk');
        await runApktoolRebuild(decompileDir, unsignedApkPath);

        // 10. 签名 APK
        const signedApkPath = join(workDir, 'signed.apk');
        await signApk(unsignedApkPath, signedApkPath);

        // 11. 计算注入后 APK SHA-256
        const signedBuffer = await readFile(signedApkPath);
        const injectedSha256 = computeFileSha256(signedBuffer);

        // 12. 上传注入后 APK 至对象存储
        const injectedObjectKey = `apk/${job.data.submitterId}/injected-${taskId}.apk`;
        await uploadInjectedApkToObjectStorage(injectedObjectKey, signedBuffer);

        // 13. 标记任务成功
        const durationMs = Date.now() - startTime;
        await markTaskSuccess(taskId, injectedObjectKey, injectedSha256, durationMs);

        console.log(`[apk-injection] 任务完成 taskId=${taskId} duration=${durationMs}ms`);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`[apk-injection] 任务失败 taskId=${taskId}:`, errorMessage);
        await markTaskFailed(taskId, errorMessage);
        throw err;
      } finally {
        // 14. 清理沙箱目录
        if (workDir) {
          await cleanupSandboxDir(workDir);
        }
      }
    },
    {
      // 并发数限制：单 Worker 同时处理 1 个任务（APK 注入 CPU 密集）
      concurrency: 1,
    },
  );
}

// ---------------------------------------------------------------------------
// 沙箱目录管理
// ---------------------------------------------------------------------------

/**
 * 创建沙箱工作目录
 *
 * §2.6.3 第 20 项：沙箱执行，独立目录隔离
 *
 * 生产环境应在 Docker 容器内执行，本函数创建临时目录作为基础隔离
 */
async function createSandboxDir(taskId: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `apk-inject-${taskId}-`));
  return dir;
}

/**
 * 清理沙箱目录
 */
async function cleanupSandboxDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (err) {
    console.error(`[apk-injection] 清理沙箱目录失败: ${dir}`, err);
  }
}

// ---------------------------------------------------------------------------
// apktool 命令执行
// ---------------------------------------------------------------------------

/**
 * 执行 apktool 反编译
 *
 * §2.6.3 第 21 项：使用参数白名单构造命令，execFile 防止 shell 注入
 */
async function runApktoolDecompile(
  apkPath: string,
  outputPath: string,
): Promise<void> {
  const args = buildApktoolDecompileCommand(apkPath, outputPath);
  console.log(`[apk-injection] apktool d ${args.join(' ')}`);

  try {
    const { stdout, stderr } = await execFileAsync('apktool', args, {
      timeout: 300_000, // 5 分钟超时
      maxBuffer: 50 * 1024 * 1024, // 50MB stdout 缓冲
    });
    if (stderr) {
      console.log(`[apk-injection] apktool d stderr: ${stderr.slice(0, 500)}`);
    }
    void stdout;
  } catch (err) {
    throw new Error(
      `apktool 反编译失败: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * 执行 apktool 重新打包
 */
async function runApktoolRebuild(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const args = buildApktoolRebuildCommand(inputPath, outputPath);
  console.log(`[apk-injection] apktool b ${args.join(' ')}`);

  try {
    const { stdout, stderr } = await execFileAsync('apktool', args, {
      timeout: 300_000,
      maxBuffer: 50 * 1024 * 1024,
    });
    if (stderr) {
      console.log(`[apk-injection] apktool b stderr: ${stderr.slice(0, 500)}`);
    }
    void stdout;
  } catch (err) {
    throw new Error(
      `apktool 重新打包失败: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// SDK smali 代码注入
// ---------------------------------------------------------------------------

/**
 * 注入 SDK smali 代码至 APK
 *
 * 流程：
 * 1. 读取 AndroidManifest.xml，找到 Application 类
 * 2. 在 Application.attachBaseContext 中插入 SDK 初始化代码
 * 3. 注入 SDK smali 文件至 smali 目录
 *
 * 待接入：实际 smali 注入逻辑复杂，需根据 SDK 版本生成对应 smali 代码
 */
async function injectSdkSmaliCode(
  decompileDir: string,
  config: InjectionConfig,
): Promise<void> {
  // 1. 创建 SDK smali 目录
  const sdkSmaliDir = join(decompileDir, 'smali', ...config.sdkPackage.split('.'));
  await mkdir(sdkSmaliDir, { recursive: true });

  // 2. 生成 SDK 入口类 smali 代码
  const sdkEntrySmali = generateSdkEntrySmali(config);
  await writeFile(join(sdkSmaliDir, 'WlyzSdkEntry.smali'), sdkEntrySmali, 'utf8');

  // 3. 生成反调试 Native 加载类 smali
  if (config.enableAntiDebug) {
    const antiDebugSmali = generateAntiDebugSmali(config);
    await writeFile(join(sdkSmaliDir, 'WlyzAntiDebug.smali'), antiDebugSmali, 'utf8');
  }

  // 4. 生成完整性校验类 smali
  if (config.enableFullIntegrityCheck) {
    const integritySmali = generateIntegrityCheckSmali(config);
    await writeFile(join(sdkSmaliDir, 'WlyzIntegrityCheck.smali'), integritySmali, 'utf8');
  }

  console.log(`[apk-injection] SDK smali 代码注入完成 dir=${sdkSmaliDir}`);
}

/**
 * 生成 SDK 入口类 smali 代码
 *
 * 待接入：完整 smali 代码需根据 SDK 版本动态生成，此处为框架代码
 */
function generateSdkEntrySmali(config: InjectionConfig): string {
  return `.class public L${config.sdkPackage.replace(/\./g, '/')}/WlyzSdkEntry;
.super Ljava/lang/Object;

# SDK 入口类，负责初始化验证服务
# 注入配置：app_key=${config.appKey}, server_url=${config.serverUrl}

.method public constructor <init>()V
    .locals 0
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    return-void
.end method

.method public static init(Landroid/content/Context;)V
    .locals 2
    # 初始化 SDK：加载 Native SO + 启动验证流程
    invoke-static {p0}, L${config.sdkPackage.replace(/\./g, '/')}/WlyzSdkEntry;->loadNativeLibrary(Landroid/content/Context;)V
    return-void
.end method

.method private static loadNativeLibrary(Landroid/content/Context;)V
    .locals 1
    # 加载 libwlyz.so（反调试 + 签名校验 + 完整性校验）
    const-string v0, "wlyz"
    invoke-static {v0}, Ljava/lang/System;->loadLibrary(Ljava/lang/String;)V
    return-void
.end method
`;
}

/**
 * 生成反调试 smali 代码
 */
function generateAntiDebugSmali(config: InjectionConfig): string {
  return `.class public L${config.sdkPackage.replace(/\./g, '/')}/WlyzAntiDebug;
.super Ljava/lang/Object;

# 反调试类：检测 ptrace / frida / xposed
# 配置：enable_anti_debug=${config.enableAntiDebug}

.method public static check()Z
    .locals 2
    # 调用 Native 层反调试检测
    invoke-static {}, L${config.sdkPackage.replace(/\./g, '/')}/WlyzAntiDebug;->nativeCheckAntiDebug()Z
    move-result v0
    return v0
.end method

.method private static native nativeCheckAntiDebug()Z
.end method
`;
}

/**
 * 生成完整性校验 smali 代码
 */
function generateIntegrityCheckSmali(config: InjectionConfig): string {
  return `.class public L${config.sdkPackage.replace(/\./g, '/')}/WlyzIntegrityCheck;
.super Ljava/lang/Object;

# 完整性校验类：classes.dex + resources.arsc + AndroidManifest.xml SHA-256 比对
# 配置：enable_full_integrity_check=${config.enableFullIntegrityCheck}

.method public static verify(Landroid/content/Context;)Z
    .locals 2
    # 调用 Native 层完整性校验
    invoke-static {p0}, L${config.sdkPackage.replace(/\./g, '/')}/WlyzIntegrityCheck;->nativeVerifyIntegrity(Landroid/content/Context;)Z
    move-result v0
    return v0
.end method

.method private static native nativeVerifyIntegrity(Landroid/content/Context;)Z
.end method
`;
}

// ---------------------------------------------------------------------------
// 配置文件注入
// ---------------------------------------------------------------------------

/**
 * 注入 SDK 配置文件至 APK assets 目录
 *
 * 文件：assets/wlyz_config.json
 */
async function injectConfigFile(
  decompileDir: string,
  config: InjectionConfig,
): Promise<void> {
  const assetsDir = join(decompileDir, 'assets');
  await mkdir(assetsDir, { recursive: true });

  // 配置文件内容（运行时由 SDK 读取）
  const configJson = JSON.stringify({
    app_key: config.appKey,
    server_url: config.serverUrl,
    sdk_version: config.sdkVersion,
    sdk_package: config.sdkPackage,
    features: {
      anti_debug: config.enableAntiDebug,
      vmp: config.enableVmp,
      string_encrypt: config.enableStringEncrypt,
      control_flow_flatten: config.enableControlFlowFlatten,
      so_pack: config.enableSoPack,
      anti_dump: config.enableAntiDump,
      anti_emulator: config.enableAntiEmulator,
      anti_virtual_space: config.enableAntiVirtualSpace,
      dual_signature_check: config.enableDualSignatureCheck,
      full_integrity_check: config.enableFullIntegrityCheck,
      heartbeat: config.enableHeartbeat,
      heartbeat_timeout_sec: config.heartbeatTimeoutSec,
      hardware_fingerprint: config.enableHardwareFingerprint,
    },
  }, null, 2);

  await writeFile(join(assetsDir, 'wlyz_config.json'), configJson, 'utf8');
  console.log('[apk-injection] 配置文件注入完成: assets/wlyz_config.json');
}

// ---------------------------------------------------------------------------
// APK 签名
// ---------------------------------------------------------------------------

/**
 * 签名 APK
 *
 * 使用平台签名 keystore 对 APK 进行签名
 *
 * 待接入：平台签名 keystore 路径和密码需从环境变量读取
 */
async function signApk(unsignedApkPath: string, signedApkPath: string): Promise<void> {
  const keystorePath = process.env.APK_SIGN_KEYSTORE_PATH;
  const keystorePassword = process.env.APK_SIGN_KEYSTORE_PASSWORD;
  const keyAlias = process.env.APK_SIGN_KEY_ALIAS;
  const keyPassword = process.env.APK_SIGN_KEY_PASSWORD;

  if (!keystorePath || !keystorePassword || !keyAlias || !keyPassword) {
    throw new Error('待接入：APK 签名环境变量未配置（APK_SIGN_KEYSTORE_PATH/PASSWORD/KEY_ALIAS/KEY_PASSWORD）');
  }

  // 使用 apksigner（推荐，支持 v2/v3 签名）
  const args = [
    'sign',
    '--ks', keystorePath,
    '--ks-key-alias', keyAlias,
    '--ks-pass', `pass:${keystorePassword}`,
    '--key-pass', `pass:${keyPassword}`,
    '--out', signedApkPath,
    unsignedApkPath,
  ];

  console.log('[apk-injection] apksigner sign ...');

  try {
    const { stdout, stderr } = await execFileAsync('apksigner', args, {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (stderr) {
      console.log(`[apk-injection] apksigner stderr: ${stderr.slice(0, 500)}`);
    }
    void stdout;
  } catch (err) {
    throw new Error(
      `APK 签名失败: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 对象存储上传（待接入）
// ---------------------------------------------------------------------------

/**
 * 上传注入后 APK 至对象存储
 *
 * 铁律 04：未实现对象存储接入，抛出明确错误
 */
async function uploadInjectedApkToObjectStorage(
  objectKey: string,
  buffer: Buffer,
): Promise<void> {
  throw new Error(
    `待接入：对象存储上传未实现，objectKey=${objectKey}, size=${buffer.length}`,
  );
}

// ---------------------------------------------------------------------------
// Worker 启动入口（生产环境通过 node 启动此文件）
// ---------------------------------------------------------------------------

/**
 * 启动 APK 注入 Worker
 *
 * 部署方式：
 * ```bash
 * node dist/workers/apk-injection-worker.js
 * ```
 *
 * 或通过 package.json script：
 * ```json
 * { "scripts": { "worker:apk": "node dist/workers/apk-injection-worker.js" } }
 * ```
 */
async function main() {
  console.log('[apk-injection-worker] Worker 启动中...');

  // 校验必需环境变量
  const requiredEnv = ['DATABASE_URL', 'REDIS_HOST', 'REDIS_PORT'];
  for (const env of requiredEnv) {
    if (!process.env[env]) {
      console.error(`[apk-injection-worker] 环境变量 ${env} 未配置`);
      process.exit(1);
    }
  }

  // 校验 apktool / apksigner 是否可用
  await checkToolAvailable('apktool');
  await checkToolAvailable('apksigner');

  const worker = startApkInjectionWorker();
  console.log(`[apk-injection-worker] Worker 已启动，监听队列: ${QueueName.APK_INJECTION}`);

  // 优雅退出
  process.on('SIGINT', async () => {
    console.log('[apk-injection-worker] 收到 SIGINT，正在关闭...');
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    console.log('[apk-injection-worker] 收到 SIGTERM，正在关闭...');
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

/**
 * 检查命令行工具是否可用
 */
async function checkToolAvailable(tool: string): Promise<void> {
  try {
    await execFileAsync(tool, ['--version'], { timeout: 5_000 });
    console.log(`[apk-injection-worker] ${tool} 可用`);
  } catch (err) {
    console.error(
      `[apk-injection-worker] ${tool} 不可用: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error(`[apk-injection-worker] 请安装 ${tool} 并加入 PATH`);
    process.exit(1);
  }
}

// 仅在直接运行时启动 Worker（不是被 require）
if (require.main === module) {
  main().catch((err) => {
    console.error('[apk-injection-worker] 启动失败:', err);
    process.exit(1);
  });
}
