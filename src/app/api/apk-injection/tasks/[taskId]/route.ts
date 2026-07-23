import { NextResponse } from 'next/server';
import {
  getInjectionTask,
  cancelInjectionTask,
} from '@/server/modules/apk-injection/apk-injection-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/apk-injection/tasks/[taskId]
 * 查询注入任务详情
 *
 * DELETE /api/apk-injection/tasks/[taskId]
 * 取消注入任务（仅 pending 状态可取消）
 *
 * 鉴权：开发者角色，X-User-Id 请求头
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

  try {
    const task = await getInjectionTask(taskId, submitterId);
    if (!task) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.APK_TASK_NOT_FOUND, '任务不存在或无权访问'),
      );
    }
    return NextResponse.json(createSuccessResponse(task));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询任务失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}

export async function DELETE(
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

  try {
    await cancelInjectionTask(taskId, submitterId);
    return NextResponse.json(createSuccessResponse({ canceled: true }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '取消任务失败';
    // 区分任务不存在 / 状态不允许 / 其他错误
    let code = ErrorCode.SYSTEM_ERROR;
    if (msg.includes('不存在')) {
      code = ErrorCode.APK_TASK_NOT_FOUND;
    } else if (msg.includes('不允许')) {
      code = ErrorCode.APK_TASK_STATUS_INVALID;
    }
    return NextResponse.json(createErrorResponse(code, msg));
  }
}
