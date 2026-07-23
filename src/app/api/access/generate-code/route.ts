import { NextResponse } from 'next/server';
import { generateSdkCode, type CodeGenOptions } from '@/server/modules/access/access-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * POST /api/access/generate-code
 *
 * 接入中心 - 按语言生成接入代码片段
 *
 * 请求体：
 * {
 *   language: string,       // 语言代码：python/java/php/nodejs/go/e/gglua/andlua/autojs/shell/anjian/htmljs
 *   baseUrl: string,        // 服务端基础 URL
 *   appKey: string,         // 应用 AppKey
 *   withExample?: boolean   // 是否附带完整示例（默认 false）
 * }
 */

interface GenerateCodeBody {
  language?: string;
  baseUrl?: string;
  appKey?: string;
  withExample?: boolean;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: GenerateCodeBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, '请求体非合法 JSON'),
    );
  }

  const { language, baseUrl, appKey, withExample } = body;

  if (!language) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 language 字段'),
    );
  }
  if (!baseUrl) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 baseUrl 字段'),
    );
  }
  if (!appKey) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 appKey 字段'),
    );
  }

  const options: CodeGenOptions = {
    baseUrl,
    appKey,
    withExample: withExample ?? false,
  };

  try {
    const result = await generateSdkCode(language, options);
    return NextResponse.json(createSuccessResponse(result));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '代码生成失败';
    // 不支持的语言走 PARAM_FORMAT，其他系统错误走 SYSTEM_ERROR
    const code = msg.startsWith('不支持的语言')
      ? ErrorCode.PARAM_FORMAT
      : ErrorCode.SYSTEM_ERROR;
    return NextResponse.json(createErrorResponse(code, msg));
  }
}
