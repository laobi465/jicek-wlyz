"use client";

import { AuthGuard } from "@/components/auth/auth-guard";
import { PageHeader } from "@/components/layout/page-header";
import { SdkDownloadContent } from "@/components/sdk/sdk-download-content";

/**
 * 开发者 SDK 下载 /developer/sdk
 *
 * 复用 SdkDownloadContent 共享组件（与 /admin/sdk 一致）。
 * - SDK 列表 / 下载链接 / 接入流程 / API 协议 / Python 示例
 * - 数据来自 GET /api/sdk/info（无需鉴权）
 */
export default function DeveloperSdkPage() {
  return (
    <AuthGuard allow={["developer"]}>
      <div className="flex flex-col gap-5">
        <PageHeader
          title="SDK 下载"
          subtitle="下载各语言 SDK，按对接教程完成客户端接入"
        />
        <SdkDownloadContent />
      </div>
    </AuthGuard>
  );
}
