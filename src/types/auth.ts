// 用户角色：三角色 RBAC
export type UserRole = 'super_admin' | 'agent' | 'developer';

// 代理层级：3 层分销（A=1 / B=2 / C=3）
export type AgentLevel = 1 | 2 | 3;

// 权限类型（对齐项目模块：应用 / 卡密 / 设备 / 代理 / 订单 / 系统 / APK / SDK）
export type Permission =
  // 应用管理
  | 'app:read' | 'app:write' | 'app:delete'
  // 卡密体系
  | 'card:read' | 'card:write' | 'card:generate'
  // 设备管理
  | 'device:read' | 'device:write' | 'device:ban'
  // 代理分销
  | 'agent:read' | 'agent:write' | 'agent:approve' | 'agent:withdraw' | 'agent:invite'
  // 发卡业务
  | 'order:read' | 'order:write'
  // 系统管理
  | 'system:config' | 'system:pricing' | 'system:user-manage' | 'system:update'
  // APK 注入 / SDK
  | 'apk:inject' | 'sdk:read';

// 角色 -> 权限映射
export type RolePermissions = Record<UserRole, Permission[]>;

// 各角色默认权限（对齐 PROJECT.md §2.3 角色权限定义）
export const ROLE_PERMISSIONS: RolePermissions = {
  super_admin: [
    'app:read', 'app:write', 'app:delete',
    'card:read', 'card:write', 'card:generate',
    'device:read', 'device:write', 'device:ban',
    'agent:read', 'agent:write', 'agent:approve', 'agent:withdraw', 'agent:invite',
    'order:read', 'order:write',
    'system:config', 'system:pricing', 'system:user-manage', 'system:update',
    'apk:inject', 'sdk:read',
  ],
  agent: [
    'agent:read', 'agent:withdraw', 'agent:invite',
    'order:read',
  ],
  developer: [
    'app:read', 'app:write',
    'card:read', 'card:write', 'card:generate',
    'device:read', 'device:write',
    'agent:invite',
    'order:read', 'order:write',
    'apk:inject', 'sdk:read',
  ],
};

// 权限校验辅助函数：判断指定角色是否拥有某项权限
export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
