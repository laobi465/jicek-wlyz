import type { SessionUser } from "./auth-client";

/**
 * 统一 HTTP 请求封装
 *
 * 业务 API 契约（与 src/app/api/** 现有路由一致）：
 * - 请求头注入 X-User-Id + X-User-Role（由调用方传入当前 session 用户）
 * - 响应体：{ code, msg, data, ts, nonce }（src/lib/security/error-code.ts）
 * - code === 0 成功；code === 8408 会话过期；其他为业务错误
 *
 * 注意：业务 API 鉴权头由前端注入。这是已有后端契约，不在本次 M8 改动范围。
 */

/** 统一响应体 */
export interface ApiResponse<T = unknown> {
  code: number;
  msg: string;
  data: T | null;
  ts: number;
  nonce: string;
}

/** 业务错误（携带错误码与文案） */
export class ApiError extends Error {
  code: number;
  constructor(code: number, msg: string) {
    super(msg);
    this.code = code;
    this.name = "ApiError";
  }
}

/** 会话过期错误码（src/lib/security/error-code.ts ErrorCode.SESSION_EXPIRED） */
const SESSION_EXPIRED_CODE = 8408;

/** 会话过期回调（由 AuthProvider 注册） */
let sessionExpiredHandler: (() => void) | null = null;

/** 注册会话过期回调（AuthProvider 启动时调用） */
export function registerSessionExpiredHandler(fn: () => void): void {
  sessionExpiredHandler = fn;
}

/** 业务错误码 → 是否为会话过期 */
function isSessionExpired(code: number): boolean {
  return code === SESSION_EXPIRED_CODE;
}

/**
 * 统一请求
 *
 * @param user 当前 session 用户（用于注入 X-User-Id / X-User-Role 头）
 * @param path API 路径，如 "/api/dashboard"
 * @param options fetch options
 * @returns data 字段（已校验 code === 0）
 * @throws ApiError 业务错误
 */
export async function request<T = unknown>(
  user: SessionUser | null,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (user) {
    headers.set("X-User-Id", user.id);
    if (user.role) {
      headers.set("X-User-Role", user.role);
    }
  }
  // 默认 JSON content-type（除非已设置或为 FormData）
  if (
    !headers.has("Content-Type") &&
    !(options.body instanceof FormData) &&
    options.body
  ) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: "include", // 携带 Better Auth session cookie
  });

  // 非 JSON 响应（如文件下载）直接返回
  const contentType = res.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) {
    return res as unknown as T;
  }

  const body = (await res.json()) as ApiResponse<T>;

  if (body.code === 0) {
    return body.data as T;
  }

  if (isSessionExpired(body.code)) {
    sessionExpiredHandler?.();
  }

  throw new ApiError(body.code, body.msg || "请求失败");
}

/** GET 便捷方法 */
export function get<T = unknown>(
  user: SessionUser | null,
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const url = params ? withQuery(path, params) : path;
  return request<T>(user, url, { method: "GET" });
}

/** POST 便捷方法 */
export function post<T = unknown>(
  user: SessionUser | null,
  path: string,
  body?: unknown,
): Promise<T> {
  return request<T>(user, path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** PATCH 便捷方法 */
export function patch<T = unknown>(
  user: SessionUser | null,
  path: string,
  body?: unknown,
): Promise<T> {
  return request<T>(user, path, {
    method: "PATCH",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** PUT 便捷方法 */
export function put<T = unknown>(
  user: SessionUser | null,
  path: string,
  body?: unknown,
): Promise<T> {
  return request<T>(user, path, {
    method: "PUT",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** DELETE 便捷方法 */
export function del<T = unknown>(
  user: SessionUser | null,
  path: string,
): Promise<T> {
  return request<T>(user, path, { method: "DELETE" });
}

/** 拼接查询参数 */
function withQuery(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
): string {
  const url = new URL(path, "http://placeholder");
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  }
  return url.pathname + url.search;
}
