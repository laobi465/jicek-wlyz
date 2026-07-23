"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * 首次安装向导页 /setup
 *
 * 流程：
 * 1. 进入页面时 GET /api/setup 检查是否需要初始化
 * 2. needsSetup=false → 跳转 /login（系统已初始化）
 * 3. needsSetup=true  → 显示超管账号设置表单
 * 4. 提交 POST /api/setup 创建首个超管 → 跳转 /login 手动登录
 *
 * 安全：服务端二次校验无超管，本页面仅是引导入口
 */

interface SetupStatus {
  needsSetup: boolean;
}

export default function SetupPage() {
  const router = useRouter();
  const toast = useToast();

  const [checking, setChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  /** 后端检查失败时的错误信息（独立于 needsSetup，避免误报"已初始化"） */
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  // 首次挂载检查初始化状态
  useEffect(() => {
    let cancelled = false;
    fetch("/api/setup", { credentials: "include" })
      .then(async (r) => {
        const data: { code: number; msg?: string; data?: SetupStatus } =
          await r.json();
        if (cancelled) return;
        if (data.code === 0 && data.data) {
          setNeedsSetup(data.data.needsSetup);
          if (!data.data.needsSetup) {
            toast.info("系统已初始化，跳转登录页");
            router.replace("/login");
          }
        } else {
          // 后端返回错误（如数据库未连接/未建表），显示真实错误而非误报"已初始化"
          const msg = data.msg ?? "无法检查初始化状态";
          setErrorMsg(msg);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setErrorMsg("网络错误，无法连接服务器");
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name || !email || !password) {
      toast.warning("请填写完整信息");
      return;
    }
    if (name.length < 2 || name.length > 32) {
      toast.warning("用户名长度 2-32 位");
      return;
    }
    if (password.length < 8) {
      toast.warning("密码至少 8 位");
      return;
    }
    if (password !== confirmPassword) {
      toast.warning("两次密码输入不一致");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, name }),
      });
      const data: { code: number; msg?: string } = await res.json();
      if (data.code !== 0) {
        toast.danger(data.msg ?? "创建超管账号失败");
        return;
      }
      toast.success("超管账号创建成功，请登录");
      router.replace("/login");
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : "创建超管账号失败");
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background-subtle">
        <div className="flex flex-col items-center gap-3">
          <span className="inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-foreground-muted">正在检查系统初始化状态</p>
        </div>
      </div>
    );
  }

  // 后端检查失败：显示真实错误 + 重试按钮（不再误报"系统已初始化"）
  if (errorMsg) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background-subtle px-4">
        <div className="w-full max-w-md text-center">
          <div className="mb-4 p-4 rounded-md bg-accent-red/10 border border-accent-red/30">
            <p className="text-sm text-foreground font-medium mb-2">
              无法检查初始化状态
            </p>
            <p className="text-xs text-foreground-muted break-all">{errorMsg}</p>
          </div>
          <p className="text-xs text-foreground-muted mb-4">
            请确认数据库已启动并已执行表结构初始化（prisma migrate / db push），然后重试。
          </p>
          <Button
            variant="secondary"
            onClick={() => window.location.reload()}
            className="w-full"
          >
            重新检查
          </Button>
          <div className="mt-4 text-center text-sm text-foreground-muted">
            <Link href="/login" className="text-primary hover:underline">
              返回登录
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (needsSetup === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background-subtle px-4">
        <p className="text-sm text-foreground-muted">
          系统已初始化，
          <Link href="/login" className="text-primary hover:underline ml-1">
            返回登录
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background-subtle px-4 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <Badge variant="primary">首次安装</Badge>
          </div>
          <h1 className="text-2xl font-bold text-foreground">系统初始化向导</h1>
          <p className="text-sm text-foreground-muted mt-2">
            创建超级管理员账号，该账号将拥有系统最高权限
          </p>
        </div>

        <Card>
          <CardBody>
            <div className="mb-4 p-3 rounded-md bg-accent-amber/10 border border-accent-amber/30">
              <p className="text-xs text-foreground leading-relaxed">
                此向导仅在系统首次部署、数据库无超管时可用。创建成功后请妥善保管账号密码，该账号可登录后在「用户管理」中分配其他超管。
              </p>
            </div>
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <Input
                id="name"
                type="text"
                label="管理员用户名"
                placeholder="2-32 位字符"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Input
                id="email"
                type="email"
                label="管理员邮箱"
                placeholder="admin@example.com"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Input
                id="password"
                type="password"
                label="登录密码"
                placeholder="至少 8 位"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Input
                id="confirmPassword"
                type="password"
                label="确认密码"
                placeholder="再次输入密码"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <Button type="submit" loading={loading} className="w-full">
                创建超管账号
              </Button>
            </form>
          </CardBody>
        </Card>

        <div className="mt-4 text-center text-sm text-foreground-muted">
          已完成初始化？
          <Link href="/login" className="text-primary hover:underline ml-1">
            返回登录
          </Link>
        </div>
      </div>
    </div>
  );
}
