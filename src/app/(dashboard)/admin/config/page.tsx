"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
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
import { get, post, put, ApiError } from "@/lib/http";

/**
 * 系统配置 /admin/config
 *
 * - GET /api/admin/config?group= → { configs: SystemConfigView[] }
 * - POST /api/admin/config → { created }（初始化全部预定义配置项空值行）
 * - PUT /api/admin/config/[key] { value } → SystemConfigView（upsert，支持首次创建）
 *
 * value 统一以字符串存储（SystemConfig.value @db.Text）。
 * encrypted=true 的配置在前端以掩码展示，编辑时需输入新值。
 *
 * 配置流程：
 * 1. 首次使用点"初始化默认配置"，一键创建全部 7 个分组（payment/storage/email/
 *    sms/cdn/backup/general 共 30+ 项）的空值行
 * 2. 按分组筛选定位配置项，点"编辑"逐项填入实际值（如易支付商户 ID、SMTP 密码等）
 * 3. 也可通过"新增配置"手动添加 CONFIG_META 未覆盖的自定义键
 */

interface SystemConfigView {
  id: string;
  key: string;
  value: string;
  group: string;
  description: string | null;
  encrypted: boolean;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  configs: SystemConfigView[];
}

const GROUP_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部分组" },
  { value: "payment", label: "支付" },
  { value: "storage", label: "对象存储" },
  { value: "email", label: "邮件" },
  { value: "sms", label: "短信" },
  { value: "cdn", label: "CDN" },
  { value: "backup", label: "备份" },
  { value: "general", label: "通用" },
];

const GROUP_LABEL: Record<string, string> = {
  payment: "支付",
  storage: "对象存储",
  email: "邮件",
  sms: "短信",
  cdn: "CDN",
  backup: "备份",
  general: "通用",
};

/** 掩码展示加密配置值 */
function maskValue(value: string, encrypted: boolean): string {
  if (!encrypted) return value;
  if (!value) return "-";
  return "******";
}

export default function ConfigPage() {
  return (
    <AuthGuard allow={["super_admin"]}>
      <ConfigPageInner />
    </AuthGuard>
  );
}

function ConfigPageInner() {
  const { user } = useAuth();
  const toast = useToast();

  const [group, setGroup] = useState("");
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // 编辑弹窗
  const [editTarget, setEditTarget] = useState<SystemConfigView | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState("");

  // 新增配置弹窗
  const [addOpen, setAddOpen] = useState(false);
  const [addKey, setAddKey] = useState("");
  const [addValue, setAddValue] = useState("");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState("");

  // 初始化默认配置（一键创建全部预定义项空值行）
  const [initLoading, setInitLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await get<ListResponse>(user, "/api/admin/config", {
        group: group || undefined,
      });
      setData(result);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载系统配置失败");
      }
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [user, group, toast]);

  useEffect(() => {
    load();
  }, [load]);

  function openEditModal(c: SystemConfigView) {
    setEditTarget(c);
    // 加密配置编辑时清空，避免误传掩码；非加密配置回填原值
    setEditValue(c.encrypted ? "" : c.value);
    setEditError("");
  }

  function openAddModal() {
    setAddKey("");
    setAddValue("");
    setAddError("");
    setAddOpen(true);
  }

  async function onConfirmAdd() {
    if (!user) return;
    if (!addKey) {
      setAddError("请输入配置键（如 epay_pid）");
      return;
    }
    if (!addValue) {
      setAddError("请输入配置值");
      return;
    }
    setAddSubmitting(true);
    try {
      await put(
        user,
        `/api/admin/config/${encodeURIComponent(addKey)}`,
        { value: addValue },
      );
      toast.success("配置已保存");
      setAddOpen(false);
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        setAddError(err.message);
      } else {
        setAddError("保存配置失败");
      }
    } finally {
      setAddSubmitting(false);
    }
  }

  async function onConfirmEdit() {
    if (!user || !editTarget) return;
    if (!editValue) {
      setEditError("请输入配置值");
      return;
    }
    setEditSubmitting(true);
    try {
      await put(
        user,
        `/api/admin/config/${encodeURIComponent(editTarget.key)}`,
        { value: editValue },
      );
      toast.success("配置已更新");
      setEditTarget(null);
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("更新配置失败");
      }
    } finally {
      setEditSubmitting(false);
    }
  }

  /**
   * 初始化默认配置：调用 POST /api/admin/config
   *
   * 一键为全部 7 个分组（payment/storage/email/sms/cdn/backup/general）的
   * 30+ 预定义配置项创建空值行，已存在的不覆盖。创建后超管逐项编辑填值即可。
   */
  async function onInitDefaults() {
    if (!user) return;
    if (
      !window.confirm(
        "将一键创建全部预定义配置项（支付/存储/邮件/短信/CDN/备份/通用共 30+ 项）的空值行，已存在的不会覆盖。是否继续？",
      )
    ) {
      return;
    }
    setInitLoading(true);
    try {
      const result = await post<{ created: number }>(user, "/api/admin/config");
      if (result.created > 0) {
        toast.success(`已初始化 ${result.created} 项配置`);
      } else {
        toast.success("所有配置已存在，无需初始化");
      }
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("初始化配置失败");
      }
    } finally {
      setInitLoading(false);
    }
  }

  const total = data?.configs.length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="系统配置"
        subtitle="按分组管理支付 / 存储 / 邮件等系统配置"
        action={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={initLoading}
              onClick={onInitDefaults}
            >
              初始化默认配置
            </Button>
            <Button size="sm" onClick={openAddModal}>
              新增配置
            </Button>
          </div>
        }
      />

      <Card>
        <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-3">
          <Select
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            className="w-40"
            aria-label="按分组筛选"
          >
            {GROUP_OPTIONS.map((o) => (
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
                <TH>配置键</TH>
                <TH>分组</TH>
                <TH>当前值</TH>
                <TH>加密</TH>
                <TH>说明</TH>
                <TH>更新时间</TH>
                <TH>操作</TH>
              </TR>
            </THead>
            <TBody>
              {data && data.configs.length > 0 ? (
                data.configs.map((c) => (
                  <TR key={c.id}>
                    <TD className="text-foreground font-medium break-all">
                      {c.key}
                    </TD>
                    <TD>
                      <Badge variant="default">
                        {GROUP_LABEL[c.group] ?? c.group}
                      </Badge>
                    </TD>
                    <TD className="text-foreground-muted text-xs break-all max-w-xs">
                      {maskValue(c.value, c.encrypted)}
                    </TD>
                    <TD>
                      <Badge variant={c.encrypted ? "warning" : "default"}>
                        {c.encrypted ? "加密" : "明文"}
                      </Badge>
                    </TD>
                    <TD className="text-foreground-muted text-xs break-all max-w-xs">
                      {c.description || "-"}
                    </TD>
                    <TD className="text-foreground-muted text-xs whitespace-nowrap">
                      {formatDateTime(c.updated_at)}
                    </TD>
                    <TD className="whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => openEditModal(c)}
                      >
                        编辑
                      </Button>
                    </TD>
                  </TR>
                ))
              ) : (
                <EmptyRow colSpan={7} message="暂无配置项" />
              )}
            </TBody>
          </Table>
        )}
      </Card>

      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title="编辑配置"
        description={
          editTarget
            ? `配置键：${editTarget.key}${
                editTarget.description ? ` · ${editTarget.description}` : ""
              }`
            : undefined
        }
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditTarget(null)}
              disabled={editSubmitting}
            >
              取消
            </Button>
            <Button size="sm" loading={editSubmitting} onClick={onConfirmEdit}>
              保存
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {editTarget?.encrypted && (
            <p className="text-xs text-warning">
              该配置为加密存储，请输入完整新值（原值已掩码，不会回填）。
            </p>
          )}
          <Textarea
            id="config-value"
            label="配置值"
            placeholder="请输入配置值"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            error={editError}
            hint="必填，统一以字符串存储"
          />
        </div>
      </Modal>

      {/* 新增配置弹窗 */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="新增配置"
        description="配置彩虹易支付：依次新增 epay_pid / epay_key / epay_api_url 三个键"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAddOpen(false)}
              disabled={addSubmitting}
            >
              取消
            </Button>
            <Button size="sm" loading={addSubmitting} onClick={onConfirmAdd}>
              保存
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            id="config-key"
            label="配置键"
            placeholder="如 epay_pid / epay_key / epay_api_url"
            value={addKey}
            onChange={(e) => setAddKey(e.target.value)}
            error={addError}
            hint="必填，易支付三个键：epay_pid(商户ID) / epay_key(商户密钥,自动加密) / epay_api_url(接口地址)"
          />
          <Textarea
            id="config-add-value"
            label="配置值"
            placeholder="请输入配置值"
            value={addValue}
            onChange={(e) => setAddValue(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}
