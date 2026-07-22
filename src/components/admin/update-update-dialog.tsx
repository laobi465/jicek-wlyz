'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * 新版本更新提醒弹窗组件
 *
 * 功能：
 * 1. 客户端轮询 /api/admin/update/check（每 60 秒一次）；
 * 2. 检测到新版本时弹出提醒；
 * 3. 「立即更新」调用 /api/admin/update/trigger；
 * 4. 「稍后提醒」关闭弹窗，等待下次轮询。
 *
 * UI 规范（铁律 03 强制）：
 * - 主色 #1E3A5F 藏蓝，圆角 6px（rounded-md）；
 * - 禁 emoji / 毛玻璃 / 暗黑 / 夸张渐变；
 * - 整体明亮，白色卡片 + 极浅灰分割线。
 */

/** 最新版本信息（与服务端 CommitInfo 子集对齐） */
interface LatestVersionInfo {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

/** /api/admin/update/check 响应数据结构 */
interface CheckResponseData {
  currentVersion: string;
  latestVersion: LatestVersionInfo;
  hasUpdate: boolean;
}

/** 统一响应体 */
interface ApiResponse<T> {
  code: number;
  msg: string;
  data: T | null;
  ts: number;
  nonce: string;
}

/** 轮询间隔（毫秒） */
const POLL_INTERVAL_MS = 60_000;

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
    });
  } catch {
    return iso;
  }
}

export function UpdateUpdateDialog() {
  const [latestVersion, setLatestVersion] = useState<LatestVersionInfo | null>(
    null,
  );
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 检查是否有新版本
   * 静默失败，不打扰管理员正常使用
   */
  const checkForUpdate = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/update/check', { method: 'GET' });
      const data: ApiResponse<CheckResponseData> = await res.json();
      if (data.code === 0 && data.data?.hasUpdate && data.data.latestVersion) {
        setLatestVersion(data.data.latestVersion);
        setOpen(true);
        setError(null);
      }
    } catch {
      // 网络异常等场景静默忽略，等待下次轮询
    }
  }, []);

  useEffect(() => {
    // 首次挂载立即检查一次
    checkForUpdate();
    const timer = setInterval(checkForUpdate, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [checkForUpdate]);

  /** 立即更新：调用 trigger 接口，等待返回后关闭弹窗 */
  const handleUpdateNow = async () => {
    setUpdating(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/update/trigger', {
        method: 'POST',
      });
      const data: ApiResponse<unknown> = await res.json();
      if (data.code === 0) {
        setOpen(false);
        setLatestVersion(null);
      } else {
        setError(data.msg || '更新失败');
      }
    } catch (e) {
      setError((e as Error).message || '更新请求异常');
    } finally {
      setUpdating(false);
    }
  };

  /** 稍后提醒：仅关闭弹窗，下一轮轮询会再次检测 */
  const handleRemindLater = () => {
    setOpen(false);
  };

  // 未检测到新版本或用户已关闭时不渲染
  if (!open || !latestVersion) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-dialog-title"
    >
      <div className="w-full max-w-md rounded-md border border-[#E2E8F0] bg-white shadow-lg">
        {/* 头部 */}
        <div className="border-b border-[#E2E8F0] px-6 py-4">
          <h2
            id="update-dialog-title"
            className="text-base font-semibold text-[#1E293B]"
          >
            发现新版本
          </h2>
        </div>

        {/* 主体内容 */}
        <div className="space-y-3 px-6 py-5">
          <div>
            <div className="text-xs text-[#64748B]">新版本号</div>
            <div className="mt-1 font-mono text-sm text-[#1E3A5F]">
              {latestVersion.shortSha}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#64748B]">更新内容</div>
            <div className="mt-1 text-sm text-[#1E293B]">
              {latestVersion.message}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#64748B]">更新时间</div>
            <div className="mt-1 text-sm text-[#1E293B]">
              {formatTime(latestVersion.date)}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#64748B]">提交者</div>
            <div className="mt-1 text-sm text-[#1E293B]">
              {latestVersion.author}
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-[#EF4444]/30 bg-[#EF4444]/5 px-3 py-2 text-sm text-[#EF4444]">
              {error}
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex justify-end gap-3 border-t border-[#E2E8F0] px-6 py-4">
          <button
            type="button"
            onClick={handleRemindLater}
            disabled={updating}
            className="rounded-md border border-[#E2E8F0] px-4 py-2 text-sm font-medium text-[#1E293B] transition-colors hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-50"
          >
            稍后提醒
          </button>
          <button
            type="button"
            onClick={handleUpdateNow}
            disabled={updating}
            className="rounded-md bg-[#1E3A5F] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#15293F] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {updating ? '更新中...' : '立即更新'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default UpdateUpdateDialog;
