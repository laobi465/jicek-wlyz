import { prisma } from '@/lib/db';
import { signEpayParams, verifyEpaySign } from '@/lib/security/epay-signature';
import { markOrderPaid } from '@/server/modules/order/order-service';

/**
 * 彩虹易支付服务（PROJECT.md §2.1 模块 7 + §7 已确认清单）
 *
 * 职责：
 * 1. 从 SystemConfig 读取易支付配置（pid/key/url，超管后台配置）
 * 2. 构建支付请求 URL（跳转易支付收银台）
 * 3. 处理支付回调（验签 + 标记订单 paid + 触发佣金分账）
 *
 * 业务规则（PROJECT.md §7）：
 * - 易支付商户号由超管后台自行配置，存于 SystemConfig 表 group=payment
 * - 配置项：epay_pid（商户 ID）/ epay_key（商户密钥）/ epay_api_url（接口地址）
 *
 * 安全设计（SPEC §2.6.4）：
 * - 商户密钥加密存储（SystemConfig.encrypted=true）
 * - 回调签名校验（MD5 + 常量时间比较）
 * - 回调域名白名单（SSRF 防护）
 * - 全程审计日志
 *
 * 彩虹易支付协议参考：
 * - 请求方式：GET 跳转收银台 / POST API 模式
 * - 回调方式：GET 异步通知 + GET 同步跳转
 * - 签名算法：MD5（参数 ASCII 排序 + 末尾拼商户密钥）
 */

/** SystemConfig 中易支付配置的 key */
const EPAY_CONFIG_KEYS = {
  PID: 'epay_pid',
  KEY: 'epay_key',
  API_URL: 'epay_api_url',
} as const;

/** 易支付配置 */
export interface EpayConfig {
  pid: string;
  key: string;
  apiUrl: string;
}

/**
 * 从 SystemConfig 读取易支付配置
 *
 * 配置项：
 * - epay_pid：商户 ID
 * - epay_key：商户密钥（加密存储，需 AES 解密）
 * - epay_api_url：接口地址（如 https://pay.example.com）
 *
 * @throws 配置未填写时显式失败（铁律 04 第 2 条）
 */
export async function getEpayConfig(): Promise<EpayConfig> {
  const configs = await prisma.systemConfig.findMany({
    where: {
      group: 'payment',
      key: { in: [EPAY_CONFIG_KEYS.PID, EPAY_CONFIG_KEYS.KEY, EPAY_CONFIG_KEYS.API_URL] },
    },
  });

  const configMap = new Map(configs.map((c) => [c.key, c]));

  const pidConfig = configMap.get(EPAY_CONFIG_KEYS.PID);
  const keyConfig = configMap.get(EPAY_CONFIG_KEYS.KEY);
  const urlConfig = configMap.get(EPAY_CONFIG_KEYS.API_URL);

  if (!pidConfig || !pidConfig.value) {
    throw new Error('待接入：易支付商户 ID（epay_pid）未在后台配置');
  }
  if (!keyConfig || !keyConfig.value) {
    throw new Error('待接入：易支付商户密钥（epay_key）未在后台配置');
  }
  if (!urlConfig || !urlConfig.value) {
    throw new Error('待接入：易支付接口地址（epay_api_url）未在后台配置');
  }

  // 商户密钥加密存储时需解密
  let key = keyConfig.value;
  if (keyConfig.encrypted) {
    key = decryptEpayKey(keyConfig.value);
  }

  return {
    pid: pidConfig.value,
    key,
    apiUrl: urlConfig.value.replace(/\/$/, ''), // 去除末尾斜杠
  };
}

/**
 * 解密易支付商户密钥
 *
 * 使用 MASTER_KEY（与卡密开发者水印同密钥）AES 解密
 */
function decryptEpayKey(encrypted: string): string {
  const masterKey = process.env.MASTER_KEY;
  if (!masterKey) {
    throw new Error('待接入：环境变量 MASTER_KEY 未配置（用于解密易支付密钥）');
  }
  // 复用 card-key-service 的水印加密格式：ivHex:cipherBase64
  // 此处仅声明调用契约，实际解密逻辑复用 aes.ts
  // 为避免循环依赖，直接内联 AES-256-CBC 解密
  const crypto = require('crypto') as typeof import('crypto');
  const [ivHex, cipherB64] = encrypted.split(':');
  if (!ivHex || !cipherB64) {
    throw new Error('待接入：易支付密钥密文格式错误');
  }
  const iv = Buffer.from(ivHex, 'hex');
  const cipher = Buffer.from(cipherB64, 'base64');
  const key = crypto.createHash('sha256').update(masterKey).digest();
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([decipher.update(cipher), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * 构建支付请求参数（用于跳转易支付收银台）
 *
 * 彩虹易支付请求参数（GET 提交到 {apiUrl}/submit.php）：
 * - pid：商户 ID
 * - type：支付方式（alipay / wxpay / qqpay）
 * - out_trade_no：商户订单号
 * - notify_url：异步通知地址
 * - return_url：同步跳转地址
 * - name：商品名称
 * - money：金额（元，2 位小数）
 * - sign：签名
 * - sign_type：MD5
 *
 * @returns 完整的支付跳转 URL
 */
export async function buildPaymentUrl(params: {
  orderNo: string;
  amount: number;
  subject: string;
  notifyUrl: string;
  returnUrl: string;
  paymentType?: 'alipay' | 'wxpay' | 'qqpay';
}): Promise<string> {
  const config = await getEpayConfig();

  const signParams = {
    pid: config.pid,
    type: params.paymentType ?? 'alipay',
    out_trade_no: params.orderNo,
    notify_url: params.notifyUrl,
    return_url: params.returnUrl,
    name: params.subject,
    money: params.amount.toFixed(2),
  };

  const sign = signEpayParams(signParams, config.key);

  // 构建跳转 URL
  const query = new URLSearchParams({
    ...signParams,
    sign,
    sign_type: 'MD5',
  });
  return `${config.apiUrl}/submit.php?${query.toString()}`;
}

/**
 * 处理易支付异步回调
 *
 * 彩虹易支付回调参数（GET）：
 * - pid：商户 ID
 * - trade_no：易支付流水号
 * - out_trade_no：商户订单号
 * - type：支付方式
 * - name：商品名称
 * - money：金额
 * - trade_status：TRADE_SUCCESS 表示成功
 * - sign：签名
 * - sign_type：MD5
 *
 * 验签：剔除 sign/sign_type，剩余参数按 ASCII 排序 + 末尾拼商户密钥 MD5
 *
 * @param query 回调参数（已解析为对象）
 * @returns 'success' 表示处理成功（易支付要求返回 success 字符串）
 */
export async function handleCallback(
  query: Record<string, string>,
): Promise<'success' | 'fail'> {
  // 校验必要参数
  const required = ['pid', 'trade_no', 'out_trade_no', 'money', 'trade_status', 'sign'];
  for (const k of required) {
    if (!query[k]) {
      return 'fail';
    }
  }

  // 仅处理 TRADE_SUCCESS
  if (query.trade_status !== 'TRADE_SUCCESS') {
    return 'fail';
  }

  const config = await getEpayConfig();

  // 校验商户 ID 一致
  if (query.pid !== config.pid) {
    return 'fail';
  }

  // 验签
  const signValid = verifyEpaySign(query, config.key, query.sign);
  if (!signValid) {
    // 签名失败审计
    await prisma.auditLog.create({
      data: {
        user_id: null,
        action: 'epay_signature_invalid',
        target_type: 'order',
        target_id: query.out_trade_no,
        details: JSON.stringify({ trade_no: query.trade_no }),
        is_abnormal: true,
      },
    });
    return 'fail';
  }

  // 查订单
  const order = await prisma.order.findUnique({
    where: { order_no: query.out_trade_no },
  });
  if (!order) {
    return 'fail';
  }

  // 校验金额一致（防篡改）
  if (Number(order.amount).toFixed(2) !== Number(query.money).toFixed(2)) {
    await prisma.auditLog.create({
      data: {
        user_id: null,
        action: 'epay_amount_mismatch',
        target_type: 'order',
        target_id: order.id,
        details: JSON.stringify({
          expected: order.amount,
          received: query.money,
        }),
        is_abnormal: true,
      },
    });
    return 'fail';
  }

  // 标记订单已支付（内部幂等 + 触发卡密分配 + 佣金分账）
  try {
    await markOrderPaid(order.id, 'epay', query.trade_no);

    // 记录 Payment 表
    await prisma.payment.create({
      data: {
        user_id: order.buyer_id,
        order_id: order.id,
        amount: order.amount,
        method: 'epay',
        status: 'success',
        trade_no: query.trade_no,
        callback_data: JSON.stringify(query),
      },
    });

    return 'success';
  } catch (error) {
    await prisma.auditLog.create({
      data: {
        user_id: null,
        action: 'epay_callback_error',
        target_type: 'order',
        target_id: order.id,
        details: JSON.stringify({
          error: (error as Error).message,
          trade_no: query.trade_no,
        }),
        is_abnormal: true,
      },
    });
    return 'fail';
  }
}
