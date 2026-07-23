"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  PageHeader,
  PageLoading,
} from "@/components/layout/page-header";
import { get, post, ApiError } from "@/lib/http";

/**
 * 接入中心 /developer/access
 *
 * - GET /api/access/languages → { languages, steps, total }（steps 为接入流程，不硬编码）
 * - POST /api/access/generate-code { language, baseUrl, appKey, withExample } → { language, fileName, code, instructions }
 * - POST /api/access/test-connection { appKey } → { success, appKey, appName, cryptoMode, version, message }
 *
 * 注意（铁律 04）：baseUrl 不硬编码默认值，留空由用户填写。
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

interface LanguagesResponse {
  languages: SdkLanguageInfo[];
  steps: AccessStep[];
  total: number;
}

interface CodeGenResult {
  language: string;
  fileName: string;
  code: string;
  instructions: string;
}

interface TestConnectionResult {
  success: boolean;
  appKey: string;
  appName: string;
  cryptoMode: string;
  version: string;
  message: string;
}

export default function AccessCenterPage() {
  const { user } = useAuth();
  const toast = useToast();

  const [languages, setLanguages] = useState<SdkLanguageInfo[]>([]);
  const [steps, setSteps] = useState<AccessStep[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedLang, setSelectedLang] = useState<string>("");

  // 代码生成表单
  const [baseUrl, setBaseUrl] = useState("");
  const [appKey, setAppKey] = useState("");
  const [withExample, setWithExample] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [codeResult, setCodeResult] = useState<CodeGenResult | null>(null);
  const [copied, setCopied] = useState(false);

  // 测试连接
  const [testAppKey, setTestAppKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(
    null,
  );

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await get<LanguagesResponse>(user, "/api/access/languages");
      setLanguages(result.languages ?? []);
      setSteps(result.steps ?? []);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载接入中心数据失败");
      }
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const mainstream = languages.filter((l) => l.isMainstream);
  const community = languages.filter((l) => !l.isMainstream);

  async function onGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!selectedLang) {
      toast.warning("请先选择接入语言");
      return;
    }
    if (!baseUrl.trim()) {
      toast.warning("请填写服务端 baseUrl");
      return;
    }
    if (!appKey.trim()) {
      toast.warning("请填写 AppKey");
      return;
    }

    setGenerating(true);
    setCopied(false);
    try {
      const result = await post<CodeGenResult>(user, "/api/access/generate-code", {
        language: selectedLang,
        baseUrl: baseUrl.trim(),
        appKey: appKey.trim(),
        withExample,
      });
      setCodeResult(result);
      toast.success("代码已生成");
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("生成代码失败");
      }
    } finally {
      setGenerating(false);
    }
  }

  async function onCopy() {
    if (!codeResult?.code) return;
    try {
      await navigator.clipboard.writeText(codeResult.code);
      setCopied(true);
      toast.success("已复制到剪贴板");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.danger("复制失败，请手动选择代码复制");
    }
  }

  async function onTestConnection(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!testAppKey.trim()) {
      toast.warning("请填写 AppKey");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await post<TestConnectionResult>(
        user,
        "/api/access/test-connection",
        { appKey: testAppKey.trim() },
      );
      setTestResult(result);
      if (result.success) {
        toast.success("连接测试通过");
      } else {
        toast.warning(result.message || "连接测试未通过");
      }
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("测试连接失败");
      }
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <PageLoading />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="接入中心"
        subtitle="按接入向导完成 SDK 集成：选择语言、生成代码、测试连接"
      />

      {/* 接入流程向导 */}
      {steps.length > 0 && (
        <Card>
          <CardHeader title="接入流程" description="按以下步骤完成客户端接入" />
          <CardBody>
            <ol className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {steps.map((s) => (
                <li
                  key={s.step}
                  className="flex gap-3 rounded-md border border-border bg-background-subtle/40 p-3"
                >
                  <span className="inline-flex items-center justify-center w-7 h-7 shrink-0 rounded-full bg-primary text-white text-sm font-semibold">
                    {s.step}
                  </span>
                  <div className="flex flex-col gap-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {s.title}
                    </p>
                    <p className="text-xs text-foreground-muted leading-5">
                      {s.description}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      )}

      {/* 语言选择 */}
      <Card>
        <CardHeader
          title="选择接入语言"
          description="主流 SDK 为平台自维护，社区示例由社区贡献"
        />
        <CardBody>
          <LanguageGroup
            title="主流 SDK"
            items={mainstream}
            selected={selectedLang}
            onSelect={setSelectedLang}
          />
          <div className="mt-5">
            <LanguageGroup
              title="社区示例"
              items={community}
              selected={selectedLang}
              onSelect={setSelectedLang}
            />
          </div>
        </CardBody>
      </Card>

      {/* 代码生成 */}
      <Card>
        <CardHeader
          title="生成接入代码"
          description={
            selectedLang
              ? `当前语言：${languages.find((l) => l.code === selectedLang)?.name ?? selectedLang}`
              : "请先在上方选择接入语言"
          }
          action={
            codeResult ? (
              <Button size="sm" variant="secondary" onClick={onCopy}>
                {copied ? "已复制" : "复制代码"}
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          <form
            className="flex flex-col gap-4"
            onSubmit={onGenerate}
          >
            <Input
              id="baseUrl"
              label="服务端 baseUrl"
              placeholder="如 https://api.example.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              hint="请填写实际部署的服务端地址"
              required
            />
            <Input
              id="appKey"
              label="AppKey"
              placeholder="应用的 AppKey"
              value={appKey}
              onChange={(e) => setAppKey(e.target.value)}
              hint="在「应用管理」中创建应用后获取"
              required
            />
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={withExample}
                onChange={(e) => setWithExample(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              附带完整示例（心跳保活 / 检查更新）
            </label>
            <div className="flex items-center justify-end">
              <Button
                type="submit"
                loading={generating}
                disabled={!selectedLang}
              >
                生成代码
              </Button>
            </div>
          </form>

          {codeResult && (
            <div className="mt-5 flex flex-col gap-4">
              <div>
                <p className="text-xs font-medium text-foreground-muted mb-2">
                  使用说明
                </p>
                <pre className="rounded-md bg-background-subtle p-4 text-xs text-foreground whitespace-pre-wrap break-words">
                  {codeResult.instructions}
                </pre>
              </div>
              <div>
                <p className="text-xs font-medium text-foreground-muted mb-2">
                  代码片段（{codeResult.fileName}）
                </p>
                <pre className="rounded-md bg-foreground/5 p-4 text-xs text-foreground overflow-x-auto whitespace-pre">
                  {codeResult.code}
                </pre>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* 测试连接 */}
      <Card>
        <CardHeader
          title="测试连接"
          description="校验 AppKey 是否可用、应用是否正常"
        />
        <CardBody>
          <form
            className="flex flex-col gap-4"
            onSubmit={onTestConnection}
          >
            <Input
              id="testAppKey"
              label="AppKey"
              placeholder="应用的 AppKey"
              value={testAppKey}
              onChange={(e) => setTestAppKey(e.target.value)}
              required
            />
            <div className="flex items-center justify-end">
              <Button type="submit" loading={testing}>
                测试连接
              </Button>
            </div>
          </form>

          {testResult && (
            <div
              className={`mt-5 rounded-md border p-4 ${
                testResult.success
                  ? "bg-emerald-50 border-emerald-200"
                  : "bg-danger-subtle border-red-200"
              }`}
            >
              <div className="flex items-center gap-2">
                <Badge variant={testResult.success ? "success" : "danger"}>
                  {testResult.success ? "连接正常" : "连接异常"}
                </Badge>
                <span className="text-sm font-medium text-foreground">
                  {testResult.message}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-xs">
                {testResult.appName && (
                  <div className="flex gap-2">
                    <dt className="text-foreground-muted">应用名称</dt>
                    <dd className="text-foreground">{testResult.appName}</dd>
                  </div>
                )}
                {testResult.cryptoMode && (
                  <div className="flex gap-2">
                    <dt className="text-foreground-muted">加密模式</dt>
                    <dd className="text-foreground">{testResult.cryptoMode}</dd>
                  </div>
                )}
                {testResult.version && (
                  <div className="flex gap-2">
                    <dt className="text-foreground-muted">应用版本</dt>
                    <dd className="text-foreground">{testResult.version}</dd>
                  </div>
                )}
                <div className="flex gap-2">
                  <dt className="text-foreground-muted">AppKey</dt>
                  <dd className="text-foreground font-mono break-all">
                    {testResult.appKey}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

/** 语言分组卡片网格 */
function LanguageGroup({
  title,
  items,
  selected,
  onSelect,
}: {
  title: string;
  items: SdkLanguageInfo[];
  selected: string;
  onSelect: (code: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-foreground-muted mb-2">{title}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((lang) => {
          const active = selected === lang.code;
          return (
            <button
              key={lang.code}
              type="button"
              onClick={() => onSelect(lang.code)}
              className={`text-left rounded-md border p-3 transition-colors ${
                active
                  ? "border-primary bg-primary-subtle"
                  : "border-border bg-white hover:bg-background-subtle/50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">
                  {lang.name}
                </span>
                <span className="text-xs text-foreground-muted">
                  {lang.version}
                </span>
              </div>
              <p className="mt-1 text-xs text-foreground-muted leading-5">
                {lang.description}
              </p>
              <p className="mt-1.5 text-xs text-foreground-muted font-mono break-all">
                {lang.installCmd}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
