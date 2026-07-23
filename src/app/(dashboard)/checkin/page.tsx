"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { formatDate } from "@/components/common/badges";
import { get, post, ApiError } from "@/lib/http";

/**
 * 每日签到 /checkin
 *
 * - GET /api/checkin → 今日状态 { checkedInToday, checkin }
 * - POST /api/checkin → 执行签到 { checkin, rewardAmount, continuousDays }
 * - GET /api/checkin/records → 历史签到 { records, total }
 *
 * 连续签到奖励规则（与 checkin-service.ts 一致）：
 * 1=0.10 / 2=0.15 / 3=0.20 / 4=0.25 / 5=0.30 / 6=0.35 / 7+=0.50
 */

interface CheckinRecord {
  id: string;
  user_id: string;
  checkin_date: string;
  continuous_days: number;
  reward_amount: string;
  created_at: string;
}

interface TodayStatus {
  checkedInToday: boolean;
  checkin: CheckinRecord | null;
}

interface CheckinResult {
  checkin: CheckinRecord;
  rewardAmount: number;
  continuousDays: number;
}

interface RecordsResponse {
  records: CheckinRecord[];
  total: number;
}

const REWARD_TABLE = [
  { day: 1, reward: "0.10" },
  { day: 2, reward: "0.15" },
  { day: 3, reward: "0.20" },
  { day: 4, reward: "0.25" },
  { day: 5, reward: "0.30" },
  { day: 6, reward: "0.35" },
  { day: 7, reward: "0.50" },
];

export default function CheckinPage() {
  const { user } = useAuth();
  const toast = useToast();

  const [status, setStatus] = useState<TodayStatus | null>(null);
  const [records, setRecords] = useState<RecordsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        get<TodayStatus>(user, "/api/checkin"),
        get<RecordsResponse>(user, "/api/checkin/records", {
          limit: 30,
          offset: 0,
        }),
      ]);
      setStatus(s);
      setRecords(r);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("加载签到信息失败");
      }
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function onCheckin() {
    if (!user) return;
    setSubmitting(true);
    try {
      const result = await post<CheckinResult>(user, "/api/checkin");
      toast.success(
        `签到成功，连续 ${result.continuousDays} 天，奖励 ¥${result.rewardAmount.toFixed(2)}`,
      );
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("签到失败");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PageLoading />;

  const checkedInToday = status?.checkedInToday ?? false;
  const todayContinuous = status?.checkin?.continuous_days ?? 0;
  const todayReward = status?.checkin?.reward_amount ?? "0";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="每日签到"
        subtitle="连续签到享递增奖励，断签重置为第 1 天"
      />

      <Card>
        <CardHeader
          title="今日签到"
          description={`今日（UTC+8）连续签到 ${todayContinuous} 天，奖励 ¥${todayReward}`}
          action={
            checkedInToday ? (
              <Badge variant="success">已签到</Badge>
            ) : (
              <Badge variant="warning">未签到</Badge>
            )
          }
        />
        <CardBody>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground-muted">今日奖励</p>
                <p className="text-2xl font-semibold text-foreground mt-1">
                  ¥
                  {checkedInToday
                    ? Number(todayReward).toFixed(2)
                    : REWARD_TABLE[0].reward}
                </p>
              </div>
              <Button
                onClick={onCheckin}
                loading={submitting}
                disabled={checkedInToday}
              >
                {checkedInToday ? "今日已签到" : "立即签到"}
              </Button>
            </div>

            <div className="rounded-md bg-background-subtle p-4">
              <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-3">
                连续签到奖励规则
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                {REWARD_TABLE.map((r) => {
                  const active =
                    checkedInToday && todayContinuous >= r.day;
                  const isToday =
                    !checkedInToday &&
                    todayContinuous + 1 === r.day;
                  return (
                    <div
                      key={r.day}
                      className={`rounded-md border p-3 text-center ${
                        active
                          ? "bg-primary-subtle border-primary/30"
                          : isToday
                            ? "bg-amber-50 border-amber-200"
                            : "bg-white border-border"
                      }`}
                    >
                      <p className="text-xs text-foreground-muted">
                        第 {r.day} 天
                      </p>
                      <p className="text-sm font-semibold text-foreground mt-1">
                        ¥{r.reward}
                      </p>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-foreground-muted mt-3">
                第 7 天及以上封顶 ¥0.50；断签后连续天数重置为 1。
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="签到记录"
          description="最近 30 天签到明细"
        />
        {records && records.records.length > 0 ? (
          <Table>
            <THead>
              <TR>
                <TH>签到日期</TH>
                <TH>连续天数</TH>
                <TH>奖励金额</TH>
                <TH>签到时间</TH>
              </TR>
            </THead>
            <TBody>
              {records.records.map((r) => (
                <TR key={r.id}>
                  <TD className="font-mono text-xs">
                    {formatDate(r.checkin_date)}
                  </TD>
                  <TD>{r.continuous_days} 天</TD>
                  <TD>¥{Number(r.reward_amount).toFixed(2)}</TD>
                  <TD className="text-foreground-muted text-xs">
                    {formatDate(r.created_at)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState title="暂无签到记录" description="点击上方按钮开始您的第一次签到" />
        )}
      </Card>
    </div>
  );
}
