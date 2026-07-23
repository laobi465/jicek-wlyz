#!/usr/bin/env node
/**
 * jicek-wlyz APK 注入命令行工具
 *
 * 用法：
 *   node dist/tools/apk-injector/cli.js inject --input app.apk --app-key ak_xxx --server-url https://api.example.com [options]
 *   node dist/tools/apk-injector/cli.js verify --input app.apk
 *   node dist/tools/apk-injector/cli.js sign --input unsigned.apk --output signed.apk
 *
 * 功能：
 *   inject  本地注入 APK（直接调用 apktool + smali 注入 + 签名，不上传服务端）
 *   verify  校验 APK 文件完整性（magic + 大小 + SHA-256）
 *   sign    对 APK 进行签名
 *
 * 依赖：apktool、apksigner（需加入 PATH）
 *
 * SPEC §2.6.3 APK 注入安全 21 项
 */

import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename, dirname, resolve } from 'path';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// 参数解析
// ---------------------------------------------------------------------------

interface ParsedArgs {
  command: 'inject' | 'verify' | 'sign' | 'help';
  options: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    return { command: 'help', options: {} };
  }

  const command = args[0] as ParsedArgs['command'];
  if (!['inject', 'verify', 'sign', 'help'].includes(command)) {
    console.error(`未知命令: ${command}`);
    process.exit(1);
  }

  const options: Record<string, string | boolean> = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        options[key] = next;
        i++;
      } else {
        options[key] = true;
      }
    }
  }

  return { command, options };
}

// ---------------------------------------------------------------------------
// 帮助信息
// ---------------------------------------------------------------------------

function showHelp(): void {
  console.log(`
jicek-wlyz APK 注入命令行工具

命令:
  inject   本地注入 APK（反编译 + 注入 SDK smali + 重打包 + 签名）
  verify   校验 APK 文件完整性（magic + 大小 + SHA-256）
  sign     对 APK 进行签名

inject 用法:
  cli.js inject --input <apk> --app-key <key> --server-url <url> [options]

  必填:
    --input         输入 APK 文件路径
    --app-key       应用 AppKey
    --server-url    服务端验证 URL

  可选:
    --output        输出 APK 路径（默认: injected-<input>）
    --sdk-version   SDK 版本（默认: 1.2.0）
    --sdk-package   SDK 包名（默认: com.jicek.wlyz.sdk）
    --no-anti-debug          禁用反调试
    --no-vmp                 禁用 VMP 虚拟化
    --no-string-encrypt      禁用字符串加密
    --no-control-flow        禁用控制流平坦化
    --no-anti-emulator       禁用反模拟器
    --no-anti-virtual-space  禁用防多开
    --no-heartbeat           禁用心跳保活
    --no-hardware-fingerprint 禁用硬件设备指纹
    --heartbeat-timeout      心跳超时秒数（默认: 300，范围 60-3600）

verify 用法:
  cli.js verify --input <apk>

sign 用法:
  cli.js sign --input <unsigned-apk> --output <signed-apk>
              --keystore <path> --ks-pass <pass> --key-alias <alias> --key-pass <pass>

环境变量:
  APK_SIGN_KEYSTORE_PATH     签名 keystore 路径
  APK_SIGN_KEYSTORE_PASSWORD keystore 密码
  APK_SIGN_KEY_ALIAS         密钥别名
  APK_SIGN_KEY_PASSWORD      密钥密码

示例:
  cli.js inject --input app.apk --app-key ak_xxx --server-url https://api.example.com
  cli.js verify --input app.apk
  cli.js sign --input unsigned.apk --output signed.apk \\
    --keystore /path/to/keystore.jks --ks-pass 123456 \\
    --key-alias wlyz --key-pass 123456
`);
}

// ---------------------------------------------------------------------------
// 工具：APK 文件校验
// ---------------------------------------------------------------------------

const APK_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const MAX_APK_SIZE = 500 * 1024 * 1024;

function validateApk(buffer: Buffer, filename: string): void {
  if (!buffer || buffer.length === 0) {
    throw new Error('APK 文件为空');
  }
  if (buffer.length > MAX_APK_SIZE) {
    throw new Error(`APK 文件大小超限（最大 ${MAX_APK_SIZE / 1024 / 1024}MB，当前 ${buffer.length / 1024 / 1024}MB）`);
  }
  if (buffer.length < 4 || !buffer.subarray(0, 4).equals(APK_MAGIC)) {
    throw new Error('APK 文件格式错误，缺少 ZIP magic number');
  }
  if (!filename.toLowerCase().endsWith('.apk')) {
    throw new Error('文件扩展名非法，仅支持 .apk');
  }
}

async function computeSha256(buffer: Buffer): Promise<string> {
  const { createHash } = await import('crypto');
  return createHash('sha256').update(buffer).digest('hex');
}

// ---------------------------------------------------------------------------
// 命令：verify
// ---------------------------------------------------------------------------

async function cmdVerify(options: Record<string, string | boolean>): Promise<void> {
  const inputPath = options.input as string;
  if (!inputPath) {
    console.error('错误: 缺少 --input 参数');
    process.exit(1);
  }

  const absPath = resolve(inputPath);
  if (!existsSync(absPath)) {
    console.error(`错误: 文件不存在: ${absPath}`);
    process.exit(1);
  }

  console.log(`校验文件: ${absPath}`);
  const buffer = await readFile(absPath);
  validateApk(buffer, basename(absPath));

  const sha256 = await computeSha256(buffer);
  console.log('校验通过:');
  console.log(`  文件名:    ${basename(absPath)}`);
  console.log(`  大小:      ${buffer.length} 字节 (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`  SHA-256:   ${sha256}`);
  console.log(`  Magic:     ${buffer.subarray(0, 4).toString('hex')} (PK\\x03\\x04)`);
}

// ---------------------------------------------------------------------------
// 命令：sign
// ---------------------------------------------------------------------------

async function cmdSign(options: Record<string, string | boolean>): Promise<void> {
  const inputPath = options.input as string;
  const outputPath = options.output as string;
  const keystore = (options.keystore as string) || process.env.APK_SIGN_KEYSTORE_PATH;
  const ksPass = (options['ks-pass'] as string) || process.env.APK_SIGN_KEYSTORE_PASSWORD;
  const keyAlias = (options['key-alias'] as string) || process.env.APK_SIGN_KEY_ALIAS;
  const keyPass = (options['key-pass'] as string) || process.env.APK_SIGN_KEY_PASSWORD;

  if (!inputPath || !outputPath) {
    console.error('错误: 缺少 --input 或 --output 参数');
    process.exit(1);
  }
  if (!keystore || !ksPass || !keyAlias || !keyPass) {
    console.error('错误: 缺少签名参数（--keystore --ks-pass --key-alias --key-pass 或对应环境变量）');
    process.exit(1);
  }

  await checkTool('apksigner');

  const args = [
    'sign',
    '--ks', keystore,
    '--ks-key-alias', keyAlias,
    '--ks-pass', `pass:${ksPass}`,
    '--key-pass', `pass:${keyPass}`,
    '--out', outputPath,
    inputPath,
  ];

  console.log(`签名 APK: ${inputPath} → ${outputPath}`);
  try {
    const { stderr } = await execFileAsync('apksigner', args, { timeout: 120_000 });
    if (stderr) console.log(stderr);
    console.log('签名完成');
  } catch (e) {
    console.error(`签名失败: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 命令：inject
// ---------------------------------------------------------------------------

interface InjectConfig {
  appKey: string;
  serverUrl: string;
  sdkVersion: string;
  sdkPackage: string;
  enableAntiDebug: boolean;
  enableVmp: boolean;
  enableStringEncrypt: boolean;
  enableControlFlowFlatten: boolean;
  enableAntiEmulator: boolean;
  enableAntiVirtualSpace: boolean;
  enableHeartbeat: boolean;
  heartbeatTimeoutSec: number;
  enableHardwareFingerprint: boolean;
}

function buildInjectConfig(options: Record<string, string | boolean>): InjectConfig {
  const appKey = options['app-key'] as string;
  const serverUrl = options['server-url'] as string;
  if (!appKey) {
    console.error('错误: 缺少 --app-key 参数');
    process.exit(1);
  }
  if (!serverUrl) {
    console.error('错误: 缺少 --server-url 参数');
    process.exit(1);
  }
  if (!/^https?:\/\//i.test(serverUrl)) {
    console.error('错误: --server-url 必须以 http:// 或 https:// 开头');
    process.exit(1);
  }

  const heartbeatTimeout = options['heartbeat-timeout']
    ? Number(options['heartbeat-timeout'])
    : 300;
  if (!Number.isFinite(heartbeatTimeout) || heartbeatTimeout < 60 || heartbeatTimeout > 3600) {
    console.error('错误: --heartbeat-timeout 必须在 60-3600 范围内');
    process.exit(1);
  }

  return {
    appKey: appKey.replace(/[^a-zA-Z0-9._-]/g, ''),
    serverUrl: serverUrl.replace(/[^a-zA-Z0-9._:/-]/g, ''),
    sdkVersion: (options['sdk-version'] as string) || '1.2.0',
    sdkPackage: (options['sdk-package'] as string) || 'com.jicek.wlyz.sdk',
    enableAntiDebug: !options['no-anti-debug'],
    enableVmp: !options['no-vmp'],
    enableStringEncrypt: !options['no-string-encrypt'],
    enableControlFlowFlatten: !options['no-control-flow'],
    enableAntiEmulator: !options['no-anti-emulator'],
    enableAntiVirtualSpace: !options['no-anti-virtual-space'],
    enableHeartbeat: !options['no-heartbeat'],
    heartbeatTimeoutSec: heartbeatTimeout,
    enableHardwareFingerprint: !options['no-hardware-fingerprint'],
  };
}

async function cmdInject(options: Record<string, string | boolean>): Promise<void> {
  const inputPath = options.input as string;
  if (!inputPath) {
    console.error('错误: 缺少 --input 参数');
    process.exit(1);
  }

  const absInput = resolve(inputPath);
  if (!existsSync(absInput)) {
    console.error(`错误: 文件不存在: ${absInput}`);
    process.exit(1);
  }

  // 1. 校验 apktool / apksigner 可用
  await checkTool('apktool');
  await checkTool('apksigner');

  // 2. 构建注入配置
  const config = buildInjectConfig(options);
  console.log('注入配置:');
  console.log(`  AppKey:           ${config.appKey}`);
  console.log(`  ServerURL:        ${config.serverUrl}`);
  console.log(`  SDK 版本:         ${config.sdkVersion}`);
  console.log(`  SDK 包名:         ${config.sdkPackage}`);
  console.log(`  反调试:           ${config.enableAntiDebug}`);
  console.log(`  VMP:              ${config.enableVmp}`);
  console.log(`  字符串加密:       ${config.enableStringEncrypt}`);
  console.log(`  控制流平坦化:     ${config.enableControlFlowFlatten}`);
  console.log(`  反模拟器:         ${config.enableAntiEmulator}`);
  console.log(`  防多开:           ${config.enableAntiVirtualSpace}`);
  console.log(`  心跳保活:         ${config.enableHeartbeat} (${config.heartbeatTimeoutSec}s)`);
  console.log(`  硬件指纹:         ${config.enableHardwareFingerprint}`);

  // 3. 校验 APK 文件
  console.log(`\n读取 APK: ${absInput}`);
  const apkBuffer = await readFile(absInput);
  validateApk(apkBuffer, basename(absInput));
  const originalSha256 = await computeSha256(apkBuffer);
  console.log(`  大小: ${apkBuffer.length} 字节`);
  console.log(`  SHA-256: ${originalSha256}`);

  // 4. 创建临时工作目录
  const workDir = await mkdtemp(join(tmpdir(), 'wlyz-inject-'));
  console.log(`\n工作目录: ${workDir}`);

  try {
    // 5. 写入原始 APK
    const originalApkPath = join(workDir, 'original.apk');
    await writeFile(originalApkPath, apkBuffer);

    // 6. 反编译
    const decompileDir = join(workDir, 'decompiled');
    await mkdir(decompileDir, { recursive: true });
    console.log('\n[1/4] 反编译 APK (apktool d)...');
    await runCmd('apktool', ['d', originalApkPath, '-o', decompileDir, '-f'], 300_000);

    // 7. 注入 SDK smali 代码
    console.log('[2/4] 注入 SDK smali 代码...');
    await injectSdkSmali(decompileDir, config);

    // 8. 注入配置文件
    console.log('[3/4] 注入配置文件 (assets/wlyz_config.json)...');
    await injectConfigFile(decompileDir, config);

    // 9. 重新打包
    const unsignedApkPath = join(workDir, 'unsigned.apk');
    console.log('[4/4] 重新打包 APK (apktool b)...');
    await runCmd('apktool', ['b', decompileDir, '-o', unsignedApkPath], 300_000);

    // 10. 签名
    const signedApkPath = join(workDir, 'signed.apk');
    console.log('\n签名 APK (apksigner)...');
    await signApk(unsignedApkPath, signedApkPath);

    // 11. 计算注入后 SHA-256
    const signedBuffer = await readFile(signedApkPath);
    const injectedSha256 = await computeSha256(signedBuffer);

    // 12. 输出文件
    const outputPath = (options.output as string) || `injected-${basename(absInput)}`;
    const absOutput = resolve(outputPath);
    const outputDir = dirname(absOutput);
    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
    }
    await writeFile(absOutput, signedBuffer);

    console.log('\n注入完成:');
    console.log(`  输出文件:   ${absOutput}`);
    console.log(`  大小:       ${signedBuffer.length} 字节 (${(signedBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`  SHA-256:    ${injectedSha256}`);
    console.log(`  耗时:       ${Date.now() - 0} ms`);
  } finally {
    // 清理工作目录
    console.log(`\n清理工作目录: ${workDir}`);
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// SDK smali 注入（与 Worker 复用逻辑）
// ---------------------------------------------------------------------------

async function injectSdkSmali(
  decompileDir: string,
  config: InjectConfig,
): Promise<void> {
  const sdkSmaliDir = join(decompileDir, 'smali', ...config.sdkPackage.split('.'));
  await mkdir(sdkSmaliDir, { recursive: true });

  const pkgPath = config.sdkPackage.replace(/\./g, '/');

  // SDK 入口类
  await writeFile(
    join(sdkSmaliDir, 'WlyzSdkEntry.smali'),
    `.class public L${pkgPath}/WlyzSdkEntry;
.super Ljava/lang/Object;

.method public constructor <init>()V
    .locals 0
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    return-void
.end method

.method public static init(Landroid/content/Context;)V
    .locals 1
    const-string v0, "wlyz"
    invoke-static {v0}, Ljava/lang/System;->loadLibrary(Ljava/lang/String;)V
    return-void
.end method
`,
    'utf8',
  );

  // 反调试类
  if (config.enableAntiDebug) {
    await writeFile(
      join(sdkSmaliDir, 'WlyzAntiDebug.smali'),
      `.class public L${pkgPath}/WlyzAntiDebug;
.super Ljava/lang/Object;

.method public static check()Z
    .locals 1
    invoke-static {}, L${pkgPath}/WlyzAntiDebug;->nativeCheckAntiDebug()Z
    move-result v0
    return v0
.end method

.method private static native nativeCheckAntiDebug()Z
.end method
`,
      'utf8',
    );
  }

  // 完整性校验类
  await writeFile(
    join(sdkSmaliDir, 'WlyzIntegrityCheck.smali'),
    `.class public L${pkgPath}/WlyzIntegrityCheck;
.super Ljava/lang/Object;

.method public static verify(Landroid/content/Context;)Z
    .locals 1
    invoke-static {p0}, L${pkgPath}/WlyzIntegrityCheck;->nativeVerifyIntegrity(Landroid/content/Context;)Z
    move-result v0
    return v0
.end method

.method private static native nativeVerifyIntegrity(Landroid/content/Context;)Z
.end method
`,
    'utf8',
  );

  console.log(`  注入 smali 类至: ${sdkSmaliDir}`);
}

async function injectConfigFile(
  decompileDir: string,
  config: InjectConfig,
): Promise<void> {
  const assetsDir = join(decompileDir, 'assets');
  await mkdir(assetsDir, { recursive: true });

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
      anti_emulator: config.enableAntiEmulator,
      anti_virtual_space: config.enableAntiVirtualSpace,
      heartbeat: config.enableHeartbeat,
      heartbeat_timeout_sec: config.heartbeatTimeoutSec,
      hardware_fingerprint: config.enableHardwareFingerprint,
    },
  }, null, 2);

  await writeFile(join(assetsDir, 'wlyz_config.json'), configJson, 'utf8');
  console.log(`  注入配置文件: ${join(assetsDir, 'wlyz_config.json')}`);
}

// ---------------------------------------------------------------------------
// 工具：执行命令
// ---------------------------------------------------------------------------

async function runCmd(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<void> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
    });
    if (stderr) console.log(`  [stderr] ${stderr.slice(0, 500)}`);
    void stdout;
  } catch (e) {
    throw new Error(`${cmd} 执行失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function signApk(unsignedApkPath: string, signedApkPath: string): Promise<void> {
  const keystore = process.env.APK_SIGN_KEYSTORE_PATH;
  const ksPass = process.env.APK_SIGN_KEYSTORE_PASSWORD;
  const keyAlias = process.env.APK_SIGN_KEY_ALIAS;
  const keyPass = process.env.APK_SIGN_KEY_PASSWORD;

  if (!keystore || !ksPass || !keyAlias || !keyPass) {
    throw new Error('APK 签名环境变量未配置（APK_SIGN_KEYSTORE_PATH/PASSWORD/KEY_ALIAS/KEY_PASSWORD）');
  }

  const args = [
    'sign',
    '--ks', keystore,
    '--ks-key-alias', keyAlias,
    '--ks-pass', `pass:${ksPass}`,
    '--key-pass', `pass:${keyPass}`,
    '--out', signedApkPath,
    unsignedApkPath,
  ];

  await runCmd('apksigner', args, 120_000);
}

async function checkTool(tool: string): Promise<void> {
  try {
    await execFileAsync(tool, ['--version'], { timeout: 5_000 });
    console.log(`  [check] ${tool} 可用`);
  } catch {
    console.error(`错误: ${tool} 不可用，请安装并加入 PATH`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv);

  switch (command) {
    case 'help':
      showHelp();
      break;
    case 'verify':
      await cmdVerify(options);
      break;
    case 'sign':
      await cmdSign(options);
      break;
    case 'inject':
      await cmdInject(options);
      break;
  }
}

// ES Module 入口判断
const isMain = typeof require !== 'undefined'
  ? require.main === module
  : import.meta.url === `file://${process.argv[1]}`;

void fileURLToPath; // 仅用于引入标记
void isMain; // CLI 工具直接执行

main().catch((err) => {
  console.error('错误:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
