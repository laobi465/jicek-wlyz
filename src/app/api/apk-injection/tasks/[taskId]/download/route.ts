import { NextResponse } from 'next/server';
import {
  downloadInjectedApk,
  downloadApkFromObjectStorage,
} from '@/server/modules/apk-injection/apk-injection-service';
import {
  ErrorCode,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/apk-injection/tasks/[taskId]/download
 *
 * APK 注入 - 下载注入后的 APK
 *
 * 鉴权：开发者角色，X-User-Id 请求头
 * 仅 success 状态任务可下载
 */

function getAuthenticatedUserId(request: Request): string | null {
  return request.headers.get('X-User-Id');
}

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const submitterId = getAuthenticatedUserId(request);
  if (!submitterId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  const { taskId } = await context.params;
  if (!taskId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 taskId 路径参数'),
    );
  }

  // 1. 查询任务并鉴权
  let downloadInfo: { objectKey: string; filename: string; sha256: string };
  try {
    downloadInfo = await downloadInjectedApk(taskId, submitterId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '下载失败';
    let code = ErrorCode.SYSTEM_ERROR;
    if (msg.includes('不存在')) {
      code = ErrorCode.APK_TASK_NOT_FOUND;
    } else if (msg.includes('未完成')) {
      code = ErrorCode.APK_TASK_STATUS_INVALID;
    } else if (msg.includes('无权')) {
      code = ErrorCode.APK_TASK_NOT_FOUND; // 隐藏存在性
    }
    return NextResponse.json(createErrorResponse(code, msg));
  }

  // 2. 从对象存储下载文件
  let apkBuffer: Buffer;
  try {
    apkBuffer = await downloadApkFromObjectStorage(downloadInfo.objectKey);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '对象存储下载失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }

  // 3. 返回文件流
  // 设置 Content-Disposition 触发浏览器下载
  const headers = new Headers();
  headers.set('Content-Type', 'application/vnd.android.package-archive');
  headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadInfo.filename)}"`);
  headers.set('X-SHA256', downloadInfo.sha256);
  headers.set('Content-Length', String(apkBuffer.length));

  // Buffer 转 Uint8Array 以兼容 BodyInit 类型
  return new NextResponse(new Uint8Array(apkBuffer), { status: 200, headers });
}
