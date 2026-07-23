import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

/**
 * 首页：根据 cookie session 重定向
 * - 已登录 → /dashboard
 * - 未登录 → /login
 *
 * 服务端组件，使用 Better Auth getSession 检测会话
 */
export default async function Home() {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h }).catch(() => null);

  if (session?.user) {
    redirect("/dashboard");
  }
  redirect("/login");
}
