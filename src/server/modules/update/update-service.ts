import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { redis } from '@/lib/redis';
import { prisma } from '@/lib/db';

/**
 * GitHub 自动更新服务层
 *
 * 职责：
 * 1. 通过 GitHub API 查询最新版本与更新日志；
 * 2. 触发自动更新流程（git pull → npm install → prisma migrate → docker restart）；
 * 3. 触发回滚流程（git reset --hard HEAD~1 → 重启）；
 * 4. 全程使用 Redis 分布式锁防止并发执行；
 * 5. 所有操作写入 updateHistory 表，既是更新历史也是审计日志。
 *
 * 安全设计：
 * - 所有 shell 命令均为常量字符串，不拼接任何外部输入，从源头杜绝命令注入；
 * - 项目根目录通过 `cwd` 选项传递，不进入 shell 解析；
 * - 分支名等来自环境变量的值通过正则严格校验后才使用；
 * - 仓库 owner / repo 从 `GITHUB_REPO_URL` 解析，不硬编码。
 */

/**
 * 更新模块错误码（项目统一错误码 7001-7006，详见 SPEC.md §2.3）
 */
export enum UpdateErrorCode {
  /** Webhook 签名验证失败 */
  WEBHOOK_SIGNATURE_INVALID = 7001,
  /** 更新任务正在执行（加锁冲突） */
  UPDATE_LOCKED = 7002,
  /** 更新前置检查失败（健康检查不通过 / 环境变量缺失） */
  UPDATE_PRECHECK_FAILED = 7003,
  /** 更新执行失败（git pull / 依赖安装 / 迁移失败） */
  UPDATE_EXECUTION_FAILED = 7004,
  /** 回滚失败 */
  ROLLBACK_FAILED = 7005,
  /** 版本不存在 */
  VERSION_NOT_FOUND = 7006,
}

/** 更新锁 Redis 键 */
const UPDATE_LOCK_KEY = 'update:lock';
/** 更新锁过期时间（秒），TTL 兜底防止死锁 */
const UPDATE_LOCK_TTL_SECONDS = 600;
/** GitHub API 基础地址 */
const GITHUB_API_BASE = 'https://api.github.com';
/** 分支名合法字符集（防止命令注入：仅字母数字 / . _ / -） */
const BRANCH_NAME_PATTERN = /^[A-Za-z0-9._/-]+$/;
/** 更新日志拉取条数 */
const UPDATE_LOGS_LIMIT = 10;

/** Commit 信息（GitHub API 返回字段的内部映射） */
export interface CommitInfo {
  /** 完整 40 位 commit SHA */
  sha: string;
  /** 7 位短 SHA，便于展示 */
  shortSha: string;
  /** commit 首行消息 */
  message: string;
  /** 提交者姓名 */
  author: string;
  /** 提交者邮箱 */
  email: string;
  /** 提交时间（ISO 8601） */
  date: string;
}

/** 更新历史记录（数据库 updateHistory 表的视图模型） */
export interface UpdateHistoryRecord {
  id: string;
  /** 操作目标版本 commit SHA */
  version: string;
  /** 操作类型：auto 自动更新 / manual 手动触发 / rollback 回滚 */
  action: 'auto' | 'manual' | 'rollback';
  /** 执行状态：running 执行中 / success 成功 / failed 失败 / rolled_back 已回滚 */
  status: 'running' | 'success' | 'failed' | 'rolled_back';
  /** 触发来源：webhook / manual / rollback */
  trigger: 'webhook' | 'manual' | 'rollback';
  /** 操作人（超管 ID 或 commit 作者名） */
  operator: string;
  /** 失败时的错误信息 */
  errorMessage: string | null;
  /** 创建时间（ISO 字符串） */
  createdAt: string;
}

/** 触发更新入参 */
export interface TriggerUpdateOptions {
  /** 触发来源 */
  trigger: 'webhook' | 'manual';
  /** 操作人标识 */
  operator: string;
}

/** 触发回滚入参 */
export interface RollbackOptions {
  /** 操作人标识 */
  operator: string;
}

/** 更新执行结果 */
export interface ExecuteUpdateResult {
  /** 更新前版本 SHA */
  oldVersion: string;
  /** 更新后版本 SHA */
  newVersion: string;
}

/** 回滚执行结果 */
export interface RollbackResult {
  /** 回滚后所处版本 SHA */
  rolledBackTo: string;
}

/**
 * 自定义更新错误，附带错误码便于路由层直接返回
 */
export class UpdateError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'UpdateError';
    this.code = code;
  }
}

/**
 * 统一成功响应体
 */
export function createSuccessResponse<T>(data: T, msg = '操作成功'): Response {
  return Response.json({
    code: 0,
    msg,
    data,
    ts: Date.now(),
    nonce: randomUUID(),
  });
}

/**
 * 统一错误响应体
 */
export function createErrorResponse(
  code: number,
  msg: string,
  status = 200,
): Response {
  return Response.json(
    {
      code,
      msg,
      data: null,
      ts: Date.now(),
      nonce: randomUUID(),
    },
    { status },
  );
}

/**
 * 从环境变量 GITHUB_REPO_URL 解析 owner / repo
 *
 * 支持两种格式：
 * - HTTPS：https://github.com/owner/repo(.git)
 * - SSH：  git@github.com:owner/repo(.git)
 *
 * 不硬编码仓库地址，遵循铁律 02（禁止硬编码）。
 */
function parseRepoOwnerAndRepo(): { owner: string; repo: string } {
  const repoUrl = process.env.GITHUB_REPO_URL;
  if (!repoUrl) {
    throw new UpdateError(
      UpdateErrorCode.UPDATE_PRECHECK_FAILED,
      '环境变量 GITHUB_REPO_URL 未配置',
    );
  }
  // 同时兼容 SSH（冒号分隔）与 HTTPS（斜杠分隔）格式
  const match = repoUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match || !match[1] || !match[2]) {
    throw new UpdateError(
      UpdateErrorCode.UPDATE_PRECHECK_FAILED,
      'GITHUB_REPO_URL 格式无法解析 owner/repo',
    );
  }
  return { owner: match[1], repo: match[2] };
}

/**
 * 获取当前部署的分支（从环境变量读取并校验）
 */
function getRepoBranch(): string {
  const branch = process.env.GITHUB_REPO_BRANCH;
  if (!branch) {
    throw new UpdateError(
      UpdateErrorCode.UPDATE_PRECHECK_FAILED,
      '环境变量 GITHUB_REPO_BRANCH 未配置',
    );
  }
  // 严格校验分支名字符集，防止后续若需要拼接命令时发生注入
  if (!BRANCH_NAME_PATTERN.test(branch)) {
    throw new UpdateError(
      UpdateErrorCode.UPDATE_PRECHECK_FAILED,
      'GITHUB_REPO_BRANCH 包含非法字符',
    );
  }
  return branch;
}

/**
 * 获取项目根目录（执行 git 命令的工作目录）
 *
 * 优先使用 PROJECT_ROOT 环境变量，回退到进程 cwd。
 * 该路径通过 `cwd` 选项传递给 execSync，不进入 shell 解析，安全。
 */
function getProjectRoot(): string {
  return process.env.PROJECT_ROOT || process.cwd();
}

/**
 * 调用 GitHub API 公共请求封装
 *
 * 若配置了 GITHUB_TOKEN 则附带 Authorization 头，提升 API 速率限制（可选）。
 */
async function callGithubApi<T>(endpoint: string): Promise<T> {
  const { owner, repo } = parseRepoOwnerAndRepo();
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}${endpoint}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'jicek-wlyz-update-service',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new UpdateError(
      UpdateErrorCode.UPDATE_PRECHECK_FAILED,
      `GitHub API 请求失败：${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as T;
}

/** GitHub API commit 对象的最小子集类型 */
interface GithubCommitItem {
  sha: string;
  commit: {
    message: string;
    author: { name: string; email: string; date: string };
  };
}

/**
 * 将 GitHub API 返回的 commit 对象映射为内部 CommitInfo
 */
function mapCommitInfo(item: GithubCommitItem): CommitInfo {
  return {
    sha: item.sha,
    shortSha: item.sha.slice(0, 7),
    message: item.commit.message.split('\n')[0],
    author: item.commit.author.name,
    email: item.commit.author.email,
    date: item.commit.author.date,
  };
}

/**
 * 通过 GitHub API 获取最新 commit 信息
 *
 * 端点：GET /repos/{owner}/{repo}/commits/{branch}
 */
export async function checkLatestVersion(): Promise<CommitInfo> {
  const branch = getRepoBranch();
  const data = await callGithubApi<GithubCommitItem>(`/commits/${branch}`);
  return mapCommitInfo(data);
}

/**
 * 获取最近 10 条 commit 列表作为更新日志
 *
 * 端点：GET /repos/{owner}/{repo}/commits?per_page=10
 */
export async function getUpdateLogs(): Promise<CommitInfo[]> {
  const data = await callGithubApi<GithubCommitItem[]>(
    `/commits?per_page=${UPDATE_LOGS_LIMIT}`,
  );
  return data.map(mapCommitInfo);
}

/**
 * 获取本地当前部署版本
 *
 * 三级降级策略，保证 Docker standalone 部署下也不抛错（否则更新面板
 * 一打开就 500，超管无法查看版本信息）：
 * 1. 优先读环境变量 DEPLOY_VERSION（Docker 部署时由 install.sh 注入
 *    宿主机 git commit SHA，见 docker-compose.yml）
 * 2. 回退 `git rev-parse HEAD`（开发模式 / 宿主机直接跑源码）
 * 3. 再回退占位值 "unknown"（Docker standalone 模式且未注入环境变量）
 *
 * 命令为常量字符串，无任何外部输入拼接。
 */
export function getCurrentVersion(): string {
  // 1. 环境变量注入（Docker 部署推荐方式）
  const deployVersion = process.env.DEPLOY_VERSION;
  if (deployVersion && deployVersion.trim()) {
    return deployVersion.trim();
  }
  // 2. git rev-parse HEAD（开发模式 / 宿主机源码部署）
  try {
    const stdout = execSync('git rev-parse HEAD', {
      cwd: getProjectRoot(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return stdout.trim();
  } catch {
    // 3. Docker standalone 模式：无 git 二进制 / 无 .git 目录
    return 'unknown';
  }
}

/**
 * 检测当前环境是否可通过 git 获取/更新源码
 *
 * Docker standalone 部署下：runner 镜像无 git 二进制，也无 .git 目录，
 * `git pull` / `git reset` 等操作无法执行。executeUpdate / rollback
 * 开头用本函数判断，若为 Docker 模式则直接抛出明确错误指引到
 * `bash install.sh update`，避免后续一连串神秘失败。
 */
function isGitAvailable(): boolean {
  try {
    execSync('git rev-parse --git-dir', {
      cwd: getProjectRoot(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取当前部署模式
 *
 * - 'source': 源码部署（存在 .git 目录），后台"触发更新"按钮可用，
 *   走 git pull → npm install → prisma migrate → docker compose restart 流程
 * - 'docker': Docker standalone 部署（镜像内无 git / 无 .git），容器内无法
 *   执行 git pull，后台"触发更新"按钮不可用，需在宿主机执行 install.sh update
 *
 * check 接口返回此标识，前端据此切换 UI：docker 模式展示"宿主机更新指引"
 * 卡片（含可一键复制的命令 + 版本对比），source 模式展示"触发更新"按钮。
 */
export function getDeployMode(): 'source' | 'docker' {
  return isGitAvailable() ? 'source' : 'docker';
}

/**
 * 安全执行 shell 命令
 *
 * 所有命令均为常量字符串，不拼接任何外部输入，从源头杜绝命令注入。
 * 工作目录通过 `cwd` 选项传递，不进入 shell 解析。
 */
function runCommand(command: string): string {
  const stdout = execSync(command, {
    cwd: getProjectRoot(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return stdout.trim();
}

/**
 * 加分布式锁
 *
 * 使用 Redis `SET key value EX ttl NX` 原子命令：
 * - NX：仅当 key 不存在时才设置，保证唯一持有者；
 * - EX：设置过期时间，防止持锁进程崩溃后死锁。
 *
 * @returns 加锁成功返回 token，失败返回 null
 */
async function acquireLock(): Promise<string | null> {
  const token = randomUUID();
  const result = await redis.set(
    UPDATE_LOCK_KEY,
    token,
    'EX',
    UPDATE_LOCK_TTL_SECONDS,
    'NX',
  );
  return result === 'OK' ? token : null;
}

/**
 * 释放分布式锁
 *
 * 使用 Lua 脚本保证"检查 token + 删除 key"的原子性，
 * 防止误删除他人持有的锁（例如本进程超时后锁被自动释放，他人重新获取）。
 */
async function releaseLock(token: string): Promise<void> {
  const script =
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
  await redis.eval(script, 1, UPDATE_LOCK_KEY, token);
}

/**
 * 执行更新流程
 *
 * 步骤：
 * 1. git pull --ff-only：拉取最新代码（仅快进合并，避免产生冲突提交）
 * 2. npm install：安装 / 更新依赖
 * 3. npx prisma migrate deploy：应用数据库迁移（生产模式，非交互）
 * 4. docker compose restart app：重启应用容器
 *
 * 所有命令均为常量字符串，不拼接外部输入。
 */
export async function executeUpdate(): Promise<ExecuteUpdateResult> {
  // Docker standalone 部署下容器内无 git / .git，无法执行 git pull，
  // 直接抛出明确错误指引到宿主机 install.sh，避免后续一连串神秘失败
  if (!isGitAvailable()) {
    throw new UpdateError(
      UpdateErrorCode.UPDATE_EXECUTION_FAILED,
      '当前为 Docker 容器化部署，容器内无法执行 git pull。请在宿主机部署目录（默认 /opt/jicek-wlyz）执行 `bash install.sh update` 完成更新',
    );
  }
  const oldVersion = getCurrentVersion();

  // 步骤 1：拉取最新代码
  try {
    runCommand('git pull --ff-only');
  } catch (error) {
    throw new UpdateError(
      UpdateErrorCode.UPDATE_EXECUTION_FAILED,
      `git pull 失败：${(error as Error).message}`,
    );
  }

  // 步骤 2：安装依赖
  try {
    runCommand('npm install --no-audit --no-fund');
  } catch (error) {
    throw new UpdateError(
      UpdateErrorCode.UPDATE_EXECUTION_FAILED,
      `依赖安装失败：${(error as Error).message}`,
    );
  }

  // 步骤 3：应用数据库迁移
  try {
    runCommand('npx prisma migrate deploy');
  } catch (error) {
    throw new UpdateError(
      UpdateErrorCode.UPDATE_EXECUTION_FAILED,
      `数据库迁移失败：${(error as Error).message}`,
    );
  }

  // 步骤 4：重启应用容器
  try {
    runCommand('docker compose restart app');
  } catch (error) {
    throw new UpdateError(
      UpdateErrorCode.UPDATE_EXECUTION_FAILED,
      `容器重启失败：${(error as Error).message}`,
    );
  }

  const newVersion = getCurrentVersion();
  return { oldVersion, newVersion };
}

/**
 * 触发更新流程
 *
 * 流程：
 * 1. 加 Redis 分布式锁，加锁失败抛 UPDATE_LOCKED；
 * 2. 写入历史记录（status: in_progress）作为审计；
 * 3. 执行 executeUpdate；
 * 4. 成功则更新历史记录为 success，失败则更新为 failed 并写入错误信息；
 * 5. finally 块释放锁。
 */
export async function triggerUpdate(
  options: TriggerUpdateOptions,
): Promise<{ historyId: string; oldVersion: string; newVersion: string }> {
  const lockToken = await acquireLock();
  if (!lockToken) {
    throw new UpdateError(
      UpdateErrorCode.UPDATE_LOCKED,
      '更新任务正在执行，请稍后再试',
    );
  }

  // 写入历史记录（in_progress），既是审计日志也是历史
  const history = await prisma.updateHistory.create({
    data: {
      version: '',
      action: 'update',
      status: 'running',
      trigger: options.trigger,
      operator: options.operator,
      error_message: null,
    },
  });

  try {
    const result = await executeUpdate();
    await prisma.updateHistory.update({
      where: { id: history.id },
      data: {
        version: result.newVersion,
        status: 'success',
      },
    });
    return {
      historyId: history.id,
      oldVersion: result.oldVersion,
      newVersion: result.newVersion,
    };
  } catch (error) {
    const errorMessage = (error as Error).message;
    await prisma.updateHistory.update({
      where: { id: history.id },
      data: {
        version: getCurrentVersion(),
        status: 'failed',
        error_message: errorMessage,
      },
    });
    throw error;
  } finally {
    await releaseLock(lockToken);
  }
}

/**
 * 回滚到上一版本
 *
 * 流程：
 * 1. 加 Redis 分布式锁（与更新共用同一把锁，互斥）；
 * 2. 写入历史记录（action: rollback, status: in_progress）；
 * 3. git reset --hard HEAD~1：硬重置到上一个 commit；
 * 4. npm install：根据回滚后的 package.json 重装依赖；
 * 5. docker compose restart app：重启容器；
 * 6. 更新历史记录状态。
 */
export async function rollback(
  options: RollbackOptions,
): Promise<RollbackResult> {
  // Docker standalone 部署下容器内无 git / .git，无法执行 git reset，
  // 直接抛出明确错误指引到宿主机 reinstall，避免后续一连串神秘失败
  if (!isGitAvailable()) {
    throw new UpdateError(
      UpdateErrorCode.ROLLBACK_FAILED,
      '当前为 Docker 容器化部署，容器内无法执行 git reset。回滚请在宿主机部署目录重新部署指定版本的镜像，或执行 `bash install.sh reinstall` 重装（注意：reinstall 保留 .env 与数据卷）',
    );
  }
  const lockToken = await acquireLock();
  if (!lockToken) {
    throw new UpdateError(
      UpdateErrorCode.UPDATE_LOCKED,
      '更新任务正在执行，无法回滚',
    );
  }

  const history = await prisma.updateHistory.create({
    data: {
      version: '',
      action: 'rollback',
      status: 'running',
      trigger: 'rollback',
      operator: options.operator,
      error_message: null,
    },
  });

  try {
    // 步骤 1：硬重置到上一个 commit
    try {
      runCommand('git reset --hard HEAD~1');
    } catch (error) {
      throw new UpdateError(
        UpdateErrorCode.ROLLBACK_FAILED,
        `git reset 失败：${(error as Error).message}`,
      );
    }

    // 步骤 2：根据回滚后的 package.json 重装依赖
    try {
      runCommand('npm install --no-audit --no-fund');
    } catch (error) {
      throw new UpdateError(
        UpdateErrorCode.ROLLBACK_FAILED,
        `回滚后依赖安装失败：${(error as Error).message}`,
      );
    }

    // 步骤 3：重启容器
    try {
      runCommand('docker compose restart app');
    } catch (error) {
      throw new UpdateError(
        UpdateErrorCode.ROLLBACK_FAILED,
        `回滚后容器重启失败：${(error as Error).message}`,
      );
    }

    const rolledBackTo = getCurrentVersion();
    await prisma.updateHistory.update({
      where: { id: history.id },
      data: {
        version: rolledBackTo,
        status: 'success',
      },
    });
    return { rolledBackTo };
  } catch (error) {
    const errorMessage = (error as Error).message;
    await prisma.updateHistory.update({
      where: { id: history.id },
      data: {
        version: getCurrentVersion(),
        status: 'failed',
        error_message: errorMessage,
      },
    });
    throw error;
  } finally {
    await releaseLock(lockToken);
  }
}

/**
 * 从数据库查询更新历史
 *
 * 同时承担审计日志查询职责，按创建时间倒序返回。
 *
 * @param limit 返回条数，默认 20
 */
export async function getUpdateHistory(
  limit = 20,
): Promise<UpdateHistoryRecord[]> {
  const records = await prisma.updateHistory.findMany({
    orderBy: { created_at: 'desc' },
    take: limit,
  });
  return records.map((r) => ({
    id: r.id,
    version: r.version,
    action: r.action as 'auto' | 'manual' | 'rollback',
    status: r.status as 'running' | 'success' | 'failed' | 'rolled_back',
    trigger: r.trigger as 'webhook' | 'manual' | 'rollback',
    operator: r.operator,
    errorMessage: r.error_message,
    createdAt: r.created_at.toISOString(),
  }));
}
