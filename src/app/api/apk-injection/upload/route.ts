import { NextResponse } from 'next/server';
import {
  createInjectionTask,
  MAX_APK_SIZE,
} from '@/server/modules/apk-injection/apk-injection-service';
import {
  buildInjectionConfig,
  type InjectionConfig,
} from '@/server/modules/apk-injection/apk-integrity-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * POST /api/apk-injection/upload
 *
 * APK 注入 - 上传 APK 并创建注入任务
 *
 * 请求体（multipart/form-data）：
 * - file: APK 文件（≤500MB）
 * - appKey: 应用 AppKey（必填）
 * - serverUrl: 服务端 URL（必填）
 * - sdkVersion?: SDK 版本（默认 1.2.0）
 * - enableAntiDebug?: 是否启用反调试（默认 true）
 * - enableVmp?: 是否启用 VMP（默认 true）
 * - enableStringEncrypt?: 是否启用字符串加密（默认 true）
 * - 其他配置项参考 InjectionConfig
 *
 * 鉴权：开发者角色，X-User-Id 请求头
 */

// 简化鉴权：从请求头读取用户 ID（实际由 Better Auth 中间件注入）
function getAuthenticatedUserId(request: Request): string | null {
  const userId = request.headers.get('X-User-Id');
  return userId;
}

export async function POST(request: Request): Promise<NextResponse> {
  // 1. 鉴权
  const submitterId = getAuthenticatedUserId(request);
  if (!submitterId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  // 2. 解析 multipart/form-data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, '请求体非合法 multipart/form-data'),
    );
  }

  // 3. 提取 APK 文件
  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 file 字段（APK 文件）'),
    );
  }

  // 4. 文件大小预校验
  if (file.size > MAX_APK_SIZE) {
    return NextResponse.json(
      createErrorResponse(
        ErrorCode.APK_SIZE_EXCEEDED,
        `APK 文件大小超限，最大允许 ${MAX_APK_SIZE / 1024 / 1024}MB，当前 ${file.size / 1024 / 1024}MB`,
      ),
    );
  }

  // 5. 读取文件 Buffer
  const apkBuffer = Buffer.from(await file.arrayBuffer());

  // 6. 提取注入配置参数
  const appKey = formData.get('appKey');
  const serverUrl = formData.get('serverUrl');
  if (!appKey || typeof appKey !== 'string') {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 appKey 字段'),
    );
  }
  if (!serverUrl || typeof serverUrl !== 'string') {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 serverUrl 字段'),
    );
  }

  // 7. 构建注入配置（白名单校验）
  const configInput: Partial<InjectionConfig> = {
    appKey,
    serverUrl,
  };

  // 可选字段
  const sdkVersion = formData.get('sdkVersion');
  if (sdkVersion && typeof sdkVersion === 'string') {
    configInput.sdkVersion = sdkVersion;
  }
  const sdkPackage = formData.get('sdkPackage');
  if (sdkPackage && typeof sdkPackage === 'string') {
    configInput.sdkPackage = sdkPackage;
  }

  // 布尔字段（表单值为 'true'/'false' 字符串）
  const boolFields: Array<keyof InjectionConfig> = [
    'enableAntiDebug', 'enableVmp', 'enableStringEncrypt',
    'enableControlFlowFlatten', 'enableSoPack', 'enableAntiDump',
    'enableAntiEmulator', 'enableAntiVirtualSpace',
    'enableDualSignatureCheck', 'enableFullIntegrityCheck',
    'enableHeartbeat', 'enableHardwareFingerprint',
  ];
  for (const field of boolFields) {
    const value = formData.get(field as string);
    if (value !== null) {
      (configInput as Record<string, unknown>)[field] = value === 'true';
    }
  }

  // 心跳超时
  const heartbeatTimeoutSec = formData.get('heartbeatTimeoutSec');
  if (heartbeatTimeoutSec && typeof heartbeatTimeoutSec === 'string') {
    configInput.heartbeatTimeoutSec = Number(heartbeatTimeoutSec);
  }

  // 原始签名哈希（开发者后台预登记）
  const originalSignatureHash = formData.get('originalSignatureHash');
  if (originalSignatureHash && typeof originalSignatureHash === 'string') {
    // 传入 buildInjectionConfig 之外的额外字段，单独处理
  }

  // appId（可选）
  const appId = formData.get('appId');
  const appIdStr = appId && typeof appId === 'string' ? appId : undefined;

  // 8. 构建并校验完整配置
  let injectionConfig: InjectionConfig;
  try {
    injectionConfig = buildInjectionConfig(configInput);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '注入配置校验失败';
    return NextResponse.json(
      createErrorResponse(ErrorCode.APK_CONFIG_INVALID, msg),
    );
  }

  // 9. 创建注入任务
  try {
    const result = await createInjectionTask({
      submitterId,
      appId: appIdStr,
      originalFilename: file.name,
      apkBuffer,
      injectionConfig,
      originalSignatureHash:
        originalSignatureHash && typeof originalSignatureHash === 'string'
          ? originalSignatureHash
          : undefined,
    });

    return NextResponse.json(createSuccessResponse(result), { status: 202 });
  } catch (e) {
    const err = e as Error & { code?: number };
    const msg = err.message || '创建注入任务失败';
    // 已知错误码使用对应错误码，否则系统错误
    const code = err.code ?? ErrorCode.SYSTEM_ERROR;
    return NextResponse.json(createErrorResponse(code, msg));
  }
}
