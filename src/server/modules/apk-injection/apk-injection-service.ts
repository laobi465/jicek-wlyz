import { prisma } from '@/lib/db';
import { createQueue, QueueName } from '@/lib/queue';
import { ErrorCode } from '@/lib/security/error-code';
import {
  validateApkFile,
  computeFileSha256,
  buildInjectionConfig,
  type InjectionConfig,
  type ApkValidationResult,
} from './apk-integrity-service';

/**
 * APK 注入服务（SPEC §2.6.3 APK 注入安全 21 项）
 *
 * 职责：
 * 1. 创建注入任务（上传 → 校验 → 入队 BullMQ）
 * 2. 查询任务状态
 * 3. 下载注入后的 APK
 * 4. 取消任务
 *
 * 安全设计：
 * - 文件大小限制 500MB（§2.6.4 第 16 项）
 * - APK magic number 校验（PK\x03\x04）
 * - SHA-256 完整性校验
 * - apktool 参数白名单（§2.6.3 第 21 项）
 * - 沙箱执行（独立 Docker 容器，§2.6.3 第 20 项）
 * - 命令注入防护（所有参数严格校验）
 */

/** APK 文件大小上限 500MB（SPEC §2.6.4 第 16 项） */
export const MAX_APK_SIZE = 500 * 1024 * 1024;

/** 注入任务状态枚举 */
export type ApkTaskStatus = 'pending' | 'processing' | 'success' | 'failed';

/** 创建注入任务入参 */
export interface CreateInjectionTaskParams {
  submitterId: string;
  appId?: string;
  originalFilename: string;
  /** 原始 APK 文件 Buffer（仅在校验阶段使用，实际上传至对象存储） */
  apkBuffer: Buffer;
  /** 注入配置 */
  injectionConfig: InjectionConfig;
  /** 原始 APK 签名哈希（开发者后台预登记，用于完整性校验） */
  originalSignatureHash?: string;
}

/** 创建注入任务结果 */
export interface CreateInjectionTaskResult {
  taskId: string;
  jobId: string;
  status: ApkTaskStatus;
}

/**
 * 创建 APK 注入任务
 *
 * 流程：
 * 1. 校验 APK 文件（magic number + 大小 + SHA-256）
 * 2. 校验注入配置参数（白名单）
 * 3. 上传至对象存储（待接入）
 * 4. 写入数据库
 * 5. 投递 BullMQ 异步队列
 */
export async function createInjectionTask(
  params: CreateInjectionTaskParams,
): Promise<CreateInjectionTaskResult> {
  const {
    submitterId,
    appId,
    originalFilename,
    apkBuffer,
    injectionConfig,
    originalSignatureHash,
  } = params;

  // 1. 校验提交者存在
  const submitter = await prisma.user.findUnique({
    where: { id: submitterId },
    select: { id: true, role: true, status: true },
  });
  if (!submitter) {
    throw new Error('待接入：提交者不存在');
  }
  if (submitter.status !== 'active') {
    throw new Error('待接入：提交者账号已停用');
  }

  // 2. 校验 APK 文件
  const validation = validateApkFile(apkBuffer, originalFilename);
  if (!validation.valid) {
    const err = new Error(validation.error ?? 'APK 文件校验失败');
    (err as Error & { code: number }).code = validation.errorCode ?? ErrorCode.APK_FORMAT_INVALID;
    throw err;
  }

  // 3. 计算原始 APK SHA-256
  const originalSha256 = computeFileSha256(apkBuffer);

  // 4. 构建并校验注入配置（白名单）
  const sanitizedConfig = buildInjectionConfig(injectionConfig);

  // 5. 上传至对象存储（铁律 04：未实现，明确失败）
  const originalObjectKey = await uploadApkToObjectStorage(
    submitterId,
    originalFilename,
    apkBuffer,
  );

  // 6. 写入数据库
  const task = await prisma.apkInjectionTask.create({
    data: {
      submitter_id: submitterId,
      app_id: appId ?? null,
      original_filename: originalFilename,
      original_object_key: originalObjectKey,
      original_sha256: originalSha256,
      original_signature_hash: originalSignatureHash ?? null,
      file_size: BigInt(apkBuffer.length),
      status: 'pending',
      injection_config: JSON.stringify(sanitizedConfig),
    },
  });

  // 7. 投递 BullMQ 队列
  const queue = createQueue(QueueName.APK_INJECTION);
  const job = await queue.add('inject', {
    taskId: task.id,
    submitterId,
    originalObjectKey,
    originalSha256,
    injectionConfig: sanitizedConfig,
  });

  // 8. 更新 job_id
  await prisma.apkInjectionTask.update({
    where: { id: task.id },
    data: { job_id: job.id },
  });

  return {
    taskId: task.id,
    jobId: job.id ?? '',
    status: 'pending' as const,
  };
}

/**
 * 上传 APK 至对象存储
 *
 * 铁律 04：未实现对象存储接入，抛出明确错误
 */
async function uploadApkToObjectStorage(
  submitterId: string,
  filename: string,
  buffer: Buffer,
): Promise<string> {
  // 对象存储 key 规则：apk/{userId}/{timestamp}-{random}-{filename}
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  const safeFilename = sanitizeFilename(filename);
  const objectKey = `apk/${submitterId}/${timestamp}-${random}-${safeFilename}`;

  // 待接入：调用对象存储 SDK 上传
  // 当前阶段：抛出明确错误，禁止模拟实现
  throw new Error(`待接入：对象存储上传未实现，objectKey=${objectKey}, size=${buffer.length}`);
}

/**
 * 文件名净化（防止路径穿越）
 */
function sanitizeFilename(filename: string): string {
  // 移除路径分隔符，仅保留文件名
  const base = filename.replace(/[/\\]/g, '_');
  // 移除特殊字符，仅保留字母数字点下划线连字符
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

// ---------------------------------------------------------------------------
// 查询任务
// ---------------------------------------------------------------------------

/**
 * 查询注入任务详情
 */
export async function getInjectionTask(
  taskId: string,
  submitterId?: string,
) {
  const task = await prisma.apkInjectionTask.findUnique({
    where: { id: taskId },
  });
  if (!task) {
    return null;
  }
  // 权限校验：仅提交者本人或超管可查看
  if (submitterId && task.submitter_id !== submitterId) {
    const user = await prisma.user.findUnique({
      where: { id: submitterId },
      select: { role: true },
    });
    if (user?.role !== 'super_admin') {
      return null;
    }
  }
  return task;
}

/**
 * 列出提交者的注入任务
 */
export async function listInjectionTasks(
  submitterId: string,
  options: { status?: ApkTaskStatus; limit?: number; offset?: number } = {},
) {
  const { status, limit = 20, offset = 0 } = options;
  const where: { submitter_id: string; status?: string } = { submitter_id: submitterId };
  if (status) {
    where.status = status;
  }

  const [tasks, total] = await Promise.all([
    prisma.apkInjectionTask.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.apkInjectionTask.count({ where }),
  ]);

  return { tasks, total };
}

// ---------------------------------------------------------------------------
// 任务状态更新（供 Worker 调用）
// ---------------------------------------------------------------------------

/**
 * 标记任务为处理中
 */
export async function markTaskProcessing(taskId: string): Promise<void> {
  await prisma.apkInjectionTask.update({
    where: { id: taskId },
    data: { status: 'processing' },
  });
}

/**
 * 标记任务成功
 */
export async function markTaskSuccess(
  taskId: string,
  injectedObjectKey: string,
  injectedSha256: string,
  durationMs: number,
): Promise<void> {
  await prisma.apkInjectionTask.update({
    where: { id: taskId },
    data: {
      status: 'success',
      injected_object_key: injectedObjectKey,
      injected_sha256: injectedSha256,
      duration_ms: durationMs,
      completed_at: new Date(),
    },
  });
}

/**
 * 标记任务失败
 */
export async function markTaskFailed(
  taskId: string,
  errorMessage: string,
): Promise<void> {
  await prisma.apkInjectionTask.update({
    where: { id: taskId },
    data: {
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date(),
    },
  });
}

// ---------------------------------------------------------------------------
// 取消任务
// ---------------------------------------------------------------------------

/**
 * 取消注入任务
 *
 * - pending 状态：从 BullMQ 移除任务
 * - processing 状态：不允许取消（已开始注入）
 * - success/failed：终态，不允许取消
 */
export async function cancelInjectionTask(
  taskId: string,
  submitterId: string,
): Promise<void> {
  const task = await getInjectionTask(taskId, submitterId);
  if (!task) {
    throw new Error('待接入：任务不存在');
  }
  if (task.submitter_id !== submitterId) {
    throw new Error('待接入：无权操作他人任务');
  }

  if (task.status === 'processing') {
    throw new Error('待接入：任务处理中，不允许取消');
  }
  if (task.status === 'success' || task.status === 'failed') {
    throw new Error('待接入：任务已结束，不允许取消');
  }

  // pending 状态：移除 BullMQ 任务
  if (task.job_id) {
    const queue = createQueue(QueueName.APK_INJECTION);
    const job = await queue.getJob(task.job_id);
    if (job) {
      await job.remove();
    }
  }

  await prisma.apkInjectionTask.update({
    where: { id: taskId },
    data: {
      status: 'failed',
      error_message: '用户主动取消',
      completed_at: new Date(),
    },
  });
}

// ---------------------------------------------------------------------------
// 下载注入后的 APK
// ---------------------------------------------------------------------------

/**
 * 下载注入后的 APK
 *
 * 返回对象存储中的 APK 文件流
 */
export async function downloadInjectedApk(
  taskId: string,
  submitterId: string,
): Promise<{ objectKey: string; filename: string; sha256: string }> {
  const task = await getInjectionTask(taskId, submitterId);
  if (!task) {
    throw new Error('待接入：任务不存在');
  }
  if (task.submitter_id !== submitterId) {
    // 超管可下载他人 APK
    const user = await prisma.user.findUnique({
      where: { id: submitterId },
      select: { role: true },
    });
    if (user?.role !== 'super_admin') {
      throw new Error('待接入：无权下载他人 APK');
    }
  }
  if (task.status !== 'success') {
    throw new Error('待接入：任务未完成，无法下载');
  }
  if (!task.injected_object_key || !task.injected_sha256) {
    throw new Error('待接入：注入结果缺失');
  }

  return {
    objectKey: task.injected_object_key,
    filename: `injected-${task.original_filename}`,
    sha256: task.injected_sha256,
  };
}

// ---------------------------------------------------------------------------
// 工具：从对象存储下载文件（待接入）
// ---------------------------------------------------------------------------

/**
 * 从对象存储下载文件 Buffer
 *
 * 铁律 04：未实现，抛出明确错误
 */
export async function downloadApkFromObjectStorage(
  objectKey: string,
): Promise<Buffer> {
  throw new Error(`待接入：对象存储下载未实现，objectKey=${objectKey}`);
}

// ---------------------------------------------------------------------------
// 类型导出（供 Worker / 路由使用）
// ---------------------------------------------------------------------------

export type { InjectionConfig, ApkValidationResult };
