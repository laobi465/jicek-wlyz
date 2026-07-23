"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody } from "@/components/ui/card";

/**
 * 登录页 /login
 *
 * 对接 Better Auth signIn.email → POST /api/auth/[...all]
 * 登录成功后 refresh session，由 AuthProvider 同步 user 状态
 *
 * useSearchParams 必须包裹 Suspense（Next.js 16 静态预渲染要求）
 */

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useAuth();
  const toast = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const reason = searchParams.get("reason");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      toast.warning("请输入邮箱与密码");
      return;
    }
    setLoading(true);
    try {
      const { error } = await authClient.signIn.email({ email, password });
      if (error) {
        toast.danger(error.message ?? "登录失败");
        return;
      }
      await refresh();
      toast.success("登录成功");
      router.push("/dashboard");
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background-subtle px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground">网络验证控制台</h1>
          <p className="text-sm text-foreground-muted mt-2">
            登录以管理您的应用、卡密与代理
          </p>
        </div>

        <Card>
          <CardBody>
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <Input
                id="email"
                type="email"
                label="邮箱"
                placeholder="you@example.com"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Input
                id="password"
                type="password"
                label="密码"
                placeholder="请输入密码"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button type="submit" loading={loading} className="w-full">
                登录
              </Button>
            </form>
            <div className="mt-4 text-center text-sm text-foreground-muted">
              没有账号？
              <Link
                href="/register"
                className="text-primary hover:underline ml-1"
              >
                立即注册
              </Link>
            </div>
            <div className="mt-2 text-center text-xs text-foreground-muted">
              首次部署系统？
              <Link
                href="/setup"
                className="text-primary hover:underline ml-1"
              >
                进入安装向导
              </Link>
            </div>
          </CardBody>
        </Card>

        {reason === "expired" && (
          <p className="mt-4 text-center text-sm text-accent-amber">
            会话已过期，请重新登录
          </p>
        )}
      </div>
    </div>
  );
}
