"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
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
import { PageHeader, PageLoading, EmptyState } from "@/components/layout/page-header";
import { formatDateTime } from "@/components/common/badges";
import { get, post, put, del, ApiError } from "@/lib/http";

/**
 * 云变量管理 /developer/cloud-variables
 *
 * - GET /api/apps?limit=100 → { apps, total }（先选应用）
 * - GET /api/apps/[appId]/cloud-variables → { variables }
 * - POST /api/apps/[appId]/cloud-variables { key, value, valueType, isPublic } → 变量（upsert）
 * - PUT /api/apps/[appId]/cloud-variables/[key] { value, valueType, isPublic } → 变量
 * - DELETE /api/apps/[appId]/cloud-variables/[key] → { deleted: true }
 *
 * PUT/DELETE 路径含 [key]，用 encodeURIComponent 编码。
 */

interface AppOption {
  id: string;
  name: string;
}

interface AppListResponse {
  apps: AppOption[];
  total: number;
}

interface CloudVariable {
  id: string;
  app_id: string;
  key: string;
  value: string;
  value_type: string;
  signature: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

interface VarsResponse {
  variables: CloudVariable[];
}

const VALUE_TYPE_OPTIONS = [
  { value: "string", label: "字符串" },
  { value: "number", label: "数字" },
  { value: "boolean", label: "布尔" },
  { value: "json", label: "JSON" },
];

const VALUE_TYPE_LABEL: Record<string, string> = {
  string: "字符串",
  number: "数字",
  boolean: "布尔",
  json: "JSON",
};

export default function CloudVariablesPage() {
  return (
    <AuthGuard allow={["developer"]}>
      <CloudVariablesPageInner />
    </AuthGuard>
  );
}

function CloudVariablesPageInner() {
  const { user } = useAuth();
  const toast = useToast();

  const [apps, setApps] = useState<AppOption[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appId, setAppId] = useState<string>("");

  const [variables, setVariables] = useState<CloudVariable[]>([]);
  const [loading, setLoading] = useState(false);

  // 新增/编辑 Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CloudVariable | null>(null);
  const [formKey, setFormKey] = useState("");
  const [formValue, setFormValue] = useState("");
  const [formType, setFormType] = useState("string");
  const [formPublic, setFormPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keyError, setKeyError] = useState<string>();
  const [valueError, setValueError] = useState<string>();

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<CloudVariable | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadApps = useCallback(async () => {
    if (!user) return;
    setAppsLoading(true);
    try {
      const result = await get<AppListResponse>(user, "/api/apps", {
        limit: 100,
      });
      setApps(result.apps);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载应用列表失败");
      }
    } finally {
      setAppsLoading(false);
    }
  }, [user, toast]);

  const loadVars = useCallback(async () => {
    if (!user || !appId) return;
    setLoading(true);
    try {
      const result = await get<VarsResponse>(
        user,
        `/api/apps/${appId}/cloud-variables`,
      );
      setVariables(result.variables ?? []);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载云变量失败");
      }
    } finally {
      setLoading(false);
    }
  }, [user, appId, toast]);

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  useEffect(() => {
    loadVars();
  }, [loadVars]);

  function openCreate() {
    setEditing(null);
    setFormKey("");
    setFormValue("");
    setFormType("string");
    setFormPublic(false);
    setKeyError(undefined);
    setValueError(undefined);
    setModalOpen(true);
  }

  function openEdit(v: CloudVariable) {
    setEditing(v);
    setFormKey(v.key);
    setFormValue(v.value);
    setFormType(v.value_type);
    setFormPublic(v.is_public);
    setKeyError(undefined);
    setValueError(undefined);
    setModalOpen(true);
  }

  function validate(): boolean {
    let ok = true;
    if (!editing) {
      if (!formKey.trim()) {
        setKeyError("请输入变量名");
        ok = false;
      } else {
        setKeyError(undefined);
      }
    }
    if (formType === "json") {
      try {
        JSON.parse(formValue);
        setValueError(undefined);
      } catch {
        setValueError("JSON 类型值必须为合法 JSON");
        ok = false;
      }
    } else if (formType === "boolean") {
      if (formValue !== "true" && formValue !== "false") {
        setValueError("布尔类型值必须为 true 或 false");
        ok = false;
      } else {
        setValueError(undefined);
      }
    } else if (formType === "number") {
      if (formValue === "" || isNaN(Number(formValue))) {
        setValueError("数字类型值必须为合法数字");
        ok = false;
      } else {
        setValueError(undefined);
      }
    }
    return ok;
  }

  async function onSave() {
    if (!user || !appId) return;
    if (!validate()) return;
    setSaving(true);
    try {
      if (editing) {
        await put(
          user,
          `/api/apps/${appId}/cloud-variables/${encodeURIComponent(editing.key)}`,
          {
            value: formValue,
            valueType: formType,
            isPublic: formPublic,
          },
        );
        toast.success("云变量已更新");
      } else {
        await post(user, `/api/apps/${appId}/cloud-variables`, {
          key: formKey.trim(),
          value: formValue,
          valueType: formType,
          isPublic: formPublic,
        });
        toast.success("云变量已新增");
      }
      setModalOpen(false);
      await loadVars();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("保存云变量失败");
      }
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!user || !appId || !deleteTarget) return;
    setDeleting(true);
    try {
      await del(
        user,
        `/api/apps/${appId}/cloud-variables/${encodeURIComponent(deleteTarget.key)}`,
      );
      toast.success("云变量已删除");
      setDeleteTarget(null);
      await loadVars();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("删除云变量失败");
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="云变量管理"
        subtitle="先选择应用，再管理其云变量配置池"
      />

      <Card>
        <CardHeader title="选择应用" description="云变量按应用隔离，每个应用拥有独立的 KV 配置池" />
        <CardBody>
          <div className="flex flex-wrap items-end gap-3">
            <Select
              id="appId"
              label="应用"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              className="w-64"
              hint={appsLoading ? "加载应用中..." : undefined}
            >
              <option value="">请选择应用</option>
              {apps.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
            {appId && (
              <Button size="sm" onClick={openCreate}>
                新增变量
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {!appId ? (
        <EmptyState
          title="请先选择应用"
          description="选择应用后将展示该应用的云变量列表"
        />
      ) : loading ? (
        <PageLoading />
      ) : (
        <Card>
          <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-foreground">
              云变量列表
            </span>
            <span className="text-xs text-foreground-muted">
              共 {variables.length} 条
            </span>
          </div>
          <Table>
            <THead>
              <TR>
                <TH>Key</TH>
                <TH>Value</TH>
                <TH>类型</TH>
                <TH>公开</TH>
                <TH>更新时间</TH>
                <TH className="text-right">操作</TH>
              </TR>
            </THead>
            <TBody>
              {variables.length > 0 ? (
                variables.map((v) => (
                  <TR key={v.id}>
                    <TD className="font-mono text-xs">{v.key}</TD>
                    <TD className="text-xs">
                      <span className="inline-block max-w-[240px] truncate align-bottom">
                        {v.value}
                      </span>
                    </TD>
                    <TD>
                      <Badge variant="default">
                        {VALUE_TYPE_LABEL[v.value_type] ?? v.value_type}
                      </Badge>
                    </TD>
                    <TD>
                      <Badge variant={v.is_public ? "primary" : "default"}>
                        {v.is_public ? "公开" : "私有"}
                      </Badge>
                    </TD>
                    <TD className="text-foreground-muted text-xs whitespace-nowrap">
                      {formatDateTime(v.updated_at)}
                    </TD>
                    <TD className="text-right">
                      <button
                        type="button"
                        className="text-primary text-sm hover:underline mr-3"
                        onClick={() => openEdit(v)}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="text-danger text-sm hover:underline"
                        onClick={() => setDeleteTarget(v)}
                      >
                        删除
                      </button>
                    </TD>
                  </TR>
                ))
              ) : (
                <EmptyRow
                  colSpan={6}
                  message="暂无云变量，点击“新增变量”创建"
                />
              )}
            </TBody>
          </Table>
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "编辑云变量" : "新增云变量"}
        description={
          editing
            ? "修改变量值、类型与可见性，保存后服务端自动重签"
            : "新增变量（已存在同名将覆盖）"
        }
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setModalOpen(false)}
            >
              取消
            </Button>
            <Button size="sm" loading={saving} onClick={onSave}>
              保存
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input
            id="cv-key"
            label="变量名 Key"
            value={formKey}
            onChange={(e) => setFormKey(e.target.value)}
            error={keyError}
            placeholder="如 app_config"
            disabled={!!editing}
            hint={editing ? "已存在变量，Key 不可修改" : "同一应用下 Key 唯一"}
          />

          <Select
            id="cv-type"
            label="值类型"
            value={formType}
            onChange={(e) => setFormType(e.target.value)}
            hint="决定客户端解析方式"
          >
            {VALUE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>

          <Textarea
            id="cv-value"
            label="值 Value"
            value={formValue}
            onChange={(e) => setFormValue(e.target.value)}
            error={valueError}
            placeholder={
              formType === "json"
                ? '{"key":"value"}'
                : formType === "boolean"
                  ? "true 或 false"
                  : formType === "number"
                    ? "123"
                    : "请输入变量值"
            }
            className="min-h-[120px]"
          />

          <label className="inline-flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={formPublic}
              onChange={(e) => setFormPublic(e.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            <span>对客户端可见（公开）</span>
          </label>
        </div>
      </Modal>

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={onDelete}
        title="删除云变量"
        message={
          deleteTarget
            ? `确认删除云变量「${deleteTarget.key}」？此操作不可逆。`
            : ""
        }
        confirmText="确认删除"
        danger
        loading={deleting}
      />
    </div>
  );
}
