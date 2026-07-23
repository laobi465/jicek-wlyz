import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import {
  parseRequestHeaders,
  validateHeadersFormat,
} from '@/lib/security/request-validator';
import { checkNonce, checkTimestamp } from '@/lib/crypto/nonce';
import { verifyRequestSignature } from '@/lib/crypto/verify-signature';
import { aesDecrypt, aesEncrypt, generateAesKey, generateAesIv, deriveAesKey } from '@/lib/crypto/aes';
import { generateEphemeralKeyPair, deriveSessionKey } from '@/lib/crypto/session';
import { rsaEncrypt } from '@/lib/crypto/rsa';
import {
  checkDeviceRate,
  checkIpRate,
  checkCardIpRisk,
  checkShareRisk,
} from '@/lib/security/rate-limit';
import {
  ErrorCode,
  createSuccessResponse,
  createErrorResponse,
  type ApiResponse,
} from '@/lib/security/error-code';
import { getAppByKey, getAppPrivateKey, getAppPublicKey } from '@/server/modules/app/app-service';
import { getCardByCode } from '@/server/modules/card-key/card-key-service';
import {
  bindDevice,
  unbindDevice,
  updateHeartbeat,
  getDeviceByMachineCode,
} from '@/server/modules/device/device-service';
import { getPublicVariables } from '@/server/modules/cloud-variable/cloud-variable-service';

/**
 * 验证 API 统一入口（SPEC §2.3）
 *
 * 路由：POST /api/v1/[action]
 * action 取值：verify_rsa | auth | use | unbind | check_update | heartbeat
 *
 * 加密链路（SPEC §2.6.1）：
 * - verify_rsa：明文（下发 RSA 公钥 + ECDHE 会话密钥）
 * - auth/use/unbind/heartbeat：RSA 签名 + AES 加密
 * - check_update：Base64
 *
 * Next.js 16：params 为 Promise，必须 await
 */

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;

  switch (action) {
    case 'verify_rsa':
      return handleVerifyRsa(request);
    case 'auth':
      return handleEncryptedAction(request, handleAuth);
    case 'use':
      return handleEncryptedAction(request, handleUse);
    case 'unbind':
      return handleEncryptedAction(request, handleUnbind);
    case 'check_update':
      return handleCheckUpdate(request);
    case 'heartbeat':
      return handleEncryptedAction(request, handleHeartbeat);
    default:
      return NextResponse.json(
        createErrorResponse(ErrorCode.PARAM_FORMAT, `未知 action: ${action}`),
      );
  }
}

// ---------------------------------------------------------------------------
// 客户端 IP 提取
// ---------------------------------------------------------------------------
function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xri = request.headers.get('x-real-ip');
  if (xri) return xri;
  return '0.0.0.0';
}

// ---------------------------------------------------------------------------
// 1. verify_rsa（明文：下发 RSA 公钥 + ECDHE 会话密钥）
// ---------------------------------------------------------------------------
async function handleVerifyRsa(request: Request): Promise<NextResponse> {
  const body = await request.text();
  let parsed: { app_key?: string; client_public_key?: string };
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json(createErrorResponse(ErrorCode.PARAM_FORMAT, '请求体非合法 JSON'));
  }

  const appKey = parsed.app_key;
  if (!appKey) {
    return NextResponse.json(createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 app_key'));
  }

  const app = await getAppByKey(appKey);
  if (!app || app.status !== 'active') {
    return NextResponse.json(createErrorResponse(ErrorCode.APP_NOT_FOUND));
  }

  // IP 限流
  const ip = getClientIp(request);
  const ipOk = await checkIpRate(ip);
  if (!ipOk) {
    return NextResponse.json(createErrorResponse(ErrorCode.SERVICE_DEGRADED, 'IP 限流'));
  }

  // ECDHE 临时密钥对（PFS）
  const ecdhePair = generateEphemeralKeyPair();

  // 客户端公钥缺失时仅返回服务端公钥
  const clientPubKey = parsed.client_public_key;
  let encryptedSessionKey: string | null = null;
  let sessionKeyHex: string | null = null;

  if (clientPubKey) {
    // 派生会话密钥并缓存（客户端用其 ECDHE 私钥 + 服务端公钥可派生相同密钥）
    const sessionKey = deriveSessionKey(ecdhePair.privateKey, clientPubKey);
    sessionKeyHex = sessionKey.toString('hex');
    // 用应用 RSA 公钥加密会话密钥下发给客户端
    encryptedSessionKey = rsaEncrypt(app.rsa_public_key, sessionKeyHex);
    // 缓存会话密钥到 Redis（10 分钟有效）
    await redis.set(`session:${appKey}`, sessionKeyHex, 'EX', 600);
  }

  return NextResponse.json(
    createSuccessResponse({
      server_public_key: app.rsa_public_key,
      ecdhe_public_key: ecdhePair.publicKey,
      encrypted_session_key: encryptedSessionKey,
      crypto_mode: app.crypto_mode,
    }),
  );
}

// ---------------------------------------------------------------------------
// 共享加密流程（auth/use/unbind/heartbeat）
// ---------------------------------------------------------------------------
interface EncryptedContext {
  app: NonNullable<Awaited<ReturnType<typeof getAppByKey>>>;
  body: string;
  sessionKey: Buffer;
  iv: Buffer;
}

async function resolveEncryptedContext(
  request: Request,
): Promise<{ ctx?: EncryptedContext; error?: NextResponse }> {
  const ip = getClientIp(request);

  // IP 限流
  const ipOk = await checkIpRate(ip);
  if (!ipOk) {
    return { error: NextResponse.json(createErrorResponse(ErrorCode.SERVICE_DEGRADED, 'IP 限流')) };
  }

  // 解析请求头
  const headers = parseRequestHeaders(request.headers);
  if (!headers || !validateHeadersFormat(headers)) {
    return { error: NextResponse.json(createErrorResponse(ErrorCode.PARAM_MISSING, '请求头不完整')) };
  }

  // 查询应用
  const app = await getAppByKey(headers.appKey);
  if (!app || app.status !== 'active') {
    return { error: NextResponse.json(createErrorResponse(ErrorCode.APP_NOT_FOUND)) };
  }

  // 时间戳校验
  if (!checkTimestamp(Number(headers.timestamp))) {
    return { error: NextResponse.json(createErrorResponse(ErrorCode.TIMESTAMP_EXPIRED)) };
  }

  // Nonce 去重
  const nonceOk = await checkNonce(headers.nonce);
  if (!nonceOk) {
    return { error: NextResponse.json(createErrorResponse(ErrorCode.NONCE_DUPLICATE)) };
  }

  // 读取原始请求体
  const rawBody = await request.text();

  // 签名验证
  const sigOk = verifyRequestSignature(
    request.method,
    new URL(request.url).pathname,
    headers.timestamp,
    headers.nonce,
    rawBody,
    headers.signature,
    app.rsa_public_key,
  );
  if (!sigOk) {
    return { error: NextResponse.json(createErrorResponse(ErrorCode.SIGNATURE_INVALID)) };
  }

  // 解析加密体：{ iv, data }
  let encryptedPayload: { iv?: string; data?: string };
  try {
    encryptedPayload = JSON.parse(rawBody);
  } catch {
    return { error: NextResponse.json(createErrorResponse(ErrorCode.PARAM_FORMAT, '请求体非合法 JSON')) };
  }

  if (!encryptedPayload.iv || !encryptedPayload.data) {
    return { error: NextResponse.json(createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 iv 或 data')) };
  }

  // 获取会话密钥
  const sessionKeyHex = await redis.get(`session:${headers.appKey}`);
  if (!sessionKeyHex) {
    return { error: NextResponse.json(createErrorResponse(ErrorCode.SIGNATURE_INVALID, '会话已过期，请重新 verify_rsa')) };
  }
  const sessionKey = Buffer.from(sessionKeyHex, 'hex');
  const iv = Buffer.from(encryptedPayload.iv, 'hex');

  // AES 解密业务数据
  let plaintext: string;
  try {
    plaintext = aesDecrypt(sessionKey, iv, encryptedPayload.data);
  } catch {
    return { error: NextResponse.json(createErrorResponse(ErrorCode.SIGNATURE_INVALID, 'AES 解密失败')) };
  }

  return {
    ctx: {
      app,
      body: plaintext,
      sessionKey,
      iv,
    },
  };
}

/** 加密响应：用会话密钥加密后返回 */
function encryptedResponse(sessionKey: Buffer, data: unknown): NextResponse {
  const iv = generateAesIv();
  const encrypted = aesEncrypt(sessionKey, iv, JSON.stringify(data));
  return NextResponse.json({ iv: iv.toString('hex'), data: encrypted });
}

// ---------------------------------------------------------------------------
// 2. auth（验证卡密并激活设备）
// ---------------------------------------------------------------------------
async function handleAuth(ctx: EncryptedContext, request: Request): Promise<NextResponse> {
  let payload: {
    card_code?: string;
    machine_code?: string;
    device_name?: string;
  };
  try {
    payload = JSON.parse(ctx.body);
  } catch {
    return encryptedResponse(ctx.sessionKey, createErrorResponse(ErrorCode.PARAM_FORMAT));
  }

  const { card_code, machine_code, device_name } = payload;
  if (!card_code || !machine_code) {
    return encryptedResponse(ctx.sessionKey, createErrorResponse(ErrorCode.PARAM_MISSING, '缺少 card_code 或 machine_code'));
  }

  // 设备级限流
  const deviceRateOk = await checkDeviceRate(ctx.app.app_key, machine_code, 'auth');
  if (!deviceRateOk) {
    return encryptedResponse(ctx.sessionKey, createErrorResponse(ErrorCode.SERVICE_DEGRADED, '设备限流'));
  }

  // 查询卡密
  const card = await getCardByCode(card_code);
  if (!card || card.app_id !== ctx.app.id) {
    return encryptedResponse(ctx.sessionKey, createErrorResponse(ErrorCode.CARD_NOT_FOUND));
  }

  // 卡密状态校验
  if (card.status === 'disabled' || card.revoked) {
    return encryptedResponse(ctx.sessionKey, createErrorResponse(ErrorCode.CARD_BANNED));
  }
  if (card.status === 'blacklisted') {
    return encryptedResponse(ctx.sessionKey, createErrorResponse(ErrorCode.CARD_BANNED));
  }
  if (card.status === 'expired') {
    return encryptedResponse(ctx.sessionKey, createErrorResponse(ErrorCode.CARD_EXPIRED));
  }

  // 风控：IP 异地检测
  const ip = getClientIp(request);
  const ipRiskOk = await checkCardIpRisk(card_code, ip);
  if (!ipRiskOk) {
    return encryptedResponse(ctx.sessionKey, createErrorResponse(ErrorCode.CARD_BANNED, '卡密 IP 异常，已临时锁定'));
  }

  // 风控：共享检测
  const shareOk = await checkShareRisk(card_code, machine_code);
  if (!shareOk) {
    return encryptedResponse(ctx.sessionKey, createErrorResponse(ErrorCode.CARD_BANNED, '卡密疑似共享，已加入黑名单'));
  }

  // 激活卡密
  const now = new Date();
  const expiresAt = computeExpiry(card);

  await prisma.cardKey.update({
    where: { id: card.id },
    data: {
      status: 'active',
      activated_at: now,
      expires_at: expiresAt,
    },
  });

  // 绑定设备
  const device = await bindDevice(ctx.app.id, machine_code, card.id, ip);

  // 返回设备 token（简化：用设备 ID + 时间戳签名）
  const token = `${device.id}:${Date.now()}`;
  return encryptedResponse(ctx.sessionKey, createSuccessResponse({
    device_id: device.id,
    token,
    expires_at: expiresAt?.toISOString() ?? null,
    heartbeat_interval: ctx.app.heartbeat_interval,
  }));
}

/** 根据卡密类型计算到期时间 */
function computeExpiry(card: Awaited<ReturnType<typeof getCardByCode>>): Date | null {
  if (!card) return null;
  const now = new Date();
  // 通过模板或卡密字段判断类型，此处简化用 template 关系
  if (card.app_id) {
    // 默认按天卡处理，实际应读 template.type
    return new Date(now.getTime() + 24 * 3600 * 1000);
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3. use（次数卡扣减）
// ---------------------------------------------------------------------------
async function handleUse(ctx: EncryptedContext): Promise<NextResponse> {
  let payload: { device_id?: string; card_code?: string };
  try {
    payload = JSON.parse(ctx.body);
  } catch {
    return encryptedResponse(ctx.sessionKey, createErrorResponse(ErrorCode.PARAM_FORMAT));
  }

  const { device_id, card_code } = payload;
  if (!device_id || !card_code) {
    return encryptedResponse(ctx.sessionKey, createErrorResponse(ErrorCode.PARAM_MISSING));
  }

  const card = await getCardByCode(card_code);
  if (!card || card.remaining_count === null) {
    return encryptedResponse(ctx.sessionKey, createErrorResponse(ErrorCode.CARD_NOT_FOUND));
  }

  if (card.remaining_count <= 0) {
    return encryptedResponse(ctx.sessionKey, createErrorResponse(ErrorCode.CARD_EXPIRED, '次数已用尽'));
  }

  await prisma.cardKey.update({
    where: { id: card.id },
    data: { remaining_count: { decrement: 1 } },
  });

  return encryptedResponse(ctx.sessionKey, createSuccessResponse({
    remaining_count: card.remaining_count - 1,
  }));
}

// ---------------------------------------------------------------------------
// 4. unbind（解绑设备）
// ---------------------------------------------------------------------------
async function handleUnbind(ctx: EncryptedContext): Promise<NextResponse> {
  let payload: { device_id?: string };
  try {
    payload = JSON.parse(ctx.body);
  } catch {
    return encryptedResponse(ctx.sessionKey, createErrorResponse(ErrorCode.PARAM_FORMAT));
  }

  const { device_id } = payload;
  if (!device_id) {
    return encryptedResponse(ctx.sessionKey, createErrorResponse(ErrorCode.PARAM_MISSING));
  }

  await unbindDevice(device_id);
  return encryptedResponse(ctx.sessionKey, createSuccessResponse({ unbound: true }));
}

// ---------------------------------------------------------------------------
// 5. check_update（检查更新和云配置，Base64 编码）
// ---------------------------------------------------------------------------
async function handleCheckUpdate(request: Request): Promise<NextResponse> {
  const headers = parseRequestHeaders(request.headers);
  if (!headers) {
    return NextResponse.json(createErrorResponse(ErrorCode.PARAM_MISSING, '请求头不完整'));
  }

  const app = await getAppByKey(headers.appKey);
  if (!app) {
    return NextResponse.json(createErrorResponse(ErrorCode.APP_NOT_FOUND));
  }

  // 公开云变量
  const publicVars = await getPublicVariables(app.id);

  return NextResponse.json(
    createSuccessResponse({
      version: app.version,
      announcement: app.announcement,
      force_update: app.force_update,
      min_version: app.min_version,
      update_url: app.update_url,
      config_signature: app.config_signature,
      cloud_variables: publicVars,
    }),
  );
}

// ---------------------------------------------------------------------------
// 6. heartbeat（心跳保活，RSA + AES 加密）
// ---------------------------------------------------------------------------
async function handleHeartbeat(ctx: EncryptedContext): Promise<NextResponse> {
  let payload: { device_id?: string; machine_code?: string };
  try {
    payload = JSON.parse(ctx.body);
  } catch {
    return encryptedResponse(ctx.sessionKey, createErrorResponse(ErrorCode.PARAM_FORMAT));
  }

  const { device_id } = payload;
  if (!device_id) {
    return encryptedResponse(ctx.sessionKey, createErrorResponse(ErrorCode.PARAM_MISSING));
  }

  const device = await prisma.device.findUnique({ where: { id: device_id } });
  if (!device) {
    return encryptedResponse(ctx.sessionKey, createErrorResponse(ErrorCode.DEVICE_BANNED, '设备不存在'));
  }
  if (device.status === 'blacklisted') {
    return encryptedResponse(ctx.sessionKey, createErrorResponse(ErrorCode.DEVICE_BANNED));
  }

  await updateHeartbeat(device_id);
  return encryptedResponse(ctx.sessionKey, createSuccessResponse({
    online: true,
    sequence: device.sequence + 1,
  }));
}

// ---------------------------------------------------------------------------
// 通用加密 action 处理器包装
// ---------------------------------------------------------------------------
type EncryptedHandler = (ctx: EncryptedContext, request: Request) => Promise<NextResponse>;

async function handleEncryptedAction(
  request: Request,
  handler: EncryptedHandler,
): Promise<NextResponse> {
  const { ctx, error } = await resolveEncryptedContext(request);
  if (error || !ctx) return error!;
  return handler(ctx, request);
}
