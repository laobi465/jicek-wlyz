# jicek-wlyz 网络验证 SaaS 系统

> 多租户云端网络验证平台 ｜ 对标米验（b6w.top）｜ Next.js 16 全栈

面向**开发者**（付费套餐接入验证服务）与**代理**（凭邀请码注册，3 层分销拿佣金）的多租户 SaaS 系统。提供登录验证、卡密发售、设备绑定、云变量、APK 注入、多语言 SDK 等能力。

## 项目特点

- **加密通信**：RSA-2048 签名 + AES-256-CBC 加密 + ECDHE 完美前向保密 + TS/Nonce 防重放
- **卡密体系**：7 种类型（天/周/月/年/永久/次数/自定义小时）+ CRC32 校验位 + RSA 签名 + 开发者 ID 水印
- **多语言接入**：6 种主流 SDK（Python/Java/PHP/Node.js/Go/易语言）+ 6 种小众示例（gglua/andlua/auto.js/shell/按键精灵/html-js）
- **接入中心向导**：一键生成 12 语言接入代码 + 6 步流程引导 + 测试连接
- **APK 注入**：在线上传 → BullMQ 异步注入（apktool + VMP + 反调试）→ 重新签名下载
- **3 层代理分销**：A→B→C→D 佣金分润，代理独立后台 + 邀请码体系
- **商业化能力**：发卡业务 + 彩虹易支付 + 套餐包月 + 提现审核
- **安全加固**：签名防篡改 + 限流风控 + 审计日志 + WAF + 2FA
- **GitHub 自动更新**：Webhook 触发 → 自动备份 → 拉取部署 → 失败回滚

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Next.js 16 App Router + TypeScript + TailwindCSS + shadcn/ui |
| 后端 | Next.js Route Handlers + REST API |
| ORM | Prisma 6 |
| 主库 | PostgreSQL 16 |
| 缓存 | Redis 7（心跳 / nonce 去重 / 限流 / 验证缓存） |
| 鉴权 | Better Auth（超管 / 代理 / 开发者 三角色 RBAC） |
| 支付 | 彩虹易支付（管理员后台自行配置商户号） |
| 队列 | BullMQ（APK 注入 / 卡密批量生成 / 通知） |
| 文件存储 | 对象存储（管理员后台自选：七牛 / 阿里 OSS / Cloudflare R2） |
| 部署 | 自建 VPS（Debian）+ 宝塔面板 + Docker |

## 部署教程

### 环境要求

- **系统**：Debian 11 / Debian 12（推荐 8 核 8G 或 4 核 8G VPS）
- **权限**：root 用户
- **网络**：需能访问 GitHub raw 与 Docker Hub / 镜像源

### 一键安装（推荐）

使用 SSH 连接服务器，执行以下命令即可完成全部部署（自动检测并安装宝塔面板 + Docker + 端口冲突检测 + 配置生成）：

```bash
bash <(curl -sSL https://raw.githubusercontent.com/laobi465/jicek-wlyz/main/deploy/install.sh)
```

脚本会自动完成：

1. 检测操作系统（仅支持 Debian 11/12）
2. 检测并安装宝塔面板（已安装则跳过）
3. 检测并安装 Docker（已安装则跳过）
4. 端口冲突检测（占用自动 +1）：宝塔端口 / 项目端口 / 数据库端口 / Redis 端口
5. 随机生成数据库密码、Redis 密码、JWT Secret（`openssl rand`）
6. 拉取预构建 Docker 镜像并启动（不上传源码到服务器）
7. 输出配置信息并保存至 `/root/jicek-wlyz-deploy.txt`

### 安装后配置

脚本执行完成后，查看 `/root/jicek-wlyz-deploy.txt` 获取端口与账号信息，然后：

1. 访问宝塔面板（端口见配置文件）
2. 在宝塔「Docker」中确认 4 个容器正常运行（app / db / redis / apk-injector）
3. 访问管理后台（端口见配置文件），进入**首次安装向导**
4. 设置超级管理员账号与密码
5. 依次配置：
   - 彩虹易支付商户号
   - 对象存储（七牛 / 阿里 OSS / Cloudflare R2）
   - 邮件 SMTP
   - 短信服务
   - 套餐定价
   - 数据库备份周期

### 手动部署（进阶）

如需手动部署或二次开发：

```bash
# 克隆仓库
git clone https://github.com/laobi465/jicek-wlyz.git
cd jicek-wlyz

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 填写数据库、Redis、密钥等配置

# 数据库迁移
npx prisma migrate deploy
npx prisma db seed

# 开发模式启动
npm run dev

# 生产构建
npm run build
npm start
```

### Docker Compose 部署

```bash
# 拉取 docker-compose.yml
curl -sSL https://raw.githubusercontent.com/laobi465/jicek-wlyz/main/docker-compose.yml -o docker-compose.yml

# 配置环境变量（参考 .env.example）
# 启动全部服务
docker compose up -d
```

### 更新与回滚

系统内置 GitHub 自动更新模块（/bdeploy）：

- **自动更新**：在 GitHub 仓库 push 后，Webhook 自动触发更新流程（备份 → 拉取 → 迁移 → 重启）
- **手动更新**：超管后台「GitHub 更新面板」→ 点击「立即更新」
- **回滚**：更新面板 → 版本历史 → 选择版本 → 一键回滚

## 项目文档

- [PROJECT.md](./PROJECT.md) - 项目概述、架构、功能清单、目录结构
- [SPEC.md](./SPEC.md) - 规划规范、技术规范、安全规范、开发流程

## 开发路线

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | 需求确认 + 文档基线 | 已完成 |
| M1 | 基础架构搭建 | 已完成 |
| M2 | 核心验证能力（加密链路 + 卡密 + 验证 API + 设备 + 云变量） | 已完成 |
| M3 | 商业化能力（代理分销 + 发卡 + 易支付 + 套餐充值） | 已完成 |
| M4 | 接入生态（6 主流 SDK + 6 小众示例 + 接入中心向导 + 协议规范） | 已完成 |
| M5 | APK 注入（在线工具 + 命令行 + 反调试） | 已完成 |
| M6 | 运营能力（工单 + 看板 + 签到 + 通知） | 已完成 |
| M7 | 安全加固 + 正式上线 | 规划 |

## License

MIT
