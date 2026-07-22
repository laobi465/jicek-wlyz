import {
  rollback,
  createSuccessResponse,
  createErrorResponse,
} from '@/server/modules/update/update-service';
import { getSession } from '@/lib/auth';

/**
 * POST /api/admin/update/rollback
 *
 * 回滚接口（超管权限）
 *
 * 调用 update-service.rollback()，内部执行 git reset --hard HEAD~1 +
 * npm install + docker compose restart app，并写入审计 / 历史记录。
 */

/** 内部错误码 */
const ERROR_CODE_UNAUTHORIZED = 9001;
const ERROR_CODE_INTERNAL = 9001;

/** 超管角色标识 */
const SUPER_ADMIN_ROLE = 'super_admin';

export async function POST(request: Request): Promise<Response> {
  // 1. 鉴权：仅超管可回滚（Better Auth getSession 需传入请求头以读取会话 Cookie）
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
      '无权限访问，仅超管可执行回滚',
      401,
    );
  }

  // 2. 执行回滚（operator 取超管 ID）
  try {
    const result = await rollback({ operator: user.id });
    return createSuccessResponse(
      { rolledBackTo: result.rolledBackTo },
      '回滚已完成',
    );
  } catch (error) {
    const code = (error as { code?: number }).code ?? ERROR_CODE_INTERNAL;
    const message = (error as Error).message;
    return createErrorResponse(code, message, 500);
  }
}
