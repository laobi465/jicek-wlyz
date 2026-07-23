"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { PageHeader, PageLoading } from "@/components/layout/page-header";
import { get, post, put, ApiError } from "@/lib/http";

/**
 * 系统配置中心 /admin/config
 *
 * 入口页：7 个分组卡片导航，点击进入各分组独立配置页（表单式编辑）。
 * - GET /api/admin/config → 全部配置（按分组统计数量显示在卡片上）
 * - POST /api/admin/config → 初始化默认配置（手动触发，v1.7.1 已自动补建）
 * - PUT /api/admin/config/[key] → 新增自定义配置
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

/** 7 个配置分组定义（与 config-service.ts CONFIG_GROUPS 一致） */
const GROUPS = [
  { code: "payment", label: "支付", desc: "彩虹易支付商户 ID / 密钥 / 接口地址", icon: "💳" },
  { code: "storage", label: "对象存储", desc: "阿里云 OSS / 腾讯云 COS / 七牛云 Kodo", icon: "📦" },
  { code: "email", label: "邮件", desc: "SMTP 服务器 / 账号 / 密码 / 发件人", icon: "✉️" },
  { code: "sms", label: "短信", desc: "阿里云 / 腾讯云短信服务配置", icon: "📱" },
  { code: "cdn", label: "CDN", desc: "CDN 加速域名与鉴权密钥", icon: "🚀" },
  { code: "backup", label: "备份", desc: "数据库备份周期 / 保留天数 / 存储位置", icon: "💾" },
  { code: "general", label: "通用", desc: "站点名称 / 地址 / 备案号 / 联系邮箱", icon: "⚙️" },
];

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

  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // 初始化默认配置
  const [initLoading, setInitLoading] = useState(false);

  // 新增自定义配置弹窗
  const [addOpen, setAddOpen] = useState(false);
  const [addKey, setAddKey] = useState("");
  const [addValue, setAddValue] = useState("");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await get<ListResponse>(user, "/api/admin/config");
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
  }, [user, toast]);

  useEffect(() => {
    load();
  }, [load]);

  /** 统计某分组的配置项数量 */
  function countByGroup(group: string): number {
    return data?.configs.filter((c) => c.group === group).length ?? 0;
  }

  /** 统计某分组已填值的配置项数量 */
  function countFilled(group: string): number {
    return (
      data?.configs.filter((c) => c.group === group && c.value).length ?? 0
    );
  }

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

  function openAddModal() {
    setAddKey("");
    setAddValue("");
    setAddError("");
    setAddOpen(true);
  }

  async function onConfirmAdd() {
    if (!user) return;
    if (!addKey) {
      setAddError("请输入配置键");
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

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="系统配置"
        subtitle="点击各分组进入独立配置页面，表单式编辑"
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

      {loading ? (
        <PageLoading />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {GROUPS.map((g) => {
            const total = countByGroup(g.code);
            const filled = countFilled(g.code);
            return (
              <Link key={g.code} href={`/admin/config/${g.code}`}>
                <Card className="hover:border-primary hover:shadow-md transition-all cursor-pointer h-full">
                  <div className="p-5 flex flex-col gap-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{g.icon}</span>
                        <div>
                          <h3 className="text-base font-semibold text-foreground">
                            {g.label}
                          </h3>
                          <p className="text-xs text-foreground-muted mt-0.5">
                            {g.desc}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="default">{total} 项配置</Badge>
                      {filled > 0 && (
                        <Badge variant="success">已配置 {filled}</Badge>
                      )}
                      {total > 0 && filled === 0 && (
                        <Badge variant="warning">未配置</Badge>
                      )}
                    </div>
                    <div className="text-xs text-primary font-medium">
                      点击配置 →
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* 新增自定义配置弹窗 */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="新增配置"
        description="添加 CONFIG_META 未覆盖的自定义配置键"
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
            placeholder="如 custom_setting_key"
            value={addKey}
            onChange={(e) => setAddKey(e.target.value)}
            error={addError}
            hint="必填，自定义键将归入 general 分组"
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
