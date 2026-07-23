import { NextResponse } from 'next/server';
import {
  listWithdrawalsWithTotal,
  requestWithdrawal,
  type WithdrawalStatus,
  type PayoutType,
} from '@/server/modules/withdrawal/withdrawal-service';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@/lib/security/error-code';

/**
 * GET /api/withdrawals
 *
 * 列出当前用户的提现记录（agentUserId 强制锁定为 X-User-Id）
 *
 * 查询参数：
 * - status?: pending / approved / rejected / paid
 * - limit?: 默认 20，最大 100
 * - offset?: 默认 0
 *
 * POST /api/withdrawals
 *
 * 发起提现申请（agentUserId 强制锁定为 X-User-Id）
 *
 * 请求体（JSON）：
 * - amount: 提现金额（必填，>= 1）
 * - payoutAccount: { type: alipay|wxpay|bank, account, name, bank? }
 *
 * 鉴权：X-User-Id + X-User-Role 请求头
 */

function getAuth(request: Request): { userId: string | null; userRole: string | null } {
  return {
    userId: request.headers.get('X-User-Id'),
    userRole: request.headers.get('X-User-Role'),
  };
}

const VALID_STATUSES = ['pending', 'approved', 'rejected', 'paid'];
const VALID_PAYOUT_TYPES = ['alipay', 'wxpay', 'bank'];

export async function GET(request: Request): Promise<NextResponse> {
  const { userId, userRole } = getAuth(request);
  if (!userId || !userRole) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id / X-User-Role 请求头'),
    );
  }

  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status');
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');

  let status: WithdrawalStatus | undefined;
  if (statusParam) {
    if (!VALID_STATUSES.includes(statusParam)) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, `status 参数非法，允许 ${VALID_STATUSES.join('/')}`),
      );
    }
    status = statusParam as WithdrawalStatus;
  }

  let limit = 20;
  if (limitParam) {
    const n = Number(limitParam);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, 'limit 参数非法，允许 1-100'),
      );
    }
    limit = n;
  }

  let offset = 0;
  if (offsetParam) {
    const n = Number(offsetParam);
    if (!Number.isInteger(n) || n < 0) {
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, 'offset 参数非法，必须为非负整数'),
      );
    }
    offset = n;
  }

  try {
    // agentUserId 强制锁定为当前用户，忽略客户端任何越权传参
    const result = await listWithdrawalsWithTotal({
      agentUserId: userId,
      status,
      limit,
      offset,
    });
    return NextResponse.json(createSuccessResponse(result));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '查询提现记录失败';
    return NextResponse.json(createErrorResponse(ErrorCode.SYSTEM_ERROR, msg));
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const { userId, userRole } = getAuth(request);
  if (!userId || !userRole) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '未认证，缺少 X-User-Id / X-User-Role 请求头'),
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, '请求体非合法 JSON'),
    );
  }

  const { amount, payoutAccount } = body;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 amount 字段'),
    );
  }
  if (amount < 1) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'amount 必须 >= 1'),
    );
  }

  if (!payoutAccount || typeof payoutAccount !== 'object') {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 payoutAccount 字段'),
    );
  }
  const account = payoutAccount as Record<string, unknown>;
  if (
    typeof account.type !== 'string' ||
    !VALID_PAYOUT_TYPES.includes(account.type) ||
    typeof account.account !== 'string' ||
    typeof account.name !== 'string'
  ) {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'payoutAccount 字段非法（需 type/account/name）'),
    );
  }
  if (account.bank !== undefined && typeof account.bank !== 'string') {
    return NextResponse.json(
      createErrorResponse(ErrorCode.PARAM_FORMAT, 'payoutAccount.bank 必须为字符串'),
    );
  }

  try {
    const withdrawal = await requestWithdrawal({
      agentUserId: userId,
      amount,
      payoutAccount: {
        type: account.type as PayoutType,
        account: account.account,
        name: account.name,
        ...(typeof account.bank === 'string' ? { bank: account.bank } : {}),
      },
    });
    return NextResponse.json(createSuccessResponse(withdrawal), { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '发起提现失败';
    let code = ErrorCode.SYSTEM_ERROR;
    if (msg.includes('金额') || msg.includes('余额') || msg.includes('账户')) {
      code = ErrorCode.PARAM_FORMAT;
    }
    return NextResponse.json(createErrorResponse(code, msg));
  }
}
