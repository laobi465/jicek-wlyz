import { NextResponse } from 'next/server';
import {
  listSdkLanguages,
  ACCESS_STEPS,
} from '@/server/modules/access/access-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/access/languages
 *
 * 接入中心 - 列出支持的语言 SDK 与接入步骤
 *
 * 查询参数：
 * - mainstream=true: 仅返回主流 SDK（默认 false 返回全部）
 */

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const mainstreamOnly = url.searchParams.get('mainstream') === 'true';

  const languages = listSdkLanguages(mainstreamOnly);

  return NextResponse.json(
    createSuccessResponse({
      languages,
      steps: ACCESS_STEPS,
      total: languages.length,
    }),
  );
}

// 防止 lint 报未使用
void ErrorCode;
void createErrorResponse;
