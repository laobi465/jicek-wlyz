import { NextResponse } from 'next/server';
import { testConnection } from '@/server/modules/access/access-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * POST /api/access/test-connection
 *
 * 接入中心 - 测试应用连接是否正常
 *
 * 请求体：
 * {
 *   appKey: string  // 应用 AppKey
 * }
 *
 * 返回：
 * {
 *   success: boolean,
 *   appKey: string,
 *   appName: string,
 *   cryptoMode: string,
 *   version: string,
 *   message: string
 * }
 */

interface TestConnectionBody {
  appKey?: string;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: TestConnectionBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, '请求体非合法 JSON'),
    );
  }

  const { appKey } = body;
  if (!appKey) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 appKey 字段'),
    );
  }

  try {
    const result = await testConnection(appKey);
    // 即使 success=false 也是正常响应（业务层失败，非系统错误）
    return NextResponse.json(createSuccessResponse(result));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '连接测试失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}
