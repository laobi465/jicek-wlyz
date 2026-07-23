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
  /** 无权限访问 */
  PERMISSION_DENIED = 1003,
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
  /** APK 文件格式错误 */
  APK_FORMAT_INVALID = 8001,
  /** APK 签名校验失败 */
  APK_SIGNATURE_INVALID = 8002,
  /** APK 完整性校验失败 */
  APK_INTEGRITY_FAILED = 8003,
  /** APK 注入任务不存在 */
  APK_TASK_NOT_FOUND = 8004,
  /** APK 注入任务状态不允许操作 */
  APK_TASK_STATUS_INVALID = 8005,
  /** APK 注入失败（apktool/smali/签名错误） */
  APK_INJECTION_FAILED = 8006,
  /** APK 文件大小超限 */
  APK_SIZE_EXCEEDED = 8007,
  /** APK 注入配置参数非法 */
  APK_CONFIG_INVALID = 8008,
  /** 工单不存在 */
  TICKET_NOT_FOUND = 8101,
  /** 工单已关闭，无法回复 */
  TICKET_CLOSED = 8102,
  /** 工单状态非法 */
  TICKET_STATUS_INVALID = 8103,
  /** 无权操作他人工单 */
  TICKET_FORBIDDEN = 8104,
  /** 通知不存在 */
  NOTIFICATION_NOT_FOUND = 8201,
  /** 今日已签到 */
  CHECKIN_ALREADY = 8301,
  /** 签到记录不存在 */
  CHECKIN_NOT_FOUND = 8302,
  /** 请求超限（全局限流） */
  RATE_LIMIT_EXCEEDED = 8401,
  /** 2FA 未开启（超管/代理强制） */
  TWO_FACTOR_REQUIRED = 8402,
  /** 2FA 验证码错误 */
  TWO_FACTOR_INVALID = 8403,
  /** 2FA 密钥未配置 */
  TWO_FACTOR_NOT_CONFIGURED = 8404,
  /** 超管 IP 不在白名单 */
  IP_WHITELIST_FORBIDDEN = 8405,
  /** 敏感字段解密失败 */
  FIELD_DECRYPT_FAILED = 8406,
  /** 敏感字段加密失败 */
  FIELD_ENCRYPT_FAILED = 8407,
  /** 会话已过期，请重新登录 */
  SESSION_EXPIRED = 8408,
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
    [ErrorCode.PERMISSION_DENIED]: '无权限访问',
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
    [ErrorCode.APK_FORMAT_INVALID]: 'APK 文件格式错误',
    [ErrorCode.APK_SIGNATURE_INVALID]: 'APK 签名校验失败',
    [ErrorCode.APK_INTEGRITY_FAILED]: 'APK 完整性校验失败',
    [ErrorCode.APK_TASK_NOT_FOUND]: 'APK 注入任务不存在',
    [ErrorCode.APK_TASK_STATUS_INVALID]: 'APK 注入任务状态不允许操作',
    [ErrorCode.APK_INJECTION_FAILED]: 'APK 注入失败',
    [ErrorCode.APK_SIZE_EXCEEDED]: 'APK 文件大小超限',
    [ErrorCode.APK_CONFIG_INVALID]: 'APK 注入配置参数非法',
    [ErrorCode.TICKET_NOT_FOUND]: '工单不存在',
    [ErrorCode.TICKET_CLOSED]: '工单已关闭，无法回复',
    [ErrorCode.TICKET_STATUS_INVALID]: '工单状态非法',
    [ErrorCode.TICKET_FORBIDDEN]: '无权操作他人工单',
    [ErrorCode.NOTIFICATION_NOT_FOUND]: '通知不存在',
    [ErrorCode.CHECKIN_ALREADY]: '今日已签到',
    [ErrorCode.CHECKIN_NOT_FOUND]: '签到记录不存在',
    [ErrorCode.RATE_LIMIT_EXCEEDED]: '请求过于频繁，请稍后再试',
    [ErrorCode.TWO_FACTOR_REQUIRED]: '请先开启两步验证',
    [ErrorCode.TWO_FACTOR_INVALID]: '两步验证码错误',
    [ErrorCode.TWO_FACTOR_NOT_CONFIGURED]: '两步验证未配置',
    [ErrorCode.IP_WHITELIST_FORBIDDEN]: '当前 IP 不在白名单',
    [ErrorCode.FIELD_DECRYPT_FAILED]: '敏感字段解密失败',
    [ErrorCode.FIELD_ENCRYPT_FAILED]: '敏感字段加密失败',
    [ErrorCode.SESSION_EXPIRED]: '会话已过期，请重新登录',
  };
  return map[code] ?? '未知错误';
}
