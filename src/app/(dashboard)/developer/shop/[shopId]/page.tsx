"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Textarea, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal, ConfirmModal } from "@/components/ui/modal";
import {
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  EmptyRow,
} from "@/components/ui/table";
import {
  PageHeader,
  PageLoading,
  EmptyState,
} from "@/components/layout/page-header";
import { formatDateTime } from "@/components/common/badges";
import { get, post, patch, del, ApiError } from "@/lib/http";

/**
 * 店铺详情 /developer/shop/[shopId]
 *
 * - GET /api/shops/[shopId] → 店铺详情
 * - GET /api/shops/[shopId]/products → { products }（商品列表，无分页）
 * - POST /api/shops/[shopId]/products { name, description?, price, stock, cardTemplateId? } → 创建商品
 * - PATCH /api/products/[productId] { name?, description?, price?, stock?, status? } → 更新商品
 * - DELETE /api/products/[productId] → 删除商品
 *
 * 价格 price 为 Decimal，序列化为字符串，展示用 Number().toFixed(2)。
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

interface Product {
  id: string;
  shop_id: string;
  card_template_id: string | null;
  name: string;
  description: string | null;
  /** 价格（Decimal 序列化为字符串） */
  price: string;
  stock: number;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ProductsResponse {
  products: Product[];
}

const SHOP_STATUS_LABEL: Record<string, string> = {
  open: "营业中",
  closed: "已关闭",
};

const SHOP_STATUS_VARIANT: Record<string, "success" | "default"> = {
  open: "success",
  closed: "default",
};

const PRODUCT_STATUS_LABEL: Record<string, string> = {
  on_sale: "在售",
  off_shelf: "已下架",
};

const PRODUCT_STATUS_VARIANT: Record<string, "success" | "default"> = {
  on_sale: "success",
  off_shelf: "default",
};

const MAX_NAME = 50;
const UNLIMITED_STOCK = -1;

type FormMode = "create" | "edit";

interface ProductFormState {
  id?: string;
  name: string;
  description: string;
  price: string;
  stock: string;
  cardTemplateId: string;
  status: string;
}

const EMPTY_FORM: ProductFormState = {
  name: "",
  description: "",
  price: "",
  stock: "",
  cardTemplateId: "",
  status: "on_sale",
};

export default function ShopDetailPage() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const params = useParams<{ shopId: string }>();
  const shopId = params?.shopId;

  const [shop, setShop] = useState<Shop | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("create");
  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM);
  const [nameError, setNameError] = useState<string>();
  const [priceError, setPriceError] = useState<string>();
  const [stockError, setStockError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!user || !shopId) return;
    setLoading(true);
    try {
      const [shopData, productsData] = await Promise.all([
        get<Shop>(user, `/api/shops/${shopId}`),
        get<ProductsResponse>(user, `/api/shops/${shopId}/products`),
      ]);
      setShop(shopData);
      setProducts(productsData.products ?? []);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载店铺详情失败");
      }
    } finally {
      setLoading(false);
    }
  }, [user, shopId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setFormMode("create");
    setForm(EMPTY_FORM);
    setNameError(undefined);
    setPriceError(undefined);
    setStockError(undefined);
    setFormOpen(true);
  }

  function openEdit(p: Product) {
    setFormMode("edit");
    setForm({
      id: p.id,
      name: p.name,
      description: p.description ?? "",
      price: Number(p.price).toFixed(2),
      stock: String(p.stock),
      cardTemplateId: p.card_template_id ?? "",
      status: p.status,
    });
    setNameError(undefined);
    setPriceError(undefined);
    setStockError(undefined);
    setFormOpen(true);
  }

  function validate(): boolean {
    let ok = true;
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setNameError("请输入商品名称");
      ok = false;
    } else if (trimmedName.length > MAX_NAME) {
      setNameError(`名称不超过 ${MAX_NAME} 字符`);
      ok = false;
    } else {
      setNameError(undefined);
    }

    const priceNum = Number(form.price);
    if (!form.price.trim() || !Number.isFinite(priceNum) || priceNum <= 0) {
      setPriceError("价格必须为大于 0 的数");
      ok = false;
    } else {
      setPriceError(undefined);
    }

    const stockNum = Number(form.stock);
    if (
      !form.stock.trim() ||
      !Number.isInteger(stockNum) ||
      stockNum < UNLIMITED_STOCK
    ) {
      setStockError("库存必须为整数且 ≥ -1（-1 表示无限）");
      ok = false;
    } else {
      setStockError(undefined);
    }
    return ok;
  }

  async function onSubmit() {
    if (!user || !shopId) return;
    if (!validate()) return;

    setSubmitting(true);
    try {
      if (formMode === "create") {
        await post<Product>(user, `/api/shops/${shopId}/products`, {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          price: Number(form.price),
          stock: Number(form.stock),
          cardTemplateId: form.cardTemplateId.trim() || undefined,
        });
        toast.success("商品已创建");
      } else if (form.id) {
        await patch<Product>(user, `/api/products/${form.id}`, {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          price: Number(form.price),
          stock: Number(form.stock),
          status: form.status,
        });
        toast.success("商品已更新");
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger(formMode === "create" ? "创建商品失败" : "更新商品失败");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete() {
    if (!user || !deleteTarget) return;
    setDeleting(true);
    try {
      await del(user, `/api/products/${deleteTarget.id}`);
      toast.success("商品已删除");
      setDeleteTarget(null);
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("删除商品失败");
      }
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <PageLoading />;
  if (!shop) {
    return (
      <EmptyState
        title="店铺不存在或无权访问"
        description="可能已被删除，或您没有权限查看此店铺"
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={shop.name}
        subtitle="店铺商品管理"
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push("/developer/shop")}
          >
            返回列表
          </Button>
        }
      />

      <Card>
        <CardHeader
          title="店铺信息"
          description={`创建于 ${formatDateTime(shop.created_at)}`}
          action={
            <Badge variant={SHOP_STATUS_VARIANT[shop.status] ?? "default"}>
              {SHOP_STATUS_LABEL[shop.status] ?? shop.status}
            </Badge>
          }
        />
        <CardBody>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-foreground-muted">域名</dt>
              <dd className="text-foreground text-xs font-mono break-all">
                {shop.url || "-"}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-foreground-muted">商品总数</dt>
              <dd className="text-foreground">
                {shop._count?.products ?? products.length}
              </dd>
            </div>
            {shop.description && (
              <div className="flex flex-col gap-1 md:col-span-2">
                <dt className="text-xs text-foreground-muted">描述</dt>
                <dd className="text-foreground whitespace-pre-wrap">
                  {shop.description}
                </dd>
              </div>
            )}
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="商品列表"
          description="库存 -1 表示无限；在售商品可被下单"
          action={
            <Button size="sm" onClick={openCreate}>
              添加商品
            </Button>
          }
        />
        <Table>
          <THead>
            <TR>
              <TH>商品名称</TH>
              <TH>状态</TH>
              <TH>价格</TH>
              <TH>库存</TH>
              <TH>创建时间</TH>
              <TH className="text-right">操作</TH>
            </TR>
          </THead>
          <TBody>
            {products.length > 0 ? (
              products.map((p) => (
                <TR key={p.id}>
                  <TD className="font-medium text-foreground">{p.name}</TD>
                  <TD>
                    <Badge
                      variant={PRODUCT_STATUS_VARIANT[p.status] ?? "default"}
                    >
                      {PRODUCT_STATUS_LABEL[p.status] ?? p.status}
                    </Badge>
                  </TD>
                  <TD className="text-foreground whitespace-nowrap">
                    ¥{Number(p.price).toFixed(2)}
                  </TD>
                  <TD className="text-foreground-muted whitespace-nowrap">
                    {p.stock === UNLIMITED_STOCK ? "无限" : p.stock}
                  </TD>
                  <TD className="text-foreground-muted text-xs whitespace-nowrap">
                    {formatDateTime(p.created_at)}
                  </TD>
                  <TD className="text-right">
                    <div className="inline-flex items-center gap-3">
                      <button
                        type="button"
                        className="text-primary text-sm hover:underline"
                        onClick={() => openEdit(p)}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="text-danger text-sm hover:underline"
                        onClick={() => setDeleteTarget(p)}
                      >
                        删除
                      </button>
                    </div>
                  </TD>
                </TR>
              ))
            ) : (
              <EmptyRow
                colSpan={6}
                message="暂无商品，点击右上角“添加商品”创建"
              />
            )}
          </TBody>
        </Table>
      </Card>

      {/* 创建 / 编辑 商品 */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={formMode === "create" ? "添加商品" : "编辑商品"}
        description={
          formMode === "create"
            ? "价格 > 0；库存为整数且 ≥ -1（-1 表示无限）"
            : "修改商品信息，可调整上下架状态"
        }
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setFormOpen(false)}
              disabled={submitting}
            >
              取消
            </Button>
            <Button size="sm" loading={submitting} onClick={onSubmit}>
              {formMode === "create" ? "创建" : "保存"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input
            id="product-name"
            label="商品名称"
            placeholder="如 月卡套餐"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={nameError}
            maxLength={MAX_NAME}
            required
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              id="product-price"
              label="价格（元）"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="如 9.90"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              error={priceError}
              required
            />
            <Input
              id="product-stock"
              label="库存"
              type="number"
              step="1"
              placeholder="-1 表示无限"
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: e.target.value })}
              error={stockError}
              hint="整数，-1 表示无限库存"
              required
            />
          </div>
          <Textarea
            id="product-desc"
            label="描述"
            placeholder="商品说明（可选）"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="min-h-[80px]"
          />
          {formMode === "create" ? (
            <Input
              id="product-card-template"
              label="关联卡密模板 ID"
              placeholder="可选，关联后下单自动发卡"
              value={form.cardTemplateId}
              onChange={(e) =>
                setForm({ ...form, cardTemplateId: e.target.value })
              }
              hint="可选，填写卡密模板 ID 后，支付成功会自动分配一张该模板的卡密"
            />
          ) : (
            <Select
              id="product-status"
              label="状态"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              hint="下架后商品不可被下单"
            >
              <option value="on_sale">在售</option>
              <option value="off_shelf">下架</option>
            </Select>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={onDelete}
        title="删除商品"
        message={
          deleteTarget
            ? `确定删除商品「${deleteTarget.name}」吗？删除后不可恢复。`
            : ""
        }
        confirmText="删除"
        danger
        loading={deleting}
      />
    </div>
  );
}
