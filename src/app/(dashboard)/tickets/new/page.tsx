"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Textarea, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/page-header";
import { post, ApiError } from "@/lib/http";

/**
 * 提交工单 /tickets/new
 *
 * - POST /api/tickets（title / content / category / priority）
 * - 后端校验：标题 1-100 字符、内容 1-5000 字符（见 ticket-service.ts）
 * - 提交成功跳转至 /tickets/[ticketId]
 */

interface CreateTicketResponse {
  id: string;
  ticket_no: string;
}

const CATEGORY_OPTIONS = [
  { value: "bug", label: "缺陷" },
  { value: "feature", label: "需求" },
  { value: "billing", label: "计费" },
  { value: "other", label: "其他" },
];

const PRIORITY_OPTIONS = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "urgent", label: "紧急" },
];

const MAX_TITLE = 100;
const MAX_CONTENT = 5000;

export default function NewTicketPage() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("bug");
  const [priority, setPriority] = useState("medium");
  const [submitting, setSubmitting] = useState(false);
  const [titleError, setTitleError] = useState<string>();
  const [contentError, setContentError] = useState<string>();

  function validate(): boolean {
    let ok = true;
    if (!title.trim()) {
      setTitleError("请输入工单标题");
      ok = false;
    } else if (title.length > MAX_TITLE) {
      setTitleError(`标题不超过 ${MAX_TITLE} 字符`);
      ok = false;
    } else {
      setTitleError(undefined);
    }

    if (!content.trim()) {
      setContentError("请输入工单内容");
      ok = false;
    } else if (content.length > MAX_CONTENT) {
      setContentError(`内容不超过 ${MAX_CONTENT} 字符`);
      ok = false;
    } else {
      setContentError(undefined);
    }
    return ok;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!validate()) return;

    setSubmitting(true);
    try {
      const created = await post<CreateTicketResponse>(user, "/api/tickets", {
        title: title.trim(),
        content: content.trim(),
        category,
        priority,
      });
      toast.success(`工单已提交，编号 ${created.ticket_no}`);
      router.push(`/tickets/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.danger(err.message);
      } else {
        toast.danger("提交工单失败");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="提交工单"
        subtitle="请尽量详细描述问题，便于客服快速处理"
      />

      <Card>
        <CardHeader
          title="工单信息"
          description="标题 1-100 字符，内容 1-5000 字符"
        />
        <CardBody>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <Input
              id="title"
              label="标题"
              placeholder="简要概括问题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              error={titleError}
              hint={`已输入 ${title.length} / ${MAX_TITLE} 字符`}
              maxLength={MAX_TITLE}
              required
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                id="category"
                label="类型"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                hint="选择问题归属类别"
              >
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>

              <Select
                id="priority"
                label="优先级"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                hint="紧急问题请选择紧急"
              >
                {PRIORITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>

            <Textarea
              id="content"
              label="内容"
              placeholder="请详细描述问题现象、复现步骤与期望结果"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              error={contentError}
              hint={`已输入 ${content.length} / ${MAX_CONTENT} 字符`}
              maxLength={MAX_CONTENT}
              className="min-h-[200px]"
              required
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.push("/tickets")}
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
