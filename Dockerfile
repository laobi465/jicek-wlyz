# syntax=docker/dockerfile:1

# =============================================================================
# base 阶段：Node 20 Alpine + 安装依赖
# =============================================================================
FROM node:20-alpine AS base
# libc6-compat 与 openssl 为 Next.js / Prisma 在 alpine 上的运行依赖
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
# 仅复制依赖清单，充分利用层缓存
COPY package.json package-lock.json* ./
RUN npm ci

# =============================================================================
# builder 阶段：构建 Next.js（standalone 输出）
# =============================================================================
FROM base AS builder
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# 仅当存在 Prisma schema 时生成客户端，避免无 schema 时构建失败
RUN if [ -f prisma/schema.prisma ]; then npx prisma generate; fi
RUN npm run build
# 确保 Prisma 产物目录存在，便于 runner 阶段 COPY（无 schema 时为空目录）
RUN mkdir -p node_modules/.prisma node_modules/@prisma

# =============================================================================
# runner 阶段：精简运行时镜像（非 root 用户运行）
# =============================================================================
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
# 默认端口 3000，运行时可通过 PORT 环境变量覆盖（不硬编码端口）
ENV PORT=3000

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs

# 复制静态资源
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# 复制 standalone 产物（含最小化 node_modules 与 server.js）
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# 复制静态构建产物
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# 复制 Prisma 生成客户端（standalone 未必完整追踪引擎二进制）
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
# 复制 prisma CLI + schema，供容器内手动执行 prisma 命令（如手动创建表）
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
# 复制初始化脚本（创建默认超管 admin@example.com/admin123）
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

USER nextjs
# 端口由运行时 PORT 环境变量决定（默认 3000）
EXPOSE 3000
# 容器启动时：1) init-admin 创建默认超管 2) 启动 Next.js server
# 注意：数据库表需在部署前手动创建（docker compose exec app npx prisma db push）
CMD ["sh", "-c", "node scripts/init-admin.mjs && node server.js"]
