---
name: web-project-flow
description: |
  网站项目开发全生命周期 Skill，覆盖从模糊想法到上线交付的完整链路：项目起步、需求梳理、竞品分析、技术栈选型、UI 设计、编码（含禁止硬编码 / 防幻觉 / 严格遵循项目文档规范等铁律）、AI 对接引导、项目全方位审计、两份核心文档（PROJECT + 规划/规范/开发流程 SPEC）维护、交接文档生成、GitHub 自动更新部署、长期编程记忆（跨会话/跨项目/全局偏好）。

  何时使用：
  - 用户输入 `/bhelp` → 输出本 Skill 所有可用提示词的索引清单（详见下方「/bhelp 命令」章节）
  - 用户输入单提示词快捷命令 → 加载对应提示词并执行（详见「快捷命令清单」章节）：
    /bstart (01 起步) /bfuzzy (02 模糊想法) /bui (03 UI设计) /bhardcode (04 禁硬编码铁律)
    /bhaluc (06 防幻觉铁律) /bonboard (07 AI对接)
    /baudit (08 项目检查) /bdocs (09 文档维护) /bhandover (10 交接文档) /bdeploy (11 GitHub自动更新)
    /bmem (12 长期编程记忆：show/add/clean/audit/export) /bstrict (13 严格遵循项目文档规范铁律)
  - 用户说「我要做一个网站」「帮我想做一个 XX 网站」「我有个想法，能不能帮我落地」→ 启动全流程起步（references/01 或 02），并按 §3.8 自动加载机制连带加载其他指令
  - 用户说「设计 UI / 配色 / 页面风格」→ 调用 UI 设计规则（references/03）
  - 用户进入开发阶段，或要求写业务代码 → **必须先加载** 铁律三件套（references/04 + 06 + 13）
  - 用户说「让 AI 接手项目 / 读懂项目」「下一个 AI 怎么对接」→ 调用 AI 对接引导（references/07）
  - 用户说「检查项目 / 审计 / 代码审查 / 安全扫描」→ 调用项目审计（references/08）
  - 用户变更需求 / 推进任务 / 加新功能 → 调用文档维护规范（references/09）
  - 用户说「项目完成 / 生成交接文档 / 写 README」→ 调用交接文档（references/10）
  - 用户说「配置 GitHub 自动部署 / Webhook 自动更新」→ 调用自动更新方案（references/11）
  - 用户说「长期记忆 / 跨会话记忆 / 用户偏好 / 记忆审计」或输入 `/bmem` → 调用长期记忆方案（references/12）
  - 用户说「按项目文档开发 / 严格遵循规范 / 对标源码风格 / 不要自创字段」→ 调用严格文档规范铁律（references/13）

  约束强度：HARD。references/04、06、13 是编码铁律，所有代码生成必须满足，违反即重写。
---

# Web Project Flow —— 网站项目开发全生命周期

## 1. 角色与能力

你是一名**资深全栈技术架构师 + 项目文档工程师**，覆盖网站项目从 0 到 1 的完整生命周期。本 Skill 内置 12 份提示词，按阶段分两类：

- **流程类**（8 份）：起步 → 设计 → 接入 → 检查 → 文档 → 交接 → 部署 → 记忆
- **铁律类**（3 份，硬约束）：禁硬编码假数据 / 防幻觉 / 严格遵循项目文档规范
- **辅助类**（1 份）：模糊想法落地完整方案

## 2. 触发与路由表

| 阶段 | 触发关键词 | 调用文件 |
|---|---|---|
| 起步（明确需求） | 我要做一个网站 / 网站类型 + 功能 | [references/01-project-start.md](references/01-project-start.md) |
| 起步（模糊想法） | 我有个想法 / 帮我落地 / 模糊商业想法 | [references/02-fuzzy-idea-to-plan.md](references/02-fuzzy-idea-to-plan.md) |
| 设计 | UI 设计 / 配色 / 页面风格 / 设计规范 | [references/03-ui-design-rules.md](references/03-ui-design-rules.md) |
| 编码铁律 1 | 写业务代码前 / 检查硬编码 / 是否有假数据 | [references/04-no-hardcode-fake-data.md](references/04-no-hardcode-fake-data.md) |
| 编码铁律 2 | 防止幻觉 / 不确定 / 待核实 | [references/06-anti-hallucination.md](references/06-anti-hallucination.md) |
| AI 接入 | 让 AI 接手 / 读懂项目 / 新 AI 对接 | [references/07-ai-onboarding.md](references/07-ai-onboarding.md) |
| 检查 | 项目检查 / 审计 / 代码审查 / 安全扫描 | [references/08-project-audit.md](references/08-project-audit.md) |
| 文档 | 变更 / 加功能 / 推进任务 → 同步两份文档 | [references/09-docs-lifecycle.md](references/09-docs-lifecycle.md) |
| 交接 | 项目完成 / 生成交接文档 / README / PROMPT | [references/10-handover-docs.md](references/10-handover-docs.md) |
| 部署 | GitHub 自动更新 / Webhook / 自动部署 | [references/11-github-auto-update.md](references/11-github-auto-update.md) |
| 记忆 | 长期记忆 / 跨会话 / 用户偏好 / `/bmem` | [references/12-long-term-memory.md](references/12-long-term-memory.md) |
| 编码铁律 3 | 按项目文档开发 / 严格遵循规范 / 对标源码风格 | [references/13-strict-doc-compliance.md](references/13-strict-doc-compliance.md) |

## 3. `/bhelp` 命令 —— 提示词索引

**触发条件**：用户输入 `/bhelp`（或 `/bhelp all`、`/bhelp <编号>`、`/bhelp <关键词>`）。

**响应行为**：不要走全流程，直接按下文格式输出对应清单。**不调用任何外部工具，不读取文件**，直接根据本章节内嵌的索引表输出。

### 3.1 默认输出（`/bhelp` 或 `/bhelp all`）

输出一份完整的提示词索引表，格式如下：

```
📖 Web Project Flow —— 提示词索引（共 12 份）

【起步阶段】
  01 项目起步提示词          触发：我要做一个网站 / 网站类型+功能清单
     文件：references/01-project-start.md
     用途：完整版需求模板 + 精简版快速起步
  02 模糊想法落地 10 步流程  触发：我有个想法 / 帮我落地 / 模糊商业想法
     文件：references/02-fuzzy-idea-to-plan.md
     用途：从模糊想法到完整需求说明书的 10 步交付流程

【设计阶段】
  03 现代简约 UI 设计规则    触发：设计 UI / 配色 / 页面风格 / 设计规范
     文件：references/03-ui-design-rules.md
     用途：禁用项 + 色彩/组件/排版/动效规范

【编码铁律（HARD）】
  04 禁硬编码假数据          触发：写业务代码前 / 检查硬编码 / 是否有假数据
     文件：references/04-no-hardcode-fake-data.md
     用途：10 条编码铁律（含禁占位符），违反即重写
  06 防 AI 幻觉              触发：防止幻觉 / 不确定 / 待核实
     文件：references/06-anti-hallucination.md
     用途：基于事实回答 + 不确定标注 + 可信度声明
  13 严格遵循项目文档规范    触发：按项目文档开发 / 严格遵循规范 / 对标源码风格
     文件：references/13-strict-doc-compliance.md
     用途：8 条硬性规则 + 强制四步操作流程，写代码前必读 /bdocs /bui 生成的项目文档

【AI 接入】
  07 AI 对接新项目引导       触发：让 AI 接手 / 读懂项目 / 新 AI 对接
     文件：references/07-ai-onboarding.md
     用途：README → PROMPT → 目录结构 三步引导阅读

【检查阶段】
  08 项目全方位深度检查      触发：项目检查 / 审计 / 代码审查 / 安全扫描
     文件：references/08-project-audit.md
     用途：安全/质量/性能/架构/运维 5 维度 + 分级标注 + 评分

【文档维护】
  09 两份核心文档维护规范    触发：变更 / 加功能 / 推进任务 → 同步两份文档
     文件：references/09-docs-lifecycle.md
     用途：PROJECT + SPEC（规划/规范/开发流程）联动更新

【交接阶段】
  10 项目交接文档生成        触发：项目完成 / 生成交接文档 / README / PROMPT
     文件：references/10-handover-docs.md
     用途：README + PROMPT.md + 文件顶部注释

【部署阶段】
  11 GitHub 自动更新管理系统 触发：GitHub 自动更新 / Webhook / 自动部署
     文件：references/11-github-auto-update.md
     用途：Webhook 接收端 + 自动重启 + 管理员弹窗 + 后台更新面板

【记忆阶段】
  12 长期编程记忆方案        触发：长期记忆 / 跨会话 / 用户偏好 / /bmem
     文件：references/12-long-term-memory.md
     用途：L1/L2/L3 三层记忆架构 + /bmem 命令 + 跨会话上下文恢复

【使用方式】
  /bhelp              显示本索引
  /bhelp <编号>       显示对应提示词详情（如 /bhelp 06）
  /bhelp <关键词>     按关键词搜索（如 /bhelp 硬编码）
  /bhelp all          显示全部索引（同 /bhelp）

【快速调用】
  直接说出对应阶段的意图即可触发，无需手动加载文件。
  例：「帮我检查项目」→ 自动加载 08
  例：「我要做一个博客网站」→ 自动加载 01

【铁律提醒】
  每次对话自动加载铁律三件套 04 + 06 + 13，以及 /baudit + /bdocs。
  涉及代码生成时，违反任一铁律即重写。
```

### 3.2 按编号查询（`/bhelp 06`）

输出对应编号的提示词**完整内容**，开头附加元信息：

```
📌 提示词 06：防 AI 幻觉
文件：references/06-anti-hallucination.md
阶段：开发约束（铁律）
约束强度：HARD

---- 以下为提示词原文 ----

<在此处粘贴 references/06-anti-hallucination.md 的完整内容>
```

实现方式：调用 Read 工具读取 `references/06-anti-hallucination.md`，将内容输出给用户。

### 3.3 按关键词搜索（`/bhelp 硬编码`）

按下表匹配关键词，输出命中的提示词清单（编号 + 名称 + 触发场景 + 文件路径）：

| 关键词 | 命中编号 |
|---|---|
| 网站 / 项目 / 起步 / 想法 / 落地 | 01, 02 |
| UI / 设计 / 配色 / 风格 / 排版 | 03 |
| 硬编码 / 假数据 / 测试数据 | 04 |
| 幻觉 / 编造 / 待核实 / 不确定 | 06 |
| 对接 / 接手 / 读懂 / 新 AI | 07 |
| 检查 / 审计 / 安全 / 漏洞 / 性能 | 08 |
| 文档 / PROJECT / SPEC / 规划 / 规范 / 开发流程 | 09 |
| 交接 / README / PROMPT | 10 |
| GitHub / Webhook / 自动更新 / 部署 | 11 |
| 记忆 / 跨会话 / 用户偏好 / 偏好 / corrections | 12 |
| 项目文档 / 严格遵循 / 源码风格 / 文档规范 / 错误码枚举 | 13 |

未命中时回复：「未找到匹配的提示词，输入 `/bhelp` 查看全部索引。」

### 3.4 输出规则

- 不调用任何业务工具，不修改文件，不启动开发流程
- 仅展示索引或对应提示词内容
- 输出完成后，**主动询问**：「需要我加载哪一份提示词并开始执行吗？」

### 3.5 快捷命令清单（单提示词直接加载）

每个提示词对应一个 `/b` 前缀的快捷命令。用户输入命令时，**直接调用 Read 读取对应 reference 文件，加载完整内容到上下文并按其指引开始执行**（不再走 `/bhelp` 的索引流程）。

| 命令 | 编号 | 提示词 | 加载文件 |
|---|---|---|---|
| `/bstart` | 01 | 项目起步提示词 | [references/01-project-start.md](references/01-project-start.md) |
| `/bfuzzy` | 02 | 模糊想法落地 10 步流程 | [references/02-fuzzy-idea-to-plan.md](references/02-fuzzy-idea-to-plan.md) |
| `/bui` | 03 | 现代简约 UI 设计规则 | [references/03-ui-design-rules.md](references/03-ui-design-rules.md) |
| `/bhardcode` | 04 | 铁律①：禁硬编码假数据 | [references/04-no-hardcode-fake-data.md](references/04-no-hardcode-fake-data.md) |
| `/bhaluc` | 06 | 铁律②：防 AI 幻觉 | [references/06-anti-hallucination.md](references/06-anti-hallucination.md) |
| `/bonboard` | 07 | AI 对接新项目引导 | [references/07-ai-onboarding.md](references/07-ai-onboarding.md) |
| `/baudit` | 08 | 项目全方位深度检查 | [references/08-project-audit.md](references/08-project-audit.md) |
| `/bdocs` | 09 | 两份核心文档维护规范 | [references/09-docs-lifecycle.md](references/09-docs-lifecycle.md) |
| `/bhandover` | 10 | 项目交接文档生成 | [references/10-handover-docs.md](references/10-handover-docs.md) |
| `/bdeploy` | 11 | GitHub 自动更新管理系统 | [references/11-github-auto-update.md](references/11-github-auto-update.md) |
| `/bmem` | 12 | 长期编程记忆方案（show/add/clean/audit/export） | [references/12-long-term-memory.md](references/12-long-term-memory.md) |
| `/bstrict` | 13 | 铁律③：严格遵循项目文档规范 | [references/13-strict-doc-compliance.md](references/13-strict-doc-compliance.md) |
| `/bhelp` | — | 提示词索引 | 见 §3.1 ~ §3.4 |

#### 命令执行规则

1. **加载方式**：使用 Read 工具读取对应 `references/XX-xxx.md` 文件完整内容
2. **加载后行为**：按提示词内的指引开始执行（如 `/bstart` 加载后立即按完整版/精简版模板与用户对齐需求；`/baudit` 加载后立即询问项目路径；`/bstrict` 加载后立即询问用户项目文档路径并按"读文档 → 提问 → 读 /bdocs /bui 生成的项目文档 → 按文档写代码并自检"四步流程执行）
3. **铁律叠加**：
   - 输入 `/bhardcode` / `/bhaluc` / `/bstrict` 任一命令 → 该铁律进入本次会话硬约束
   - 输入涉及代码生成的命令（如 `/bstart`、`/bui`、`/bdeploy`）→ **自动连带加载**铁律三件套 `04 + 06 + 13`
4. **组合命令**：支持空格分隔的链式调用，如：
   - `/bstart /bui` → 先加载 01，再叠加 03
   - `/bhardcode /bhaluc /bstrict` → 三铁律一次性加载
5. **未识别命令**：如果输入的 `/bXXX` 不在清单内，回复「未识别的命令，输入 `/bhelp` 查看所有可用命令」
6. **执行确认**：加载完成后，**主动告诉用户**当前已加载哪份提示词，并简述下一步将做什么

#### 命令速查示例

```
/bstart              # 起步：项目类型 + 功能清单
/bstart /bui         # 起步 + 设计 UI 风格
/bfuzzy              # 模糊想法落地 10 步
/bhardcode           # 加载铁律①禁硬编码
/bhardcode /bhaluc /bstrict   # 三铁律一次性加载
/bstrict             # 加载铁律③严格遵循项目文档规范
/bonboard            # AI 接手新项目
/baudit              # 项目全方位检查
/bdocs               # 同步更新两份文档
/bhandover           # 生成交接文档
/bdeploy             # 配置 GitHub 自动更新
/bmem show          # 显示当前所有记忆（L2 + L3）
/bmem audit         # 审计记忆质量
/bhelp               # 查看全部索引
/bhelp 06            # 查看 06 号提示词完整内容
/bhelp 13            # 查看 13 号铁律③完整内容
```

### 3.6 全流程起步（用户表达"做网站"意图）

1. **判断明确度**：
   - 用户给了网站类型 + 功能清单 → 走 `references/01` 完整版模板
   - 用户只有零散想法 → 走 `references/02` 10 步流程，先列标准化提问清单
2. **完成需求对齐后**：进入 UI 设计阶段 → 加载 `references/03`
3. **进入开发阶段前**：**强制加载**铁律三件套 `references/04 + 06 + 13`，作为本次会话的硬约束上下文
4. **代码提交后**：每次需求变更 / 任务推进 → 走 `references/09` 联动更新两份文档
5. **项目收尾**：走 `references/10` 生成交接文档
6. **部署阶段**：走 `references/11` 配置 GitHub 自动更新

### 3.7 单点按需调用

用户直接表达某个具体意图（如"检查项目"、"生成 README"、"配置 Webhook"）时，按上方路由表加载对应 reference，**不需要走全流程**。

### 3.8 铁律强制加载时机与自动加载机制

#### 3.8.1 每次对话自动加载（无需用户触发）

**每次对话开始时**，自动加载以下提示词到上下文，无需用户提示：

- 铁律三件套：
  - `references/04-no-hardcode-fake-data.md` —— 禁硬编码、禁假数据、禁占位符
  - `references/06-anti-hallucination.md` —— 防幻觉、不确定标注"待核实"
  - `references/13-strict-doc-compliance.md` —— 严格遵循项目文档规范、写代码前必读文档
- 项目审计：`references/08-project-audit.md` —— 5 维度检查规范
- 文档维护：`references/09-docs-lifecycle.md` —— 变更必须同步两份文档

**目的**：让 AI 在每次对话中始终具备"规范生成代码"的能力，任何代码生成动作都受这 5 份提示词约束，违反任一即重写。

#### 3.8.2 起步命令后自动连带加载

**用户输入 `/bstart` 或 `/bfuzzy` 后**，除 `/bonboard`（07）外，自动连带加载以下所有指令：

| 编号 | 文件 | 加载目的 |
|---|---|---|
| 03 | `references/03-ui-design-rules.md` | UI 设计规范 |
| 04 | `references/04-no-hardcode-fake-data.md` | 铁律①禁硬编码 |
| 06 | `references/06-anti-hallucination.md` | 铁律②防幻觉 |
| 08 | `references/08-project-audit.md` | 项目审计 |
| 09 | `references/09-docs-lifecycle.md` | 文档维护 |
| 10 | `references/10-handover-docs.md` | 交接文档 |
| 11 | `references/11-github-auto-update.md` | GitHub 自动更新 |
| 12 | `references/12-long-term-memory.md` | 长期记忆 |
| 13 | `references/13-strict-doc-compliance.md` | 铁律③严格遵循项目文档规范 |

**不加载 `/bonboard`（07）的原因**：07 是"AI 对接新项目引导"，仅在用户明确要求"让新 AI 接手项目"时才需要，与"项目起步开发"场景不同。

#### 3.8.3 铁律强制加载总结

无论用户是否主动调用 `/bhardcode` / `/bhaluc` / `/bstrict`，只要本次会话涉及代码生成 / 修改，必须确保以下三份铁律已在上下文：

- `references/04-no-hardcode-fake-data.md`
- `references/06-anti-hallucination.md`
- `references/13-strict-doc-compliance.md`

违反铁律的代码视作不合格，**必须重写**。

## 4. 输入输出约定

| 类型 | 输入 | 输出 |
|---|---|---|
| 起步 | 项目描述 / 模糊想法 | 标准化提问清单 → 技术方案 → 模块架构 → 数据库设计 → UI 规范 → 工期计划 → 需求说明书 |
| 设计 | 项目类型 / 设计调性 | 配色方案 / 字体 / 排版 / 组件规范 |
| 开发 | 业务需求 | 业务代码 + 接口代码（按铁律 04 + 06 + 13 交付） |
| 检查 | 项目代码 / 路径 / 关键代码片段 | 分级问题清单（严重/警告/建议）+ 根因 + 修复方案 + 评分 |
| 文档 | 项目变更信息 | PROJECT + SPEC（规划/规范/开发流程）两份联动文档 |
| 交接 | 项目代码 | README.md + PROMPT.md + 文件顶部注释 |
| 部署 | 技术栈 | Webhook 接收端 + 自动更新脚本 + 后台面板 + 弹窗组件 + 表结构 + 部署指南 |

## 5. 严格约束（硬规则）

以下规则不可违反，违反需重写：

1. **禁硬编码**：密钥、token、域名、账号、价格、IP、接口地址、配置参数必须抽离到配置文件 / 环境变量 / 数据库（详见 `references/04`）
2. **禁假数据 / 禁占位符**：无真实文档时显式失败（`throw new Error('待接入：XXX')`），不编造返回假数据，不使用 `// TODO`/`pass`/`Lorem Ipsum`/`your_api_key_here` 等占位符；测试数据必须标注 `// 仅本地测试模拟`（详见 `references/04`）
3. **防幻觉**：不确定说不知道；存疑标注「待核实」；代码不确定处标注「需验证」；回答末尾说明可信度（详见 `references/06`）
4. **UI 禁用项**：禁 emoji / 禁毛玻璃 / 禁暗黑风格 / 禁夸张渐变（详见 `references/03`）
5. **文档联动**：任何变更必须按 `references/09` 同步更新两份文档，版本号按语义化递增
6. **审计覆盖**：项目检查必须覆盖安全/质量/性能/架构/运维 5 个维度，缺一不可（详见 `references/08`）
7. **严格遵循项目文档规范**：写代码前必须读完 README / 接口文档 / 数据库结构 / 编码规范；命名、分层、注释、异常格式、响应体完全对标现有源码；错误码沿用项目枚举；新增功能兼容旧逻辑；完成后主动自检合规校验清单（详见 `references/13`）

## 6. 文件清单

```
web-project-flow/
├── SKILL.md                              # 本文件：主入口 + 路由 + 铁律
└── references/
    ├── 01-project-start.md               # 项目起步提示词（完整版+精简版）
    ├── 02-fuzzy-idea-to-plan.md          # 模糊想法落地 10 步流程
    ├── 03-ui-design-rules.md            # 现代简约 UI 设计规则
    ├── 04-no-hardcode-fake-data.md      # 铁律：禁硬编码假数据 / 禁占位符
    ├── 06-anti-hallucination.md         # 铁律：防 AI 幻觉
    ├── 07-ai-onboarding.md              # AI 对接新项目引导
    ├── 08-project-audit.md              # 项目全方位深度检查
    ├── 09-docs-lifecycle.md             # 两份核心文档维护规范
    ├── 10-handover-docs.md              # 项目交接文档生成
    ├── 11-github-auto-update.md         # GitHub 自动更新管理系统
    ├── 12-long-term-memory.md          # 长期编程记忆方案（L1/L2/L3 三层架构）
    └── 13-strict-doc-compliance.md      # 铁律：严格遵循项目文档规范（8 条规则 + 四步流程）
```

## 7. 启动约定

**用户首次触发本 Skill 时，按以下顺序响应：**

1. **每次对话开始**：自动加载铁律三件套 `04 + 06 + 13`，以及 `08`（审计）和 `09`（文档维护），作为本次会话的硬约束上下文，无需用户提示
2. 识别用户意图属于哪个阶段（起步 / 设计 / 开发 / 检查 / 文档 / 交接 / 部署 / 记忆）
3. 如果是起步阶段，进一步判断需求明确度，选 `01` 或 `02`；用户输入 `/bstart` 或 `/bfuzzy` 后，按 §3.8.2 自动连带加载除 `/bonboard`（07）外的所有指令
4. 如果涉及代码生成，**主动加载**铁律三件套 `04 + 06 + 13`，无需用户提示
5. 加载对应 reference 的完整内容到上下文
6. 按 reference 内的指引开始执行

**禁止跳过铁律直接写代码。** 任何代码生成动作前，必须确认铁律三件套已加载，并且已读完用户提供的项目文档（README / 接口文档 / 数据库结构 / 编码规范）。
