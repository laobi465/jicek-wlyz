"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmModal } from "@/components/ui/modal";
import {
  PageHeader,
  PageLoading,
  EmptyState,
} from "@/components/layout/page-header";
import { formatDateTime } from "@/components/common/badges";
import { get, post, request, ApiError } from "@/lib/http";

/**
 * APK 注入任务详情 /developer/apk-injection/[taskId]
 *
 * - GET /api/apk-injection/tasks/[taskId] → 任务详情
 * - POST /api/apk-injection/tasks/[taskId]/cancel → 取消（仅 pending）
 * - GET /api/apk-injection/tasks/[taskId]/download → 下载注入后 APK（文件流）
 *
 * pending / processing 状态每 5s 轮询刷新；success 显示下载按钮，pending 显示取消按钮。
 */

interface ApkInjectionTask {
  id: string;
  submitter_id: string;
  app_id: string | null;
  original_filename: string;
  original_signature_hash: string | null;
  injected_object_key: string | null;
  injected_sha256: string | null;
  /** 文件大小（字节，BigInt 序列化为 String） */
  file_size: string;
  status: string;
  error_message: string | null;
  injection_config: string;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "排队中",
  processing: "注入中",
  success: "成功",
  failed: "失败",
};

const STATUS_VARIANT: Record<
  string,
  "default" | "primary" | "success" | "danger"
> = {
  pending: "default",
  processing: "primary",
  success: "success",
  failed: "danger",
};

/** 轮询间隔（毫秒） */
const POLL_INTERVAL = 5000;

function formatFileSize(size: string | number): string {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i === 0 ? n.toFixed(0) : n.toFixed(2)} ${units[i]}`;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** 注入配置 JSON 字符串 → 格式化展示 */
function formatInjectionConfig(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw || "-";
  }
}

export default function ApkInjectionDetailPage() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const params = useParams<{ taskId: string }>();
  const taskId = params?.taskId;

  const [task, setTask] = useState<ApkInjectionTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    if (!user || !taskId) return;
    try {
      const data = await get<ApkInjectionTask>(
        user,
        `/api/apk-injection/tasks/${taskId}`,
      );
      setTask(data);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载任务失败");
      }
    } finally {
      setLoading(false);
    }
  }, [user, taskId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // pending / processing 时轮询
  const status = task?.status;
  useEffect(() => {
    if (status !== "pending" && status !== "processing") return;
    const id = setInterval(() => {
      load();
    }, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [status, load]);

  async function onCancel() {
    if (!user || !task) return;
    setCanceling(true);
    try {
      await post(user, `/api/apk-injection/tasks/${task.id}/cancel`);
      toast.success("任务已取消");
      setCancelConfirm(false);
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("取消任务失败");
      }
    } finally {
      setCanceling(false);
    }
  }

  async function onDownload() {
    if (!user || !task) return;
    setDownloading(true);
    try {
      // 下载接口需 X-User-Id 鉴权头，window.open 无法带自定义头，
      // 改用 request 拿到 Response → blob → <a> 触发下载
      const res = await request<Response>(
        user,
        `/api/apk-injection/tasks/${task.id}/download`,
        { method: "GET" },
      );
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      a.download = match
        ? decodeURIComponent(match[1])
        : `injected-${task.original_filename}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("下载失败");
      }
    } finally {
      setDownloading(false);
    }
  }

  if (loading) return <PageLoading />;
  if (!task) {
    return (
      <EmptyState
        title="任务不存在或无权访问"
        description="可能已被删除，或您没有权限查看此任务"
      />
    );
  }

  const isSuccess = task.status === "success";
  const isPending = task.status === "pending";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={task.original_filename}
        subtitle="APK 注入任务详情"
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push("/developer/apk-injection")}
          >
            返回列表
          </Button>
        }
      />

      <Card>
        <CardHeader
          title="任务信息"
          description={`创建于 ${formatDateTime(task.created_at)}`}
          action={
            <Badge variant={STATUS_VARIANT[task.status] ?? "default"}>
              {STATUS_LABEL[task.status] ?? task.status}
            </Badge>
          }
        />
        <CardBody>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-foreground-muted">文件大小</dt>
              <dd className="text-foreground">{formatFileSize(task.file_size)}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-foreground-muted">注入耗时</dt>
              <dd className="text-foreground">
                {formatDuration(task.duration_ms)}
              </dd>
            </div>
            <div className="flex flex-col gap-1 md:col-span-2">
              <dt className="text-xs text-foreground-muted">原始文件名</dt>
              <dd className="text-foreground font-mono text-xs break-all">
                {task.original_filename}
              </dd>
            </div>
            {task.injected_sha256 && (
              <div className="flex flex-col gap-1 md:col-span-2">
                <dt className="text-xs text-foreground-muted">
                  注入后 SHA-256
                </dt>
                <dd className="text-foreground font-mono text-xs break-all">
                  {task.injected_sha256}
                </dd>
              </div>
            )}
            {task.original_signature_hash && (
              <div className="flex flex-col gap-1 md:col-span-2">
                <dt className="text-xs text-foreground-muted">
                  原始签名哈希
                </dt>
                <dd className="text-foreground font-mono text-xs break-all">
                  {task.original_signature_hash}
                </dd>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-foreground-muted">更新时间</dt>
              <dd className="text-foreground">
                {formatDateTime(task.updated_at)}
              </dd>
            </div>
          </dl>

          {task.error_message && (
            <div className="mt-4 rounded-md bg-danger-subtle border border-red-200 p-4">
              <p className="text-xs font-medium text-danger">失败原因</p>
              <p className="mt-1 text-sm text-foreground whitespace-pre-wrap break-words">
                {task.error_message}
              </p>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="注入配置" description="提交时使用的注入参数" />
        <CardBody>
          <pre className="rounded-md bg-background-subtle p-4 text-xs text-foreground overflow-x-auto whitespace-pre-wrap break-all">
            {formatInjectionConfig(task.injection_config)}
          </pre>
        </CardBody>
      </Card>

      {(isSuccess || isPending) && (
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">操作</p>
                <p className="text-xs text-foreground-muted mt-1">
                  当前状态：{STATUS_LABEL[task.status] ?? task.status}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isSuccess && (
                  <Button
                    size="sm"
                    loading={downloading}
                    onClick={onDownload}
                  >
                    下载注入包
                  </Button>
                )}
                {isPending && (
                  <Button
                    variant="danger"
                    size="sm"
                    loading={canceling}
                    onClick={() => setCancelConfirm(true)}
                  >
                    取消任务
                  </Button>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="text-xs text-foreground-muted">
        <Link
          href="/developer/apk-injection"
          className="hover:text-primary"
        >
          返回注入任务列表
        </Link>
      </div>

      <ConfirmModal
        open={cancelConfirm}
        onClose={() => setCancelConfirm(false)}
        onConfirm={onCancel}
        title="取消任务"
        message="取消后任务将标记为失败，无法恢复，确定取消此任务吗？"
        confirmText="确认取消"
        danger
        loading={canceling}
      />
    </div>
  );
}
