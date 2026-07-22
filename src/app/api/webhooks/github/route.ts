import { NextRequest } from 'next/server';
import { verifyGithubSignature } from '@/lib/crypto/signature';
import {
  triggerUpdate,
  createSuccessResponse,
  createErrorResponse,
  UpdateErrorCode,
} from '@/server/modules/update/update-service';

/**
 * GitHub Webhook 接收端
 *
 * 接收 GitHub 仓库 push 事件推送，校验签名后触发自动更新流程。
 *
 * 安全设计：
 * 1. 必须验证 `X-Hub-Signature-256` 头（HMAC-SHA256），防止伪造请求；
 * 2. 必须验证 `X-GitHub-Event === 'push'`，忽略其他事件；
 * 3. 校验推送分支与配置分支匹配，避免非生产分支触发更新；
 * 4. 仅读取原始 body 进行签名验证，禁止在验证前 JSON.parse。
 *
 * 环境变量：
 * - GITHUB_WEBHOOK_SECRET：GitHub 仓库 Webhook Secret
 * - GITHUB_REPO_BRANCH：目标生产分支（如 main）
 */

/** 内部错误码（沿用项目错误码表） */
const ERROR_CODE_BAD_REQUEST = 1002;
const ERROR_CODE_INTERNAL = 9001;

/** Webhook push 事件 payload 的最小子集类型 */
interface GithubPushPayload {
  ref?: string;
  head_commit?: {
    id?: string;
    message?: string;
    timestamp?: string;
    author?: { name?: string; username?: string };
  };
  commits?: Array<{ id: string; message: string }>;
  pusher?: { name?: string };
}

/**
 * POST /api/webhooks/github
 * 接收 GitHub Webhook 推送，校验签名后触发更新
 */
export async function POST(request: NextRequest): Promise<Response> {
  // 1. 读取原始请求体文本（签名验证必须基于原始字节流，不能 JSON.parse 后再序列化）
  const payload = await request.text();
  const signature = request.headers.get('x-hub-signature-256') || '';
  const event = request.headers.get('x-github-event') || '';

  // 2. 校验 Webhook Secret 是否已配置
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return createErrorResponse(
      UpdateErrorCode.WEBHOOK_SIGNATURE_INVALID,
      'Webhook 密钥未配置',
      500,
    );
  }

  // 3. 验证签名（HMAC-SHA256 + timingSafeEqual 防时序攻击）
  if (!verifyGithubSignature(payload, signature, secret)) {
    return createErrorResponse(
      UpdateErrorCode.WEBHOOK_SIGNATURE_INVALID,
      'Webhook 签名验证失败',
      401,
    );
  }

  // 4. 验证事件类型，仅处理 push 事件
  if (event !== 'push') {
    return createSuccessResponse(null, '非 push 事件，已忽略');
  }

  // 5. 解析 payload（此时签名已通过，可以安全解析）
  let payloadObj: GithubPushPayload;
  try {
    payloadObj = JSON.parse(payload) as GithubPushPayload;
  } catch {
    return createErrorResponse(
      ERROR_CODE_BAD_REQUEST,
      'payload 解析失败',
      400,
    );
  }

  // 6. 校验推送分支与配置分支匹配，避免非生产分支触发更新
  const configuredBranch = process.env.GITHUB_REPO_BRANCH;
  if (configuredBranch && payloadObj.ref !== `refs/heads/${configuredBranch}`) {
    return createSuccessResponse(null, '非目标分支，已忽略');
  }

  // 7. 提取操作人信息（优先 head_commit 作者，回退 pusher.name，再回退 webhook 字面量）
  const operator =
    payloadObj.head_commit?.author?.username ||
    payloadObj.head_commit?.author?.name ||
    payloadObj.pusher?.name ||
    'webhook';

  // 8. 触发更新流程（内部已加分布式锁、写入审计 / 历史）
  try {
    const result = await triggerUpdate({ trigger: 'webhook', operator });
    return createSuccessResponse(
      {
        historyId: result.historyId,
        oldVersion: result.oldVersion,
        newVersion: result.newVersion,
      },
      '更新已触发',
    );
  } catch (error) {
    const code =
      (error as { code?: number }).code ?? ERROR_CODE_INTERNAL;
    const message = (error as Error).message;
    return createErrorResponse(code, message, 500);
  }
}
