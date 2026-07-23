"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody } from "@/components/ui/card";

/**
 * 注册页 /register
 *
 * 对接 Better Auth signUp.email → POST /api/auth/[...all]
 * admin 插件默认角色 developer（src/lib/auth.ts 配置）
 */
export default function RegisterPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const toast = useToast();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name || !email || !password) {
      toast.warning("请填写完整信息");
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
      const { error } = await authClient.signUp.email({
        name,
        email,
        password,
      });
      if (error) {
        toast.danger(error.message ?? "注册失败");
        return;
      }
      await refresh();
      toast.success("注册成功，欢迎加入");
      router.push("/dashboard");
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : "注册失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background-subtle px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground">创建账号</h1>
          <p className="text-sm text-foreground-muted mt-2">
            注册后默认为开发者角色，可购买套餐接入验证
          </p>
        </div>

        <Card>
          <CardBody>
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <Input
                id="name"
                type="text"
                label="用户名"
                placeholder="请输入用户名"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
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
                注册
              </Button>
            </form>
            <div className="mt-4 text-center text-sm text-foreground-muted">
              已有账号？
              <Link
                href="/login"
                className="text-primary hover:underline ml-1"
              >
                返回登录
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
