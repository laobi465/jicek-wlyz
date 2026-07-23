/**
 * 统一错误码枚举与响应体工厂
 *
 * 严格遵循 SPEC.md §2.3 错误码枚举表，禁止自创错误码。
 * 统一响应体：{ code, msg, data, ts, nonce }
 */

/** 项目统一错误码（SPEC.md §2.3，禁止自创） */
export enum ErrorCode {
  /** 成功 */
  SUCCESS = 0,
  /** 参数缺失 */
  PARAM_MISSING = 1001,
  /** 参数格式错误 */
  PARAM_FORMAT = 1002,
  /** 应用不存在 */
  APP_NOT_FOUND = 2001,
  /** AppKey 无效 */
  APP_KEY_INVALID = 2002,
  /** 签名校验失败 */
  SIGNATURE_INVALID = 2003,
  /** 时间戳过期 */
  TIMESTAMP_EXPIRED = 2004,
  /** Nonce 重复 */
  NONCE_DUPLICATE = 2005,
  /** 卡密不存在 */
  CARD_NOT_FOUND = 3001,
  /** 卡密已过期 */
  CARD_EXPIRED = 3002,
  /** 卡密已绑定其他设备 */
  CARD_BOUND_OTHER = 3003,
  /** 卡密已被封禁 */
  CARD_BANNED = 3004,
  /** 卡密签名校验失败 */
  CARD_SIGNATURE_INVALID = 3005,
  /** 设备超过绑定上限 */
  DEVICE_LIMIT_EXCEEDED = 4001,
  /** 设备已被封禁 */
  DEVICE_BANNED = 4002,
  /** 套餐余额不足 */
  PACKAGE_INSUFFICIENT = 5001,
  /** 套餐已过期 */
  PACKAGE_EXPIRED = 5002,
  /** 代理邀请码无效 */
  AGENT_CODE_INVALID = 6001,
  /** 代理层级超限 */
  AGENT_LEVEL_EXCEEDED = 6002,
  /** 系统内部错误 */
  SYSTEM_ERROR = 9001,
  /** 服务降级中 */
  SERVICE_DEGRADED = 9002,
}

/** 统一响应体 */
export interface ApiResponse<T = null> {
  code: number;
  msg: string;
  data: T | null;
  ts: number;
  nonce: string;
}

/** 生成随机 nonce（16 字节 hex） */
function genNonce(): string {
  const { randomBytes } = require('crypto') as typeof import('crypto');
  return randomBytes(16).toString('hex');
}

/** 成功响应 */
export function createSuccessResponse<T>(data: T, msg = 'success'): ApiResponse<T> {
  return { code: ErrorCode.SUCCESS, msg, data, ts: Date.now(), nonce: genNonce() };
}

/** 错误响应 */
export function createErrorResponse(
  code: ErrorCode,
  msg?: string,
): ApiResponse<null> {
  return { code, msg: msg ?? errorCodeMsg(code), data: null, ts: Date.now(), nonce: genNonce() };
}

/** 错误码默认文案 */
function errorCodeMsg(code: ErrorCode): string {
  const map: Record<number, string> = {
    [ErrorCode.SUCCESS]: '成功',
    [ErrorCode.PARAM_MISSING]: '参数缺失',
    [ErrorCode.PARAM_FORMAT]: '参数格式错误',
    [ErrorCode.APP_NOT_FOUND]: '应用不存在',
    [ErrorCode.APP_KEY_INVALID]: 'AppKey 无效',
    [ErrorCode.SIGNATURE_INVALID]: '签名校验失败',
    [ErrorCode.TIMESTAMP_EXPIRED]: '时间戳过期',
    [ErrorCode.NONCE_DUPLICATE]: 'Nonce 重复，疑似重放',
    [ErrorCode.CARD_NOT_FOUND]: '卡密不存在',
    [ErrorCode.CARD_EXPIRED]: '卡密已过期',
    [ErrorCode.CARD_BOUND_OTHER]: '卡密已绑定其他设备',
    [ErrorCode.CARD_BANNED]: '卡密已被封禁',
    [ErrorCode.CARD_SIGNATURE_INVALID]: '卡密签名校验失败',
    [ErrorCode.DEVICE_LIMIT_EXCEEDED]: '设备超过绑定上限',
    [ErrorCode.DEVICE_BANNED]: '设备已被封禁',
    [ErrorCode.PACKAGE_INSUFFICIENT]: '套餐余额不足',
    [ErrorCode.PACKAGE_EXPIRED]: '套餐已过期',
    [ErrorCode.AGENT_CODE_INVALID]: '代理邀请码无效',
    [ErrorCode.AGENT_LEVEL_EXCEEDED]: '代理层级超限',
    [ErrorCode.SYSTEM_ERROR]: '系统内部错误',
    [ErrorCode.SERVICE_DEGRADED]: '服务降级中',
  };
  return map[code] ?? '未知错误';
}
