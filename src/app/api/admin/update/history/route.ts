import {
  getUpdateHistory,
  createSuccessResponse,
  createErrorResponse,
} from '@/server/modules/update/update-service';
import { getSession } from '@/lib/auth';

/**
 * GET /api/admin/update/history
 *
 * 更新历史接口（超管权限）
 *
 * 返回更新与回滚的历史记录列表，同时承担审计日志查询职责。
 * 默认返回最近 20 条，按创建时间倒序排列。
 */

/** 内部错误码 */
const ERROR_CODE_UNAUTHORIZED = 9001;
const ERROR_CODE_INTERNAL = 9001;

/** 超管角色标识 */
const SUPER_ADMIN_ROLE = 'super_admin';

/** 默认返回条数 */
const DEFAULT_LIMIT = 20;
/** 单次最大返回条数，防止恶意拉取 */
const MAX_LIMIT = 100;

export async function GET(request: Request): Promise<Response> {
  // 1. 鉴权：仅超管可查询更新历史（Better Auth getSession 需传入请求头以读取会话 Cookie）
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
      '无权限访问，仅超管可查看更新历史',
      401,
    );
  }

  // 2. 解析 limit 参数（可选），做范围约束
  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  let limit = DEFAULT_LIMIT;
  if (limitParam) {
    const parsed = Number.parseInt(limitParam, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  // 3. 查询历史记录
  try {
    const history = await getUpdateHistory(limit);
    return createSuccessResponse({ history, total: history.length });
  } catch (error) {
    const code = (error as { code?: number }).code ?? ERROR_CODE_INTERNAL;
    const message = (error as Error).message;
    return createErrorResponse(code, message, 500);
  }
}
