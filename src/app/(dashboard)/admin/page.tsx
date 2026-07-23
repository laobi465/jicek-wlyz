import { AuthGuard } from "@/components/auth/auth-guard";
import { RoleDashboard } from "@/components/dashboard/role-dashboard";

/**
 * 超管仪表盘 /admin
 *
 * 仅 super_admin 角色可访问
 */
export default function AdminPage() {
  return (
    <AuthGuard allow={["super_admin"]}>
      <RoleDashboard />
    </AuthGuard>
  );
}
