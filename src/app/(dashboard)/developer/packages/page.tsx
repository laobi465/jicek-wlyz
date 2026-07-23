"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmModal } from "@/components/ui/modal";
import { PageHeader, PageLoading, EmptyState } from "@/components/layout/page-header";
import { formatDate } from "@/components/common/badges";
import { get, post, ApiError } from "@/lib/http";

/**
 * 套餐充值 /developer/packages
 *
 * - GET /api/packages → { packages }（非超管仅返回启用套餐，按 sort_order 升序）
 * - POST /api/packages/[packageId]/subscribe → 订阅套餐（创建/叠加 UserPackage，30 天有效期）
 *
 * 价格 price 为 Decimal，序列化为字符串，展示用 Number().toFixed(2)。
 * 订阅额度：app_quota 应用数额度 / card_quota 卡密额度，订阅后写入 UserPackage。
 */

interface Package {
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

interface PackagesResponse {
  packages: Package[];
}

interface UserPackage {
  id: string;
  remaining_app_quota: number;
  remaining_card_quota: number;
  status: string;
  expires_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  active: "可订阅",
  inactive: "已停用",
};

const STATUS_VARIANT: Record<string, "success" | "default"> = {
  active: "success",
  inactive: "default",
};

export default function PackagesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();

  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);

  const [subscribeTarget, setSubscribeTarget] = useState<Package | null>(null);
  const [subscribing, setSubscribing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await get<PackagesResponse>(user, "/api/packages");
      setPackages(result.packages ?? []);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载套餐列表失败");
      }
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function onSubscribe() {
    if (!user || !subscribeTarget) return;
    setSubscribing(true);
    try {
      const result = await post<UserPackage>(
        user,
        `/api/packages/${subscribeTarget.id}/subscribe`,
      );
      toast.success(
        `已订阅「${subscribeTarget.name}」，有效期至 ${formatDate(result.expires_at)}`,
      );
      setSubscribeTarget(null);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("订阅套餐失败");
      }
    } finally {
      setSubscribing(false);
    }
  }

  if (loading) return <PageLoading />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="套餐充值"
        subtitle="订阅套餐获取应用与卡密额度，有效期 30 天，重复订阅叠加额度"
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push("/developer/packages/orders")}
          >
            我的订单
          </Button>
        }
      />

      {packages.length === 0 ? (
        <EmptyState
          title="暂无可订阅套餐"
          description="平台尚未配置套餐，请联系管理员"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {packages.map((pkg) => {
            const isActive = pkg.status === "active";
            return (
              <Card key={pkg.id} className="flex flex-col">
                <CardBody className="flex flex-col gap-4 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-1">
                      <h3 className="text-base font-semibold text-foreground">
                        {pkg.name}
                      </h3>
                      <Badge
                        variant={STATUS_VARIANT[pkg.status] ?? "default"}
                      >
                        {STATUS_LABEL[pkg.status] ?? pkg.status}
                      </Badge>
                    </div>
                    <div className="text-right">
                      <span className="text-2xl font-semibold text-primary">
                        ¥{Number(pkg.price).toFixed(2)}
                      </span>
                      <span className="text-xs text-foreground-muted ml-1">
                        /月
                      </span>
                    </div>
                  </div>

                  {pkg.description && (
                    <p className="text-sm text-foreground-muted leading-5">
                      {pkg.description}
                    </p>
                  )}

                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-md border border-border bg-background-subtle/40 p-3">
                      <dt className="text-xs text-foreground-muted">
                        应用额度
                      </dt>
                      <dd className="mt-1 text-foreground font-medium">
                        {pkg.app_quota} 个
                      </dd>
                    </div>
                    <div className="rounded-md border border-border bg-background-subtle/40 p-3">
                      <dt className="text-xs text-foreground-muted">
                        卡密度额
                      </dt>
                      <dd className="mt-1 text-foreground font-medium">
                        {pkg.card_quota} 张
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-auto pt-2">
                    <Button
                      className="w-full"
                      disabled={!isActive}
                      onClick={() => setSubscribeTarget(pkg)}
                    >
                      订阅
                    </Button>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <div className="text-xs text-foreground-muted">
        <Link
          href="/developer/packages/orders"
          className="hover:text-primary"
        >
          查看我的订阅记录
        </Link>
      </div>

      <ConfirmModal
        open={!!subscribeTarget}
        onClose={() => setSubscribeTarget(null)}
        onConfirm={onSubscribe}
        title="确认订阅"
        message={
          subscribeTarget
            ? `确定订阅「${subscribeTarget.name}」吗？月费 ¥${Number(subscribeTarget.price).toFixed(2)}，订阅后获得 ${subscribeTarget.app_quota} 个应用额度 + ${subscribeTarget.card_quota} 张卡密度额，有效期 30 天。重复订阅将叠加额度并延长有效期。`
            : ""
        }
        confirmText="确认订阅"
        loading={subscribing}
      />
    </div>
  );
}
