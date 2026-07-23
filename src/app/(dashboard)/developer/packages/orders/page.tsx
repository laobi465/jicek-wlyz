"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { PageHeader, PageLoading, EmptyState } from "@/components/layout/page-header";
import { formatDate, formatDateTime } from "@/components/common/badges";
import { get, ApiError } from "@/lib/http";

/**
 * 我的订单 /developer/packages/orders
 *
 * 套餐订阅记录（套餐充值模块下的「我的订单」）。
 *
 * - GET /api/user-packages → { userPackages }（含套餐详情，按创建时间倒序，无分页）
 *
 * 套餐订阅会创建/叠加 UserPackage（30 天有效期），并非 Order 表记录，
 * 因此「我的订单」展示的是当前用户的套餐订阅记录与剩余额度。
 *
 * 价格 price 为 Decimal，序列化为字符串，展示用 Number().toFixed(2)。
 */

interface PackageInfo {
  id: string;
  name: string;
  description: string | null;
  /** 月费价格（Decimal 序列化为字符串） */
  price: string;
  app_quota: number;
  card_quota: number;
  sort_order: number;
  status: string;
  created_at: string;
  updated_at: string;
}

interface UserPackage {
  id: string;
  user_id: string;
  package_id: string;
  remaining_app_quota: number;
  remaining_card_quota: number;
  status: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  package: PackageInfo;
}

interface UserPackagesResponse {
  userPackages: UserPackage[];
}

const STATUS_LABEL: Record<string, string> = {
  active: "有效",
  expired: "已过期",
};

const STATUS_VARIANT: Record<string, "success" | "default"> = {
  active: "success",
  expired: "default",
};

export default function PackageOrdersPage() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();

  const [records, setRecords] = useState<UserPackage[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await get<UserPackagesResponse>(user, "/api/user-packages");
      setRecords(result.userPackages ?? []);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载订阅记录失败");
      }
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <PageLoading />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="我的订单"
        subtitle="套餐订阅记录与剩余额度"
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push("/developer/packages")}
          >
            返回套餐
          </Button>
        }
      />

      {records.length === 0 ? (
        <EmptyState
          title="暂无订阅记录"
          description="您还未订阅任何套餐，去套餐列表选择适合的套餐"
        />
      ) : (
        <Card>
          <div className="px-5 py-4 border-b border-border">
            <span className="text-xs text-foreground-muted">
              共 {records.length} 条记录
            </span>
          </div>
          <Table>
            <THead>
              <TR>
                <TH>套餐</TH>
                <TH>状态</TH>
                <TH>月费</TH>
                <TH>应用额度</TH>
                <TH>卡密度额</TH>
                <TH>有效期至</TH>
                <TH>订阅时间</TH>
              </TR>
            </THead>
            <TBody>
              {records.map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium text-foreground">
                    {r.package?.name ?? "-"}
                  </TD>
                  <TD>
                    <Badge variant={STATUS_VARIANT[r.status] ?? "default"}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </Badge>
                  </TD>
                  <TD className="text-foreground whitespace-nowrap">
                    ¥{Number(r.package?.price ?? 0).toFixed(2)}
                  </TD>
                  <TD className="text-foreground-muted whitespace-nowrap">
                    {r.remaining_app_quota}
                    {r.package ? ` / ${r.package.app_quota}` : ""}
                  </TD>
                  <TD className="text-foreground-muted whitespace-nowrap">
                    {r.remaining_card_quota}
                    {r.package ? ` / ${r.package.card_quota}` : ""}
                  </TD>
                  <TD className="text-foreground-muted text-xs whitespace-nowrap">
                    {formatDate(r.expires_at)}
                  </TD>
                  <TD className="text-foreground-muted text-xs whitespace-nowrap">
                    {formatDateTime(r.created_at)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <div className="text-xs text-foreground-muted">
        <Link href="/developer/packages" className="hover:text-primary">
          返回套餐列表
        </Link>
      </div>
    </div>
  );
}
