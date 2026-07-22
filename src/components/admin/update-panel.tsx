'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 后台更新面板组件
 *
 * 功能：
 * 1. 展示当前版本 / 最新版本 / 更新日志列表 / 更新时间；
 * 2. 「立即更新」按钮 + 进度条 + 实时日志（轮询历史记录）；
 * 3. 「一键回滚」按钮；
 * 4. 版本历史记录表格。
 *
 * UI 规范（铁律 03 强制）：
 * - 主色 #1E3A5F 藏蓝，圆角 6px（rounded-md）；
 * - shadcn/ui 风格：白底卡片 + 极浅灰边框 + 充足留白；
 * - 禁 emoji / 毛玻璃 / 暗黑 / 夸张渐变。
 */

/** 最新版本信息 */
interface LatestVersionInfo {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

/** 更新日志条目 */
interface UpdateLogItem {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

/** 更新历史记录 */
interface HistoryRecord {
  id: string;
  version: string;
  action: 'update' | 'rollback';
  status: 'success' | 'failed' | 'in_progress';
  trigger: 'webhook' | 'manual';
  operator: string;
  errorMessage: string | null;
  createdAt: string;
}

/** 统一响应体 */
interface ApiResponse<T> {
  code: number;
  msg: string;
  data: T | null;
  ts: number;
  nonce: string;
}

/** check 接口返回数据 */
interface CheckData {
  currentVersion: string;
  latestVersion: LatestVersionInfo;
  updateLogs: UpdateLogItem[];
  hasUpdate: boolean;
}

/** history 接口返回数据 */
interface HistoryData {
  history: HistoryRecord[];
  total: number;
}

/** 轮询实时日志的间隔（毫秒） */
const LOG_POLL_INTERVAL_MS = 2000;
/** 进度推进间隔（毫秒） */
const PROGRESS_INTERVAL_MS = 500;
/** 单次进度推进量（百分比） */
const PROGRESS_STEP = 5;
/** 进度上限（未完成时不超过 90%，完成后跳到 100%） */
const PROGRESS_MAX_BEFORE_DONE = 90;

/**
 * 格式化 ISO 时间为本地化展示
 */
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

/**
 * 状态标签样式映射
 */
function getStatusBadgeClass(status: HistoryRecord['status']): string {
  switch (status) {
    case 'success':
      return 'bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/30';
    case 'failed':
      return 'bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/30';
    case 'in_progress':
      return 'bg-[#0EA5E9]/10 text-[#0EA5E9] border border-[#0EA5E9]/30';
    default:
      return 'bg-[#F8FAFC] text-[#64748B] border border-[#E2E8F0]';
  }
}

/**
 * 状态中文标签
 */
function getStatusLabel(status: HistoryRecord['status']): string {
  switch (status) {
    case 'success':
      return '成功';
    case 'failed':
      return '失败';
    case 'in_progress':
      return '执行中';
    default:
      return status;
  }
}

/**
 * 操作类型中文标签
 */
function getActionLabel(action: HistoryRecord['action']): string {
  return action === 'update' ? '更新' : '回滚';
}

/**
 * 触发来源中文标签
 */
function getTriggerLabel(trigger: HistoryRecord['trigger']): string {
  return trigger === 'webhook' ? 'Webhook' : '手动';
}

export function UpdatePanel() {
  // 版本与日志数据
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const [latestVersion, setLatestVersion] = useState<LatestVersionInfo | null>(
    null,
  );
  const [updateLogs, setUpdateLogs] = useState<UpdateLogItem[]>([]);
  const [hasUpdate, setHasUpdate] = useState(false);

  // 历史记录
  const [history, setHistory] = useState<HistoryRecord[]>([]);

  // 操作状态
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [progress, setProgress] = useState(0);
  const [realtimeLog, setRealtimeLog] = useState<HistoryRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 计时器引用（用于清理）
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * 拉取更新检查数据
   */
  const refreshCheck = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/update/check', { method: 'GET' });
      const data: ApiResponse<CheckData> = await res.json();
      if (data.code === 0 && data.data) {
        setCurrentVersion(data.data.currentVersion);
        setLatestVersion(data.data.latestVersion);
        setUpdateLogs(data.data.updateLogs || []);
        setHasUpdate(data.data.hasUpdate);
      } else {
        setError(data.msg || '获取更新信息失败');
      }
    } catch (e) {
      setError((e as Error).message || '网络异常');
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 拉取历史记录
   */
  const refreshHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/update/history?limit=20', {
        method: 'GET',
      });
      const data: ApiResponse<HistoryData> = await res.json();
      if (data.code === 0 && data.data) {
        setHistory(data.data.history || []);
      }
    } catch {
      // 历史拉取失败不影响主流程
    }
  }, []);

  /**
   * 清理所有计时器
   */
  const clearTimers = useCallback(() => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    if (logTimerRef.current) {
      clearInterval(logTimerRef.current);
      logTimerRef.current = null;
    }
  }, []);

  // 挂载时拉取一次数据
  useEffect(() => {
    refreshCheck();
    refreshHistory();
    return () => clearTimers();
  }, [refreshCheck, refreshHistory, clearTimers]);

  /**
   * 轮询历史记录获取实时日志（更新 / 回滚期间）
   */
  const startLogPolling = useCallback(() => {
    logTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/admin/update/history?limit=1', {
          method: 'GET',
        });
        const data: ApiResponse<HistoryData> = await res.json();
        if (data.code === 0 && data.data?.history?.[0]) {
          setRealtimeLog(data.data.history[0]);
        }
      } catch {
        // 静默忽略
      }
    }, LOG_POLL_INTERVAL_MS);
  }, []);

  /**
   * 启动进度推进（仅作视觉反馈，上限 90%）
   */
  const startProgress = useCallback(() => {
    setProgress(0);
    progressTimerRef.current = setInterval(() => {
      setProgress((p) => Math.min(p + PROGRESS_STEP, PROGRESS_MAX_BEFORE_DONE));
    }, PROGRESS_INTERVAL_MS);
  }, []);

  /**
   * 立即更新
   */
  const handleUpdate = async () => {
    setUpdating(true);
    setError(null);
    setSuccess(null);
    setRealtimeLog(null);
    startProgress();
    startLogPolling();

    try {
      const res = await fetch('/api/admin/update/trigger', {
        method: 'POST',
      });
      const data: ApiResponse<unknown> = await res.json();
      if (data.code === 0) {
        setProgress(100);
        setSuccess('更新成功，服务已重启');
      } else {
        setError(data.msg || '更新失败');
        setProgress(0);
      }
    } catch (e) {
      setError((e as Error).message || '更新请求异常');
      setProgress(0);
    } finally {
      clearTimers();
      setUpdating(false);
      // 刷新数据
      refreshCheck();
      refreshHistory();
    }
  };

  /**
   * 一键回滚
   */
  const handleRollback = async () => {
    setRollingBack(true);
    setError(null);
    setSuccess(null);
    setRealtimeLog(null);
    startProgress();
    startLogPolling();

    try {
      const res = await fetch('/api/admin/update/rollback', {
        method: 'POST',
      });
      const data: ApiResponse<unknown> = await res.json();
      if (data.code === 0) {
        setProgress(100);
        setSuccess('回滚成功，服务已重启');
      } else {
        setError(data.msg || '回滚失败');
        setProgress(0);
      }
    } catch (e) {
      setError((e as Error).message || '回滚请求异常');
      setProgress(0);
    } finally {
      clearTimers();
      setRollingBack(false);
      // 刷新数据
      refreshCheck();
      refreshHistory();
    }
  };

  const isBusy = updating || rollingBack;

  return (
    <div className="space-y-6">
      {/* 顶部错误 / 成功提示 */}
      {error && (
        <div className="rounded-md border border-[#EF4444]/30 bg-[#EF4444]/5 px-4 py-3 text-sm text-[#EF4444]">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-[#10B981]/30 bg-[#10B981]/5 px-4 py-3 text-sm text-[#10B981]">
          {success}
        </div>
      )}

      {/* 卡片 1：版本信息 */}
      <section className="rounded-md border border-[#E2E8F0] bg-white">
        <header className="flex items-center justify-between border-b border-[#E2E8F0] px-6 py-4">
          <h2 className="text-base font-semibold text-[#1E293B]">版本信息</h2>
          <button
            type="button"
            onClick={refreshCheck}
            disabled={loading || isBusy}
            className="rounded-md border border-[#E2E8F0] px-3 py-1.5 text-xs font-medium text-[#1E293B] transition-colors hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? '刷新中...' : '刷新'}
          </button>
        </header>
        <div className="grid grid-cols-1 gap-4 px-6 py-5 md:grid-cols-2">
          <div>
            <div className="text-xs text-[#64748B]">当前版本</div>
            <div className="mt-1 font-mono text-sm text-[#1E293B]">
              {currentVersion ? currentVersion.slice(0, 7) : '-'}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#64748B]">最新版本</div>
            <div className="mt-1 font-mono text-sm text-[#1E3A5F]">
              {latestVersion ? latestVersion.shortSha : '-'}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#64748B]">最新提交信息</div>
            <div className="mt-1 text-sm text-[#1E293B]">
              {latestVersion ? latestVersion.message : '-'}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#64748B]">最新提交时间</div>
            <div className="mt-1 text-sm text-[#1E293B]">
              {latestVersion ? formatTime(latestVersion.date) : '-'}
            </div>
          </div>
        </div>
      </section>

      {/* 卡片 2：更新操作 + 进度 + 实时日志 */}
      <section className="rounded-md border border-[#E2E8F0] bg-white">
        <header className="border-b border-[#E2E8F0] px-6 py-4">
          <h2 className="text-base font-semibold text-[#1E293B]">更新操作</h2>
        </header>
        <div className="space-y-4 px-6 py-5">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleUpdate}
              disabled={isBusy || !hasUpdate}
              className="rounded-md bg-[#1E3A5F] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#15293F] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {updating ? '更新中...' : '立即更新'}
            </button>
            <button
              type="button"
              onClick={handleRollback}
              disabled={isBusy}
              className="rounded-md border border-[#EF4444]/40 bg-white px-4 py-2 text-sm font-medium text-[#EF4444] transition-colors hover:bg-[#EF4444]/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rollingBack ? '回滚中...' : '一键回滚'}
            </button>
          </div>

          {/* 进度条 */}
          {isBusy && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-[#64748B]">
                <span>{updating ? '正在执行更新流程' : '正在执行回滚流程'}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-md bg-[#F1F5F9]">
                <div
                  className="h-full bg-[#1E3A5F] transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="text-xs text-[#64748B]">
                流程包含：git pull -&gt; npm install -&gt; prisma migrate -&gt;
                docker compose restart
              </div>
            </div>
          )}

          {/* 实时日志 */}
          {isBusy && realtimeLog && (
            <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3">
              <div className="mb-2 text-xs font-medium text-[#64748B]">
                实时日志
              </div>
              <div className="space-y-1 text-xs text-[#1E293B]">
                <div>
                  <span className="text-[#64748B]">操作：</span>
                  {getActionLabel(realtimeLog.action)}
                </div>
                <div>
                  <span className="text-[#64748B]">状态：</span>
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-xs ${getStatusBadgeClass(
                      realtimeLog.status,
                    )}`}
                  >
                    {getStatusLabel(realtimeLog.status)}
                  </span>
                </div>
                <div>
                  <span className="text-[#64748B]">触发：</span>
                  {getTriggerLabel(realtimeLog.trigger)}
                </div>
                <div>
                  <span className="text-[#64748B]">操作人：</span>
                  {realtimeLog.operator}
                </div>
                <div>
                  <span className="text-[#64748B]">时间：</span>
                  {formatTime(realtimeLog.createdAt)}
                </div>
                {realtimeLog.errorMessage && (
                  <div className="text-[#EF4444]">
                    {realtimeLog.errorMessage}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 卡片 3：更新日志 */}
      <section className="rounded-md border border-[#E2E8F0] bg-white">
        <header className="border-b border-[#E2E8F0] px-6 py-4">
          <h2 className="text-base font-semibold text-[#1E293B]">更新日志</h2>
        </header>
        <div className="divide-y divide-[#E2E8F0]">
          {updateLogs.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-[#64748B]">
              暂无更新日志
            </div>
          ) : (
            updateLogs.map((log) => (
              <div
                key={log.sha}
                className="flex flex-col gap-1 px-6 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-[#1E293B]">
                    {log.message}
                  </div>
                  <div className="mt-1 text-xs text-[#64748B]">
                    {log.author} · {formatTime(log.date)}
                  </div>
                </div>
                <div className="shrink-0 font-mono text-xs text-[#1E3A5F]">
                  {log.shortSha}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* 卡片 4：版本历史记录 */}
      <section className="rounded-md border border-[#E2E8F0] bg-white">
        <header className="flex items-center justify-between border-b border-[#E2E8F0] px-6 py-4">
          <h2 className="text-base font-semibold text-[#1E293B]">版本历史</h2>
          <button
            type="button"
            onClick={refreshHistory}
            disabled={isBusy}
            className="rounded-md border border-[#E2E8F0] px-3 py-1.5 text-xs font-medium text-[#1E293B] transition-colors hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-50"
          >
            刷新
          </button>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-xs text-[#64748B]">
              <tr>
                <th className="px-6 py-3 font-medium">时间</th>
                <th className="px-6 py-3 font-medium">操作</th>
                <th className="px-6 py-3 font-medium">状态</th>
                <th className="px-6 py-3 font-medium">触发</th>
                <th className="px-6 py-3 font-medium">操作人</th>
                <th className="px-6 py-3 font-medium">版本</th>
                <th className="px-6 py-3 font-medium">错误信息</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {history.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-8 text-center text-sm text-[#64748B]"
                  >
                    暂无历史记录
                  </td>
                </tr>
              ) : (
                history.map((record) => (
                  <tr key={record.id} className="hover:bg-[#F8FAFC]">
                    <td className="whitespace-nowrap px-6 py-3 text-[#1E293B]">
                      {formatTime(record.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-[#1E293B]">
                      {getActionLabel(record.action)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-xs ${getStatusBadgeClass(
                          record.status,
                        )}`}
                      >
                        {getStatusLabel(record.status)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-[#1E293B]">
                      {getTriggerLabel(record.trigger)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-[#1E293B]">
                      {record.operator}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 font-mono text-xs text-[#1E3A5F]">
                      {record.version ? record.version.slice(0, 7) : '-'}
                    </td>
                    <td className="max-w-xs truncate px-6 py-3 text-xs text-[#EF4444]">
                      {record.errorMessage || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default UpdatePanel;
