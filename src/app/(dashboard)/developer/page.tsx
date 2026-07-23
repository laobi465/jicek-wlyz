import { AuthGuard } from "@/components/auth/auth-guard";
import { RoleDashboard } from "@/components/dashboard/role-dashboard";

/**
 * 开发者仪表盘 /developer
 *
 * 仅 developer 角色可访问
 */
export default function DeveloperPage() {
  return (
    <AuthGuard allow={["developer"]}>
      <RoleDashboard />
    </AuthGuard>
  );
}
