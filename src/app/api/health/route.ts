import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { prisma } from '@/lib/db';

/**
 * GET /api/health
 *
 * 健康检查（上线准备）
 *
 * 检查项：
 * - 应用进程存活
 * - 数据库连接
 * - Redis 连接
 * - 关键环境变量配置
 *
 * 不需要鉴权（供负载均衡器/监控探针调用）
 */

export async function GET(): Promise<NextResponse> {
  const checks: Record<string, { status: 'ok' | 'fail'; latencyMs?: number; error?: string }> = {};

  // 1. 数据库连接检查
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    checks.database = {
      status: 'fail',
      error: err instanceof Error ? err.message : '数据库连接失败',
    };
  }

  // 2. Redis 连接检查
  try {
    const start = Date.now();
    await redis.ping();
    checks.redis = { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    checks.redis = {
      status: 'fail',
      error: err instanceof Error ? err.message : 'Redis 连接失败',
    };
  }

  // 3. 关键环境变量检查（与代码实际读取的变量名一致）
  const requiredEnvVars = [
    'DATABASE_URL',
    'REDIS_HOST',
    'REDIS_PORT',
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_URL',
    'FIELD_ENCRYPTION_KEY',
  ];
  const missingEnvVars = requiredEnvVars.filter((v) => !process.env[v]);
  checks.envVars = {
    status: missingEnvVars.length === 0 ? 'ok' : 'fail',
    error:
      missingEnvVars.length > 0
        ? `缺失环境变量: ${missingEnvVars.join(', ')}`
        : undefined,
  };

  // 综合状态
  const allOk = Object.values(checks).every((c) => c.status === 'ok');
  const httpStatus = allOk ? 200 : 503;

  return NextResponse.json(
    {
      status: allOk ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: httpStatus },
  );
}
