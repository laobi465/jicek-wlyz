import { NextResponse } from 'next/server';
import { getDashboardData } from '@/server/modules/dashboard/dashboard-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/dashboard
 *
 * 数据看板（按角色返回不同维度的统计数据）
 *
 * 鉴权：X-User-Id + X-User-Role 请求头
 * - developer: 应用/卡密/设备/工单/通知/签到统计
 * - agent: 下级代理/邀请码/佣金/提现/通知/签到统计
 * - super_admin: 全平台用户/业务/收入/工单/提现/APK 注入统计
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const { userId, userRole } = getAuth(request);
  if (!userId || !userRole) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id / X-User-Role 请求头'),
    );
  }

  try {
    const data = await getDashboardData(userId, userRole);
    return NextResponse.json(createSuccessResponse(data));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '获取看板数据失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
