"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/page-header";
import { get, post, ApiError } from "@/lib/http";

/**
 * 批量生成卡密 /developer/cards/generate
 *
 * - GET /api/apps?limit=100 → { apps, total }（供应用下拉）
 * - POST /api/card-keys/generate { appId, type, count, durationHours?, maxCount?, countTimeLimit? }
 *   → { sync: boolean, jobId?, count? }
 *   - sync=false：异步生成（>100 张），提示任务进行中
 *   - sync=true：同步生成完成
 */

interface AppOption {
  id: string;
  name: string;
}

interface AppListResponse {
  apps: AppOption[];
  total: number;
}

interface GenerateResponse {
  sync: boolean;
  jobId?: string;
  count?: number;
}

const TYPE_OPTIONS = [
  { value: "day", label: "天卡" },
  { value: "week", label: "周卡" },
  { value: "month", label: "月卡" },
  { value: "year", label: "年卡" },
  { value: "permanent", label: "永久卡" },
  { value: "count", label: "次数卡" },
  { value: "custom_hour", label: "自定义小时" },
];

const MIN_COUNT = 1;
const MAX_COUNT = 1000;

export default function GenerateCardsPage() {
  return (
    <AuthGuard allow={["developer"]}>
      <GenerateCardsPageInner />
    </AuthGuard>
  );
}

function GenerateCardsPageInner() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();

  const [apps, setApps] = useState<AppOption[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);

  const [appId, setAppId] = useState("");
  const [type, setType] = useState("day");
  const [count, setCount] = useState("");
  const [durationHours, setDurationHours] = useState("");
  const [maxCount, setMaxCount] = useState("");
  const [countTimeLimit, setCountTimeLimit] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [appIdError, setAppIdError] = useState<string>();
  const [countError, setCountError] = useState<string>();
  const [durationError, setDurationError] = useState<string>();
  const [maxCountError, setMaxCountError] = useState<string>();
  const [countTimeLimitError, setCountTimeLimitError] = useState<string>();

  const [result, setResult] = useState<GenerateResponse | null>(null);

  const loadApps = useCallback(async () => {
    if (!user) return;
    setAppsLoading(true);
    try {
      const res = await get<AppListResponse>(user, "/api/apps", {
        limit: 100,
      });
      setApps(res.apps);
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

  const isCustomHour = type === "custom_hour";
  const isCount = type === "count";

  function validate(): boolean {
    let ok = true;
    if (!appId) {
      setAppIdError("请选择应用");
      ok = false;
    } else {
      setAppIdError(undefined);
    }

    const n = Number(count);
    if (!count || !Number.isInteger(n) || n < MIN_COUNT || n > MAX_COUNT) {
      setCountError(`生成数量必须为 ${MIN_COUNT}-${MAX_COUNT} 的整数`);
      ok = false;
    } else {
      setCountError(undefined);
    }

    if (isCustomHour) {
      const dh = Number(durationHours);
      if (!durationHours || isNaN(dh) || dh < 0.1 || dh > 8760) {
        setDurationError("时长必须为 0.1-8760 的小数");
        ok = false;
      } else {
        setDurationError(undefined);
      }
    }

    if (isCount) {
      const mc = Number(maxCount);
      if (!maxCount || !Number.isInteger(mc) || mc < 1 || mc > 1000000) {
        setMaxCountError("使用次数必须为 1-1000000 的整数");
        ok = false;
      } else {
        setMaxCountError(undefined);
      }
      if (countTimeLimit) {
        const ctl = Number(countTimeLimit);
        if (!Number.isInteger(ctl) || ctl < 1) {
          setCountTimeLimitError("时间上限必须为正整数");
          ok = false;
        } else {
          setCountTimeLimitError(undefined);
        }
      }
    }
    return ok;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!validate()) return;

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        appId,
        type,
        count: Number(count),
      };
      if (isCustomHour) {
        body.durationHours = Number(durationHours);
      }
      if (isCount) {
        body.maxCount = Number(maxCount);
        if (countTimeLimit) {
          body.countTimeLimit = Number(countTimeLimit);
        }
      }
      const res = await post<GenerateResponse>(
        user,
        "/api/card-keys/generate",
        body,
      );
      setResult(res);
      if (res.sync) {
        toast.success(`成功生成 ${res.count ?? 0} 张卡密`);
      } else {
        toast.success("生成任务已提交，正在后台处理");
      }
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("生成卡密失败");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="生成结果" subtitle="卡密生成任务已处理" />
        <Card>
          <CardHeader
            title={result.sync ? "同步生成完成" : "异步生成已提交"}
            description={
              result.sync
                ? `已同步生成 ${result.count ?? 0} 张卡密`
                : "数量较大，已提交到后台队列处理"
            }
          />
          <CardBody>
            <div className="flex flex-col gap-3 text-sm text-foreground">
              <div>
                <span className="text-foreground-muted">处理方式：</span>
                {result.sync ? "同步" : "异步"}
              </div>
              {result.sync ? (
                <div>
                  <span className="text-foreground-muted">生成数量：</span>
                  {result.count ?? 0}
                </div>
              ) : (
                <div>
                  <span className="text-foreground-muted">任务 ID：</span>
                  <span className="font-mono text-xs">{result.jobId ?? "-"}</span>
                </div>
              )}
              {!result.sync && (
                <p className="text-xs text-foreground-muted">
                  异步任务完成后，可在卡密列表中查看新生成的卡密。
                </p>
              )}
            </div>
          </CardBody>
        </Card>
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={() => router.push("/developer/cards")}>
            查看卡密列表
          </Button>
          <Button
            onClick={() => {
              setResult(null);
              setCount("");
              setDurationHours("");
              setMaxCount("");
              setCountTimeLimit("");
            }}
          >
            继续生成
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="生成卡密"
        subtitle="批量生成应用卡密，超过 100 张将自动转为异步处理"
      />

      <Card>
        <CardHeader title="生成参数" description="应用与卡密类型为必填项" />
        <CardBody>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                id="appId"
                label="应用"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                error={appIdError}
                hint={appsLoading ? "加载应用中..." : "选择卡密归属应用"}
                required
              >
                <option value="">请选择应用</option>
                {apps.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>

              <Select
                id="type"
                label="卡密类型"
                value={type}
                onChange={(e) => setType(e.target.value)}
                hint="决定卡密的有效期模式"
                required
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>

              <Input
                id="count"
                label="生成数量"
                type="number"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                error={countError}
                hint={`单次生成 ${MIN_COUNT}-${MAX_COUNT} 张，超过 100 张异步处理`}
                min={MIN_COUNT}
                max={MAX_COUNT}
                required
              />

              {isCustomHour && (
                <Input
                  id="durationHours"
                  label="有效时长（小时）"
                  type="number"
                  value={durationHours}
                  onChange={(e) => setDurationHours(e.target.value)}
                  error={durationError}
                  hint="0.1-8760 小时"
                  step="0.1"
                  min={0.1}
                  max={8760}
                  required
                />
              )}

              {isCount && (
                <Input
                  id="maxCount"
                  label="使用次数"
                  type="number"
                  value={maxCount}
                  onChange={(e) => setMaxCount(e.target.value)}
                  error={maxCountError}
                  hint="1-1000000 的整数"
                  min={1}
                  max={1000000}
                  required
                />
              )}

              {isCount && (
                <Input
                  id="countTimeLimit"
                  label="时间上限（小时）"
                  type="number"
                  value={countTimeLimit}
                  onChange={(e) => setCountTimeLimit(e.target.value)}
                  error={countTimeLimitError}
                  hint="选填，次数卡有效时长上限，正整数"
                  min={1}
                />
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.push("/developer/cards")}
                disabled={submitting}
              >
                取消
              </Button>
              <Button type="submit" loading={submitting}>
                生成
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
