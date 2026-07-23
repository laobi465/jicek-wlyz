"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/page-header";
import { request, get, ApiError } from "@/lib/http";

/**
 * APK 上传注入 /developer/apk-injection/upload
 *
 * - GET /api/apps → { apps, total }（用于关联应用下拉）
 * - POST /api/apk-injection/upload（multipart/form-data）
 *
 * 后端实际字段契约（apk-injection/upload/route.ts）：
 * - file: APK 文件（必填，≤500MB）
 * - appKey: 应用 AppKey（必填）
 * - serverUrl: 服务端 URL（必填）
 * - appId?: 关联应用 ID（选填）
 * - enableAntiDebug / enableFullIntegrityCheck / enableAntiEmulator: 注入开关（布尔字符串）
 *
 * 提交成功跳转至 /developer/apk-injection/[taskId]
 */

interface AppItem {
  id: string;
  name: string;
  app_key: string;
  status: string;
}

interface AppsResponse {
  apps: AppItem[];
  total: number;
}

interface UploadResponse {
  taskId: string;
  jobId: string;
  status: string;
}

/** APK 文件大小上限（SPEC §2.6.4 第 16 项，与后端 MAX_APK_SIZE 一致） */
const MAX_APK_SIZE_MB = 500;

export default function ApkInjectionUploadPage() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();

  const [apps, setApps] = useState<AppItem[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [appId, setAppId] = useState("");
  const [appKey, setAppKey] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [antiDebug, setAntiDebug] = useState(true);
  const [integrityCheck, setIntegrityCheck] = useState(true);
  const [emulatorDetect, setEmulatorDetect] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [appKeyError, setAppKeyError] = useState<string>();
  const [serverUrlError, setServerUrlError] = useState<string>();

  const loadApps = useCallback(async () => {
    if (!user) return;
    try {
      const result = await get<AppsResponse>(user, "/api/apps", {
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

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  function onAppChange(value: string) {
    setAppId(value);
    const selected = apps.find((a) => a.id === value);
    if (selected) {
      setAppKey(selected.app_key);
    }
  }

  const overSize = file
    ? file.size > MAX_APK_SIZE_MB * 1024 * 1024
    : false;

  function validate(): boolean {
    let ok = true;
    if (!appKey.trim()) {
      setAppKeyError("请输入 AppKey");
      ok = false;
    } else {
      setAppKeyError(undefined);
    }
    if (!serverUrl.trim()) {
      setServerUrlError("请输入服务端 URL");
      ok = false;
    } else {
      setServerUrlError(undefined);
    }
    return ok;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!file) {
      toast.warning("请选择 APK 文件");
      return;
    }
    if (!validate()) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("appKey", appKey.trim());
    formData.append("serverUrl", serverUrl.trim());
    if (appId) formData.append("appId", appId);
    formData.append("enableAntiDebug", String(antiDebug));
    formData.append("enableFullIntegrityCheck", String(integrityCheck));
    formData.append("enableAntiEmulator", String(emulatorDetect));

    setSubmitting(true);
    try {
      // 文件上传用 request 直接传 FormData（不设 Content-Type，浏览器自动设 boundary）
      const result = await request<UploadResponse>(
        user,
        "/api/apk-injection/upload",
        {
          method: "POST",
          body: formData,
        },
      );
      toast.success("注入任务已创建");
      router.push(`/developer/apk-injection/${result.taskId}`);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("上传注入失败");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="上传注入"
        subtitle="选择 APK 文件并配置注入参数，提交后异步处理"
      />

      <Card>
        <CardHeader
          title="注入信息"
          description={`APK 文件大小上限 ${MAX_APK_SIZE_MB}MB，支持 .apk 格式`}
        />
        <CardBody>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="file"
                className="text-sm font-medium text-foreground"
              >
                APK 文件
              </label>
              <input
                id="file"
                type="file"
                accept=".apk"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="h-10 px-3 rounded-md border border-border bg-white text-sm text-foreground file:mr-3 file:rounded file:border-0 file:bg-primary file:px-3 file:py-1 file:text-white"
              />
              {file ? (
                <p
                  className={`text-xs ${overSize ? "text-danger" : "text-foreground-muted"}`}
                >
                  {file.name}（{(file.size / 1024 / 1024).toFixed(2)} MB）
                  {overSize ? `，超过 ${MAX_APK_SIZE_MB}MB 上限，后端将拒绝` : ""}
                </p>
              ) : (
                <p className="text-xs text-foreground-muted">
                  请选择 .apk 文件
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                id="appId"
                label="关联应用（选填）"
                value={appId}
                onChange={(e) => onAppChange(e.target.value)}
                hint={
                  appsLoading
                    ? "加载中…"
                    : apps.length === 0
                      ? "暂无应用"
                      : "选择后将自动填充 AppKey"
                }
              >
                <option value="">不关联</option>
                {apps.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <Input
                id="appKey"
                label="AppKey"
                placeholder="应用 AppKey"
                value={appKey}
                onChange={(e) => setAppKey(e.target.value)}
                error={appKeyError}
                required
              />
            </div>

            <Input
              id="serverUrl"
              label="服务端 URL"
              placeholder="请输入服务端 URL（含协议）"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              error={serverUrlError}
              required
            />

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">
                注入选项
              </span>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={antiDebug}
                  onChange={(e) => setAntiDebug(e.target.checked)}
                  className="rounded border-border"
                />
                反调试（antiDebug）
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={integrityCheck}
                  onChange={(e) => setIntegrityCheck(e.target.checked)}
                  className="rounded border-border"
                />
                完整性校验（integrityCheck）
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={emulatorDetect}
                  onChange={(e) => setEmulatorDetect(e.target.checked)}
                  className="rounded border-border"
                />
                模拟器检测（emulatorDetect）
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.push("/developer/apk-injection")}
                disabled={submitting}
              >
                取消
              </Button>
              <Button type="submit" loading={submitting}>
                提交
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
