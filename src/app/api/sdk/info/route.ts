import { NextResponse } from 'next/server';
import {
  listSdkLanguages,
  ACCESS_STEPS,
} from '@/server/modules/access/access-service';
import { createSuccessResponse } from '@/lib/security/error-code';

/**
 * GET /api/sdk/info
 *
 * 返回 SDK 语言列表 + 接入步骤 + 仓库下载地址。
 * 无需鉴权（SDK 信息为公开内容，GitHub 仓库已开源）。
 *
 * 前端用 downloadBase + filePath 拼接每个 SDK 的下载链接。
 */

export async function GET(): Promise<NextResponse> {
  const languages = listSdkLanguages(false);

  // 从环境变量读取仓库地址（install.sh 默认填本项目仓库）
  const repoUrl = process.env.GITHUB_REPO_URL || 'https://github.com/laobi465/jicek-wlyz.git';
  const repoBranch = process.env.GITHUB_REPO_BRANCH || 'main';

  // 拼接 GitHub raw 下载基础 URL
  // https://github.com/laobi465/jicek-wlyz.git → https://github.com/laobi465/jicek-wlyz/raw/main
  const repoBase = repoUrl.replace(/\.git$/, '');
  const downloadBase = `${repoBase}/raw/${repoBranch}`;

  return NextResponse.json(
    createSuccessResponse({
      languages,
      steps: ACCESS_STEPS,
      total: languages.length,
      repoUrl: repoBase,
      repoBranch,
      downloadBase,
    }),
  );
}
