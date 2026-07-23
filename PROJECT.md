# jicek-wlyz 项目文档（PROJECT.md）

> 版本：1.7.1 ｜ 状态：新增 SDK 下载与对接教程 + 配置中心改为分组独立表单页 ｜ 最后更新：2026-07-23
> 维护规则：任何变更按 SPEC.md 联动更新，版本号语义化递增

---

## 1. 项目概述

### 1.1 目标
构建一套多租户云端 SaaS 网络验证系统，面向**开发者**（付费购买套餐，接入验证服务）与**代理**（凭开发者邀请码注册，仅拿佣金，3 层分销）两类用户。系统提供登录验证、卡密发售、设备绑定、云变量、APK 注入、多语言 SDK 等能力。

### 1.2 背景
- 对标产品：米验（b6w.top）——产品形态、加密链路、UI 调性参考
- 借鉴开源：License SaaS（Go+Vue+SQLite，论坛公开）——**仅参考功能模块划分与安全协议设计，不二开**（本项目技术栈为 Next.js）
- 差异化：对标米验做得更全（10+ 语言接入、APK 重打包注入工具、3 层代理、签名防篡改）

### 1.3 适用范围
- 部署形态：多租户云 SaaS（统一一套，开发者注册即用）
- 规模目标：500+ 开发者、日验证 5000+ 次调用
- 端：响应式 H5（PC + 平板 + H5 三端适配）

### 1.4 技术栈（已锁定，不再讨论替代方案）
| 层 | 选型 |
|---|---|
| 前端 | Next.js 16 App Router + TypeScript + TailwindCSS v4（自实现 UI 组件库，无外部 UI 库） |
| 后端 | Next.js Route Handlers / Server Actions + REST API |
| ORM | Prisma |
| 主库 | PostgreSQL 16 |
| 缓存 | Redis 7（心跳、在线列表、签名 nonce、限流、验证结果缓存） |
| 鉴权 | Better Auth（三角色 RBAC） |
| 支付 | 彩虹易支付（管理员后台自行配置商户号） |
| 队列 | BullMQ（基于 Redis，异步任务：APK 注入、卡密批量生成、通知） |
| 文件存储 | 对象存储（管理员后台自选：七牛 / 阿里 OSS / Cloudflare R2） |
| 部署 | 自建 VPS（Debian）+ 宝塔面板 + Docker（SSH 一键安装脚本） |

---

## 2. 架构总览

### 2.1 核心模块（10 大模块）

| # | 模块 | 说明 |
|---|---|---|
| 1 | 应用管理 | 开发者创建应用 → 获取 AppKey + client_secret → 配置版本号/公告/强制更新/心跳间隔/设备策略（1~10000 台） |
| 2 | 卡密体系 | 7 种类型（天卡/周卡/月卡/年卡/永久卡/次数卡/自定义小时卡）+ 批量生成 + 模板 + CRC32 校验位 + RSA 签名 |
| 3 | 设备管理 | 机器码绑定 + 心跳保活 + 在线/离线 + 黑名单 + 临时封禁 + 解绑规则 |
| 4 | 登录验证 | 账号密码 + 卡密 + 机器码绑定 + RSA-2048 + AES-256-CBC + TS/Nonce 三重加密通信 |
| 5 | 云变量 | 每应用独立 KV 配置池，登录后凭 token 读取，服务端签名防篡改 |
| 6 | 代理分销 | 3 层代理（A→B→C→D，D 制卡 C 分 3% / B 分 2% / A 分 1%）+ 代理独立后台 + 余额管理 + 邀请码 |
| 7 | 发卡业务 | 店铺 + 商品 + 库存 + 订单 + 收益（对接彩虹易支付） |
| 8 | APK 注入工具 | 在线上传 APK → BullMQ 异步调用 apktool + 平台 SDK smali 注入 → 重新签名 → 返回新 APK |
| 9 | 多语言接入 | 平台自维护 6 种主流 SDK（Python/Java/PHP/Node.js/Go/易语言）+ 协议规范 + 社区贡献小众（gglua/andlua/auto.js/shell/按键精灵/html-js） |
| 10 | 工单 + 账户服务 | 工单系统 + 充值 + 订单 + 签到 + 数据看板 |
| 11 | **GitHub 自动更新系统** | Webhook 监听 push 事件 → git pull + 依赖安装 + 数据库迁移 + 缓存清理 → 自动重启 Docker 容器 → 管理员弹窗提醒 + 后台更新面板 + 版本历史 + 一键回滚 |

### 2.2 数据流

```
开发者客户端（10+ 语言 SDK / APK 注入）
    │
    │ RSA-2048 签名 + AES-256-CBC 加密 + TS/Nonce
    ▼
Next.js API（Route Handlers）
    │
    ├──► PostgreSQL（持久化：应用/卡密/设备/订单/代理/工单）
    ├──► Redis（心跳/在线列表/nonce 去重/限流/验证结果缓存 TTL 60s）
    ├──► BullMQ（异步：APK 注入/卡密批量生成/邮件通知）
    └──► 对象存储（APK 上传/SDK 包下载）

代理 / 开发者后台 ──► Better Auth（三角色 RBAC）──► Next.js 页面
```

### 2.3 角色权限（3 级）
| 角色 | 权限 |
|---|---|
| 超级管理员 | 全平台管理、套餐定价、代理审核、系统配置、彩虹易支付商户号配置 |
| 代理 | 3 层分销、查看下级代理、佣金结算、提现、生成开发者邀请码 |
| 开发者 | 创建应用、生成卡密、配置设备策略、上传 APK 注入、查看 SDK 文档、邀请代理、充值套餐 |

---

## 3. 功能清单

> 状态标记：[规划中] / [开发中] / [已完成] / [已移除]

### 3.1 开发者端
- [已完成] 注册 / 登录 / 套餐购买（包月，应用数 + 卡密额度 1:1）
- [已完成] 在线充值（彩虹易支付，MD5 签名 + 异步回调 + 金额校验）
- [已完成] 应用管理（创建 / 配置 / AppKey + client_secret）
- [已完成] 卡密管理（7 种类型 / 批量生成 / 模板 / 签名）
- [已完成] 设备管理（绑定 / 心跳 / 黑名单 / 解绑）
- [已完成] 云变量（KV 配置池 / 签名下发）
- [已完成] APK 注入工具（在线上传 / 异步注入 / 下载）
- [已完成] 接入中心（一键接入向导 + 流程图 + 代码生成器 + 测试连接）
- [已完成] 邀请代理（生成邀请码：一次性/可复用/限量/有效期/绑定关系）
- [已完成] 店铺与商品管理（创建店铺 / 商品上下架 / 关联卡密模板 / 库存管理）
- [已完成] 工单系统（创建 / 列表 / 详情 / 回复 / 状态流转 open→in_progress→resolved→closed / 权限校验）
- [已完成] 数据看板（开发者/代理/超管三角色维度统计 / 收入 / 工单 / 提现 / APK 注入）

> 登录验证 API（verify_rsa / auth / use / unbind / check_update / heartbeat）已于 M2 完成，对标 SPEC §2.3 接口规范。

### 3.2 代理端
- [已完成] 凭邀请码注册代理（3 层分销 A→B→C→D）
- [规划中] 独立后台
- [已完成] 3 层分销佣金查看（直接/二级/三级上级）
- [已完成] 余额管理 + 提现（1 元起，T+1 日结，pending/approved/rejected/paid 状态机）
- [已完成] 生成下级邀请码（开发者邀请 / 代理邀请，once/reusable/limited 三种模式）
- [已完成] 通知中心（站内信 / 未读红点 / 全部已读）
- [已完成] 每日签到（连续签到奖励 0.10-0.50 元 / 余额自动入账）

### 3.3 超管端
- [规划中] 全平台管理
- [已完成] 套餐定价（包月套餐 + app_quota + card_quota + sort_order）
- [已完成] 代理审核（注册审核 + 状态冻结 + 佣金比例调整）
- [规划中] 系统配置（彩虹易支付商户号 / 对象存储 / 邮件 / 短信 / Cloudflare CDN）
- [已完成] 数据看板（全平台用户/业务/收入/工单/提现/APK 注入统计）
- [已完成] 提现审核（pending → approved/rejected → paid 全流程）
- [已完成] **GitHub 自动更新面板**（当前版本/最新版本/更新日志/立即更新/版本历史/一键回滚）
- [已完成] **新版本弹窗提醒**（WebSocket 实时推送，立即更新/稍后提醒）
- [已完成] 工单客服处理（回复自动置为 in_progress / 标记 resolved / 关闭 closed）
- [已完成] **全局限流代理**（proxy.ts，IP 令牌桶 100 req/min，§2.6.4 第 6 项）
- [已完成] **HTTP 安全头**（HSTS / X-Frame-Options / CSP / X-Content-Type-Options，§2.6.4 第 17-18 项）
- [已完成] **2FA 双因子验证**（TOTP RFC 6238 + 备份码 + 超管/代理强制，§2.6.4 第 10 项）
- [已完成] **超管 IP 白名单**（全局环境变量 + 用户个人白名单 + CIDR 支持，§2.6.4 第 11 项）
- [已完成] **统一审计日志**（audit-service + 30+ 操作类型 + 敏感字段脱敏，§2.6.4 第 12 项）
- [已完成] **敏感字段加密**（AES-256-GCM + scrypt 密钥派生，手机号/真实姓名加密存储，§2.6.4 第 14 项）
- [已完成] **健康检查 API**（/api/health，数据库 + Redis + 环境变量检查，供负载均衡探针）

### 3.4 Web 控制台（M8.0 / M8.1 / M8.2 已完成）
- [已完成] 官网营销页：/ 首页改为产品介绍页（Hero + 8 项核心特性 + 12 语言 SDK 展示 + 注册 CTA + 登录态感知导航）
- [已完成] 基础布局：根 layout + AuthProvider + ToastProvider + 主题色变量（藏蓝 #1E3A5F）
- [已完成] UI 原子组件：Button / Input / Textarea / Select / Card / Badge / Table / Modal / ConfirmModal / Toast（自实现，无外部 UI 库）
- [已完成] 鉴权基础设施：Better Auth 客户端（useSession）+ HTTP 封装（X-User-Id / X-User-Role 头注入 + 8408 会话过期跳登录）+ AuthGuard 角色守卫
- [已完成] 登录 / 注册：Better Auth signIn.email / signUp.email，注册默认 developer 角色
- [已完成] 角色仪表盘：开发者 / 代理 / 超管三角色共用 RoleDashboard 组件，对接 GET /api/dashboard
- [已完成] 侧边栏 + 顶栏：角色感知侧边栏（通用入口 + 角色专属入口）+ 顶栏通知红点轮询（30s）+ 退出确认
- [已完成] 工单 Web 闭环：列表（状态/类型筛选 + 分页）/ 创建（标题/内容/类型/优先级校验）/ 详情（回复列表 + 回复表单 + 状态管理：客服标记已解决 / 提交者关闭）
- [已完成] 通知 Web 闭环：列表（已读/未读筛选 + 分页）+ 单条/全部标记已读
- [已完成] 签到 Web 闭环：今日签到状态 + 立即签到 + 7 天奖励规则可视化 + 最近 30 天签到记录
- [已完成] M8.1 应用管理：列表（状态筛选+分页）/ 创建（clientSecret+privateKey 仅显示一次）/ 详情+编辑（版本/公告/心跳/设备上限/解绑规则）/ 重签 / 停用
- [已完成] M8.1 卡密管理：列表（应用/状态筛选+分页）/ 批量生成（7 类型+同步/异步）/ 详情（签名/校验位/水印）/ 作废 / 加黑名单
- [已完成] M8.1 设备管理：列表（应用/状态筛选+分页）/ 详情（机器码/心跳/序列号）/ 加黑名单 / 解绑
- [已完成] M8.1 云变量管理：应用选择 + 列表 / Modal 新增编辑（key/value/类型/公开）/ 删除（服务端签名防篡改）
- [已完成] M8.1 APK 注入：任务列表（状态筛选+分页）/ 上传（FormData+注入配置）/ 详情（5s 轮询+取消）/ 下载
- [已完成] M8.1 接入中心：6 步流程向导（API 下发非硬编码）/ 语言选择（主流+社区分组）/ 代码生成（baseUrl+appKey）/ 测试连接
- [已完成] M8.1 店铺商品：店铺列表（创建/编辑/删除 Modal）/ 店铺详情 + 商品 CRUD（价格/库存/上下架）
- [已完成] M8.1 套餐充值：套餐列表（卡片网格+订阅 ConfirmModal）/ 当前有效套餐（剩余额度+到期）/ 订阅记录
- [已完成] M8.2 代理概览：4 余额卡片（累计佣金/已提现/审核中/可提现）+ 代理信息（层级/佣金比例/状态）+ 快捷入口（profile 为 null 时提示联系上级）
- [已完成] M8.2 下级代理：三层分段切换（一级/二级/三级）+ 每层表格（邮箱/昵称/层级/佣金比例/累计佣金/状态）+ 三层总数统计
- [已完成] M8.2 邀请码：列表（code 可复制 + 类型/使用模式/目标层级/已用上限/过期/状态 Badge）+ 创建 Modal（type/targetLevel/usageMode/maxUses/expiresInDays 条件显示）
- [已完成] M8.2 佣金明细：4 余额卡片 + 提现记录表格（金额/状态/收款账户/申请审核打款时间/驳回原因）+ 状态筛选分页 + 申请提现入口
- [已完成] M8.2 提现申请：可提现余额卡片 + 提现记录表格 + 发起提现 Modal（amount/payoutType alipay|wxpay|bank/account/name/bank 条件校验）
- [规划中] M8.3 超管管理页：用户管理 / 业务总览 / 收入明细 / 提现审核 / 工单客服 / 系统配置 / 审计日志 / 2FA / IP 白名单 / 更新面板

### 3.5 客户端 SDK（10+ 语言）
- [已完成] Python SDK（cryptography 库 + 完整 6 actions + ECDHE-PFS）
- [已完成] Java SDK（JDK crypto + Gson + 完整 6 actions + ECDHE-PFS）
- [已完成] PHP SDK（openssl + curl 扩展 + 完整 6 actions + ECDHE-PFS）
- [已完成] Node.js SDK（内置 fetch + crypto + 完整 6 actions + ECDHE-PFS）
- [已完成] Go SDK（标准库 crypto/* + 完整 6 actions + ECDHE-PFS）
- [已完成] 易语言模块（精易模块 + OpenSSL DLL + 完整 6 actions）
- [已完成] gglua 示例代码（社区贡献，GG 修改器 Lua 脚本）
- [已完成] andlua 示例代码（社区贡献，AndroLua+ LuaJ 桥接 Java Crypto）
- [已完成] autojs 示例代码（社区贡献，Auto.js Pro Node.js 兼容 API）
- [已完成] shell 示例代码（社区贡献，curl + openssl + jq）
- [已完成] 按键精灵示例代码（社区贡献，Call.Cmd 调用 curl/openssl）
- [已完成] html/js 示例代码（社区贡献，Web Crypto API + fetch）
- [已完成] APK 注入工具（在线 + 命令行）
- [已完成] 协议规范文档（docs/api/protocol.md，6 actions + 加密细节 + 错误码 + 12 语言对照）

---

## 4. 使用指南

### 4.1 部署方式
自建 VPS + 宝塔面板 + Docker。提供 SSH 一键安装脚本：

```bash
curl -sSL <脚本URL> | bash
```

**脚本能力**：
1. 检测宝塔面板，未安装则拉取官方脚本安装
2. 检测 Docker，未安装则通过宝塔应用商店或官方脚本安装
3. 端口冲突检测（`ss -tuln` + 占用自动 +1）：宝塔端口 / 项目端口 / DB 端口 / Redis 端口
4. 随机生成数据库密码、Redis 密码、JWT Secret（`openssl rand`）
5. 拉取预构建 Docker 镜像启动（不上传源码）
6. 输出配置并保存至 `/root/auth-saas-deploy.txt`

**待核实**：
- ~~服务器系统版本~~ → 已确认 Debian
- ~~脚本托管 URL~~ → 已确认 GitHub raw：`https://raw.githubusercontent.com/laobi465/jicek-wlyz/main/deploy/install.sh`

### 4.2 管理员首次配置
1. 访问宝塔面板（端口由脚本输出）
2. 进入项目容器，访问管理后台（端口由脚本输出）
3. **首次安装向导**：设置超管账号 + 密码（不写死在脚本，不环境变量，向导式设置）
4. 配置彩虹易支付商户号（管理员后台自行配置）
5. 配置对象存储（管理员后台自选：七牛/阿里 OSS/Cloudflare R2）
6. 配置邮件 SMTP（管理员后台自定义服务商）
7. 配置短信服务（管理员后台自定义服务商）
8. 配置套餐定价（管理员后台自定义）
9. 配置数据库备份周期（管理员后台自定义）

### 4.3 开发者接入流程
1. 注册开发者账号
2. 购买套餐（包月，应用数 + 卡密额度 1:1）
3. 创建应用，获取 AppKey + client_secret
4. 进入「接入中心」选择语言
5. 复制代码或下载 SDK 包
6. 测试连接
7. 上线

---

## 5. 目录结构说明

> M1 已落地（基础架构 + /bdeploy），M2 待实现。以下为当前实际结构（已实现的模块保留，规划中的标注待实现）。

```
jicek-wlyz/
├── PROJECT.md                      # 本文件
├── SPEC.md                         # 规划/规范/开发流程文档
├── README.md                       # 项目说明
├── .env.example                    # 环境变量示例（用 <在此填写 XXX> 标注）
├── docker-compose.yml              # Docker 编排
├── Dockerfile                      # 镜像构建
├── deploy/
│   └── install.sh                  # SSH 一键安装脚本
├── prisma/
│   ├── schema.prisma               # 数据库 Schema
│   └── migrations/                 # 数据库迁移
├── src/
│   ├── app/                        # Next.js App Router
│   │   ├── (public)/               # 公开页面（登录/注册）
│   │   ├── (admin)/                # 超管后台
│   │   ├── (agent)/                # 代理后台
│   │   ├── (developer)/            # 开发者后台
│   │   └── api/                    # API 路由
│   │       ├── auth/               # Better Auth
│   │       ├── v1/                 # 验证 API（SDK 调用）
│   │       └── webhooks/           # 支付回调
│   ├── components/                 # React 组件
│   ├── lib/                        # 工具库
│   │   ├── crypto/                 # RSA + AES + 签名
│   │   ├── db/                     # Prisma 客户端
│   │   ├── redis/                  # Redis 客户端
│   │   └── queue/                  # BullMQ 队列
│   ├── server/                     # 服务端业务逻辑
│   │   ├── modules/                # 业务模块
│   │   └── services/               # 服务层
│   └── types/                      # TypeScript 类型
├── sdks/                           # 多语言 SDK 源码
│   ├── python/
│   ├── java/
│   ├── php/
│   ├── nodejs/
│   ├── go/
│   └── e/                          # 易语言模块
├── examples/                       # 小众语言示例代码
│   ├── gglua/
│   ├── andlua/
│   ├── autojs/
│   ├── shell/
│   ├── anjian/
│   └── htmljs/
├── tools/
│   └── apk-injector/               # APK 注入工具（在线 + 命令行）
└── docs/                           # 开发者文档
    ├── api/                        # API 文档
    ├── sdks/                       # 各语言 SDK 文档
    └── images/                     # 接入流程图等图片
```

---

## 6. 贡献指南

- 社区贡献者可为小众语言（gglua/andlua/auto.js/shell/按键精灵/html-js）提交示例代码 PR
- PR 合并后获官方认证标识
- 详见 SPEC.md 开发流程章节

---

## 7. 待核实清单

> M0 阶段全部需求已确认，无待核实项。

### 已确认汇总
- ✅ 项目类型、技术栈、对标产品（米验 b6w.top）
- ✅ 角色（超管 / 代理 3 层 / 开发者）
- ✅ 卡密 7 种类型
- ✅ 加密方案（RSA-2048 + AES-256-CBC + TS + Nonce，加强版见 SPEC.md §2.6）
- ✅ 多语言接入策略（6 主流 + 协议规范 + 社区贡献）
- ✅ 部署：Debian + 宝塔 + Docker
- ✅ GitHub 仓库：laobi465/jicek-wlyz
- ✅ 对象存储：管理员后台自选
- ✅ 易支付：管理员后台自行配置
- ✅ UI 调性：科技极简对标 b6w.top
- ✅ 服务器配置：8核8G 或 4核8G
- ✅ Cloudflare CDN：管理员后台自定义配置
- ✅ ICP 备案：不需要
- ✅ 邮件 SMTP：管理员后台自定义
- ✅ 短信服务：管理员后台自定义
- ✅ 套餐定价：管理员后台自定义
- ✅ 代理佣金比例：开发者自定义
- ✅ 代理提现：1 元起，日结（T+1）
- ✅ 自定义小时卡范围：0.1 小时（6 分钟）到永久
- ✅ 数据库备份频率：管理员后台自定义
- ✅ 日志保留天数：30 天
- ✅ 超管初始账号：首次安装向导
- ✅ 后台 i18n：不需要（仅中文）
- ✅ 数据导出：需要（Excel）
- ✅ 用户协议/隐私政策：不需要
- ✅ SSH 脚本托管 URL：GitHub raw
- ✅ 监控告警：不需要
- ✅ 灰度/蓝绿部署：不需要（全量发布 + Docker 镜像回滚）
- ✅ SDK 旧版本兼容策略：A（保留 N 个旧版本，默认 1 年）

---

## 8. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| 0.1.0 | 2026-07-22 | 初始版本，整合需求确认 23 项方案，建立 PROJECT.md 与 SPEC.md |
| 0.1.1 | 2026-07-22 | 确认 Debian + 仓库 laobi465/jicek-wlyz + 对象存储管理员自选 + 易支付管理员配置；安全方案大幅升级（通信+7 / 卡密+8 / APK 注入+11 / 网站+9）；待核实清单细化至 19 项 |
| 0.1.2 | 2026-07-22 | 19 项待核实清单中 16 项已确认（服务器配置/CDN/备案/邮件/短信/定价/佣金/提现/小时卡/备份/日志/超管向导/i18n/导出/用户协议/脚本URL）；待核实剩 3 项（监控告警/灰度部署/SDK兼容策略） |
| 0.2.0 | 2026-07-22 | **M0 完成**：最后 3 项确认（监控告警=不需要 / 灰度部署=不需要 / SDK 兼容=A）；修正 Cloudflare CDN 为管理员后台自定义配置；待核实清单清空，进入 M1 |
| 0.2.1 | 2026-07-22 | 整合 /bdeploy 模块：新增 GitHub 自动更新系统（模块 11）；超管端新增更新面板 + 弹窗提醒功能 |
| 0.3.0 | 2026-07-22 | **M2 完成**：核心验证能力落地——加密链路（RSA-2048 + AES-256-CBC + ECDHE-PFS + TS/Nonce 防重放 + 限流风控）/ 应用管理 / 卡密体系（7 类 + CRC32 + RSA 签名 + 开发者水印）/ 验证 API 6 actions / 设备管理 / 云变量；tsc 自检 0 errors |
| 0.4.0 | 2026-07-23 | **M3 完成**：商业化能力落地——代理分销（3 层 A→B→C→D + 邀请码 once/reusable/limited + 佣金分账事务 + 状态审核）/ 提现服务（1 元起 T+1 + pending/approved/rejected/paid 状态机 + 余额锁定）/ 发卡业务（店铺/商品/订单 + 库存事务防超卖 + 关联卡密模板自动发卡 + 退款回滚佣金）/ 彩虹易支付（MD5 签名 + 异步回调 + 验签常量时间比较 + 金额一致性校验）/ 套餐包月（30 天有效期 + app/card quota + 续费叠加 + 过期标记）；扩展 prisma schema 新增 Withdrawal 表 + Product↔CardTemplate 关系；tsc 自检 0 errors |
| 0.5.0 | 2026-07-23 | **M4 完成**：接入生态落地——6 主流 SDK（Python/Java/PHP/Node.js/Go/易语言，全部实现 verify_rsa/auth/use/unbind/check_update/heartbeat 6 actions + RSA-2048 签名 + AES-256-CBC 加密 + ECDHE-PFS）/ 6 小众语言示例（gglua/andlua/autojs/shell/anjian/htmljs，社区贡献）/ 接入中心向导（access-service + 3 API 路由：languages/generate-code/test-connection + 6 步流程引导）/ 协议规范文档（docs/api/protocol.md，6 actions 详细规范 + 加密细节 + 错误码 + 12 语言 SDK 对照）；tsc 自检 0 errors |
| 0.6.0 | 2026-07-23 | **M5 完成**：APK 注入落地——在线注入服务（apk-injection-service + 4 API 路由：upload/tasks 列表/详情/下载 + 202 异步 + 任务取消）/ 安全完整性服务（apk-integrity-service：APK magic number 校验 + SHA-256 常量时间比较 + apktool 参数白名单防命令注入 + 路径穿越防护 + SDK 版本/包名白名单 + InjectionConfig 15+ 特性开关）/ BullMQ 异步 Worker（沙箱 mkdtemp 隔离 + apktool d/b + smali 注入 WlyzSdkEntry/WlyzAntiDebug/WlyzIntegrityCheck + assets/wlyz_config.json + apksigner 签名 + 5 分钟超时 + 优雅关闭）/ 命令行工具（tools/apk-injector/cli.ts：inject/verify/sign/help 4 子命令）/ 扩展 prisma schema 新增 ApkInjectionTask 模型 + 8 个 APK 错误码（8001-8008）/ 文档 docs/apk-injection.md（9 章节：安全策略 21 项 + API + CLI + Worker 部署 + Docker Compose）；对象存储上传/下载明确抛错待接入（铁律 04）；tsc 自检 0 errors |
| 0.7.0 | 2026-07-23 | **M6 完成**：运营能力落地——工单系统（ticket-service + 5 API 路由：创建/列表/详情/回复/状态流转 + 工单编号 TK+YYYYMMDD+随机串 + 状态机 open→in_progress→resolved→closed + 权限校验仅提交者或超管 + 客服回复自动置 in_progress）/ 通知中心（notification-service + 3 API 路由：列表/标记已读/未读数 + 6 种类型 ticket/payment/withdrawal/system/apk/agent + 单条/全部已读 + 内部 sendNotification 接口供其他模块调用）/ 每日签到（checkin-service + 2 API 路由：签到/记录 + 连续签到奖励 0.10-0.50 元 7 天封顶 + UTC+8 时区 + 唯一约束防重复 + 事务保证签到记录与余额原子入账）/ 数据看板（dashboard-service + 1 API 路由：按角色分发开发者/代理/超管三维度统计 + 并行 aggregate 查询）/ 扩展 prisma schema 新增 Notification + CheckIn 模型 + 8 个错误码 8101-8302；tsc 自检 0 errors |
| 1.0.0 | 2026-07-23 | **M7 完成 + 正式上线**：安全加固落地——全局限流代理（proxy.ts + Redis 滑动窗口 100 req/min/IP + §2.6.4 第 6 项 + 白名单路径豁免 + Redis 降级放行）/ HTTP 安全头（HSTS max-age=31536000 + X-Frame-Options=DENY + X-Content-Type-Options=nosniff + Referrer-Policy + Permissions-Policy + CSP 严格策略 default-src 'self'，§2.6.4 第 17-18 项）/ 统一审计日志服务（audit-service + 30+ AuditAction 枚举 + 敏感字段自动脱敏 password/token/secret/keystore + IP/UA 采集 + 不可篡改仅追加 + 超管查询 API，§2.6.4 第 12 项）/ 敏感字段加密（crypto-field AES-256-GCM + scrypt 密钥派生 N=16384 + 随机 IV + AuthTag 防篡改 + 密文格式 base64(iv\|ciphertext\|authTag) + 脱敏展示 phone/name/email，§2.6.4 第 14 项）/ 2FA 双因子验证（two-factor-service TOTP RFC 6238 HMAC-SHA1 6 位 30 秒窗口 + Base32 编解码 + 常量时间比较防时序攻击 + ±1 窗口容错 + 10 个一次性备份码 + 超管/代理强制 + 3 API 路由 status/enable/disable/verify，§2.6.4 第 10 项）/ 超管 IP 白名单（ip-whitelist-service 全局环境变量 + 用户个人白名单 + IPv4/IPv4 CIDR 匹配 + 中间件层校验，§2.6.4 第 11 项）/ 健康检查 API（/api/health 数据库 + Redis + 环境变量检查 + 200/503 状态码供负载均衡探针）/ 新增 9 个错误码 1003/8401-8408（限流/2FA/IP白名单/字段加解密/会话过期）+ PERMISSION_DENIED 通用权限码；tsc 自检 0 errors |
| 1.0.1 | 2026-07-23 | **构建修复**：解决 `next build` 在"收集页面数据"阶段因模块加载即抛错导致构建失败——Redis 客户端（src/lib/redis/index.ts）改为 Proxy 惰性初始化（构建期不创建连接、不校验环境变量、不抛错，运行时首次调用方法才创建单例并校验 REDIS_HOST/REDIS_PORT，保留铁律 04 显式失败）/ Better Auth 实例（src/lib/auth.ts）改为 Proxy 惰性初始化（构建期不创建实例，运行时首次访问属性才调用 betterAuth() 并校验 BETTER_AUTH_SECRET/BETTER_AUTH_URL，handler/GET/POST/signIn/signUp/signOut/getSession 全部包装为惰性转发函数）/ Next.js 16 适配：middleware.ts → proxy.ts（middleware 文件约定已弃用，统一改名 proxy）+ 函数名 middleware → proxy + 移除 config 中的 runtime: 'nodejs'（Next.js 16 proxy 文件不允许设置 runtime，proxy 默认 Node.js runtime 复用 ioredis）；tsc 自检 0 errors；next build 验证通过（27/27 静态页面生成成功，无 REDIS_HOST / BETTER_AUTH_SECRET / middleware 弃用警告）|
| 1.1.0 | 2026-07-23 | **M8.0 Web 前端核心 UI 框架完成**：基础布局（根 layout + AuthProvider + ToastProvider + globals.css 主题色变量 藏蓝 #1E3A5F 强制明亮主题，禁暗黑/毛玻璃/emoji/夸张渐变）/ UI 原子组件 7 个（Button primary/secondary/ghost/danger + Input/Textarea/Select + Card/Header/Body/Footer + Badge 6 变体 + Table 斑马纹 + Modal ESC 关闭 + ConfirmModal + Toast Provider 4 语义色）/ 鉴权基础设施（auth-client Better Auth 单例 + http.ts 统一 fetch 封装注入 X-User-Id/X-User-Role 头 + 处理 {code,msg,data,ts,nonce} 响应 + 8408 会话过期回调 + auth-provider useSession 同步 + auth-guard 角色路由隔离）/ 登录注册（Better Auth signIn.email/signUp.email + useSearchParams Suspense 包裹修复 Next.js 16 静态预渲染）/ 三角色仪表盘（RoleDashboard 共用组件 + GET /api/dashboard + 三角色维度卡片）/ 工单 Web 闭环（列表筛选分页 + 创建校验 + 详情回复 + 状态管理：客服标记已解决 / 提交者关闭，权限校验与后端 ticket-service 一致）/ 通知 Web 闭环（列表筛选分页 + 单条/全部标记已读 + 6 种类型语义色）/ 签到 Web 闭环（今日状态 + 立即签到 + 7 天奖励规则可视化 + 最近 30 天记录）/ 共享组件（page-header 通用页头 + common/badges 工单/通知枚举映射 + 时间格式化）/ 顶栏 bug 修复（unread-count API 返回 {count} 而非 {unread}）/ auth-provider refresh bug 修复（refetch 返回 Promise<void>，改用 authClient.getSession 直接拉取最新会话）；tsc 自检 0 errors；next build 验证通过（37/37 路由，新增 5 个静态页 + 1 个动态页 /tickets/[ticketId]，ƒ Proxy (Middleware) 识别正常）|
| 1.2.0 | 2026-07-23 | **M8.1 开发者管理页完成 + 官网营销页**：官网营销页（/ 首页改为产品介绍页：Hero 区 + 8 项核心特性卡片 + 12 语言 SDK 展示 + 注册 CTA + 顶部登录态感知导航按钮，登录显示"进入控制台"未登录显示"登录/免费注册"）/ 后端 web API 路由层补全（apps/card-keys/devices/cloud-variables/shops/products/packages/user-packages/orders 共 30+ 路由 + service 补 listAppsByDeveloper/getAppById/disableApp/listCards/deleteCard/listDevices/getDeviceById/deleteVariable/getShop/deleteShop/deleteProduct/updatePackage/listAllOrders 方法，手写校验非 zod 对标现有路由风格）/ M8.1 应用管理（列表状态筛选分页 + 创建 clientSecret/privateKey 仅显示一次 + 详情编辑版本/公告/心跳/设备上限/解绑规则 + 重签 + 停用）/ M8.1 卡密管理（列表应用/状态筛选分页 + 批量生成 7 类型同步/异步 + 详情签名/校验位/水印 + 作废/加黑名单）/ M8.1 设备管理（列表应用/状态筛选分页 + 详情机器码/心跳/序列号 + 加黑名单/解绑）/ M8.1 云变量管理（应用选择 + 列表 + Modal 新增编辑 key/value/类型/公开 + 删除，http.ts 新增 put 方法）/ M8.1 APK 注入（任务列表状态筛选分页 + 上传 FormData 注入配置 + 详情 5s 轮询取消 + 下载 blob）/ M8.1 接入中心（6 步流程向导 API 下发非硬编码 + 语言选择主流/社区分组 + 代码生成 baseUrl/appKey + 测试连接）/ M8.1 店铺商品（店铺列表创建/编辑/删除 Modal + 店铺详情商品 CRUD 价格/库存/上下架）/ M8.1 套餐充值（套餐列表卡片网格 + 订阅 ConfirmModal + 当前有效套餐剩余额度到期 + 订阅记录）/ sidebar 移除 developer comingSoon 标记；tsc 自检 0 errors；next build 验证通过（54/54 路由，新增 17 个开发者页面，ƒ Proxy (Middleware) 识别正常）|
| 1.3.0 | 2026-07-23 | **M8.2 代理管理页完成**：后端 web API 路由层补全（agent 自助 4 路由：profile/balance/subordinates/tree + 提现 2 路由：列表+发起/详情 + 邀请码 3 路由：列表+发起/详情/校验 + 超管 9 路由：代理列表/详情/状态/佣金比例 + 提现列表/审核/驳回/打款 + 邀请码列表，共 18 路由；service 补 listAllAgents/getAgentById/getWithdrawalById/listWithdrawalsWithTotal/listAllInvitations 方法，手写校验非 zod 对标现有路由风格，路由层捕获 service 错误映射到现有错误码 PERMISSION_DENIED/PARAM_FORMAT/PARAM_MISSING/SYSTEM_ERROR）/ M8.2 代理概览（4 余额卡片：累计佣金/已提现/审核中/可提现 + 代理信息层级/佣金比例/状态 + 快捷入口，profile 为 null 时 EmptyState 提示联系上级开通代理身份）/ M8.2 下级代理（三层分段切换：一级/二级/三级 + 每层表格邮箱/昵称/层级/佣金比例/累计佣金/状态 + 三层总数统计 + EmptyState 空态）/ M8.2 邀请码（列表 code 可复制 + 类型/使用模式/目标层级/已用上限/过期/状态 Badge + 创建 Modal type/targetLevel/usageMode/maxUses/expiresInDays 条件显示校验）/ M8.2 佣金明细（4 余额卡片 + 提现记录表格金额/状态/收款账户/申请审核打款时间/驳回原因 + 状态筛选分页 + 申请提现入口跳转）/ M8.2 提现申请（可提现余额卡片 + 提现记录表格 + 发起提现 Modal amount/payoutType alipay|wxpay|bank/account/name/bank 条件校验 + 1 元起校验）/ sidebar 移除 agent comingSoon 标记；tsc 自检 0 errors；next build 验证通过（59/59 路由，新增 5 个代理页面 + 18 个 API 路由，ƒ Proxy (Middleware) 识别正常）|
| 1.4.0 | 2026-07-23 | **M8.3 超管管理页完成**：后端 web API 路由层补全（系统配置 2 路由：GET /api/admin/config 按 group 查询 + PUT /api/admin/config/[key] 更新；用户管理 2 路由：GET /api/admin/users role/status/keyword/limit/offset 筛选分页 + PATCH /api/admin/users/[userId]/status 封禁/解封 + PATCH /api/admin/users/[userId]/role 角色变更；超管专属 4 路由：GET /api/admin/revenue 收入汇总+最近支付 + GET /api/admin/ip-whitelist 全局+个人白名单 + PUT /api/admin/ip-whitelist 更新个人白名单；2FA 复用 M7 /api/two-factor；提现审核复用 M8.2 /api/admin/withdrawals + /[id]/approve|reject|paid；工单客服复用 M6 /api/tickets/list；审计日志复用 M7 /api/audit-logs；更新面板复用 M0 /api/admin/update/check|trigger|rollback|history 走 Better Auth getSession cookie 鉴权；service 新增 user-service.ts listUsersForAdmin/changeUserStatus/changeUserRole + config-service.ts listSystemConfigs/getSystemConfig/updateSystemConfig，手写校验非 zod）/ M8.3 超管仪表盘（5 卡片组：用户规模/业务规模/收入与提现/工单状态/APK 注入任务 + 6 子页快捷入口，formatYuan Decimal→2 位小数）/ M8.3 用户管理（role/status/keyword 筛选 + 分页 + ConfirmModal 封禁/解封 + Modal 角色变更 Select + 自我封禁/降级提示）/ M8.3 业务总览（业务规模/工单分布/APK 注入任务 3 卡片组 + 收入/工单入口）/ M8.3 收入明细（今日/本月/累计 3 卡片 + 最近支付表格 金额/方式/三方号/订单/用户/时间 + PAYMENT_METHOD_LABEL 映射）/ M8.3 提现审核（agentUserId/status 筛选 + 分页 + parsePayoutAccount JSON 安全解析 + 状态条件按钮：pending 通过/驳回 + approved 标记打款 + Reject Modal reason Textarea + Paid Modal tradeNo Input）/ M8.3 工单客服（status/category 筛选 + 分页 + 工单号/标题/状态/优先级/类型/提交人/时间/操作表格 + StatusBadge/PriorityBadge/CategoryBadge + 跳转 /tickets/[ticketId] 共享详情页）/ M8.3 系统配置（group 筛选 payment/storage/email/sms/cdn/backup/general + 表格 key/value/group/description/操作 + maskValue 加密配置 ****** 脱敏 + Edit Modal Textarea 加密配置不回填）/ M8.3 审计日志（action 20 选项/targetType 8 选项/userId 搜索 3 筛选 + PAGE_SIZE=50 + 表格 时间/用户/操作/对象/异常标记 + Detail Modal lg 全字段 + prettyJson details 美化 + is_abnormal danger Badge）/ M8.3 安全（2FA 状态卡 enabled/required/backupCodesRemaining + 两阶段开启 Modal accountName→secret/otpAuthUri/backupCodes + 关闭 Modal code 校验，DELETE 走 request() 直接传 body 修复 http.ts del 不支持 body；IP 白名单卡 全局只读 env + 个人 Textarea 一行一 IP，2FA 开启时显示字段冲突 warning 替换 textarea 防覆盖备份码）/ M8.3 更新面板（版本卡 currentVersion 截断 12 字符 + hasUpdate Badge + latestVersion 详情 + 触发更新按钮 !hasUpdate 禁用 + 回滚 window.confirm + 远程提交日志表 SHA/信息/作者/时间 + 本地历史表 时间/操作/状态/触发方式/操作人/版本/错误 + ACTION_LABEL/STATUS_LABEL/STATUS_VARIANT 映射）/ sidebar 移除全部 9 个 admin comingSoon 标记 + 注释更新 M8.3 已完成；tsc 自检 0 errors；next build 验证通过（36 静态页 + 82 API 路由，新增 9 个超管页面，ƒ Proxy (Middleware) 识别正常）|
| 1.5.0 | 2026-07-23 | **首次安装向导 + 环境变量修复**：首次安装向导（后端 setup-service.ts checkNeedsSetup 查询 super_admin count=0 + createFirstSuperAdmin 调用 Better Auth signUpEmail 创建用户后 prisma 更新 role=super_admin + 清理自动创建的 session 不自动登录 + 写审计日志 USER_ROLE_CHANGE；/api/setup GET 状态查询 + POST 创建首个超管，公开接口无需鉴权，POST 内部二次校验无超管防提权滥用，手写校验 email 正则/password≥8/name 2-32 非 zod）/ 前端 /setup 安装向导页（useEffect 检查 needsSetup，false 跳转 /login，true 显示表单 用户名/邮箱/密码/确认密码 + Badge 首次安装标识 + 警告提示 + 创建成功跳转 /login 手动登录验证凭据；登录页底部新增"首次部署系统？进入安装向导"入口链接）/ 环境变量命名统一（修复代码读 BETTER_AUTH_SECRET/BETTER_AUTH_URL 但 docker-compose.yml/install.sh 提供 AUTH_SECRET 的不一致 + 代码读 REDIS_HOST/REDIS_PORT 但 compose 提供 REDIS_URL 的不一致 + health 检查 JWT_SECRET 与实际不符）：docker-compose.yml 改 AUTH_SECRET→BETTER_AUTH_SECRET + 新增 BETTER_AUTH_URL/REDIS_HOST=redis/REDIS_PORT=6379/REDIS_PASSWORD/FIELD_ENCRYPTION_KEY；deploy/install.sh generate_env 生成 BETTER_AUTH_SECRET/BETTER_AUTH_URL/FIELD_ENCRYPTION_KEY 替代 AUTH_SECRET + 部署信息文件输出 BETTER_AUTH_SECRET + 新增"首次安装"访问地址提示 /setup；health route requiredEnvVars 改为 DATABASE_URL/REDIS_HOST/REDIS_PORT/BETTER_AUTH_SECRET/BETTER_AUTH_URL/FIELD_ENCRYPTION_KEY）/ 新增 .env.example 模板（APP_PORT/APP_IMAGE/DATABASE_URL/DB_*/REDIS_*/BETTER_AUTH_SECRET/BETTER_AUTH_URL/FIELD_ENCRYPTION_KEY/SUPER_ADMIN_IP_WHITELIST 全量示例 + openssl rand 生成提示）/ .gitignore 新增 !.env.example 例外允许提交模板；tsc 自检 0 errors；next build 验证通过（37 静态页 + 83 API 路由，新增 /setup 页 + /api/setup 路由，ƒ Proxy (Middleware) 识别正常）|
| 1.5.1 | 2026-07-23 | **移除 /setup 安装向导，改为容器启动自动创建默认超管**：删除 3 文件（src/app/(auth)/setup/page.tsx 前端向导 + src/app/api/setup/route.ts API + src/server/modules/setup/setup-service.ts service）/ 新增 scripts/init-admin.mjs（容器启动在 prisma db push 后、node server.js 前执行；幂等——已存在 super_admin 或邮箱被占用则跳过；事务创建 User + Account 双写 hash；hashPassword 与 better-auth/crypto 兼容——salt(16字节hex):key(64字节hex) scrypt N=16384/r=16/p=1/dkLen=64；输出默认账密 admin@example.com/admin123 到日志）/ Dockerfile CMD 改为 `npx prisma db push --skip-generate && node scripts/init-admin.mjs && node server.js` + COPY scripts 目录 / install.sh 输出超管账号 admin@example.com + 超管密码 admin123 + 修改密码警告，移除 /setup 提示 / README 部署文档同步移除 /setup 步骤改为默认账密登录 / auth.ts 注释微调；tsc 自检 0 errors；next build 验证通过 |
| 1.5.2 | 2026-07-23 | **移除容器启动自动同步表结构**：Dockerfile CMD 删除 `npx prisma db push --skip-generate`，改为 `node scripts/init-admin.mjs && node server.js`；保留 prisma CLI + schema COPY 供容器内手动 prisma 操作 / install.sh 提示改为"首次启动需先手动创建数据库表" / README 手动部署注释改为"创建数据库表（手动部署需执行一次）"+ 容器启动说明改为"需确保数据库表已提前创建" / init-admin.mjs 头注释移除"在 prisma db push 之后" / 表结构改为部署前手动创建（docker compose exec app npx prisma db push）；tsc 自检 0 errors；next build 验证通过 |
| 1.5.3 | 2026-07-23 | **优化一键安装脚本 deploy/install.sh**：① 自动建表恢复一键体验（db 就绪后 `docker compose run --rm --no-deps app npx prisma db push`，无需手动建表）② 子命令 install/update/uninstall/reinstall/--help ③ 幂等检测（已安装运行中则提示引导子命令）④ 失败自动打日志（db/app 健康检查失败/建表失败时 docker compose logs --tail=50）⑤ 分步启动（db+redis → wait db → 建表 → app → wait app）⑥ set -euo pipefail ⑦ shellcheck 通过（仅剩 SC1091 不可避免）/ README 新增「常用运维命令」段 + 安装步骤新增建表说明；bash -n + --help + 未知命令处理验证通过 |
| 1.5.4 | 2026-07-23 | **修复一键安装建表失败**：① install.sh create_db_schema 改用 `node /app/node_modules/prisma/build/index.js` 直接调用 prisma CLI（替代 `npx prisma`——standalone 镜像无 node_modules/.bin 符号链接，npx 找不到本地 prisma 包会尝试联网下载失败）② 捕获 prisma 完整输出到 /tmp/jicek-schema.log，失败时 cat 显示（docker compose logs 看不到 run --rm 已删除容器的输出，导致看不到真正错误）③ Dockerfile runner 阶段补充 COPY node_modules/.bin/prisma（让 npx prisma 也能用）④ 清理 Dockerfile 重复的 @prisma/.prisma COPY ⑤ CMD 注释更新为"表由 install.sh 自动创建"；bash -n 语法通过 + shellcheck 仅剩 SC1091 |
| 1.5.5 | 2026-07-23 | **修复建表失败——新增 migrate 专用镜像**：1.5.4 无效，根本原因是 app(standalone) 镜像缺 prisma CLI 传递依赖 `effect`（@prisma/config 依赖 effect，prisma 依赖 @prisma/config），standalone 只追踪应用代码依赖。修复：① Dockerfile 新增 migrate 构建阶段（FROM base 含完整 node_modules + COPY builder 的 prisma/schema + .prisma，prisma CLI 及 effect 等传递依赖齐全）② docker-compose.yml 新增 migrate service（profiles:["migrate"] 隔离不默认启动 + DATABASE_URL + depends_on db healthy）③ install.sh create_db_schema 改用 `docker compose --profile migrate run --rm migrate`（CMD 即 npx prisma db push --skip-generate）④ prepare_image + cmd_update 增加 migrate 镜像构建 ⑤ runner 移除无用 prisma CLI + .bin/prisma COPY；bash -n 通过 |
| 1.5.6 | 2026-07-23 | **修复远程拉取模式 migrate 构建失败**：1.5.5 在远程 app 镜像拉取成功时直接构建 migrate，但部署目录只有 docker-compose.yml + .env 无 Dockerfile/源码，docker compose build migrate 报 `failed to read dockerfile: open Dockerfile: no such file or directory`。修复：prepare_image 将 prepare_local_build_source 调用提前到 pull 之前——无论远程拉取还是本地构建都先下载源码（幂等：已有 Dockerfile 则跳过），保证 migrate 构建时 Dockerfile 在场；bash -n 通过 |
| 1.6.0 | 2026-07-23 | **重构建表方案——彻底删除 migrate 镜像，改用 init.sql + PostgreSQL docker-entrypoint-initdb.d 标准机制**：背景——1.5.3~1.5.6 连续 4 次修复建表问题（standalone 缺 prisma CLI 依赖 effect / 缺 Dockerfile / 远程拉取需源码），migrate 镜像方案过于复杂不可靠。根因认识：① 建表只需 prisma CLI（命令行工具），其依赖 effect 等未被 standalone 追踪 ② init-admin 只用 PrismaClient（运行时库），被 standalone 追踪，runner 容器能正常跑（已验证登录成功）③ PostgreSQL 官方镜像支持 /docker-entrypoint-initdb.d/ 首次初始化自动执行 .sql，零运行时依赖、完全幂等。方案：① `prisma migrate diff --from-empty --to-schema-datamodel --script` 生成 deploy/init.sql（699 行/25 张表+索引+外键）提交仓库 ② docker-compose.yml db 挂载 `./init.sql:/docker-entrypoint-initdb.d/01-init.sql:ro`，db 首次启动自动建表 ③ 删除 migrate service ④ Dockerfile 删 migrate 阶段，runner 移除 prisma CLI/schema COPY ⑤ install.sh 删 create_db_schema + prepare_image 远程拉取不再下载源码 + start_services 简化为 `docker compose up -d` + cmd_update 移除 migrate 构建建表 ⑥ download_compose 同时下载 compose+init.sql。优势：远程拉取模式部署目录仅需 3 文件无需源码；建表零运行时依赖；完全幂等；bash -n 通过 |
| 1.6.1 | 2026-07-23 | **修复 reinstall 旧数据卷导致 init.sql 被跳过——新增表结构校验自愈**：背景——1.6.0 用 docker-entrypoint-initdb.d 机制建表，但该机制仅在数据卷为空时执行 init.sql。reinstall 保留旧数据卷（之前建表失败遗留的空库但非空卷），init.sql 被跳过，app 启动时 init-admin 报 `The table public.users does not exist`。修复：① 新增 verify_tables_exist 函数——db 启动健康后用 `docker compose exec -T db psql -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"` 查询表数量，>0 跳过，==0 自动 `docker compose exec -T db psql < init.sql` 补建（init.sql 含 CREATE TABLE 非 IF NOT EXISTS，仅在 table_count==0 时执行保证幂等安全）② start_services 改为分步：先 db+redis → wait_db_healthy → verify_tables_exist → app+apk-injector（确保 app 启动前表就绪）③ cmd_update 同样分步插入 verify_tables_exist ④ 移除未使用 db_pwd 变量；bash -n 通过 |
| 1.6.2 | 2026-07-23 | **修复登录"无效来源"错误——BETTER_AUTH_URL 改用公网 IP**：背景——Better Auth 校验请求 Origin/Referer 头与 baseURL（来自 BETTER_AUTH_URL 环境变量）是否匹配，不匹配则拒绝登录并返回"无效来源"。原 install.sh generate_env 将 BETTER_AUTH_URL 设为 `http://localhost:${APP_PORT}`，但用户通过服务器公网 IP 访问，浏览器 Origin 头为 `http://<IP>:<port>` 与 baseURL 的 localhost 不匹配，登录被拒。修复：generate_env 调用 get_public_ip 获取公网 IP，BETTER_AUTH_URL 改设为 `http://${public_ip}:${APP_PORT}`，使 baseURL 与实际访问地址一致。注意：已部署环境 reinstall/update 保留旧 .env，需手动编辑 `/opt/jicek-wlyz/.env` 将 BETTER_AUTH_URL 改为 `http://<服务器IP>:<端口>` 后执行 `docker compose restart app` 生效；bash -n 通过 |
| 1.7.0 | 2026-07-23 | **SDK 下载与对接教程页面**：背景——用户要求在开发者和管理员后台均能下载各语言 SDK 并查看对接教程。新增 GET /api/sdk/info（无需鉴权，从 GITHUB_REPO_URL/GITHUB_REPO_BRANCH 环境变量拼接 GitHub raw 下载基础 URL，返回 6 主流 SDK + 6 社区示例 + 6 步接入流程 + 6 核心 API 协议 + 仓库信息；复用 access-service.listSdkLanguages/ACCESS_STEPS，不重复维护语言清单）/ 共享组件 src/components/sdk/sdk-download-content.tsx（主流 SDK 卡片网格 下载/复制链接 + 社区示例卡片 + 6 步对接流程列表 + API 协议表格 verify_rsa/auth/heartbeat/check_update/use/unbind + 加密方式 Badge + Python 接入完整示例 verify_rsa→auth→heartbeat→check_update→use→unbind 一键复制）/ 新增 /developer/sdk + /admin/sdk 两个独立页面（分别 AuthGuard allow developer/super_admin，复用 SdkDownloadContent 内容组件）/ sidebar DEVELOPER_NAV 在"接入中心"后新增"SDK 下载"入口、ADMIN_NAV 在"更新面板"前新增"SDK 下载"入口 + 顶部注释同步；tsc 自检 0 errors；next build 验证通过（/admin/sdk、/api/sdk/info、/developer/sdk 三路由均编译成功，无 error/warn）|
| 1.7.1 | 2026-07-23 | **配置中心改为分组卡片导航 + 独立配置表单页**：背景——用户要求邮件/CDN/短信/备份/通用/对象存储/支付等分组为单独页面可配置（如同创建应用那样的表单式编辑），原 /admin/config 为单页表格展示不便操作。改动 ① config 入口页 src/app/(dashboard)/admin/config/page.tsx 改为 7 分组卡片导航（payment/storage/email/sms/cdn/backup/general，每张卡片显示图标+名称+描述+配置项总数/已配置数 Badge+点击进入独立配置页；保留"初始化默认配置"和"新增配置"按钮，countByGroup/countFilled 实时统计）② 新增动态路由页 src/app/(dashboard)/admin/config/[group]/page.tsx（VALID_GROUPS 校验 group 参数防越权访问；按分组加载该组全部配置项；表单式编辑：长值 secret/pass/key/endpoint/url/domain/path 用 Textarea，其余用 Input；加密配置项显示掩码占位符 + 编辑时清空原值；isDirty 实时高亮"已修改"Badge + dirtyCount 统计；批量保存 PUT /api/admin/config/[key] 并行 + 重置按钮 + 错误展示 + 顶部面包屑返回）；tsc 自检 0 errors；next build 验证通过 |
