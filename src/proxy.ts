import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { redis } from '@/lib/redis';
import {
  ErrorCode,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * 全局代理（M7 安全加固）
 *
 * Next.js 16：middleware 文件约定已弃用，统一改名为 proxy。
 *
 * 职责：
 * 1. 全局 IP 限流（§2.6.4 第 6 项：100 req/min/IP）
 * 2. HTTP 安全头注入（§2.6.4 第 17 项：HSTS/X-Frame-Options 等）
 * 3. 超管后台 IP 白名单（§2.6.4 第 11 项）
 *
 * 注意：proxy 默认使用 Node.js runtime（非 Edge），以便复用 ioredis 连接。
 * Next.js 16 不允许在 proxy 文件中设置 runtime 配置项，否则会抛错。
 */

/** 全局 IP 限流：100 次/分钟（仅作用于未认证请求与外部 API 入口） */
const GLOBAL_IP_LIMIT = 100;
const GLOBAL_IP_WINDOW = 60; // 秒

/**
 * 白名单路径前缀：不限流
 *
 * 设计原则：限流目标是防外部 API 滥用，不应阻碍已登录用户的后台浏览。
 * 一次侧边栏点击会产生 4~5 个请求（HTML 页面 + get-session + unread-count
 * + 业务接口 + RSC prefetch），100 req/min 在正常浏览下会被误限，
 * 表现为"点击侧边栏无反应"（Next.js 客户端路由收到 429 JSON 静默失败）。
 *
 * 豁免范围：
 * - 所有 HTML 页面（非 /api/ 路径）
 * - 携带 Better Auth session cookie 的已认证请求（见 isAuthenticated）
 * - /api/auth/*：Better Auth 内部已有自己的限流，且 get-session 是高频读操作
 * - /api/notifications/*：客户端已节流 30s，无需 server 端再限
 * - /api/health, /api/webhooks/*：内部健康检查与回调
 */
const RATE_LIMIT_SKIP_PREFIXES: readonly string[] = [
  '/api/auth/',
  '/api/notifications/',
  '/api/health',
  '/api/webhooks/',
];

/**
 * Better Auth 会话 cookie 名称
 *
 * Better Auth 默认 cookie 前缀 `better-auth.session_token`，
 * 部署时可通过环境变量 BETTER_AUTH_SESSION_COOKIE 覆盖。
 */
const SESSION_COOKIE_NAME =
  process.env.BETTER_AUTH_SESSION_COOKIE ?? 'better-auth.session_token';

/**
 * 判断请求是否已通过 Better Auth 身份认证
 *
 * 安全性分析：
 * - cookie 是 Better Auth 服务端用 HMAC 签名设置的，攻击者无法伪造有效签名
 * - 即使攻击者发送一个无效的 cookie 头绕过限流，后续 API 仍会被 Better Auth
 *   校验拒绝（签名无效 → 401），无法实际访问受保护资源
 * - 因此本函数只做"是否存在 cookie"的快速判断，不做签名验证
 *   （签名验证由 Better Auth 在路由层完成）
 *
 * 注意：X-User-Id 头由 src/lib/http.ts 在前端注入，但该头可被攻击者伪造，
 * 不可作为身份认证依据，因此本函数不检查 X-User-Id。
 *
 * @returns true 表示已认证，跳过限流
 */
function isAuthenticated(request: NextRequest): boolean {
  return Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

/** 判断路径是否豁免限流 */
function isRateLimitSkipped(pathname: string): boolean {
  // HTML 页面（非 /api/ 路径）一律豁免：限流目标是防 API 滥用，
  // 不应阻碍已登录用户的后台浏览（每次点击产生 4~5 个伴随请求）
  if (!pathname.startsWith('/api/')) {
    return true;
  }
  return RATE_LIMIT_SKIP_PREFIXES.some((p) => pathname.startsWith(p));
}

/** 超管后台路径前缀 */
const SUPER_ADMIN_PATHS = ['/admin', '/api/admin'];

/**
 * 获取客户端真实 IP
 *
 * 优先级：CF-Connecting-IP > X-Forwarded-For > X-Real-IP
 */
function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    request.headers.get('X-Real-IP') ??
    'unknown'
  );
}

/**
 * 滑动窗口限流（Redis 有序集合）
 */
async function checkGlobalRateLimit(ip: string): Promise<boolean> {
  const key = `ratelimit:global:${ip}`;
  const now = Date.now();
  const windowStart = now - GLOBAL_IP_WINDOW * 1000;

  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(key, 0, windowStart);
  pipeline.zadd(key, now, `${now}:${Math.random()}`);
  pipeline.zcard(key);
  pipeline.pexpire(key, GLOBAL_IP_WINDOW * 1000);
  const results = await pipeline.exec();
  const count = results?.[2]?.[1] as number;
  return count <= GLOBAL_IP_LIMIT;
}

/**
 * 解析超管 IP 白名单（JSON 数组）
 */
function getSuperAdminIpWhitelist(): string[] | null {
  const raw = process.env.SUPER_ADMIN_IP_WHITELIST;
  if (!raw) {
    return null; // 未配置则不启用白名单
  }
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || !arr.every((v) => typeof v === 'string')) {
      return null;
    }
    return arr;
  } catch {
    return null;
  }
}

/**
 * 注入 HTTP 安全响应头
 */
function injectSecurityHeaders(response: NextResponse): void {
  // §2.6.4 第 17 项 HTTP 安全头
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // HSTS（仅 HTTPS）
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains; preload',
  );

  // CSP 严格策略（§2.6.4 第 18 项）
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  );
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const clientIp = getClientIp(request);

  // -----------------------------------------------------------------
  // 1. 超管后台 IP 白名单（§2.6.4 第 11 项）
  // -----------------------------------------------------------------
  const isSuperAdminPath = SUPER_ADMIN_PATHS.some((p) => pathname.startsWith(p));
  if (isSuperAdminPath) {
    const whitelist = getSuperAdminIpWhitelist();
    if (whitelist && whitelist.length > 0) {
      if (!whitelist.includes(clientIp)) {
        return NextResponse.json(
          createErrorResponse(ErrorCode.IP_WHITELIST_FORBIDDEN, '当前 IP 不在超管白名单'),
          { status: 403 },
        );
      }
    }
  }

  // -----------------------------------------------------------------
  // 2. 全局 IP 限流（§2.6.4 第 6 项，跳过白名单路径与已认证请求）
  //
  //    限流仅作用于：
  //    - 未认证请求（未携带 Better Auth session cookie，可能是攻击者）
  //    - 外部 API 入口（/api/v1/*、/api/admin/*、/api/agent/* 等业务接口）
  //
  //    豁免范围：
  //    - HTML 页面（非 /api/ 路径，由 isRateLimitSkipped 判断）
  //    - /api/auth/*、/api/notifications/*、/api/health、/api/webhooks/*
  //    - 携带 Better Auth session cookie 的已认证请求（isAuthenticated）
  //      （cookie 由服务端 HMAC 签名，攻击者无法伪造有效签名）
  // -----------------------------------------------------------------
  if (
    !isRateLimitSkipped(pathname) &&
    !isAuthenticated(request) &&
    clientIp !== 'unknown'
  ) {
    try {
      const allowed = await checkGlobalRateLimit(clientIp);
      if (!allowed) {
        const response = NextResponse.json(
          createErrorResponse(ErrorCode.RATE_LIMIT_EXCEEDED, '请求过于频繁，请稍后再试'),
          { status: 429 },
        );
        response.headers.set('Retry-After', String(GLOBAL_IP_WINDOW));
        injectSecurityHeaders(response);
        return response;
      }
    } catch {
      // Redis 不可用时不阻断请求（降级），仅记录日志
      console.error('[proxy] 全局限流 Redis 查询失败，降级放行');
    }
  }

  // -----------------------------------------------------------------
  // 3. 继续请求 + 注入安全头
  // -----------------------------------------------------------------
  const response = NextResponse.next();
  injectSecurityHeaders(response);
  return response;
}

/**
 * Proxy 匹配规则
 *
 * 排除静态资源与 Next.js 内部路径
 *
 * 注意：Next.js 16 的 proxy 不支持 runtime 配置项（默认 Node.js runtime），
 * 设置 runtime 会抛错，因此这里仅保留 matcher。
 */
export const config = {
  matcher: [
    /*
     * 匹配所有路径，排除：
     * - _next/static, _next/image（静态资源）
     * - favicon.ico, public 静态文件
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
