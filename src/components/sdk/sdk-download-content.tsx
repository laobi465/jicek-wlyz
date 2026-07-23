"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/http";

/**
 * SDK 下载与对接教程（共享内容组件）
 *
 * 被 /developer/sdk 和 /admin/sdk 两个页面复用。
 * 调用 GET /api/sdk/info 获取语言列表 + 仓库下载地址。
 */

interface SdkLanguageInfo {
  code: string;
  name: string;
  version: string;
  filePath: string;
  description: string;
  installCmd: string;
  isMainstream: boolean;
}

interface AccessStep {
  step: number;
  title: string;
  description: string;
}

interface SdkInfoResponse {
  languages: SdkLanguageInfo[];
  steps: AccessStep[];
  total: number;
  repoUrl: string;
  repoBranch: string;
  downloadBase: string;
}

/** 6 个核心 API 方法（协议要点） */
const API_METHODS = [
  { method: "verify_rsa", path: "/api/v1/verify_rsa", desc: "协商 ECDHE 会话密钥（启动时调用一次）", encrypted: "明文" },
  { method: "auth", path: "/api/v1/auth", desc: "验证卡密 + 激活设备", encrypted: "RSA签名+AES" },
  { method: "heartbeat", path: "/api/v1/heartbeat", desc: "心跳保活（每 60s）", encrypted: "RSA签名+AES" },
  { method: "check_update", path: "/api/v1/check_update", desc: "拉取云变量/公告/版本更新", encrypted: "Base64" },
  { method: "use", path: "/api/v1/use", desc: "次数卡扣减 1 次", encrypted: "RSA签名+AES" },
  { method: "unbind", path: "/api/v1/unbind", desc: "解绑设备", encrypted: "RSA签名+AES" },
];

/** Python 接入代码示例 */
const PYTHON_EXAMPLE = `from jicek_wlyz import WlyzClient

# 1. 初始化（填入你的 AppKey + 服务器地址 + RSA 私钥）
client = WlyzClient(
    app_key="ak_xxxxxxxxxxxx",
    base_url="https://your-domain.com",
    client_private_key="-----BEGIN RSA PRIVATE KEY-----\\n...",
)

# 2. 协商会话密钥（每次启动调用一次）
client.verify_rsa()

# 3. 用户输入卡密码 → 验证激活
result = client.auth(
    card_code="ABCD-EFGH-JKLM-XXXX",
    machine_code=client.get_machine_code(),
    device_name="我的电脑",
)
# → {device_id, token, expires_at, heartbeat_interval}

# 4. 心跳保活（按 heartbeat_interval 周期调用，默认 60s）
client.heartbeat(device_id=result["device_id"],
                 machine_code=client.get_machine_code())

# 5. 拉取云变量 / 公告 / 版本更新
update = client.check_update()
# → {version, announcement, force_update, cloud_variables}

# 6. 次数卡扣减（仅 count 类型）
client.use(device_id=result["device_id"],
           card_code="ABCD-EFGH-JKLM-XXXX")

# 7. 解绑设备（可选）
client.unbind(device_id=result["device_id"])`;

export function SdkDownloadContent() {
  const toast = useToast();
  const [info, setInfo] = useState<SdkInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/sdk/info");
        const body = await res.json();
        if (body.code === 0 && body.data) {
          setInfo(body.data);
        } else {
          toast.danger(body.msg || "加载 SDK 信息失败");
        }
      } catch {
        toast.danger("加载 SDK 信息失败");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [toast]);

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("下载链接已复制");
    } catch {
      toast.danger("复制失败，请手动复制");
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("代码已复制");
    } catch {
      toast.danger("复制失败，请手动复制");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-foreground-muted">加载中...</p>
      </div>
    );
  }

  if (!info) {
    return (
      <Card>
        <div className="p-8 text-center text-foreground-muted">
          SDK 信息加载失败，请刷新重试
        </div>
      </Card>
    );
  }

  const mainstream = info.languages.filter((l) => l.isMainstream);
  const community = info.languages.filter((l) => !l.isMainstream);

  return (
    <div className="flex flex-col gap-5">
      {/* 主流 SDK 下载 */}
      <Card>
        <CardHeader
          title="主流 SDK（平台自维护）"
          description={`${mainstream.length} 种主流编程语言 SDK，点击下载或复制链接`}
        />
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {mainstream.map((sdk) => {
              const downloadUrl = `${info.downloadBase}/${sdk.filePath}`;
              return (
                <div
                  key={sdk.code}
                  className="rounded-lg border border-border p-4 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        {sdk.name}
                      </h3>
                      <p className="text-xs text-foreground-muted">
                        {sdk.version}
                      </p>
                    </div>
                    <Badge variant="primary">主流</Badge>
                  </div>
                  <p className="text-xs text-foreground-muted">
                    {sdk.description}
                  </p>
                  <div className="rounded bg-background-subtle px-2 py-1 text-xs font-mono text-foreground-muted">
                    {sdk.installCmd}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
                      <Button size="sm">下载</Button>
                    </a>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => copyLink(downloadUrl)}
                    >
                      复制链接
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* 社区示例 */}
      <Card>
        <CardHeader
          title="社区示例"
          description={`${community.length} 种社区贡献的接入示例`}
        />
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {community.map((sdk) => {
              const downloadUrl = `${info.downloadBase}/${sdk.filePath}`;
              return (
                <div
                  key={sdk.code}
                  className="rounded-lg border border-border p-4 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">
                      {sdk.name}
                    </h3>
                    <Badge variant="default">社区</Badge>
                  </div>
                  <p className="text-xs text-foreground-muted">
                    {sdk.description}
                  </p>
                  <div className="rounded bg-background-subtle px-2 py-1 text-xs font-mono text-foreground-muted">
                    {sdk.installCmd}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
                      <Button size="sm" variant="secondary">
                        下载
                      </Button>
                    </a>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => copyLink(downloadUrl)}
                    >
                      复制链接
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* 对接流程 */}
      <Card>
        <CardHeader
          title="对接流程（6 步）"
          description="从创建应用到上线运行的完整流程"
        />
        <CardBody>
          <ol className="flex flex-col gap-3">
            {info.steps.map((s) => (
              <li
                key={s.step}
                className="flex items-start gap-3 rounded-lg border border-border p-3"
              >
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-primary text-white text-xs font-semibold flex items-center justify-center">
                  {s.step}
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {s.title}
                  </p>
                  <p className="text-xs text-foreground-muted mt-0.5">
                    {s.description}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>

      {/* API 协议 */}
      <Card>
        <CardHeader
          title="API 协议"
          description="6 个核心 API 方法，所有 SDK 接口一致"
        />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 font-medium text-foreground">
                    方法
                  </th>
                  <th className="text-left py-2 px-3 font-medium text-foreground">
                    路径
                  </th>
                  <th className="text-left py-2 px-3 font-medium text-foreground">
                    功能
                  </th>
                  <th className="text-left py-2 px-3 font-medium text-foreground">
                    加密
                  </th>
                </tr>
              </thead>
              <tbody>
                {API_METHODS.map((m) => (
                  <tr key={m.method} className="border-b border-border/50">
                    <td className="py-2 px-3 font-mono text-primary text-xs">
                      {m.method}()
                    </td>
                    <td className="py-2 px-3 font-mono text-foreground-muted text-xs">
                      {m.path}
                    </td>
                    <td className="py-2 px-3 text-foreground-muted text-xs">
                      {m.desc}
                    </td>
                    <td className="py-2 px-3">
                      <Badge variant={m.encrypted.includes("AES") ? "warning" : "default"}>
                        {m.encrypted}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-xs text-foreground-muted">
            统一响应体：<code className="font-mono">{"{ code, msg, data, ts, nonce }"}</code>
            ，code=0 成功，详见
            <a
              href={`${info.downloadBase}/docs/api/protocol.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary ml-1 hover:underline"
            >
              协议文档
            </a>
          </div>
        </CardBody>
      </Card>

      {/* Python 接入示例 */}
      <Card>
        <CardHeader
          title="Python 接入示例"
          description="完整调用流程：协商密钥 → 验证卡密 → 心跳 → 拉取云变量"
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => copyCode(PYTHON_EXAMPLE)}
            >
              复制代码
            </Button>
          }
        />
        <CardBody>
          <pre className="rounded-lg bg-foreground/5 p-4 overflow-x-auto text-xs font-mono text-foreground leading-relaxed">
            <code>{PYTHON_EXAMPLE}</code>
          </pre>
        </CardBody>
      </Card>
    </div>
  );
}
