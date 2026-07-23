"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthGuard } from "@/components/auth/auth-guard";
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
 * 卡密列表 /developer/cards
 *
 * - GET /api/apps?limit=100 → { apps, total }（供应用筛选下拉）
 * - GET /api/card-keys（参数：appId / status / limit / offset → { cards, total }）
 * - issuerId 由后端从 X-User-Id 取，仅列出本人生成的卡密
 */

interface AppOption {
  id: string;
  name: string;
}

interface AppListResponse {
  apps: AppOption[];
  total: number;
}

interface CardKey {
  id: string;
  code: string;
  status: string;
  expires_at: string | null;
  remaining_count: number | null;
  created_at: string;
  app: { id: string; name: string };
}

interface ListResponse {
  cards: CardKey[];
  total: number;
}

const PAGE_SIZE = 20;

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部状态" },
  { value: "unused", label: "未使用" },
  { value: "active", label: "已激活" },
  { value: "expired", label: "已过期" },
  { value: "disabled", label: "已作废" },
  { value: "blacklisted", label: "黑名单" },
];

const CARD_STATUS_LABEL: Record<string, string> = {
  unused: "未使用",
  active: "已激活",
  expired: "已过期",
  disabled: "已作废",
  blacklisted: "黑名单",
};

const CARD_STATUS_VARIANT: Record<
  string,
  "default" | "primary" | "success" | "warning" | "danger"
> = {
  unused: "default",
  active: "success",
  expired: "warning",
  disabled: "default",
  blacklisted: "danger",
};

function CardStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={CARD_STATUS_VARIANT[status] ?? "default"}>
      {CARD_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

export default function CardsPage() {
  return (
    <AuthGuard allow={["developer"]}>
      <CardsPageInner />
    </AuthGuard>
  );
}

function CardsPageInner() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();

  const [apps, setApps] = useState<AppOption[]>([]);
  const [appId, setAppId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // 加载应用下拉
  const loadApps = useCallback(async () => {
    if (!user) return;
    try {
      const result = await get<AppListResponse>(user, "/api/apps", {
        limit: 100,
      });
      setApps(result.apps);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      }
    }
  }, [user, toast]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await get<ListResponse>(user, "/api/card-keys", {
        appId: appId || undefined,
        status: status || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setData(result);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载卡密列表失败");
      }
    } finally {
      setLoading(false);
    }
  }, [user, appId, status, offset, toast]);

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setOffset(0);
  }, [appId, status]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="卡密管理"
        subtitle="生成与管理应用卡密，支持作废与加黑名单"
        action={
          <Button size="sm" onClick={() => router.push("/developer/cards/generate")}>
            生成卡密
          </Button>
        }
      />

      <Card>
        <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-3">
          <Select
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            className="w-48"
            aria-label="按应用筛选"
          >
            <option value="">全部应用</option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
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
                <TH>卡密码</TH>
                <TH>应用</TH>
                <TH>状态</TH>
                <TH>过期时间</TH>
                <TH>剩余次数</TH>
                <TH>创建时间</TH>
                <TH className="text-right">操作</TH>
              </TR>
            </THead>
            <TBody>
              {data && data.cards.length > 0 ? (
                data.cards.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-mono text-xs">{c.code}</TD>
                    <TD className="text-xs">{c.app?.name ?? "-"}</TD>
                    <TD>
                      <CardStatusBadge status={c.status} />
                    </TD>
                    <TD className="text-foreground-muted text-xs whitespace-nowrap">
                      {formatDateTime(c.expires_at)}
                    </TD>
                    <TD className="text-xs">
                      {c.remaining_count ?? "-"}
                    </TD>
                    <TD className="text-foreground-muted text-xs whitespace-nowrap">
                      {formatDateTime(c.created_at)}
                    </TD>
                    <TD className="text-right">
                      <Link
                        href={`/developer/cards/${c.id}`}
                        className="text-primary text-sm hover:underline"
                      >
                        查看
                      </Link>
                    </TD>
                  </TR>
                ))
              ) : (
                <EmptyRow
                  colSpan={7}
                  message="暂无卡密，点击右上角“生成卡密”创建"
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
