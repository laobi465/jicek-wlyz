"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/page-header";
import { post, ApiError } from "@/lib/http";

/**
 * 创建应用 /developer/apps/new
 *
 * - POST /api/apps { name, description } → { app, clientSecret, privateKey, configSignature }
 * - clientSecret / privateKey 仅在创建时返回一次，必须提示用户保存
 */

interface App {
  id: string;
  app_key: string;
  name: string;
}

interface CreateAppResponse {
  app: App;
  clientSecret: string;
  privateKey: string;
  configSignature: string;
}

const MAX_NAME = 50;
const MAX_DESC = 200;

export default function NewAppPage() {
  return (
    <AuthGuard allow={["developer"]}>
      <NewAppPageInner />
    </AuthGuard>
  );
}

function NewAppPageInner() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string>();
  const [descError, setDescError] = useState<string>();
  const [created, setCreated] = useState<CreateAppResponse | null>(null);

  function validate(): boolean {
    let ok = true;
    if (!name.trim()) {
      setNameError("请输入应用名称");
      ok = false;
    } else if (name.length > MAX_NAME) {
      setNameError(`名称不超过 ${MAX_NAME} 字符`);
      ok = false;
    } else {
      setNameError(undefined);
    }

    if (description.length > MAX_DESC) {
      setDescError(`描述不超过 ${MAX_DESC} 字符`);
      ok = false;
    } else {
      setDescError(undefined);
    }
    return ok;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!validate()) return;

    setSubmitting(true);
    try {
      const result = await post<CreateAppResponse>(user, "/api/apps", {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setCreated(result);
      toast.success("应用创建成功，请立即保存密钥");
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("创建应用失败");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label}已复制`);
    } catch {
      toast.danger("复制失败，请手动选择复制");
    }
  }

  // 创建成功：展示一次性密钥
  if (created) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title="应用创建成功"
          subtitle="以下密钥仅显示一次，请立即复制保存，关闭后无法再次获取"
        />

        <Card>
          <CardHeader
            title="应用密钥（仅此一次）"
            description={`应用 ${created.app.name} 的 AppKey / client_secret / RSA 私钥 / 配置签名`}
          />
          <CardBody>
            <div className="flex flex-col gap-4">
              <SecretField
                label="AppKey"
                value={created.app.app_key}
                onCopy={() => copyText(created.app.app_key, "AppKey")}
              />
              <SecretField
                label="Client Secret"
                value={created.clientSecret}
                onCopy={() => copyText(created.clientSecret, "Client Secret")}
              />
              <SecretField
                label="RSA 私钥"
                value={created.privateKey}
                onCopy={() => copyText(created.privateKey, "RSA 私钥")}
                multiline
              />
              <SecretField
                label="配置签名"
                value={created.configSignature}
                onCopy={() =>
                  copyText(created.configSignature, "配置签名")
                }
              />
            </div>
          </CardBody>
        </Card>

        <div className="flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => router.push("/developer/apps")}
          >
            返回列表
          </Button>
          <Button onClick={() => router.push(`/developer/apps/${created.app.id}`)}>
            查看应用详情
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="创建应用"
        subtitle="创建后将自动生成 AppKey、client_secret 与 RSA 密钥对"
      />

      <Card>
        <CardHeader
          title="应用信息"
          description="名称 1-50 字符，描述 0-200 字符"
        />
        <CardBody>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <Input
              id="name"
              label="应用名称"
              placeholder="请输入应用名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={nameError}
              hint={`已输入 ${name.length} / ${MAX_NAME} 字符`}
              maxLength={MAX_NAME}
              required
            />

            <Textarea
              id="description"
              label="应用描述"
              placeholder="选填，简要描述应用用途"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              error={descError}
              hint={`已输入 ${description.length} / ${MAX_DESC} 字符`}
              maxLength={MAX_DESC}
              className="min-h-[120px]"
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.push("/developer/apps")}
                disabled={submitting}
              >
                取消
              </Button>
              <Button type="submit" loading={submitting}>
                创建
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

function SecretField({
  label,
  value,
  onCopy,
  multiline = false,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  multiline?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">{label}</label>
        <Button type="button" variant="secondary" size="sm" onClick={onCopy}>
          复制
        </Button>
      </div>
      <div
        className={`rounded-md border border-border bg-background-subtle px-3 py-2 text-xs font-mono text-foreground break-all ${
          multiline ? "max-h-40 overflow-y-auto whitespace-pre-wrap" : "truncate"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
