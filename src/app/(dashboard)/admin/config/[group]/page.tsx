"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader, PageLoading } from "@/components/layout/page-header";
import { get, put, ApiError } from "@/lib/http";

/**
 * 分组独立配置页 /admin/config/[group]
 *
 * 像创建应用那样，以表单形式编辑单个分组的全部配置项。
 * - GET /api/admin/config?group=xxx → 加载该分组配置
 * - PUT /api/admin/config/[key] { value } → 逐项保存已修改的配置
 *
 * 加密配置（encrypted=true）：表单中显示掩码占位，编辑时清空，
 * 保存时提交新值（后端自动 AES-256-CBC 加密存储）。
 * 非加密配置：回填原值，直接编辑。
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

/** 合法分组（与 config-service.ts CONFIG_GROUPS 一致） */
const VALID_GROUPS: Record<string, { label: string; desc: string }> = {
  payment: { label: "支付配置", desc: "彩虹易支付商户 ID / 密钥 / 接口地址" },
  storage: { label: "对象存储配置", desc: "阿里云 OSS / 腾讯云 COS / 七牛云 Kodo" },
  email: { label: "邮件配置", desc: "SMTP 服务器 / 账号 / 密码 / 发件人" },
  sms: { label: "短信配置", desc: "阿里云 / 腾讯云短信服务" },
  cdn: { label: "CDN 配置", desc: "CDN 加速域名与鉴权密钥" },
  backup: { label: "备份配置", desc: "数据库备份周期 / 保留天数 / 存储位置" },
  general: { label: "通用配置", desc: "站点名称 / 地址 / 备案号 / 联系邮箱" },
};

export default function GroupConfigPage() {
  return (
    <AuthGuard allow={["super_admin"]}>
      <GroupConfigPageInner />
    </AuthGuard>
  );
}

function GroupConfigPageInner() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const params = useParams();
  const group = String(params?.group ?? "");

  const groupInfo = VALID_GROUPS[group];

  const [configs, setConfigs] = useState<SystemConfigView[]>([]);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user || !groupInfo) return;
    setLoading(true);
    try {
      const result = await get<ListResponse>(user, "/api/admin/config", {
        group,
      });
      setConfigs(result.configs);
      // 初始化表单值：加密配置清空（避免误传掩码），非加密回填原值
      const initial: Record<string, string> = {};
      for (const c of result.configs) {
        initial[c.key] = c.encrypted ? "" : c.value;
      }
      setFormValues(initial);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载配置失败");
      }
    } finally {
      setLoading(false);
    }
  }, [user, group, groupInfo, toast]);

  useEffect(() => {
    load();
  }, [load]);

  /** 判断某配置项是否被修改（与原始值对比） */
  function isDirty(c: SystemConfigView): boolean {
    const current = formValues[c.key] ?? "";
    if (c.encrypted) {
      // 加密配置：只要用户输入了非空值就算修改
      return current !== "";
    }
    return current !== c.value;
  }

  /** 获取已修改的配置项列表 */
  function getDirtyConfigs(): SystemConfigView[] {
    return configs.filter(isDirty);
  }

  async function onSave() {
    if (!user) return;
    const dirty = getDirtyConfigs();
    if (dirty.length === 0) {
      toast.danger("没有修改的配置项");
      return;
    }
    setSaving(true);
    let success = 0;
    let failed = 0;
    for (const c of dirty) {
      try {
        await put(
          user,
          `/api/admin/config/${encodeURIComponent(c.key)}`,
          { value: formValues[c.key] ?? "" },
        );
        success++;
      } catch {
        failed++;
      }
    }
    setSaving(false);
    if (failed === 0) {
      toast.success(`已保存 ${success} 项配置`);
    } else if (success === 0) {
      toast.danger(`保存失败（${failed} 项）`);
    } else {
      toast.danger(`部分保存成功：成功 ${success} 项，失败 ${failed} 项`);
    }
    if (success > 0) {
      await load();
    }
  }

  /** 重置表单到原始值 */
  function onReset() {
    const initial: Record<string, string> = {};
    for (const c of configs) {
      initial[c.key] = c.encrypted ? "" : c.value;
    }
    setFormValues(initial);
    toast.success("已重置未保存的修改");
  }

  // 分组不合法
  if (!groupInfo) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="配置不存在" subtitle={`分组 "${group}" 不合法`} />
        <Card>
          <div className="p-8 text-center">
            <p className="text-foreground-muted mb-4">
              合法的分组：支付 / 对象存储 / 邮件 / 短信 / CDN / 备份 / 通用
            </p>
            <Button onClick={() => router.push("/admin/config")}>
              返回配置中心
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const dirtyCount = getDirtyConfigs().length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={groupInfo.label}
        subtitle={groupInfo.desc}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push("/admin/config")}
          >
            返回配置中心
          </Button>
        }
      />

      {loading ? (
        <PageLoading />
      ) : configs.length === 0 ? (
        <Card>
          <div className="p-8 text-center">
            <p className="text-foreground-muted mb-4">
              该分组暂无配置项，点击下方按钮初始化默认配置
            </p>
            <Button onClick={() => router.push("/admin/config")}>
              返回初始化
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={`${groupInfo.label}（共 ${configs.length} 项）`}
            description="修改下方配置项后点击保存。加密配置（如密钥/密码）不会回显原值，输入新值保存即可。"
          />
          <CardBody>
            <form
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                onSave();
              }}
            >
              {configs.map((c) => {
                const isEncrypted = c.encrypted;
                const dirty = isDirty(c);
                // 长值（如 RSA 密钥、端点地址）用 Textarea，短值用 Input
                const isLongValue =
                  c.key.includes("secret") ||
                  c.key.includes("pass") ||
                  c.key.includes("key") ||
                  c.key.includes("endpoint") ||
                  c.key.includes("url") ||
                  c.key.includes("domain") ||
                  c.key.includes("path");
                const fieldValue = formValues[c.key] ?? "";
                const placeholder = isEncrypted
                  ? c.value
                    ? "******（已加密存储，输入新值覆盖）"
                    : "请输入（将加密存储）"
                  : "请输入配置值";
                return (
                  <div key={c.key} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <label
                        className="text-sm font-medium text-foreground"
                        htmlFor={`cfg-${c.key}`}
                      >
                        {c.description || c.key}
                      </label>
                      {isEncrypted && (
                        <Badge variant="warning">加密</Badge>
                      )}
                      {dirty && (
                        <Badge variant="info">已修改</Badge>
                      )}
                    </div>
                    {isLongValue ? (
                      <Textarea
                        id={`cfg-${c.key}`}
                        placeholder={placeholder}
                        value={fieldValue}
                        onChange={(e) =>
                          setFormValues((prev) => ({
                            ...prev,
                            [c.key]: e.target.value,
                          }))
                        }
                        className="font-mono text-xs"
                      />
                    ) : (
                      <Input
                        id={`cfg-${c.key}`}
                        placeholder={placeholder}
                        value={fieldValue}
                        onChange={(e) =>
                          setFormValues((prev) => ({
                            ...prev,
                            [c.key]: e.target.value,
                          }))
                        }
                      />
                    )}
                    <p className="text-xs text-foreground-muted">
                      配置键：<code className="font-mono">{c.key}</code>
                    </p>
                  </div>
                );
              })}

              <div className="flex items-center justify-between gap-2 pt-4 border-t border-border">
                <span className="text-xs text-foreground-muted">
                  {dirtyCount > 0
                    ? `${dirtyCount} 项已修改`
                    : "无修改"}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={onReset}
                    disabled={saving || dirtyCount === 0}
                  >
                    重置
                  </Button>
                  <Button
                    type="submit"
                    loading={saving}
                    disabled={dirtyCount === 0}
                  >
                    保存{dirtyCount > 0 ? `（${dirtyCount} 项）` : ""}
                  </Button>
                </div>
              </div>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
