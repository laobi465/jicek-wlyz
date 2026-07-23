/**
 * (auth) 路由组布局
 *
 * 未登录访问的页面（登录 / 注册），无侧边栏
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
