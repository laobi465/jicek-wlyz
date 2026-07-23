import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { redis } from '@/lib/redis';
import {
  ErrorCode,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * 全局中间件（M7 安全加固）
 *
 * 职责：
 * 1. 全局 IP 限流（§2.6.4 第 6 项：100 req/min/IP）
 * 2. HTTP 安全头注入（§2.6.4 第 17 项：HSTS/X-Frame-Options 等）
 * 3. 超管后台 IP 白名单（§2.6.4 第 11 项）
 *
 * 注意：使用 Node.js runtime（非 Edge），以便复用 ioredis 连接
 */

/** 全局 IP 限流：100 次/分钟 */
const GLOBAL_IP_LIMIT = 100;
const GLOBAL_IP_WINDOW = 60; // 秒

/** 白名单路径：不限流 */
const RATE_LIMIT_SKIP_PATHS = new Set([
  '/api/health',
  '/api/webhooks/epay',
]);

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

export async function middleware(request: NextRequest): Promise<NextResponse> {
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
  // 2. 全局 IP 限流（§2.6.4 第 6 项，跳过白名单路径）
  // -----------------------------------------------------------------
  if (!RATE_LIMIT_SKIP_PATHS.has(pathname) && clientIp !== 'unknown') {
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
      console.error('[middleware] 全局限流 Redis 查询失败，降级放行');
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
 * Middleware 匹配规则
 *
 * 排除静态资源与 Next.js 内部路径
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
  runtime: 'nodejs',
};
