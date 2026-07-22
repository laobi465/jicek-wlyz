import { PrismaClient } from '@prisma/client';

// 复用全局单例，防止 Next.js 开发环境热重载产生多个 PrismaClient 实例
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
