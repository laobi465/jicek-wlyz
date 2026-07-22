import {
  checkLatestVersion,
  getUpdateLogs,
  getCurrentVersion,
  createSuccessResponse,
  createErrorResponse,
} from '@/server/modules/update/update-service';
import { getSession } from '@/lib/auth';

/**
 * GET /api/admin/update/check
 *
 * 检查更新接口（超管权限）
 *
 * 返回当前版本 + 最新版本 + 更新日志，供后台弹窗与面板轮询使用。
 * 客户端组件每 60 秒调用一次以检测新版本。
 */

/** 内部错误码 */
const ERROR_CODE_UNAUTHORIZED = 9001;
const ERROR_CODE_INTERNAL = 9001;

/** 超管角色标识（与 Better Auth RBAC 配置一致） */
const SUPER_ADMIN_ROLE = 'super_admin';

export async function GET(request: Request): Promise<Response> {
  // 1. 鉴权：仅超管可访问（Better Auth getSession 需传入请求头以读取会话 Cookie）
  const session = await getSession({ headers: request.headers });
  if (!session) {
    return createErrorResponse(
      ERROR_CODE_UNAUTHORIZED,
      '未登录或会话已过期',
      401,
    );
  }
  // admin 插件为 user 注入 role 字段（string | undefined），防御性断言访问
  const user = session.user as { id: string; role?: string };
  if (user.role !== SUPER_ADMIN_ROLE) {
    return createErrorResponse(
      ERROR_CODE_UNAUTHORIZED,
      '无权限访问，仅超管可检查更新',
      401,
    );
  }

  // 2. 并行获取：当前版本 / 最新版本 / 更新日志
  try {
    const [currentVersion, latestVersion, updateLogs] = await Promise.all([
      Promise.resolve(getCurrentVersion()),
      checkLatestVersion(),
      getUpdateLogs(),
    ]);

    // 3. 比较版本：本地 SHA 与远端最新 SHA 不一致即视为有更新
    const hasUpdate = currentVersion !== latestVersion.sha;

    return createSuccessResponse({
      currentVersion,
      latestVersion,
      updateLogs,
      hasUpdate,
    });
  } catch (error) {
    const code = (error as { code?: number }).code ?? ERROR_CODE_INTERNAL;
    const message = (error as Error).message;
    return createErrorResponse(code, message, 500);
  }
}
