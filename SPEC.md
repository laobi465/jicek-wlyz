# jicek-wlyz 规划/规范/开发流程文档（SPEC.md）

> 版本：1.6.4 ｜ 状态：修复更新面板 git: not found——update-service 适配 Docker 部署 ｜ 最后更新：2026-07-23
> 维护规则：与 PROJECT.md 同源同步，任何变更联动更新，版本号语义化递增

---

## 1. 项目规划（Plan）

### 1.1 里程碑划分

| 里程碑 | 目标 | 交付物 | 状态 |
|---|---|---|---|
| M0 | 需求确认 + 文档基线 | PROJECT.md + SPEC.md + UI 设计规范 | 已完成 |
| M1 | 基础架构搭建 | Next.js 项目骨架 + Prisma Schema + Docker + 一键安装脚本 | 已完成 |
| M2 | 核心验证能力 | 应用管理 + 卡密体系 + 登录验证 + 设备管理（RSA+AES+TS/Nonce） | 已完成 |
| M3 | 商业化能力 | 代理 3 层分销 + 发卡业务 + 彩虹易支付 + 套餐包月充值 | 已完成 |
| M4 | 接入生态 | 6 种主流 SDK + 协议规范文档 + 小众语言示例 + 接入中心向导 | 已完成 |
| M5 | APK 注入 | 在线注入工具 + 命令行工具 + SDK 自签名校验 + 反调试 | 已完成 |
| M6 | 运营能力 | 工单系统 + 数据看板 + 签到 + 通知 | 已完成 |
| M7 | 安全加固 + 上线 | 签名防篡改全链路 + 限流 + 审计日志 + 上线 | 已完成 |
| M8 | Web 前端 UI | 三角色 Web 界面（开发者/代理/超管）+ 登录注册 + 仪表盘 + 工单 + 通知 + 签到 | 进行中（M8.0/M8.1/M8.2/M8.3 已完成） |

> M8 拆分：M8.0 核心 UI 框架（已交付 v1.1.0：基础布局 + 登录注册 + 鉴权守卫 + 三角色仪表盘 + 共享工单/通知/签到闭环）→ M8.1 开发者管理页（已交付 v1.2.0：应用/卡密/设备/云变量/APK 注入/接入中心/店铺/套餐 + 官网营销页）→ M8.2 代理管理页（已交付 v1.3.0：代理概览/下级代理/邀请码/佣金明细/提现申请 + 后端 web API 路由层补全）→ M8.3 超管管理页（已交付 v1.4.0：超管仪表盘/用户/业务/收入/提现审核/工单客服/系统配置/审计日志/2FA+IP 白名单/更新面板 + 后端 user-service/config-service + 8 API 路由）。

### 1.2 版本路线图

| 版本 | 内容 | 状态 |
|---|---|---|
| 0.1.0 | 需求文档基线 | 已完成 |
| 0.2.0 | M1 基础架构 | 已完成 |
| 0.2.1 | /bdeploy GitHub 自动更新模块 | 已完成 |
| 0.3.0 | M2 核心验证 | 已完成 |
| 0.4.0 | M3 商业化 | 已完成 |
| 0.5.0 | M4 接入生态 | 已完成 |
| 0.6.0 | M5 APK 注入 | 已完成 |
| 0.7.0 | M6 运营能力 | 已完成 |
| 1.0.0 | M7 安全加固 + 正式上线 | 已完成 |
| 1.0.1 | 构建修复（Next.js 16 proxy 适配 + redis/auth 惰性初始化） | 已完成 |
| 1.1.0 | M8.0 Web 前端核心 UI 框架（基础布局 + 登录注册 + 鉴权守卫 + 三角色仪表盘 + 工单/通知/签到闭环） | 已完成 |
| 1.2.0 | M8.1 开发者管理页（官网营销页 + 应用/卡密/设备/云变量/APK注入/接入中心/店铺/套餐 8 模块 + 后端 web API 路由层补全） | 已完成 |
| 1.3.0 | M8.2 代理管理页（代理概览/下级代理/邀请码/佣金明细/提现申请 5 模块 + 后端 web API 路由层补全 18 路由） | 已完成 |
| 1.4.0 | M8.3 超管管理页（超管仪表盘/用户/业务/收入/提现审核/工单客服/系统配置/审计日志/2FA+IP 白名单/更新面板 10 模块 + 后端 user-service/config-service + 8 API 路由） | 已完成 |
| 1.5.0 | 首次安装向导（/setup 页 + /api/setup 路由 + setup-service）+ 环境变量命名统一（BETTER_AUTH_SECRET/BETTER_AUTH_URL/REDIS_HOST/REDIS_PORT/FIELD_ENCRYPTION_KEY）+ .env.example 模板 | 已完成 |
| 1.5.1 | 移除 /setup 安装向导（删除前端页 + /api/setup 路由 + setup-service）→ 改为容器启动时执行 `scripts/init-admin.mjs` 自动创建默认超管 `admin@example.com/admin123`（幂等：已存在超管则跳过）+ Dockerfile CMD 集成 init-admin 步骤 + install.sh 输出默认账密 | 已完成 |
| 1.5.2 | 移除容器启动自动同步表结构（Dockerfile CMD 删除 `npx prisma db push --skip-generate`，改为仅 `node scripts/init-admin.mjs && node server.js`）+ install.sh/README 文档移除"同步表结构"描述，表结构改为部署前手动创建（`docker compose exec app npx prisma db push`） | 已完成 |
| 1.5.3 | 优化一键安装脚本 deploy/install.sh：① 自动建表（恢复一键体验，db 就绪后 `docker compose run --rm --no-deps app npx prisma db push --skip-generate`，无需手动建表）② 子命令支持（install 默认幂等 / update 拉新镜像+同步表+重启 / uninstall 停删容器保留数据卷 / reinstall 保留 .env 重装 / --help）③ 幂等检测（已安装且运行中则提示引导子命令，不重复安装）④ 失败自动打日志（db/app 健康检查失败、建表失败时自动 `docker compose logs --tail=50`）⑤ 分步启动（db+redis → wait db healthy → 建表 → app+apk-injector → wait app healthy）⑥ set -euo pipefail 健壮性 ⑦ shellcheck 通过（仅剩 SC1091 不可避免 info） | 已完成 |
| 1.5.4 | 修复一键安装建表失败：① install.sh create_db_schema 改用 `node /app/node_modules/prisma/build/index.js` 直接调用 prisma CLI（替代 `npx prisma`——standalone 镜像无 node_modules/.bin 符号链接，npx 找不到本地 prisma 包会尝试联网下载失败）② 捕获 prisma 完整输出到 /tmp/jicek-schema.log，失败时 cat 显示（docker compose logs 看不到 run --rm 已删除容器的输出，导致看不到真正错误）③ Dockerfile runner 阶段补充 COPY node_modules/.bin/prisma（让 npx prisma 也能用）④ 清理 Dockerfile 重复的 @prisma/.prisma COPY ⑤ CMD 注释更新为"表由 install.sh 自动创建" | 已完成 |
| 1.5.5 | 修复建表失败——新增 migrate 专用镜像：1.5.4 的修复无效，因为根本原因是 app(standalone) 镜像缺 prisma CLI 的传递依赖 `effect` 包（@prisma/config 依赖 effect，prisma CLI 依赖 @prisma/config），standalone 模式只追踪应用代码用到的依赖。修复方案：① Dockerfile 新增 `migrate` 构建阶段（FROM base 含完整 node_modules + COPY builder 的 prisma schema 与 .prisma 客户端，prisma CLI 及 effect 等传递依赖齐全）② docker-compose.yml 新增 migrate service（profiles: ["migrate"] 隔离，正常 docker compose up 不启动；含 DATABASE_URL + depends_on db healthy）③ install.sh create_db_schema 改用 `docker compose --profile migrate run --rm migrate`（migrate 镜像的 CMD 即 `npx prisma db push --skip-generate`）④ install.sh prepare_image / cmd_update 增加 migrate 镜像构建步骤 ⑤ runner 阶段移除无用的 prisma CLI + .bin/prisma COPY（runner 不再需要跑 prisma，建表由 migrate 负责） | 已完成 |
| 1.5.6 | 修复远程拉取模式 migrate 构建失败：1.5.5 在远程 app 镜像拉取成功时直接构建 migrate，但部署目录只有 docker-compose.yml + .env，无 Dockerfile/源码，docker compose build migrate 报 `failed to read dockerfile: open Dockerfile: no such file or directory`。修复：prepare_image 将 `prepare_local_build_source` 调用提前到 pull 之前——无论远程拉取还是本地构建都先下载源码（幂等：已有 Dockerfile 则跳过），保证 migrate 构建时 Dockerfile 在场 | 已完成 |
| 1.6.0 | **重构建表方案——彻底删除 migrate 镜像，改用 init.sql + PostgreSQL docker-entrypoint-initdb.d 标准机制**：背景——1.5.3~1.5.6 连续 4 次修复建表问题（standalone 缺 prisma CLI 依赖 effect / 缺 Dockerfile / 远程拉取需源码），migrate 镜像方案过于复杂且不可靠。根因认识：① 建表只需 prisma CLI（命令行工具），其依赖 effect 等未被 standalone 追踪 ② init-admin 只用 PrismaClient（运行时库），被 standalone 追踪，在 runner 容器能正常跑（已验证登录成功）③ PostgreSQL 官方镜像支持 /docker-entrypoint-initdb.d/ 首次初始化自动执行 .sql，零运行时依赖、完全幂等。方案：① 用 `prisma migrate diff --from-empty --to-schema-datamodel --script` 生成 deploy/init.sql（699 行 / 25 张表，含表+索引+外键），提交仓库 ② docker-compose.yml db 服务挂载 `./init.sql:/docker-entrypoint-initdb.d/01-init.sql:ro`，db 首次启动自动建表 ③ 删除 migrate service（profiles 隔离那套）④ Dockerfile 删除 migrate 构建阶段，runner 移除 prisma CLI/schema COPY（建表不再依赖 runner）⑤ install.sh 删除 create_db_schema 函数 + prepare_image 远程拉取分支不再下载源码（init.sql 已由 download_compose 下载）+ start_services 简化为 `docker compose up -d`（compose 编排处理依赖）+ cmd_update 移除 migrate 构建与建表步骤 ⑥ download_compose 同时下载 docker-compose.yml + init.sql。优势：远程拉取模式部署目录只需 docker-compose.yml+init.sql+.env 三文件，无需源码；建表零运行时依赖；完全幂等 | 已完成 |
| 1.6.1 | 修复 reinstall 旧数据卷导致 init.sql 被跳过——新增表结构校验自愈：背景——1.6.0 用 docker-entrypoint-initdb.d 机制建表，但该机制仅在数据卷为空时执行 init.sql。reinstall 保留旧数据卷（之前建表失败遗留的空库但非空卷），init.sql 被跳过，app 启动时 init-admin 报 `The table public.users does not exist`。修复：① 新增 verify_tables_exist 函数——db 启动健康后用 `docker compose exec -T db psql -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"` 查询表数量，>0 则跳过，==0 则自动 `docker compose exec -T db psql < init.sql` 补建（init.sql 含 CREATE TABLE 非 IF NOT EXISTS，故仅在 table_count==0 时执行保证幂等安全）② start_services 改为分步：先 `docker compose up -d db redis` → wait_for_db_healthy → verify_tables_exist → `docker compose up -d app apk-injector`（确保 app 启动前表已就绪）③ cmd_update 同样改为分步并插入 verify_tables_exist ④ 移除未使用的 db_pwd 变量。适用场景：首次安装（init.sql 自动执行）+ reinstall（旧卷跳过 init.sql 但 verify 自动补建）+ update（保留卷表已存在则跳过） | 已完成 |
| 1.6.2 | 修复登录"无效来源"错误：Better Auth 校验请求 Origin 头与 baseURL（来自 BETTER_AUTH_URL 环境变量）是否匹配，不匹配则拒绝登录返回"无效来源"。原 install.sh generate_env 将 BETTER_AUTH_URL 设为 `http://localhost:${APP_PORT}`，用户通过公网 IP 访问导致浏览器 Origin 头与 baseURL 的 localhost 不匹配被拒。修复：generate_env 改用 get_public_ip 获取公网 IP，BETTER_AUTH_URL 设为 `http://${public_ip}:${APP_PORT}` 使 baseURL 与实际访问地址一致。已部署环境 reinstall/update 保留旧 .env，需手动改 `/opt/jicek-wlyz/.env` 的 BETTER_AUTH_URL 为 `http://<服务器IP>:<端口>` 后 `docker compose restart app` | 已完成 |
| 1.6.3 | 修复开发者和管理员后台侧边栏点击无反应问题：proxy.ts 全局 IP 限流（100 req/min/IP，§2.6.4 第 6 项）未豁免已认证用户的后台浏览，一次侧边栏点击产生 4~5 个伴随请求（HTML + get-session + unread-count + 业务 API + RSC prefetch），1 分钟内撑爆 100 限制，Next.js 客户端路由收到 429 JSON 后静默失败 → 用户表现为"侧边栏点击无反应"。修复：proxy.ts 三层豁免——① HTML 页面（非 `/api/` 路径）一律豁免 ② 内部高频 API 前缀豁免（`/api/auth/` `/api/notifications/` `/api/health` `/api/webhooks/`） ③ 携带 Better Auth session cookie 的已认证请求豁免（cookie 由服务端 HMAC 签名不可伪造，即使伪造绕过限流后续 API 仍会被 Better Auth 拒绝 401）。新增 `RATE_LIMIT_SKIP_PREFIXES` 数组 + `isRateLimitSkipped()` + `isAuthenticated()` 函数；移除可被前端伪造的 `X-User-Id` 头检查。同步更新 §2.6.4 第 6 项规范补充豁免规则细节 | 已完成 |
| 1.6.4 | 修复更新面板 `git: not found`：update-service `getCurrentVersion()` 执行 `git rev-parse HEAD` 在 Docker runner 镜像（无 git 二进制 + 无 .git 目录）抛错导致 `/api/admin/update/check` 500、更新面板顶部红条报错。修复（update-service.ts）：① `getCurrentVersion()` 三级降级不抛错——`DEPLOY_VERSION` 环境变量 → `git rev-parse HEAD` → `"unknown"` ② 新增 `isGitAvailable()` ③ `executeUpdate()`/`rollback()` 开头检测 Docker 模式，git 不可用直接抛明确错误指引到 `bash install.sh update`/`reinstall`，避免 git pull/npm install/prisma migrate 一连串神秘失败 | 已完成 |

### 1.3 风险与依赖清单

| 风险/依赖 | 影响 | 缓解 |
|---|---|---|
| 10+ 语言 SDK 维护成本 | 高 | 平台仅维护 6 种主流，小众走社区贡献 |
| APK 注入涉及 apktool 二进制依赖 | Vercel 不支持长任务 | 自建 VPS + Docker + BullMQ 异步 |
| 加固应用脱壳失败 | APK 注入成功率下降 | 文档明确声明不支持加固应用，建议开发者提供未加固版本 |
| SDK 旧版本兼容（策略 A） | 老版本 SDK 需维护 1 年 | API 版本化路由，v1/v2 并存，1 年后下线 v1 |

---

## 2. 技术规范（Specification）

### 2.1 代码规范

#### 命名
- 文件：`kebab-case.ts`（如 `card-key-service.ts`）
- 组件：`PascalCase`（如 `CardKeyTable.tsx`）
- 函数/变量：`camelCase`
- 常量：`UPPER_SNAKE_CASE`
- 数据库表：`snake_case`（如 `card_keys`）
- 数据库字段：`snake_case`
- 类型/接口：`PascalCase`

#### 格式
- ESLint + Prettier 强制
- 2 空格缩进
- 单引号
- 分号结尾
- import 顺序：react → 第三方 → @/ 别名 → 相对路径

#### 注释
- 复杂业务逻辑必须注释「为什么」而非「是什么」
- 公共 API 必须有 JSDoc
- 禁止 `// TODO` 占位（铁律 04），未实现的写 `throw new Error('待接入：XXX')`

### 2.2 架构规范

#### 分层
```
src/app/api/         # 路由层（仅接收请求、校验、调用 service、返回响应）
src/server/services/ # 服务层（业务逻辑）
src/server/modules/  # 领域模块（实体 + 仓储）
src/lib/             # 基础设施（crypto/db/redis/queue）
```

#### 模块边界
- 路由层不直接操作数据库
- 服务层不直接返回 HTTP 响应
- 模块间通过 service 调用，禁止跨模块直接读对方仓储

### 2.3 接口规范

#### 统一响应体
```typescript
{
  code: number;      // 0=成功，非 0=错误码（沿用项目枚举，禁止自创）
  msg: string;       // 错误描述
  data: T | null;    // 业务数据
  ts: number;        // 服务器时间戳（毫秒）
  nonce: string;     // 随机串
}
```

#### 验证 API（SDK 调用，对标米验）
| action | 功能 | 加密 |
|---|---|---|
| `verify_rsa` | 获取 RSA 公钥 | 明文 |
| `auth` | 验证卡密并激活设备 | RSA + AES |
| `use` | 次数卡扣减 | RSA + AES |
| `unbind` | 解绑设备 | RSA + AES |
| `check_update` | 检查更新和云配置 | Base64 |
| `heartbeat` | 心跳保活 | RSA + AES |

#### 请求头（签名）
```
X-App-Key:   <应用 AppKey>
X-Timestamp: <秒级时间戳，5 分钟有效期>
X-Nonce:     <32 位随机串，Redis 缓存 10 分钟去重>
X-Signature: <RSA-2048 签名，原文 = METHOD\nPATH\nTS\nNONCE\nBODY>
Content-Type: application/json
```

#### 错误码枚举（项目内统一，禁止自创）
| 错误码 | 含义 |
|---|---|
| 0 | 成功 |
| 1001 | 参数缺失 |
| 1002 | 参数格式错误 |
| 2001 | 应用不存在 |
| 2002 | AppKey 无效 |
| 2003 | 签名校验失败 |
| 2004 | 时间戳过期 |
| 2005 | Nonce 重复 |
| 3001 | 卡密不存在 |
| 3002 | 卡密已过期 |
| 3003 | 卡密已绑定其他设备 |
| 3004 | 卡密已被封禁 |
| 3005 | 卡密签名校验失败 |
| 4001 | 设备超过绑定上限 |
| 4002 | 设备已被封禁 |
| 5001 | 套餐余额不足 |
| 5002 | 套餐已过期 |
| 6001 | 代理邀请码无效 |
| 6002 | 代理层级超限 |
| 9001 | 系统内部错误 |
| 9002 | 服务降级中 |
| 7001 | Webhook 签名验证失败 |
| 7002 | 更新任务正在执行（加锁冲突） |
| 7003 | 更新前置检查失败（健康检查不通过） |
| 7004 | 更新执行失败（git pull / 依赖安装 / 迁移失败） |
| 7005 | 回滚失败 |
| 7006 | 版本不存在 |

> 编码阶段如需新增错误码，必须在此表登记后再使用（铁律 13）。

### 2.4 提交规范

#### Commit Message
```
<type>(<scope>): <subject>

<body>
```
- type：`feat / fix / docs / style / refactor / test / chore / perf`
- scope：模块名（如 `card-key / agent / apk-injector`）
- 示例：`feat(card-key): 新增卡密 RSA 签名校验`

#### 分支策略
```
main              # 生产分支，保护
develop           # 开发主干
feature/<模块>     # 功能分支，从 develop 拉，合并回 develop
fix/<问题>         # 修复分支
release/<版本>     # 发版分支
```

### 2.5 测试规范
- 单元测试：Vitest，覆盖核心 service（crypto / card-key / agent 分润）
- 接口测试：Vitest + supertest，覆盖验证 API 全流程
- 覆盖率目标：核心模块 ≥ 80%，整体 ≥ 60%
- 加密链路必须有完整链路测试（签名 → 加密 → 解密 → 验签）

### 2.6 安全规范（v0.1.1 加强版）

> 本节为 v0.1.1 大幅升级版，原 v0.1.0 安全方案全部保留并扩展。

#### 2.6.1 通信安全（14 项，对标米验 + 加强 7 项）

| # | 防护 | 方案 |
|---|---|---|
| 1 | 请求签名 | RSA-2048 客户端私钥签名 `METHOD\nPATH\nTS\nNONCE\nBODY` |
| 2 | 业务加密 | AES-256-CBC，密钥由 `verify_rsa` 动态下发，单会话单密钥 |
| 3 | 防重放 - TS | 时间戳 5 分钟有效期 |
| 4 | 防重放 - Nonce | 32 位随机串，Redis 缓存 10 分钟去重 |
| 5 | 防中间人 | 强制 HTTPS + HSTS + 证书钉扎（SDK 内置公钥指纹） |
| 6 | **PFS 完美前向保密**（加强） | 每次 `verify_rsa` 用 ECDHE 生成临时会话密钥对，会话结束销毁 |
| 7 | **双向加密**（加强） | 请求体 AES 加密 + 响应体也 AES 加密（原响应明文升级为双向） |
| 8 | **心跳包加密**（加强） | 心跳也走 RSA+AES，原方案心跳明文易被伪造 |
| 9 | **Nonce + 业务序列号双因子**（加强） | Nonce 去重 + 每设备递增序列号，双重保险 |
| 10 | **证书钉扎 + 公钥指纹轮换**（加强） | SDK 内置服务端公钥指纹列表，支持多证书轮换不中断 |
| 11 | **流量速率限制**（加强） | 单设备单 action 5 次/秒，单 IP 100 次/分钟，超限 Redis 计数封禁 |
| 12 | **异常流量风控**（加强） | 同一卡密 5 分钟内 >3 个不同 IP / 异地登录 → 自动锁定 + 通知开发者 |
| 13 | 密钥轮换 | RSA 主密钥对每 90 天轮换，旧公钥保留 180 天兼容 |
| 14 | 会话固定防护 | 登录后强制重置 session ID |

#### 2.6.2 卡密安全（13 项，原 5 项 + 加强 8 项）

| # | 防护 | 方案 |
|---|---|---|
| 1 | 防爆破 | 单 IP 单卡密 5 次/分钟失败锁定 30 分钟（Redis 计数） |
| 2 | 防撞库 | 格式 `XXXX-XXXX-XXXX-XXXX`，最后 4 位为前 12 位 CRC32 校验 |
| 3 | 防伪造 | 卡密生成时用平台私钥 RSA 签名，SDK 校验签名后才提交 |
| 4 | 防重放 | 卡密激活后状态机锁定，重复激活返回 3004 |
| 5 | 防遍历 | 字符集排除 0/O/1/I/l，随机熵 ≥ 80 bit |
| 6 | **多层加密载荷**（加强） | 卡密 = 明文卡号 + CRC32 校验位 + RSA 签名 + AES 加密的开发者 ID 水印 |
| 7 | **开发者水印追溯**（加强） | 每张卡密含开发者 ID 水印，泄露可追溯到源头 |
| 8 | **设备指纹 + IP + 地理位置风控**（加强） | 激活时校验三因子，异地激活需二次验证 |
| 9 | **日转绑次数限制**（加强） | 单卡密单日最多转绑 N 次（开发者后台可配，默认 1 次） |
| 10 | **共享检测**（加强） | 同卡密 24 小时内 >2 个不同设备指纹 → 自动加入黑名单池 + 通知开发者 |
| 11 | **卡密黑名单池**（加强） | 被共享/破解的卡密自动入库，全局拦截 |
| 12 | **一键作废 + 远程失效**（加强） | 开发者后台一键作废，SDK 下次心跳即拒绝服务 |
| 13 | **次数+时间双限制**（加强） | 次数卡可同时设时间上限（防永久使用） |

#### 2.6.3 APK 注入安全（16 项，原 5 项 + 加强 11 项）

| # | 防护 | 方案 |
|---|---|---|
| 1 | SDK 自签名校验 | 注入 SDK 内置平台公钥，启动时校验宿主 APK 签名哈希（开发者后台预登记） |
| 2 | 完整性校验 | SDK 启动时计算 `classes.dex` SHA-256，与服务端登记值比对 |
| 3 | 反调试 | SDK Native 层检测 ptrace / frida / xposed |
| 4 | 代码混淆 | SDK 提供 VMP 版本（关键逻辑虚拟化） |
| 5 | 通信密钥保护 | RSA 私钥存 Native SO，Java 层无法直接读取 |
| 6 | **Java + Native 双层签名校验**（加强） | Java 层 + Native SO 双校验，绕过任一层另一层仍拦截 |
| 7 | **全文件完整性校验**（加强） | classes.dex + resources.arsc + AndroidManifest.xml + 所有 SO 文件 SHA-256 比对 |
| 8 | **反调试加强**（加强） | ptrace + frida + xposed + 调试器附加 + signal handler 检测 |
| 9 | **反 Hook**（加强） | JNI 函数表保护 + 关键方法 inline 化 + ART hook 检测 |
| 10 | **反模拟器**（加强） | 检测 qemu / genymotion / bluestacks / nox / ldplayer |
| 11 | **防多开/虚拟空间**（加强） | 检测 VirtualApp / DualSpace / 平行空间等 |
| 12 | **VMP 虚拟化**（加强） | 核心验证逻辑虚拟指令集，原始指令不可见 |
| 13 | **字符串加密**（加强） | 所有敏感字符串（AppKey/URL/密钥）运行时 Native 解密 |
| 14 | **控制流平坦化**（加强） | OLLVM 编译期混淆 |
| 15 | **SO 加壳**（加强） | Native SO 层加壳（Themida/VMProtect） |
| 16 | **防内存 dump**（加强） | 关键数据用后即抹（mprotect + memset） |
| 17 | **在线心跳保活** | 离线超阈值（默认 5 分钟）自动失效，需重新验证 |
| 18 | **硬件级设备指纹** | CPU ID + IMEI + Android ID + MAC 组合哈希 |
| 19 | **服务端动态下发校验规则** | SDK 启动拉取最新校验策略，无需更新 SDK 即可升级防护 |
| 20 | **沙箱执行**（加强） | APK 注入在独立 Docker 容器执行，宿主机隔离 |
| 21 | **apktool 参数白名单**（加强） | 命令注入防护，所有参数严格校验 |

#### 2.6.4 网站安全（16 项，原 7 项 + 加强 9 项）

| # | 防护 | 方案 |
|---|---|---|
| 1 | SQL 注入 | Prisma 参数化查询 + zod schema 输入校验 |
| 2 | XSS | React 自动转义 + CSP 策略 + DOMPurify |
| 3 | CSRF | SameSite=Strict Cookie + 双重提交 Token |
| 4 | SSRF | 服务端请求白名单（仅易支付回调域名） |
| 5 | 暴力破解 | Better Auth 内置限流 + Redis 失败计数 |
| 6 | 限流 | 全局 Redis 令牌桶 100 req/min/IP（豁免：① 所有 HTML 页面即非 `/api/` 路径 ② 携带 Better Auth session cookie 的已认证请求——cookie 由服务端 HMAC 签名不可伪造，即使伪造绕过限流后续 API 仍会被 Better Auth 拒绝 401 ③ 内部高频 API 前缀 `/api/auth/` `/api/notifications/` `/api/health` `/api/webhooks/`，分别由 Better Auth 自身限流 / 客户端已节流 30s / 健康检查探针 / 三方回调承担。**禁止**用 `X-User-Id` 头作为身份依据——该头由前端 `src/lib/http.ts` 注入可被攻击者伪造） |
| 7 | 签名防篡改（后台配置） | 应用配置/云变量/卡密模板写入时服务端私钥签名，SDK 读取时校验 |
| 8 | **WAF**（加强） | ModSecurity + OWASP CRS 规则集（宝塔自带） |
| 9 | **DDoS 防护**（加强） | Cloudflare（管理员后台自定义配置）+ 宝塔 nginx 限流 |
| 10 | **2FA 双因子**（加强） | 超管 + 代理强制 TOTP，开发者可选 |
| 11 | **超管 IP 白名单**（加强） | 超管后台仅允许指定 IP 访问 |
| 12 | **全量操作审计日志**（加强） | 所有敏感操作入库 + 异常告警 |
| 13 | **数据库审计**（加强） | 慢查询 + 敏感表（users/card_keys/orders）读写审计 |
| 14 | **敏感字段加密存储**（加强） | 手机号/邮箱/真实姓名 AES 加密，密码 bcrypt |
| 15 | **备份加密**（加强） | 数据库备份 AES-256 加密存储对象存储 |
| 16 | **文件上传校验**（加强） | APK 文件 magic number + 签名块 + 大小限制（≤ 500MB）+ 病毒扫描预留接口 |
| 17 | **HTTP 安全头**（加强） | HSTS / X-Frame-Options=DENY / X-Content-Type-Options=nosniff / Referrer-Policy |
| 18 | **CSP 严格策略**（加强） | default-src 'self'，禁内联脚本，白名单 CDN |
| 19 | **SRI 子资源完整性**（加强） | 所有第三方资源加 integrity 属性 |
| 20 | **行为验证码**（加强） | 登录/注册/充值接入滑块验证（防撞库/防爬虫） |
| 21 | **会话固定防护**（加强） | 登录后强制重置 session ID |

#### 2.6.5 GitHub 自动更新安全（/bdeploy 模块）

| # | 防护 | 方案 |
|---|---|---|
| 1 | Webhook 签名验证 | 使用 GitHub Secret + HMAC-SHA256 签名校验，防止非法触发 |
| 2 | 更新接口权限 | 仅超级管理员可访问，2FA 验证后才能触发更新 |
| 3 | 更新前置健康检查 | 更新前检查服务健康状态，不通过则拒绝更新 |
| 4 | 更新加锁 | Redis 分布式锁，防止并发重复触发 |
| 5 | 更新前自动备份 | 备份代码 + 数据库，存储到对象存储 |
| 6 | 失败自动回滚 | 更新失败自动回滚到上一稳定版本 |
| 7 | 操作审计日志 | 记录操作人/时间/IP/更新前后版本/结果 |
| 8 | 更新脚本沙箱 | 更新脚本在独立进程执行，禁止直接暴露 shell 接口 |
| 9 | WebSocket 鉴权 | 弹窗推送仅推送给已认证的超管会话 |

### 2.7 UI 设计规范（铁律 03 强制）

#### 严格禁用项
1. **禁止 emoji / 表情符号 / 图标化装饰**
2. **禁止夸张设计**：大渐变、强对比、炫光、霓虹、3D 凸起
3. **禁止毛玻璃效果**：backdrop-filter、玻璃拟态、半透明模糊
4. **禁止暗黑风格**：黑色 / 深灰 / 深紫为主深色主题，整体保持明亮
5. **禁止过度装饰**：不必要装饰线条、背景纹理、花哨图案

#### 色彩系统
| 用途 | 色值 | 说明 |
|---|---|---|
| 主背景 | `#FFFFFF` 或 `#F8FAFC` | 纯白或极浅灰 |
| 主色 | `#1E3A5F`（藏蓝） | 对标 b6w.top 科技极简调性，用于重点按钮、关键文字 |
| 辅助色 1 | `#0EA5E9`（湖蓝） | 标签、状态提示 |
| 辅助色 2 | `#10B981`（青绿） | 成功状态 |
| 警示色 | `#EF4444`（柔和红） | 错误、封禁 |
| 主文字 | `#1E293B`（深灰） | 不用纯黑 |
| 次文字 | `#64748B`（中灰） | 层级区分 |
| 分割线 | `#E2E8F0`（极浅灰） | 若有若无 |

#### 组件规范
| 组件 | 规范 |
|---|---|
| 按钮 | 圆角 6px，扁平或轻微阴影，hover 状态简洁，主色按钮 `#1E3A5F` |
| 卡片 | 白色背景，`#E2E8F0` 细边框或极淡阴影，圆角 8px |
| 输入框 | `#E2E8F0` 细边框，聚焦时主色高亮 |
| 导航 | 顶部或侧边，底色浅（`#F8FAFC`），选中态主色文字 + 极浅主色背景 |
| 表格 | 行间距充足，斑马纹极浅（`#F8FAFC`），无重边框 |

#### 布局与排版
- 留白充足，内容区域呼吸感强
- 字体：`Inter`（英文）+ `PingFang SC` / `Microsoft YaHei`（中文），现代无衬线
- 字重梯度：400（正文）/ 500（次标题）/ 600（标题）/ 700（主标题）
- 整体对齐工整，视觉节奏稳定

#### 动效
- 过渡动画 150~200ms，`ease-out`
- 状态变化反馈明确但不夸张
- 无炫技式动画

#### 响应式
- 断点：移动 `< 640px` / 平板 `640~1024px` / PC `> 1024px`
- 移动端：单列布局，导航折叠为汉堡菜单
- PC 端：多列布局，侧边导航

### 2.8 前端架构规范（M8）

#### 技术选型（已锁定）
- 框架：Next.js 16 App Router（Server Components 优先，交互页用 `'use client'`）
- 样式：TailwindCSS v4（`@import "tailwindcss"` + `@theme inline`），不引入 shadcn/ui
- 字体：Geist Sans（已在 [layout.tsx](file:///workspace/src/app/layout.tsx) 加载）
- 鉴权客户端：`createAuthClient` from `better-auth/react`（`useSession()` hook）
- 状态：React 19 内置（Context + useState/useEffect），不引入 Redux/Zustand
- HTTP：原生 `fetch`，封装统一 `request()` 处理 `{ code, msg, data, ts, nonce }` 响应体
- 图标：禁用（铁律 03 第 1 条），用文字 + CSS 几何元素表达

#### 目录结构（M8 新增）
```
src/
├── app/
│   ├── (auth)/                 # 未登录路由组
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (dashboard)/            # 已登录路由组（带鉴权守卫 + 侧边栏布局）
│   │   ├── layout.tsx          # 守卫 + 侧边栏 + 顶栏 + 通知红点
│   │   ├── dashboard/page.tsx  # 按角色重定向到子仪表盘
│   │   ├── tickets/            # 共享工单模块
│   │   │   ├── page.tsx
│   │   │   ├── new/page.tsx
│   │   │   └── [ticketId]/page.tsx
│   │   ├── notifications/page.tsx
│   │   ├── checkin/page.tsx
│   │   ├── developer/          # 开发者专属（M8.1 已完成）
│   │   │   ├── page.tsx        # 开发者仪表盘
│   │   │   ├── apps/           # 应用管理（列表/创建/详情编辑）
│   │   │   │   ├── page.tsx
│   │   │   │   ├── new/page.tsx
│   │   │   │   └── [appId]/page.tsx
│   │   │   ├── cards/          # 卡密管理（列表/生成/详情）
│   │   │   │   ├── page.tsx
│   │   │   │   ├── generate/page.tsx
│   │   │   │   └── [cardId]/page.tsx
│   │   │   ├── devices/        # 设备管理（列表/详情）
│   │   │   │   ├── page.tsx
│   │   │   │   └── [deviceId]/page.tsx
│   │   │   ├── cloud-variables/page.tsx  # 云变量（选应用+列表+Modal编辑）
│   │   │   ├── apk-injection/  # APK 注入（列表/上传/详情轮询）
│   │   │   │   ├── page.tsx
│   │   │   │   ├── upload/page.tsx
│   │   │   │   └── [taskId]/page.tsx
│   │   │   ├── access/page.tsx # 接入中心（流程向导+代码生成+测试连接）
│   │   │   ├── shop/           # 店铺商品（列表/详情+商品CRUD）
│   │   │   │   ├── page.tsx
│   │   │   │   └── [shopId]/page.tsx
│   │   │   └── packages/       # 套餐充值（列表/订阅/订单记录）
│   │   │       ├── page.tsx
│   │   │       └── orders/page.tsx
│   │   ├── agent/              # 代理专属（M8.2 已完成）
│   │   │   ├── page.tsx        # 代理概览（4 余额卡片 + 代理信息 + 快捷入口）
│   │   │   ├── subordinates/page.tsx   # 下级代理（三层分段切换 + 每层表格）
│   │   │   ├── invitations/page.tsx    # 邀请码（列表 + 创建 Modal + code 复制）
│   │   │   ├── commission/page.tsx     # 佣金明细（4 余额卡片 + 提现记录表格）
│   │   │   └── withdrawals/page.tsx    # 提现申请（可提现余额 + 记录 + 发起 Modal）
│   │   └── admin/              # 超管专属（M8.3 已完成）
│   │       ├── page.tsx                # 超管仪表盘（5 卡片组 + 6 子页快捷入口）
│   │       ├── users/page.tsx          # 用户管理（筛选 + 封禁/解封 + 角色变更）
│   │       ├── business/page.tsx       # 业务总览（业务规模 + 工单 + APK 注入 3 卡片组）
│   │       ├── revenue/page.tsx        # 收入明细（今日/本月/累计 + 最近支付表格）
│   │       ├── withdrawals/page.tsx    # 提现审核（通过/驳回/打款 + 状态筛选分页）
│   │       ├── tickets/page.tsx        # 工单客服（status/category 筛选 + 跳转共享详情页）
│   │       ├── config/page.tsx         # 系统配置（group 筛选 + 加密脱敏 + 编辑 Modal）
│   │       ├── audit-logs/page.tsx     # 审计日志（3 筛选 + 异常标记 + 详情 Modal）
│   │       ├── security/page.tsx       # 安全（2FA 状态 + 开启/关闭 + IP 白名单）
│   │       └── update/page.tsx         # 更新面板（版本检查 + 触发 + 回滚 + 历史日志）
│   ├── layout.tsx              # 根布局（字体 + AuthProvider + ToastProvider）
│   └── page.tsx                # 官网营销页（Hero+核心特性+SDK展示+注册CTA+登录态感知导航）
├── components/
│   ├── ui/                     # UI 原子组件（不引外部库）
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── card.tsx
│   │   ├── badge.tsx
│   │   ├── table.tsx
│   │   ├── modal.tsx
│   │   └── toast.tsx
│   ├── layout/
│   │   ├── sidebar.tsx         # 角色感知侧边栏
│   │   ├── topbar.tsx          # 顶栏（用户菜单 + 通知红点 + 退出）
│   │   └── page-header.tsx     # 通用页头（PageHeader / PageLoading / EmptyState）
│   ├── common/
│   │   └── badges.tsx          # 工单/通知枚举映射 + StatusBadge/PriorityBadge/CategoryBadge + 时间格式化
│   ├── dashboard/
│   │   └── role-dashboard.tsx  # 三角色共用仪表盘
│   └── auth/
│       ├── auth-guard.tsx      # 路由组守卫（角色路由隔离）
│       └── auth-provider.tsx   # useSession 同步 + 会话过期回调 + refresh + signOut
├── lib/
│   ├── auth-client.ts          # Better Auth 客户端单例
│   ├── http.ts                 # 统一 fetch 封装（X-User-Id / X-User-Role 头注入）
│   └── ...（已有后端模块不动）
```

#### 鉴权流程
1. 用户在 `/login` 通过 Better Auth 客户端 `signIn.email({ email, password })` → 后端 `/api/auth/[...all]` 校验 → set-cookie `better-auth.session_token`
2. 客户端 `useSession()` 获取 `session.user`，admin 插件注入 `user.role`
3. 业务 API 鉴权契约（已有后端不变）：请求头 `X-User-Id` + `X-User-Role`，由 `lib/http.ts` 统一注入
4. 鉴权守卫 `<AuthGuard>`：在 `(dashboard)` 路由组 layout 中包裹，未登录 → 重定向 `/login`，已登录按 role 渲染对应侧边栏

#### 路由规范
- 未登录可访问：`/login`, `/register`, `/api/auth/[...all]`, `/api/health`
- 已登录可访问：`/(dashboard)/**`
- 角色路由隔离：`/developer/**` 仅 developer 可见，`/agent/**` 仅 agent 可见，`/admin/**` 仅 super_admin 可见（守卫校验，越权访问重定向到 `/dashboard`）
- 首页 `/`：服务端根据 cookie session 重定向到 `/dashboard` 或 `/login`

#### 响应体处理
所有业务 API 返回 `{ code, msg, data, ts, nonce }`（[error-code.ts](file:///workspace/src/lib/security/error-code.ts)）。`lib/http.ts` 统一处理：
- `code === 0` → 返回 `data`
- `code === 8408` (SESSION_EXPIRED) → 跳 `/login`
- 其他 → throw `{ code, msg }`，由调用方 Toast 提示

#### M8.0 交付范围（已交付 v1.1.0）
| 模块 | 页面 | 对接 API |
|---|---|---|
| 基础 | 根 layout + 主题 + AuthProvider + ToastProvider | — |
| 基础 | UI 原子组件（Button/Input/Textarea/Select/Card/Badge/Table/Modal/ConfirmModal/Toast） | — |
| 基础 | lib/auth-client + lib/http + 共享 page-header + common/badges | — |
| 基础 | 鉴权守卫 + 角色侧边栏 + 顶栏（通知红点轮询） | — |
| 登录 | /login（useSearchParams Suspense 包裹修复静态预渲染） | POST /api/auth/[...all] (sign-in/email) |
| 注册 | /register | POST /api/auth/[...all] (sign-up/email) |
| 仪表盘 | /dashboard（角色重定向） | GET /api/dashboard |
| 仪表盘 | /developer, /agent, /admin（共用 RoleDashboard） | GET /api/dashboard |
| 工单 | /tickets, /tickets/new, /tickets/[id] | GET/POST /api/tickets/** |
| 通知 | /notifications | GET /api/notifications, POST /api/notifications/read |
| 签到 | /checkin | GET/POST /api/checkin, GET /api/checkin/records |

#### M8.1 交付范围（已交付 v1.2.0）
| 模块 | 页面 | 对接 API |
|---|---|---|
| 官网 | /（Hero+核心特性+SDK展示+注册CTA+登录态感知导航） | — |
| 应用 | /developer/apps, /new, /[appId] | GET/POST/PATCH/DELETE /api/apps/**, POST regenerate-signature |
| 卡密 | /developer/cards, /generate, /[cardId] | GET /api/card-keys, POST /generate, GET /[cardId], POST revoke/blacklist |
| 设备 | /developer/devices, /[deviceId] | GET /api/devices, GET /[deviceId], POST blacklist/unbind |
| 云变量 | /developer/cloud-variables（选应用+Modal CRUD） | GET/POST /api/apps/[appId]/cloud-variables, PUT/DELETE /[key] |
| APK注入 | /developer/apk-injection, /upload, /[taskId] | GET /api/apk-injection/tasks, POST upload, GET /[taskId], POST cancel, GET download |
| 接入中心 | /developer/access（流程向导+代码生成+测试连接） | GET /api/access/languages, POST generate-code, POST test-connection |
| 店铺商品 | /developer/shop, /[shopId] | GET/POST/PATCH/DELETE /api/shops/**, /api/products/[productId] |
| 套餐充值 | /developer/packages, /orders | GET /api/packages, POST subscribe, GET /api/user-packages, /active |

> 后端 web API 路由层补全：apps / card-keys / devices / cloud-variables / shops / products / packages / user-packages / orders 共 30+ 路由，service 补 listAppsByDeveloper / getAppById / disableApp / listCards / deleteCard / listDevices / getDeviceById / deleteVariable / getShop / deleteShop / deleteProduct / updatePackage / listAllOrders 方法（手写校验非 zod，对标现有路由风格）。

#### M8.2 交付范围（已交付 v1.3.0）
| 模块 | 页面 | 对接 API |
|---|---|---|
| 代理概览 | /agent（4 余额卡片 + 代理信息 + 快捷入口） | GET /api/agent/profile, GET /api/agent/balance |
| 下级代理 | /agent/subordinates（三层分段切换 + 每层表格） | GET /api/agent/subordinates, GET /api/agent/tree |
| 邀请码 | /agent/invitations（列表 + 创建 Modal + code 复制） | GET/POST /api/invitations, GET /[code], GET /validate |
| 佣金明细 | /agent/commission（4 余额卡片 + 提现记录表格 + 筛选分页） | GET /api/agent/balance, GET /api/withdrawals |
| 提现申请 | /agent/withdrawals（可提现余额 + 记录 + 发起 Modal） | GET /api/agent/balance, GET/POST /api/withdrawals |

> 后端 web API 路由层补全 18 路由：agent 自助 4 路由（profile/balance/subordinates/tree）+ 提现 2 路由（列表+发起 / 详情）+ 邀请码 3 路由（列表+发起 / 详情 / 校验）+ 超管 9 路由（代理列表/详情/状态/佣金比例 + 提现列表/审核/驳回/打款 + 邀请码列表）；service 补 listAllAgents / getAgentById / getWithdrawalById / listWithdrawalsWithTotal / listAllInvitations 方法（手写校验非 zod，路由层捕获 service 错误映射到现有错误码 PERMISSION_DENIED / PARAM_FORMAT / PARAM_MISSING / SYSTEM_ERROR）。

#### M8.3 已交付（v1.4.0）

| 模块 | 路由 | 后端依赖 |
|---|---|---|
| 超管仪表盘 | /admin（5 卡片组：用户/业务/收入提现/工单/APK 注入 + 6 子页快捷入口） | GET /api/dashboard（super_admin 维度） |
| 用户管理 | /admin/users（role/status/keyword 筛选 + 分页 + 封禁/解封 ConfirmModal + 角色变更 Modal） | GET /api/admin/users, PATCH /api/admin/users/[userId]/status, PATCH /api/admin/users/[userId]/role |
| 业务总览 | /admin/business（业务规模/工单分布/APK 注入任务 3 卡片组） | GET /api/dashboard |
| 收入明细 | /admin/revenue（今日/本月/累计 3 卡片 + 最近支付表格） | GET /api/admin/revenue |
| 提现审核 | /admin/withdrawals（agentUserId/status 筛选 + 通过/驳回/打款 + 状态条件按钮） | GET /api/admin/withdrawals, POST /[id]/approve, POST /[id]/reject, POST /[id]/paid |
| 工单客服 | /admin/tickets（status/category 筛选 + 跳转共享 /tickets/[ticketId] 详情） | GET /api/tickets/list（超管看全部） |
| 系统配置 | /admin/config（group 筛选 payment/storage/email/sms/cdn/backup/general + 加密脱敏 + 编辑 Modal） | GET /api/admin/config, PUT /api/admin/config/[key] |
| 审计日志 | /admin/audit-logs（action 20 选项/targetType 8 选项/userId 搜索 3 筛选 + 异常标记 + 详情 Modal） | GET /api/audit-logs |
| 安全 | /admin/security（2FA 状态 + 两阶段开启/关闭 + 全局只读 + 个人 IP 白名单，2FA 开启时显示字段冲突 warning） | GET/POST/DELETE /api/two-factor, GET/PUT /api/admin/ip-whitelist |
| 更新面板 | /admin/update（版本检查 + 触发更新 + 回滚 + 远程提交日志 + 本地历史日志） | GET /api/admin/update/check, POST /trigger, POST /rollback, GET /history |

> 后端 web API 路由层补全 8 路由：系统配置 2（GET /api/admin/config + PUT /api/admin/config/[key]）+ 用户管理 3（GET /api/admin/users + PATCH /[userId]/status + PATCH /[userId]/role）+ 超管专属 3（GET /api/admin/revenue + GET/PUT /api/admin/ip-whitelist）；service 新增 user-service.ts（listUsersForAdmin/changeUserStatus/changeUserRole）+ config-service.ts（listSystemConfigs/getSystemConfig/updateSystemConfig，与 epay-service.getEpayConfig 共享同一张 SystemConfig 表）；2FA/提现/工单/审计/更新 复用既有 M7/M8.2/M6/M0 路由，手写校验非 zod，路由层捕获 service 错误映射到现有错误码 PERMISSION_DENIED/PARAM_FORMAT/PARAM_MISSING/SYSTEM_ERROR；更新面板走 Better Auth getSession cookie 鉴权（非 X-User-Id/X-User-Role 头），http.ts 凭借 credentials:"include" 透传 Cookie 兼容。
> 已知限制：User.ip_whitelist 字段被 2FA 复用存储加密备份码，2FA 开启时 getUserIpWhitelist() 返回空数组，前端在 2FA 开启时禁用 IP 白名单编辑并显示 warning，避免覆盖备份码。

---

## 3. 开发流程（Workflow）

### 3.1 分支策略
- `main`：生产分支，仅通过 `release/*` 合并，保护
- `develop`：开发主干，功能分支合并目标
- `feature/<模块>`：从 `develop` 拉，完成后 PR 合并回 `develop`
- `fix/<问题>`：紧急修复，从 `main` 拉，合并回 `main` 和 `develop`
- `release/<版本>`：从 `develop` 拉，合并回 `main` 并打 tag

### 3.2 PR 流程
1. 至少 1 人 Review
2. CI 必须通过（lint + type-check + test + build）
3. 覆盖率不下降
4. 合并后删除分支

### 3.3 发布流程
1. 从 `develop` 拉 `release/X.Y.Z`
2. 更新 PROJECT.md + SPEC.md 版本号 + 变更记录
3. 运行发版检查清单：
   - [ ] 所有测试通过
   - [ ] 数据库 migration 已生成
   - [ ] .env.example 已更新
   - [ ] PROJECT.md + SPEC.md 已同步
   - [ ] Docker 镜像构建成功
4. 合并 `release/X.Y.Z` → `main`，打 tag `vX.Y.Z`
5. CI 自动构建镜像并推送
6. 服务器执行 `docker compose pull && docker compose up -d`
7. 回滚方案：保留前两版镜像，`docker compose down` + 切换镜像 tag + `up -d`

### 3.4 CI/CD 流程
- GitHub Actions
- `main` push → 构建 Docker 镜像 → 推送镜像仓库
- `develop` push → lint + type-check + test + build
- PR → lint + type-check + test

### 3.5 协作流程
- 任务认领：GitHub Issues
- 进度同步：PROJECT.md 功能清单状态 + SPEC.md 里程碑状态
- 交接规范：每次交接按 `references/10-handover-docs.md` 生成 README + PROMPT.md

### 3.6 文档维护规则（铁律 09）
- 任何变更按 SPEC.md §1 步骤 1 识别变更类型
- 版本号按 §1 步骤 2 语义化递增
- PROJECT 与 SPEC 联动校验（§1 步骤 3）
- 已移除功能必须从 PROJECT 功能清单删除，并在 SPEC 版本路线图标记「已移除」

---

## 4. 待核实清单

> M0 阶段全部需求已确认，无待核实项。已确认汇总见 PROJECT.md §7。

---

## 5. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| 0.1.0 | 2026-07-22 | 初始版本：7 里程碑 + 版本路线图 + 代码/架构/接口/安全/UI 规范 + 开发流程 |
| 0.1.1 | 2026-07-22 | 确认 Debian + 仓库 + 对象存储管理员自选 + 易支付管理员配置；§2.6 安全规范大幅升级（通信 14 项 / 卡密 13 项 / APK 注入 21 项 / 网站 21 项）；待核实清单细化至 19 项 |
| 0.1.2 | 2026-07-22 | 19 项待核实清单中 16 项已确认；待核实剩 3 项（监控告警/灰度部署/SDK兼容策略） |
| 0.2.0 | 2026-07-22 | **M0 完成**：最后 3 项确认（监控告警=不需要 / 灰度部署=不需要 / SDK 兼容=A 保留 1 年）；修正 Cloudflare CDN 为管理员后台自定义配置；风险清单清空待核实项；待核实清单清空 |
| 0.2.1 | 2026-07-22 | 整合 /bdeploy 模块：新增 GitHub 自动更新系统（Webhook + 自动更新 + 弹窗 + 后台面板 + 回滚）；新增错误码 7001-7006；新增 §2.6.5 更新安全规范（9 项） |
| 0.3.0 | 2026-07-22 | **M2 完成**：核心验证能力落地——加密链路（RSA-2048 + AES-256-CBC + ECDHE-PFS + TS/Nonce 防重放 + 限流风控）/ 应用管理（AppKey + client_secret + RSA 密钥对）/ 卡密体系（7 类 + CRC32 + RSA 签名 + 开发者水印 + BullMQ 异步批量）/ 统一验证 API 6 actions（verify_rsa/auth/use/unbind/check_update/heartbeat）/ 设备管理 / 云变量；tsc 自检 0 errors |
| 0.4.0 | 2026-07-23 | **M3 完成**：商业化能力落地——代理分销（3 层 A→B→C→D + 邀请码 once/reusable/limited + 佣金分账事务 + 状态审核 + 层级递归校验）/ 提现服务（1 元起 T+1 + pending/approved/rejected/paid 状态机 + 余额锁定防超额 + 审计全流程）/ 发卡业务（店铺/商品/订单 + 库存事务防超卖 + 关联卡密模板自动发卡 + 退款回滚佣金）/ 彩虹易支付（MD5 签名 + 异步回调 + 验签常量时间比较防时序攻击 + 金额一致性二次校验 + 幂等回调）/ 套餐包月（30 天有效期 + app/card quota + 续费叠加 + 过期标记定时任务）；扩展 prisma schema 新增 Withdrawal 表 + Product↔CardTemplate 关系；tsc 自检 0 errors |
| 0.5.0 | 2026-07-23 | **M4 完成**：接入生态落地——6 主流 SDK（Python/Java/PHP/Node.js/Go/易语言，全部实现 6 actions + RSA-2048 签名 + AES-256-CBC 加密 + ECDHE-PFS）/ 6 小众语言示例（gglua/andlua/autojs/shell/anjian/htmljs，社区贡献）/ 接入中心向导（access-service + 3 API 路由：languages/generate-code/test-connection + 6 步流程引导 + 12 语言模板生成 + 连接测试）/ 协议规范文档（docs/api/protocol.md，6 actions 详细规范 + 加密细节 + 错误码 + 12 语言 SDK 对照）；tsc 自检 0 errors |
| 0.6.0 | 2026-07-23 | **M5 完成**：APK 注入落地——在线注入服务（apk-injection-service + 4 API 路由：upload/tasks 列表/详情/下载 + 202 异步 + 任务取消 + 权限校验）/ 安全完整性服务（apk-integrity-service：APK magic number 校验 PK\x03\x04 + SHA-256 常量时间比较防时序攻击 + apktool 参数白名单防命令注入 + 路径穿越防护 + SDK 版本/包名白名单 + InjectionConfig 15+ 特性开关 + 文件大小 500MB 限制）/ BullMQ 异步 Worker（§2.6.3 第 20 项沙箱 mkdtemp 隔离 + apktool d/b + smali 注入 WlyzSdkEntry/WlyzAntiDebug/WlyzIntegrityCheck + assets/wlyz_config.json + apksigner 签名 + 5 分钟超时 + SIGINT/SIGTERM 优雅关闭）/ 命令行工具（tools/apk-injector/cli.ts：inject/verify/sign/help 4 子命令 + --no-* 反向开关）/ 扩展 prisma schema 新增 ApkInjectionTask 模型（BigInt file_size + status 状态机 pending/processing/success/failed）/ 新增 8 个 APK 错误码 8001-8008 / 文档 docs/apk-injection.md（9 章节：安全策略 21 项 + 在线 API + CLI + 注入后结构 + Worker 部署 + Docker Compose）；对象存储上传/下载明确抛错待接入（铁律 04）；tsc 自检 0 errors |
| 0.7.0 | 2026-07-23 | **M6 完成**：运营能力落地——工单系统（ticket-service + 5 API 路由：POST 创建/GET 列表/GET 详情/POST 回复/PATCH 状态 + 工单编号 TK+YYYYMMDD+6位随机串防碰撞 + 状态机 open→in_progress→resolved→closed + 权限校验仅提交者或超管 + 客服回复事务性自动置 in_progress + closed 禁止回复 + 内容长度限制 100/5000/2000）/ 通知中心（notification-service + 3 API 路由：GET 列表/POST 标记已读/GET 未读数 + 6 种类型 ticket/payment/withdrawal/system/apk/agent + 单条/全部已读幂等 + 内部 sendNotification 接口供工单/支付/提现模块调用 + 标题/内容长度限制）/ 每日签到（checkin-service + 2 API 路由：POST 签到/GET 状态 + GET 记录 + 连续签到奖励规则 1-6 天 0.10-0.35 元递增 / 7 天及以上 0.50 元封顶 + UTC+8 时区计算 + 唯一约束(user_id, checkin_date)防重复 + 事务保证签到记录与 balance 余额原子入账 + 断签重置连续天数）/ 数据看板（dashboard-service + 1 API 路由：按角色分发 developer/agent/super_admin 三维度 + 开发者看应用/卡密/设备/工单/通知/签到 + 代理看下级/邀请码/佣金/提现 + 超管看全平台用户/业务/收入/工单/提现/APK 注入 + 并行 Promise.all aggregate 查询优化）/ 扩展 prisma schema 新增 Notification + CheckIn 模型（含 @@unique 防重复签到）+ User 关联 + 8 个错误码 8101-8302（工单 4 项 + 通知 1 项 + 签到 2 项）；tsc 自检 0 errors |
| 1.0.0 | 2026-07-23 | **M7 完成 + 正式上线**：安全加固落地——全局限流代理（src/proxy.ts + Redis 滑动窗口 zset 实现 100 req/min/IP + §2.6.4 第 6 项 + 白名单路径 /api/health /api/webhooks/epay 豁免 + Redis 不可用降级放行不阻断 + proxy 默认 Node.js runtime 复用 ioredis）/ HTTP 安全头（injectSecurityHeaders HSTS max-age=31536000; includeSubDomains; preload + X-Frame-Options=DENY + X-Content-Type-Options=nosniff + Referrer-Policy=strict-origin-when-cross-origin + X-XSS-Protection=1; mode=block + Permissions-Policy geolocation/microphone/camera 禁用 + CSP default-src 'self' script/style 'unsafe-inline' img 'self' data: https: frame-ancestors 'none'，§2.6.4 第 17-18 项）/ 统一审计日志服务（audit-service + AuditAction 30+ 枚举覆盖 user/card/agent/withdrawal/config/apk/update/2fa/ticket + sanitizeDetails 递归脱敏 password/password_hash/client_secret/rsa_private_key/token/access_token/refresh_token/two_factor_secret/keystore_password/key_password + writeAuditLog 写入失败不阻断主流程 + listAuditLogs 超管查询 API，§2.6.4 第 12 项）/ 敏感字段加密（crypto-field AES-256-GCM + scrypt 密钥派生 N=16384 从 FIELD_ENCRYPTION_KEY 派生 32 字节 + 每条记录随机 12 字节 IV + 16 字节 AuthTag 防篡改 + 密文格式 base64(iv\|ciphertext\|authTag) + decryptFieldWithMask 脱敏展示 phone 138\*\*\*\*8888 / name 张\*\* / email z\*\*\*@example.com + isEncryptedField 兼容旧明文数据，§2.6.4 第 14 项）/ 2FA 双因子验证（two-factor-service TOTP RFC 6238 HMAC-SHA1 6 位数字 30 秒窗口 + Base32 编解码 + generateTotp Dynamic Truncation + verifyTotp 常量时间比较 timingSafeEqual 防时序攻击 + ±1 窗口容错时钟偏差 + generateBackupCodes 10 个 8 位一次性备份码 + enableTwoFactor/disableTwoFactor/verifyTwoFactorCode + 超管/代理 requireTwoFactor 强制 + 密钥 AES 加密存储 + 3 API 路由 GET 状态/POST 开启/DELETE 关闭 + POST verify，§2.6.4 第 10 项）/ 超管 IP 白名单（ip-whitelist-service 全局环境变量 SUPER_ADMIN_IP_WHITELIST + 用户个人 User.ip_whitelist + isValidIpFormat IPv4/IPv4 CIDR 校验 + isIpInWhitelist CIDR 掩码匹配 32 位整数 + checkSuperAdminIpAccess 综合校验 + 中间件层 SUPER_ADMIN_PATHS /admin /api/admin 拦截，§2.6.4 第 11 项）/ 健康检查 API（/api/health GET 数据库 prisma.$queryRaw SELECT 1 + Redis ping + 4 个关键环境变量 DATABASE_URL/REDIS_HOST/REDIS_PORT/JWT_SECRET + 200 healthy/503 unhealthy + 供负载均衡/监控探针）/ 新增错误码 PERMISSION_DENIED=1003 通用权限 + 8401 RATE_LIMIT_EXCEEDED + 8402-8404 TWO_FACTOR + 8405 IP_WHITELIST_FORBIDDEN + 8406-8407 FIELD 加解密 + 8408 SESSION_EXPIRED；tsc 自检 0 errors |
| 1.0.1 | 2026-07-23 | **构建修复**：解决 `next build` 在"收集页面数据（Collecting page data）"阶段因模块加载即抛错导致构建失败——Redis 客户端（src/lib/redis/index.ts）改为 Proxy 惰性初始化（构建期不创建连接、不校验环境变量、不抛错；运行时首次调用方法才创建单例并校验 REDIS_HOST/REDIS_PORT，保留铁律 04 显式失败；现有 `redis.xxx()` 调用点零改动）/ Better Auth 实例（src/lib/auth.ts）改为 Proxy 惰性初始化（构建期不创建实例；运行时首次访问属性才调用 betterAuth() 并校验 BETTER_AUTH_SECRET/BETTER_AUTH_URL；handler/GET/POST/signIn/signUp/signOut/getSession 全部包装为惰性转发函数；现有调用点零改动）/ Next.js 16 适配：src/middleware.ts → src/proxy.ts（middleware 文件约定已弃用，统一改名 proxy）+ 函数名 middleware → proxy + 移除 config 中的 runtime: 'nodejs'（Next.js 16 proxy 文件不允许设置 runtime，设置会抛错；proxy 默认 Node.js runtime 复用 ioredis）；tsc 自检 0 errors；next build 验证通过（27/27 静态页面生成成功，无 REDIS_HOST / BETTER_AUTH_SECRET / middleware 弃用警告，proxy 被正确识别为 ƒ Proxy (Middleware)）|
| 1.1.0 | 2026-07-23 | **M8.0 Web 前端核心 UI 框架完成**：基础布局（src/app/globals.css 主题色变量：背景 #FFFFFF/#F8FAFC + 文字 #1E293B/#64748B + 主色藏蓝 #1E3A5F + 辅助色 accent-blue/green/amber + danger + border #E2E8F0 + @theme inline 映射 + 强制 color-scheme: light 禁暗黑 + focus-visible 主色细环 + 极简滚动条）/ 根 layout（src/app/layout.tsx：lang="zh-CN" + AuthProvider + ToastProvider 包裹 + metadata 标题"网络验证 SaaS 控制台"）/ UI 原子组件 7 个（components/ui/：Button 4 变体 primary/secondary/ghost/danger + 3 尺寸 sm/md/lg + loading spinner / Input + Textarea + Select label/error/hint / Card + CardHeader + CardBody + CardFooter / Badge 6 变体 default/primary/success/warning/danger/info / Table + THead/TBody/TR/TH/TD/EmptyRow 斑马纹 #F8FAFC hover / Modal ESC 关闭 + 滚动锁 + 3 尺寸 sm/md/lg + ConfirmModal danger 变体 / ToastProvider 4 语义色 info/success/warning/danger + 3s 自动消失 + 右上角 viewport + 进入动画）/ 鉴权基础设施（lib/auth-client.ts createAuthClient 单例 + SessionUser 类型含 role / lib/http.ts request<T> 统一封装注入 X-User-Id/X-User-Role 头 + 处理 {code,msg,data,ts,nonce} 响应 + code===0 返回 data + code===8408 触发 sessionExpiredHandler + ApiError 携带 code/msg + get/post/patch/del 便捷方法 + withQuery 查询参数拼接 / components/auth/auth-provider.tsx useSession 同步 + 注册会话过期回调 setUser(null) + window.location /login?reason=expired + refresh 通过 authClient.getSession({query:{disableCookieCache:true}}) 直接拉取最新会话（修复 refetch 返回 Promise<void> 无法获取数据的 bug）+ signOutAndRedirect / components/auth/auth-guard.tsx allow prop 角色路由隔离 + 未登录重定向 /login + 角色不匹配重定向 ROLE_HOME + loading spinner）/ 登录注册（src/app/(auth)/login/page.tsx + register/page.tsx：Better Auth signIn.email/signUp.email + 默认 developer 角色 + 密码 8 字符 + 确认密码校验 + useSearchParams Suspense 包裹修复 Next.js 16 静态预渲染要求 + ?reason=expired 显示会话过期提示）/ 三角色仪表盘（src/app/(dashboard)/dashboard/page.tsx 服务端 auth.api.getSession 重定向 + developer/agent/admin/page.tsx AuthGuard allow 角色守卫 + components/dashboard/role-dashboard.tsx 共用组件 GET /api/dashboard + DeveloperDashboard/AgentDashboard/SuperAdminDashboard 三个 render + StatCard/StatItem/PageHeader/CheckinCard 共享子组件）/ 工单 Web 闭环（src/app/(dashboard)/tickets/page.tsx 列表 status/category 筛选 + limit/offset 分页 20/页 + 工单号/标题/类型/优先级/状态/创建时间/操作表格 + EmptyRow 空态 + 上一页/下一页 + tickets/new/page.tsx 创建表单 title 1-100 + content 1-5000 + category bug/feature/billing/other + priority low/medium/high/urgent + 字符计数 hint + tickets/[ticketId]/page.tsx 详情工单信息卡 + StatusBadge/PriorityBadge/CategoryBadge + 回复列表 is_staff 高亮 primary-subtle + 回复表单 2000 字符限制 + closed 禁止回复 + 状态管理 ConfirmModal：客服标记已解决 resolved / 提交者关闭 closed，权限校验与后端 ticket-service 一致）/ 通知 Web 闭环（src/app/(dashboard)/notifications/page.tsx 列表 isRead 筛选 + 分页 + 6 种类型语义色 Badge + 未读项 primary-subtle 高亮 + 红点标记 + 单条标为已读 + 全部标记已读按钮 + 本地状态更新避免整页刷新）/ 签到 Web 闭环（src/app/(dashboard)/checkin/page.tsx 今日签到状态 Badge + 立即签到按钮已签到禁用 + 7 天奖励规则可视化网格 active/isToday 高亮 + 第 7 天封顶提示 + 最近 30 天签到记录 Table 日期/连续天数/奖励金额/签到时间 + EmptyState 空态）/ 共享组件（components/layout/page-header.tsx PageHeader + PageLoading + EmptyState / components/common/badges.tsx TicketStatus/Category/Priority + NotificationType 枚举 + StatusBadge/PriorityBadge/CategoryBadge + TICKET_STATUS_LABEL/CATEGORY_LABEL/PRIORITY_LABEL + NOTIFICATION_TYPE_LABEL + formatDateTime/formatDate）/ 顶栏 bug 修复（components/layout/topbar.tsx：unread-count API 返回 {count} 而非 {unread}，原代码 data?.unread 永远为 0，修复为 data?.count）；tsc 自检 0 errors；next build 验证通过（37/37 路由，新增 5 个静态页 /checkin /notifications /tickets /tickets/new /login + 1 个动态页 /tickets/[ticketId]，ƒ Proxy (Middleware) 识别正常，无 REDIS_HOST/BETTER_AUTH_SECRET 抛错）|
| 1.2.0 | 2026-07-23 | **M8.1 开发者管理页完成 + 官网营销页**：官网营销页（src/app/page.tsx 重写为 client 营销页：Hero 区 + 8 项核心特性卡片 + 12 语言 SDK 展示 + 注册 CTA + 顶部登录态感知导航 useAuth 判断"进入控制台"/"登录/免费注册"）/ 后端 web API 路由层补全（apps/card-keys/devices/cloud-variables/shops/products/packages/user-packages/orders 共 30+ 路由 + service 补 listAppsByDeveloper/getAppById/disableApp/listCards/deleteCard/listDevices/getDeviceById/deleteVariable/getShop/deleteShop/deleteProduct/updatePackage/listAllOrders 13 个方法，手写校验非 zod 对标现有路由风格）/ M8.1 开发者 8 模块管理页（应用：列表状态筛选分页 / 创建 clientSecret+privateKey 仅显示一次 / 详情编辑版本/公告/心跳/设备上限/解绑规则 / 重签 / 停用；卡密：列表应用/状态筛选分页 / 批量生成 7 类型同步/异步 / 详情签名/校验位/水印 / 作废 / 加黑名单；设备：列表应用/状态筛选分页 / 详情机器码/心跳/序列号 / 加黑名单 / 解绑；云变量：应用选择 + 列表 + Modal 新增编辑 key/value/类型/公开 + 删除（http.ts 新增 put 方法）；APK 注入：任务列表状态筛选分页 / 上传 FormData 注入配置 / 详情 5s 轮询取消 / 下载 blob；接入中心：6 步流程向导 API 下发非硬编码 + 语言选择主流/社区分组 + 代码生成 baseUrl/appKey + 测试连接；店铺商品：店铺列表创建/编辑/删除 Modal + 店铺详情商品 CRUD 价格/库存/上下架；套餐充值：套餐列表卡片网格 + 订阅 ConfirmModal + 当前有效套餐剩余额度到期 + 订阅记录）/ sidebar 移除 developer comingSoon 标记；tsc 自检 0 errors；next build 验证通过（54/54 路由，新增 17 个开发者页面，ƒ Proxy (Middleware) 识别正常）|
| 1.3.0 | 2026-07-23 | **M8.2 代理管理页完成**：后端 web API 路由层补全 18 路由（agent 自助 4 路由：GET /api/agent/profile|balance|subordinates|tree；提现 2 路由：GET+POST /api/withdrawals + GET /api/withdrawals/[id]；邀请码 3 路由：GET+POST /api/invitations + GET /api/invitations/[code] + GET /api/invitations/validate；超管 9 路由：GET /api/admin/agents + GET /[agentId] + PATCH /[agentId]/status + PATCH /[agentId]/commission-rate + GET /api/admin/withdrawals + POST /[id]/approve|reject|paid + GET /api/admin/invitations；service 补 listAllAgents/getAgentById/getWithdrawalById/listWithdrawalsWithTotal/listAllInvitations 5 个方法，手写校验非 zod，路由层捕获 service 错误映射到现有错误码 PERMISSION_DENIED/PARAM_FORMAT/PARAM_MISSING/SYSTEM_ERROR）/ M8.2 代理概览（4 余额卡片累计佣金/已提现/审核中/可提现 + 代理信息层级/佣金比例/状态 + 快捷入口，profile 为 null 时 EmptyState 提示联系上级开通代理身份）/ M8.2 下级代理（三层分段切换一级/二级/三级 + 每层表格邮箱/昵称/层级/佣金比例/累计佣金/状态 + 三层总数统计 + EmptyState 空态）/ M8.2 邀请码（列表 code 可复制 + 类型/使用模式/目标层级/已用上限/过期/状态 Badge + 创建 Modal type/targetLevel/usageMode/maxUses/expiresInDays 条件显示校验）/ M8.2 佣金明细（4 余额卡片 + 提现记录表格金额/状态/收款账户/申请审核打款时间/驳回原因 + 状态筛选分页 + 申请提现入口跳转）/ M8.2 提现申请（可提现余额卡片 + 提现记录表格 + 发起提现 Modal amount/payoutType alipay|wxpay|bank/account/name/bank 条件校验 + 1 元起校验）/ sidebar 移除 agent comingSoon 标记 + 注释更新 M8.2 已完成；tsc 自检 0 errors；next build 验证通过（59/59 路由，新增 5 个代理页面 + 18 个 API 路由，ƒ Proxy (Middleware) 识别正常）|
| 1.4.0 | 2026-07-23 | **M8.3 超管管理页完成**：后端 web API 路由层补全 8 路由（系统配置 2：GET /api/admin/config 按 group 查询 + PUT /api/admin/config/[key] 更新；用户管理 3：GET /api/admin/users role/status/keyword/limit/offset 筛选分页 + PATCH /[userId]/status 封禁/解封 + PATCH /[userId]/role 角色变更；超管专属 3：GET /api/admin/revenue 收入汇总+最近支付 + GET/PUT /api/admin/ip-whitelist 全局+个人白名单；service 新增 user-service.ts listUsersForAdmin/changeUserStatus/changeUserRole + config-service.ts listSystemConfigs/getSystemConfig/updateSystemConfig，与 epay-service.getEpayConfig 共享同一张 SystemConfig 表；2FA/提现/工单/审计/更新 复用既有 M7/M8.2/M6/M0 路由，更新面板走 Better Auth getSession cookie 鉴权非 X-User-Id/X-User-Role 头，http.ts credentials:"include" 透传 Cookie 兼容）/ M8.3 超管仪表盘（5 卡片组：用户规模/业务规模/收入与提现/工单状态/APK 注入任务 + 6 子页快捷入口，formatYuan Decimal→2 位小数）/ M8.3 用户管理（role/status/keyword 筛选 + 分页 20/页 + ConfirmModal 封禁/解封 + Modal 角色变更 Select + 自我封禁/降级提示）/ M8.3 业务总览（业务规模/工单分布/APK 注入任务 3 卡片组 + 收入/工单入口）/ M8.3 收入明细（今日/本月/累计 3 卡片 + 最近支付表格 金额/方式/三方号/订单/用户/时间 + PAYMENT_METHOD_LABEL epay→彩虹易支付 映射）/ M8.3 提现审核（agentUserId/status 筛选 + 分页 + parsePayoutAccount JSON 安全解析 + 状态条件按钮：pending 通过/驳回 + approved 标记打款 + Reject Modal reason Textarea + Paid Modal tradeNo Input）/ M8.3 工单客服（status/category 筛选 + 分页 + 工单号/标题/状态/优先级/类型/提交人/时间/操作表格 + StatusBadge/PriorityBadge/CategoryBadge + 跳转 /tickets/[ticketId] 共享详情页）/ M8.3 系统配置（group 筛选 payment/storage/email/sms/cdn/backup/general + 表格 key/value/group/description/操作 + maskValue 加密配置 ****** 脱敏 + Edit Modal Textarea 加密配置不回填）/ M8.3 审计日志（action 20 选项/targetType 8 选项/userId 搜索 3 筛选 + PAGE_SIZE=50 + 表格 时间/用户/操作/对象/异常标记 + Detail Modal lg 全字段 + prettyJson details 美化 + is_abnormal danger Badge）/ M8.3 安全（2FA 状态卡 enabled/required/backupCodesRemaining + 两阶段开启 Modal accountName→secret/otpAuthUri/backupCodes + 关闭 Modal code 校验，DELETE 走 request() 直接传 body 修复 http.ts del 不支持 body；IP 白名单卡 全局只读 env + 个人 Textarea 一行一 IP，2FA 开启时显示字段冲突 warning 替换 textarea 防覆盖备份码）/ M8.3 更新面板（版本卡 currentVersion 截断 12 字符 + hasUpdate Badge + latestVersion 详情 + 触发更新按钮 !hasUpdate 禁用 + 回滚 window.confirm + 远程提交日志表 SHA/信息/作者/时间 + 本地历史表 时间/操作/状态/触发方式/操作人/版本/错误 + ACTION_LABEL/STATUS_LABEL/STATUS_VARIANT 映射）/ sidebar 移除全部 9 个 admin comingSoon 标记 + 注释更新 M8.3 已完成；tsc 自检 0 errors；next build 验证通过（36 静态页 + 82 API 路由，新增 9 个超管页面，ƒ Proxy (Middleware) 识别正常）|
| 1.5.0 | 2026-07-23 | **首次安装向导 + 环境变量修复**：首次安装向导（后端 setup-service.ts checkNeedsSetup 查询 super_admin count=0 + createFirstSuperAdmin 调用 Better Auth signUpEmail 创建用户后 prisma 更新 role=super_admin + 清理自动创建的 session 不自动登录 + 写审计日志 USER_ROLE_CHANGE；/api/setup GET 状态查询 + POST 创建首个超管，公开接口无需鉴权，POST 内部二次校验无超管防提权滥用，手写校验 email 正则/password≥8/name 2-32 非 zod；SetupError 业务错误类区分 PERMISSION_DENIED/SYSTEM_ERROR）/ 前端 /setup 安装向导页（useEffect 检查 needsSetup，false 跳转 /login，true 显示表单 用户名/邮箱/密码/确认密码 + Badge 首次安装标识 + 警告提示"仅在无超管时可用" + 创建成功跳转 /login 手动登录验证凭据；登录页底部新增"首次部署系统？进入安装向导"入口链接）/ 环境变量命名统一（修复代码 auth.ts 读 BETTER_AUTH_SECRET/BETTER_AUTH_URL 但 docker-compose.yml/install.sh 提供 AUTH_SECRET 的不一致 + 代码 redis/index.ts 读 REDIS_HOST/REDIS_PORT 但 compose 提供 REDIS_URL 的不一致 + health 检查 JWT_SECRET 与实际不符 + FIELD_ENCRYPTION_KEY 未在 compose/install 注入）：docker-compose.yml 改 AUTH_SECRET→BETTER_AUTH_SECRET + 新增 BETTER_AUTH_URL 默认 http://localhost:${APP_PORT}/REDIS_HOST=redis/REDIS_PORT=6379/REDIS_PASSWORD/FIELD_ENCRYPTION_KEY；deploy/install.sh generate_env 生成 BETTER_AUTH_SECRET/BETTER_AUTH_URL=http://localhost:${APP_PORT}/FIELD_ENCRYPTION_KEY 替代 AUTH_SECRET + 部署信息文件输出 BETTER_AUTH_SECRET + 新增"首次安装"访问地址 http://${public_ip}:${APP_PORT}/setup 提示；health route requiredEnvVars 改为 DATABASE_URL/REDIS_HOST/REDIS_PORT/BETTER_AUTH_SECRET/BETTER_AUTH_URL/FIELD_ENCRYPTION_KEY）/ 新增 .env.example 模板（APP_PORT/APP_IMAGE/DATABASE_URL/DB_*/REDIS_*/BETTER_AUTH_SECRET/BETTER_AUTH_URL/FIELD_ENCRYPTION_KEY/SUPER_ADMIN_IP_WHITELIST 全量示例 + openssl rand 生成提示 + 注释说明代码读取位置）/ .gitignore 新增 !.env.example 例外允许提交模板；tsc 自检 0 errors；next build 验证通过（37 静态页 + 83 API 路由，新增 /setup 页 + /api/setup 路由，ƒ Proxy (Middleware) 识别正常）|
| 1.5.1 | 2026-07-23 | **移除 /setup 安装向导，改为容器启动自动创建默认超管**：背景——/setup 向导流程重（前端表单 + 后端 service + 公开 API + 二次鉴权），且依赖 Better Auth signUpEmail 触发字段映射冲突（password_hash/email_verified/password 等问题），改为容器启动时幂等脚本自动创建默认超管更稳健。删除文件（src/app/(auth)/setup/page.tsx 前端向导页 + src/app/api/setup/route.ts 公开 API + src/server/modules/setup/setup-service.ts 业务服务，含目录清空）/ 新增 scripts/init-admin.mjs（容器启动时在 prisma db push 之后、node server.js 之前执行；幂等：prisma.user.count({where:{role:'super_admin'}})>0 则跳过；邮箱已被非超管占用则跳过；事务创建 User + Account：User.password_hash + Account.password 双写相同 hash，Account.provider=credential/provider_account_id=email；hashPassword 与 better-auth/crypto 完全兼容——salt(16字节 hex):key(64字节 hex)，scryptSync N=16384/r=16/p=1/dkLen=64/maxmem=128\*N\*r\*2，password.normalize('NFKC')，登录时 verifyPassword 可正常校验；输出默认账密到容器日志 + 安全提示）/ Dockerfile CMD 集成（runner 阶段新增 COPY --from=builder scripts ./scripts；CMD 由 `npx prisma db push --skip-generate && node server.js` 改为 `npx prisma db push --skip-generate && node scripts/init-admin.mjs && node server.js`）/ deploy/install.sh 输出调整（save_and_print_deploy_info 移除"首次安装 http://${public_ip}:${APP_PORT}/setup"行，新增"超管账号 : admin@example.com" + "超管密码 : admin123" 到部署信息文件与终端输出 + 黄色警告"默认密码较弱，请登录后立即在「安全」页面修改密码"）/ README 部署文档同步（移除"访问 /setup 进入首次安装向导"步骤，改为"使用默认超管 admin@example.com/admin123 登录 + 立即修改密码"；手动部署段移除"访问 /setup 创建超管"，改为"容器自动执行 init-admin.mjs 创建默认超管"）/ src/lib/auth.ts 注释由"由 setup/超管修改"改为"由超管修改"；tsc 自检 0 errors；next build 验证通过 |
| 1.5.2 | 2026-07-23 | **移除容器启动自动同步表结构**：背景——容器每次启动都执行 `npx prisma db push --skip-generate` 在生产环境有风险（可能误改表结构/拖慢启动/与 migrate 流程冲突），改为表结构由部署前手动创建更安全可控。Dockerfile 改动（CMD 由 `npx prisma db push --skip-generate && node scripts/init-admin.mjs && node server.js` 改为 `node scripts/init-admin.mjs && node server.js`；line 51 注释由"运行时执行 db push 同步表结构"改为"供容器内手动执行 prisma 命令（如手动创建表）"；line 60-61 注释由"1) prisma db push 同步表结构 2) init-admin 3) server"改为"1) init-admin 2) server + 数据库表需在部署前手动创建"；保留 prisma CLI + schema COPY 供容器内手动 prisma 操作）/ deploy/install.sh wait_for_healthy 提示由"首次启动时 app 容器会自动执行 prisma db push 同步表结构，可能稍慢"改为"首次启动需先手动创建数据库表（docker compose exec app npx prisma db push），否则 init-admin 会失败"/ README 手动部署段注释由"同步数据库表结构（开发环境用 db push；生产环境首次部署也用 db push...）"改为"创建数据库表（手动部署需执行一次；后续表结构变更用 npm run db:migrate）"；容器启动说明由"app 容器会自动执行 prisma db push 同步表结构 + init-admin"改为"app 容器会自动执行 init-admin（需确保数据库表已提前创建）"/ scripts/init-admin.mjs 头注释由"在 prisma db push 之后、node server.js 之前执行"改为"在 node server.js 之前执行"；tsc 自检 0 errors；next build 验证通过 |
| 1.5.3 | 2026-07-23 | **优化一键安装脚本 deploy/install.sh**：背景——1.5.2 移除 Dockerfile CMD 中的 `prisma db push` 后，部署需手动建表，破坏一键体验；且原脚本无幂等/子命令/失败诊断能力。优化点①自动建表（start_services 重构为分步：`docker compose up -d db redis` → wait_for_db_healthy 最多 90s 轮询 docker healthcheck → `docker compose run --rm --no-deps app npx prisma db push --skip-generate` 临时容器建表 → `docker compose up -d app apk-injector`，表已存在 init-admin 成功）/ ②子命令（main case 分发：install 默认幂等 / update 拉新镜像+同步表+重启 / uninstall docker compose down 保留数据卷 / reinstall 保留 .env 重装 / --help）/ ③幂等检测（is_installed 检 .env+compose 文件，is_running 检 app 容器 Running 状态，已安装且运行中则提示引导子命令不重复安装）/ ④失败自动打日志（dump_logs 函数：db 未就绪/建表失败/app 健康检查失败时自动 `docker compose logs --tail=50`）/ ⑤健壮性（`set -euo pipefail`；prepare_image 拆分远程拉取+本地构建回退；prepare_local_build_source 复用判断 Dockerfile 是否已存在；is_running 用子 shell cd 避免副作用）/ ⑥本地构建模式补充 cp scripts 目录（init-admin.mjs 需要）/ ⑦shellcheck 通过（修复 SC2002 useless cat → `tr < file`、SC2015 `A&&B||C` → `|| cid=""`，仅剩 SC1091 source /etc/os-release 不可避免 info）/ README 部署文档新增「常用运维命令」段（update/uninstall/reinstall/--help 示例）+ 安装步骤说明新增第 7 步分步启动建表 + 幂等提示；bash -n 语法检查通过 + --help 输出验证 + 未知命令处理验证 |
