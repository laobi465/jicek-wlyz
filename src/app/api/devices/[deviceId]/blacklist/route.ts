import { NextResponse } from 'next/server';
import {
  getDeviceById,
  blacklistDevice,
} from '@/server/modules/device/device-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * POST /api/devices/[deviceId]/blacklist
 *
 * 将设备加入黑名单（status=blacklisted）。校验归属。
 *
 * 鉴权：X-User-Id 请求头
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

interface RouteContext {
  params: Promise<{ deviceId: string }>;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { userId } = getAuth(request);
  if (!userId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id 请求头'),
    );
  }

  const { deviceId } = await context.params;
  if (!deviceId) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 deviceId 路径参数'),
    );
  }

  try {
    const device = await getDeviceById(deviceId);
    if (!device || device.app.developer_id !== userId) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PERMISSION_DENIED, '设备不存在或无权访问'),
      );
    }
    await blacklistDevice(deviceId);
    return NextResponse.json(createSuccessResponse({ blacklisted: true }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '加黑名单失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
