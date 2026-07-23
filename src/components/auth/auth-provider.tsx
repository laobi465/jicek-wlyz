"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { authClient, type SessionUser } from "@/lib/auth-client";
import { registerSessionExpiredHandler } from "@/lib/http";

/**
 * 全局鉴权上下文
 *
 * - 启动时通过 Better Auth useSession() 拉取当前会话
 * - 暴露 user / loading / refresh / signOutAndRedirect
 * - 注册会话过期回调（HTTP 层收到 8408 时触发跳转登录页）
 */

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  /** 重新拉取 session */
  refresh: () => Promise<SessionUser | null>;
  /** 退出登录并跳转 /login */
  signOutAndRedirect: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth 必须在 <AuthProvider> 内使用");
  }
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending, refetch } = authClient.useSession();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  // 同步 Better Auth session 到本地 state
  useEffect(() => {
    if (isPending) return;
    if (session?.user) {
      setUser(session.user as SessionUser);
    } else {
      setUser(null);
    }
    setLoading(false);
  }, [session, isPending]);

  // 注册会话过期回调
  useEffect(() => {
    registerSessionExpiredHandler(() => {
      setUser(null);
      if (typeof window !== "undefined") {
        window.location.href = "/login?reason=expired";
      }
    });
  }, []);

  const refresh = useCallback(async (): Promise<SessionUser | null> => {
    // refetch() 返回 Promise<void>，无法直接拿到数据
    // 改用 authClient.getSession() 直接拉取最新会话（响应：{ session, user } | null）
    try {
      const data = (await authClient.getSession({
        query: { disableCookieCache: true },
      })) as { user?: SessionUser } | null;
      const u = (data?.user as SessionUser | undefined) ?? null;
      setUser(u);
      // 同步触发 useSession 内部 store 刷新，确保其它订阅者也更新
      await refetch();
      return u;
    } catch {
      // getSession 失败时降级为 refetch，由 useSession 反向同步
      await refetch();
      return null;
    }
  }, [refetch]);

  const signOutAndRedirect = useCallback(async () => {
    try {
      await authClient.signOut();
    } catch {
      // 即使 signOut 失败也强制跳转
    }
    setUser(null);
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, refresh, signOutAndRedirect }),
    [user, loading, refresh, signOutAndRedirect],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
