"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
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
import { get, post, ApiError } from "@/lib/http";

/**
 * 店铺列表 /developer/shop
 *
 * - GET /api/shops → { shops }（listShopsByDeveloper 返回全部，无分页）
 * - POST /api/shops { name, description?, url? } → 创建店铺
 *
 * 列表展示：名称 / 状态 / 商品数 / 域名 / 创建时间 / 操作。
 */

interface Shop {
  id: string;
  developer_id: string;
  name: string;
  description: string | null;
  url: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  _count: { products: number };
}

interface ShopsResponse {
  shops: Shop[];
}

const STATUS_LABEL: Record<string, string> = {
  open: "营业中",
  closed: "已关闭",
};

const STATUS_VARIANT: Record<string, "success" | "default"> = {
  open: "success",
  closed: "default",
};

const MAX_NAME = 50;

export default function ShopListPage() {
  const { user } = useAuth();
  const toast = useToast();

  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);

  // 创建店铺弹窗
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string>();

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await get<ShopsResponse>(user, "/api/shops");
      setShops(result.shops ?? []);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载店铺列表失败");
      }
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setName("");
    setDescription("");
    setUrl("");
    setNameError(undefined);
    setCreateOpen(true);
  }

  async function onCreate() {
    if (!user) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("请输入店铺名称");
      return;
    }
    if (trimmed.length > MAX_NAME) {
      setNameError(`名称不超过 ${MAX_NAME} 字符`);
      return;
    }

    setSubmitting(true);
    try {
      await post<Shop>(user, "/api/shops", {
        name: trimmed,
        description: description.trim() || undefined,
        url: url.trim() || undefined,
      });
      toast.success("店铺已创建");
      setCreateOpen(false);
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("创建店铺失败");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="店铺商品"
        subtitle="管理发卡店铺与店铺内商品"
        action={
          <Button size="sm" onClick={openCreate}>
            创建店铺
          </Button>
        }
      />

      <Card>
        <div className="px-5 py-4 border-b border-border">
          <span className="text-xs text-foreground-muted">
            共 {shops.length} 家店铺
          </span>
        </div>

        {loading ? (
          <PageLoading />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>店铺名称</TH>
                <TH>状态</TH>
                <TH>商品数</TH>
                <TH>域名</TH>
                <TH>创建时间</TH>
                <TH className="text-right">操作</TH>
              </TR>
            </THead>
            <TBody>
              {shops.length > 0 ? (
                shops.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-medium text-foreground">{s.name}</TD>
                    <TD>
                      <Badge variant={STATUS_VARIANT[s.status] ?? "default"}>
                        {STATUS_LABEL[s.status] ?? s.status}
                      </Badge>
                    </TD>
                    <TD className="text-foreground-muted">{s._count?.products ?? 0}</TD>
                    <TD className="text-foreground-muted text-xs">
                      {s.url ? (
                        <span className="font-mono break-all">{s.url}</span>
                      ) : (
                        "-"
                      )}
                    </TD>
                    <TD className="text-foreground-muted text-xs whitespace-nowrap">
                      {formatDateTime(s.created_at)}
                    </TD>
                    <TD className="text-right">
                      <Link
                        href={`/developer/shop/${s.id}`}
                        className="text-primary text-sm hover:underline"
                      >
                        管理
                      </Link>
                    </TD>
                  </TR>
                ))
              ) : (
                <EmptyRow
                  colSpan={6}
                  message="暂无店铺，点击右上角“创建店铺”开始"
                />
              )}
            </TBody>
          </Table>
        )}
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="创建店铺"
        description={`名称不超过 ${MAX_NAME} 字符，域名与描述可选填`}
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCreateOpen(false)}
              disabled={submitting}
            >
              取消
            </Button>
            <Button size="sm" loading={submitting} onClick={onCreate}>
              创建
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input
            id="shop-name"
            label="店铺名称"
            placeholder="如 官方发卡店"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={nameError}
            maxLength={MAX_NAME}
            required
          />
          <Input
            id="shop-url"
            label="域名"
            placeholder="如 https://shop.example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            hint="可选，店铺对外访问地址"
          />
          <Textarea
            id="shop-desc"
            label="描述"
            placeholder="简要介绍店铺"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-[80px]"
          />
        </div>
      </Modal>
    </div>
  );
}
