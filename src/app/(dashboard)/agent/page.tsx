import { AuthGuard } from "@/components/auth/auth-guard";
import { RoleDashboard } from "@/components/dashboard/role-dashboard";

/**
 * 代理仪表盘 /agent
 *
 * 仅 agent 角色可访问
 */
export default function AgentPage() {
  return (
    <AuthGuard allow={["agent"]}>
      <RoleDashboard />
    </AuthGuard>
  );
}
