"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";

/**
 * 官网营销页 /
 *
 * - 顶部导航：Logo + 登录态感知按钮（未登录"登录" / 已登录"进入控制台"）
 * - Hero 区：产品定位 + 立即注册 CTA
 * - 核心特性：8 项核心能力卡片
 * - SDK 与文档入口：12 语言 SDK + 文档链接
 * - 底部 CTA：注册引导
 *
 * 设计遵循铁律 03：无 emoji、无夸张渐变、无毛玻璃、明亮藏蓝调性
 */

const FEATURES = [
  {
    title: "加密通信",
    desc: "RSA-2048 签名 + AES-256-CBC 加密 + ECDHE 完美前向保密 + TS/Nonce 防重放，对标米验且双向加密",
  },
  {
    title: "卡密体系",
    desc: "7 种类型（天/周/月/年/永久/次数/自定义小时）+ CRC32 校验位 + RSA 签名 + 开发者 ID 水印追溯",
  },
  {
    title: "设备管理",
    desc: "机器码绑定 + 心跳保活 + 在线状态 + 黑名单 + 临时封禁 + 多种解绑规则 + 共享检测",
  },
  {
    title: "云变量",
    desc: "每应用独立 KV 配置池，登录后凭 token 读取，服务端签名防篡改，支持 string/number/boolean/json",
  },
  {
    title: "APK 注入",
    desc: "在线上传 → BullMQ 异步注入（apktool + 反调试 + 完整性校验）→ 重新签名下载，沙箱隔离执行",
  },
  {
    title: "3 层代理分销",
    desc: "A→B→C→D 佣金分润，代理独立后台 + 邀请码体系（一次性/可复用/限量）+ 余额管理 + 提现审核",
  },
  {
    title: "多语言接入",
    desc: "6 种主流 SDK（Python/Java/PHP/Node.js/Go/易语言）+ 6 种社区示例 + 接入中心一键生成代码",
  },
  {
    title: "安全加固",
    desc: "签名防篡改 + 全局限流 + 审计日志 + WAF + 2FA 双因子 + IP 白名单 + 敏感字段加密 + HTTP 安全头",
  },
] as const;

const SDK_LANGUAGES = [
  { name: "Python", type: "主流" },
  { name: "Java", type: "主流" },
  { name: "PHP", type: "主流" },
  { name: "Node.js", type: "主流" },
  { name: "Go", type: "主流" },
  { name: "易语言", type: "主流" },
  { name: "gglua", type: "社区" },
  { name: "andlua", type: "社区" },
  { name: "auto.js", type: "社区" },
  { name: "shell", type: "社区" },
  { name: "按键精灵", type: "社区" },
  { name: "html/js", type: "社区" },
] as const;

export default function LandingPage() {
  const { user } = useAuth();
  const isLoggedIn = !!user;

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* 顶部导航 */}
      <header className="border-b border-border bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-block w-7 h-7 rounded bg-primary" aria-hidden />
            <span className="text-base font-semibold text-foreground">
              网络验证 SaaS
            </span>
          </div>
          <div className="flex items-center gap-3">
            {isLoggedIn ? (
              <Link href="/dashboard">
                <Button size="sm">进入控制台</Button>
              </Link>
            ) : (
              <>
                <Link href="/login">
                  <Button variant="ghost" size="sm">
                    登录
                  </Button>
                </Link>
                <Link href="/register">
                  <Button size="sm">免费注册</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero 区 */}
        <section className="border-b border-border bg-background-subtle">
          <div className="max-w-6xl mx-auto px-6 py-20 text-center">
            <h1 className="text-4xl font-bold text-foreground leading-tight">
              多租户云端网络验证平台
            </h1>
            <p className="mt-5 text-lg text-foreground-muted max-w-2xl mx-auto leading-relaxed">
              面向开发者与代理的 SaaS 网络验证系统，提供登录验证、卡密发售、设备绑定、云变量、APK 注入、多语言 SDK 等一站式能力，对标米验且更全面
            </p>
            <div className="mt-8 flex items-center justify-center gap-4">
              {!isLoggedIn && (
                <Link href="/register">
                  <Button size="lg">立即注册</Button>
                </Link>
              )}
              <Link href="/dashboard">
                <Button variant="secondary" size="lg">
                  查看控制台
                </Button>
              </Link>
            </div>
            <p className="mt-4 text-xs text-foreground-muted">
              注册即用，包月套餐灵活选配，无需自建服务器
            </p>
          </div>
        </section>

        {/* 核心特性 */}
        <section className="max-w-6xl mx-auto px-6 py-16">
          <h2 className="text-2xl font-semibold text-foreground text-center">
            核心能力
          </h2>
          <p className="mt-2 text-sm text-foreground-muted text-center">
            从加密通信到商业化运营，覆盖网络验证全链路
          </p>
          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="p-5 bg-white border border-border rounded-lg hover:border-primary/40 transition-colors"
              >
                <h3 className="text-base font-semibold text-foreground">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm text-foreground-muted leading-relaxed">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* SDK 与文档入口 */}
        <section className="border-y border-border bg-background-subtle">
          <div className="max-w-6xl mx-auto px-6 py-16">
            <h2 className="text-2xl font-semibold text-foreground text-center">
              多语言 SDK 与文档
            </h2>
            <p className="mt-2 text-sm text-foreground-muted text-center">
              6 种主流语言官方维护 + 6 种社区贡献示例，接入中心一键生成代码
            </p>
            <div className="mt-10 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {SDK_LANGUAGES.map((lang) => (
                <div
                  key={lang.name}
                  className="px-4 py-3 bg-white border border-border rounded text-center"
                >
                  <p className="text-sm font-medium text-foreground">
                    {lang.name}
                  </p>
                  <p className="mt-1 text-[10px] text-foreground-muted">
                    {lang.type}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-8 flex items-center justify-center gap-4">
              <Link href="/dashboard">
                <Button variant="secondary" size="sm">
                  进入接入中心
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* 底部 CTA */}
        <section className="max-w-6xl mx-auto px-6 py-16 text-center">
          <h2 className="text-2xl font-semibold text-foreground">
            立即开始接入
          </h2>
          <p className="mt-2 text-sm text-foreground-muted">
            注册开发者账号，创建应用，复制 SDK 代码即可上线
          </p>
          <div className="mt-6 flex items-center justify-center gap-4">
            {!isLoggedIn ? (
              <Link href="/register">
                <Button size="lg">免费注册</Button>
              </Link>
            ) : (
              <Link href="/developer/apps">
                <Button size="lg">管理我的应用</Button>
              </Link>
            )}
            <Link href="/login">
              <Button variant="ghost" size="lg">
                登录
              </Button>
            </Link>
          </div>
        </section>
      </main>

      {/* 页脚 */}
      <footer className="border-t border-border bg-white">
        <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between text-xs text-foreground-muted">
          <span>网络验证 SaaS 平台</span>
          <span>多租户云端验证服务</span>
        </div>
      </footer>
    </div>
  );
}
