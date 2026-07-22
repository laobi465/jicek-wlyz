import {
  triggerUpdate,
  createSuccessResponse,
  createErrorResponse,
} from '@/server/modules/update/update-service';
import { getSession } from '@/lib/auth';

/**
 * POST /api/admin/update/trigger
 *
 * 手动触发更新接口（超管权限）
 *
 * 调用 update-service.triggerUpdate()，内部已加 Redis 分布式锁、
 * 执行 git pull + npm install + prisma migrate + docker restart 完整流程，
 * 并写入审计 / 历史记录。
 */

/** 内部错误码 */
const ERROR_CODE_UNAUTHORIZED = 9001;
const ERROR_CODE_INTERNAL = 9001;

/** 超管角色标识 */
const SUPER_ADMIN_ROLE = 'super_admin';

export async function POST(request: Request): Promise<Response> {
  // 1. 鉴权：仅超管可手动触发（Better Auth getSession 需传入请求头以读取会话 Cookie）
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
      '无权限访问，仅超管可触发更新',
      401,
    );
  }

  // 2. 触发更新（trigger: manual，operator 取超管 ID）
  try {
    const result = await triggerUpdate({
      trigger: 'manual',
      operator: user.id,
    });
    return createSuccessResponse(
      {
        historyId: result.historyId,
        oldVersion: result.oldVersion,
        newVersion: result.newVersion,
      },
      '更新已完成',
    );
  } catch (error) {
    const code = (error as { code?: number }).code ?? ERROR_CODE_INTERNAL;
    const message = (error as Error).message;
    return createErrorResponse(code, message, 500);
  }
}
