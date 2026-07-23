import { NextResponse } from 'next/server';
import { handleCallback } from '@/server/modules/payment/epay-service';

/**
 * 彩虹易支付异步回调入口（SPEC §2.6.4 第 4 项 SSRF 白名单）
 *
 * 路由：GET /api/webhooks/epay
 *
 * 彩虹易支付协议：
 * - 异步通知以 GET 方式发送到 notify_url
 * - 服务端处理成功后必须返回纯文本 "success"（非 200 状态码 / 非 success 字符串均会触发重试）
 * - 失败返回 "fail" 或非 success 字符串，易支付会按策略重试
 *
 * 安全设计：
 * - 全程不依赖 Cookie / Session（回调来自易支付服务器，无身份）
 * - 验签使用商户密钥（数据库存储），不依赖任何身份信息
 * - 验签失败记录审计日志 + 返回 fail
 * - 金额一致性二次校验（防篡改）
 * - 全程幂等（重复回调安全）
 *
 * Next.js 16 App Router 约定：
 * - 路由函数签名固定，params 为 Promise（与 [action]/route.ts 一致）
 * - 此处无动态路由参数，仅导出 GET
 */

/**
 * 处理易支付异步回调
 *
 * 响应规则：
 * - 成功：返回纯文本 "success"（Content-Type: text/plain）
 * - 失败：返回纯文本 "fail"
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    // 将 URLSearchParams 转为普通对象
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    const result = await handleCallback(query);

    // 易支付要求成功返回 "success" 字符串
    return new NextResponse(result, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (error) {
    // 异常时返回 fail，易支付会重试
    console.error('[epay-callback] error:', (error as Error).message);
    return new NextResponse('fail', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
