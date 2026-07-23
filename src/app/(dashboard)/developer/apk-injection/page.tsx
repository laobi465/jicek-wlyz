"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  EmptyRow,
} from "@/components/ui/table";
import { PageHeader, PageLoading } from "@/components/layout/page-header";
import { formatDateTime } from "@/components/common/badges";
import { get, ApiError } from "@/lib/http";

/**
 * APK 注入任务列表 /developer/apk-injection
 *
 * - GET /api/apk-injection/tasks（参数：status / limit / offset → { tasks, total }）
 * - 状态筛选 + 上一页 / 下一页分页（limit=20）
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

interface ListResponse {
  tasks: ApkInjectionTask[];
  total: number;
}

const PAGE_SIZE = 20;

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部状态" },
  { value: "pending", label: "排队中" },
  { value: "processing", label: "注入中" },
  { value: "success", label: "成功" },
  { value: "failed", label: "失败" },
];

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

/** 字节 → 可读大小 */
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

/** 毫秒 → 可读耗时 */
function formatDuration(ms: number | null): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export default function ApkInjectionListPage() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();

  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await get<ListResponse>(
        user,
        "/api/apk-injection/tasks",
        {
          status: status || undefined,
          limit: PAGE_SIZE,
          offset,
        },
      );
      setData(result);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载注入任务列表失败");
      }
    } finally {
      setLoading(false);
    }
  }, [user, status, offset, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // 切换筛选条件时重置 offset
  useEffect(() => {
    setOffset(0);
  }, [status]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="APK 注入"
        subtitle="上传 APK 进行安全注入，下载注入后的安装包"
        action={
          <Button
            size="sm"
            onClick={() => router.push("/developer/apk-injection/upload")}
          >
            上传注入
          </Button>
        }
      />

      <Card>
        <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-3">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-32"
            aria-label="按状态筛选"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <span className="text-xs text-foreground-muted">共 {total} 条</span>
        </div>

        {loading ? (
          <PageLoading />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>文件名</TH>
                <TH>状态</TH>
                <TH>大小</TH>
                <TH>耗时</TH>
                <TH>创建时间</TH>
                <TH className="text-right">操作</TH>
              </TR>
            </THead>
            <TBody>
              {data && data.tasks.length > 0 ? (
                data.tasks.map((t) => (
                  <TR key={t.id}>
                    <TD className="font-mono text-xs break-all max-w-[260px]">
                      {t.original_filename}
                    </TD>
                    <TD>
                      <Badge variant={STATUS_VARIANT[t.status] ?? "default"}>
                        {STATUS_LABEL[t.status] ?? t.status}
                      </Badge>
                    </TD>
                    <TD className="text-foreground-muted text-xs whitespace-nowrap">
                      {formatFileSize(t.file_size)}
                    </TD>
                    <TD className="text-foreground-muted text-xs whitespace-nowrap">
                      {formatDuration(t.duration_ms)}
                    </TD>
                    <TD className="text-foreground-muted text-xs whitespace-nowrap">
                      {formatDateTime(t.created_at)}
                    </TD>
                    <TD className="text-right">
                      <Link
                        href={`/developer/apk-injection/${t.id}`}
                        className="text-primary text-sm hover:underline"
                      >
                        查看
                      </Link>
                    </TD>
                  </TR>
                ))
              ) : (
                <EmptyRow
                  colSpan={6}
                  message="暂无注入任务，点击右上角“上传注入”创建"
                />
              )}
            </TBody>
          </Table>
        )}
      </Card>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            上一页
          </Button>
          <span className="text-xs text-foreground-muted">
            {currentPage} / {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={offset + PAGE_SIZE >= total || loading}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}
