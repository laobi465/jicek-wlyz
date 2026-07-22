<!--
reference: 12-long-term-memory.md
source: 长期编程记忆方案（设计文档）
stage: 记忆 / 跨会话上下文
-->

# 长期编程记忆方案（Long-term Programming Memory）

> 版本：1.0 ｜ 适用于 TRAE / web-project-flow Skill
> 最后更新：2026-07-19

---

## 1. 核心目标

让 AI 在**跨会话、跨项目、跨时间**的长期协作中：

- 保持一致的编程风格和规范
- 快速恢复项目上下文（无需用户重复说明）
- 积累用户偏好和历史经验
- 不丢失关键决策和约定
- 避免重复犯错（已纠正过的不再犯）

---

## 2. 三层记忆架构

### L1 - 即时记忆（Session Memory）

| 项 | 值 |
|---|---|
| 范围 | 当前会话 |
| 载体 | 对话历史 |
| 容量 | 受 context window 限制 |
| 失效 | 会话结束即失效 |
| 用途 | 临时澄清、当前任务上下文 |

### L2 - 项目持久记忆（Project Persistent）

| 项 | 值 |
|---|---|
| 范围 | 当前项目 |
| 载体 | `README.md` / `PROMPT.md` / 文件顶部注释 / `.trae/skills/` |
| 容量 | 无限制（受 git 管理） |
| 失效 | 项目删除时失效 |
| 用途 | 项目规范、铁律、架构、决策 |

### L3 - 全局持久记忆（Global Persistent）

| 项 | 值 |
|---|---|
| 范围 | 跨项目（用户级） |
| 载体 | `~/.trae/skills/` / `~/.trae/rules/` / `~/.trae/config` |
| 容量 | 无限制 |
| 失效 | 永久（除非手动清理） |
| 用途 | 用户偏好、通用规则、跨项目经验 |

> **说明**：本提示词仅描述 L3 机制和路径，不在仓库内附带模板文件。用户需要时按 §8 模板手动创建。

---

## 3. 记忆写入时机

| 触发事件 | 写入位置 | 写入内容 | 优先级 |
|---|---|---|---|
| 用户表达偏好 | `~/.trae/rules/preferences.md` | 偏好项（命名/注释/代码风格） | P1 |
| 用户纠正错误 | `~/.trae/rules/corrections.md` | 错误模式 + 正确做法 | P0 |
| 项目里程碑完成 | `PROMPT.md` + `PROJECT.md` + `SPEC.md` | 决策、变更、版本 | P1 |
| 发现新铁律 | `references/` + `PROMPT.md` | 新规则 | P0 |
| 代码生成 | 文件顶部注释 | 文件元信息 | P2 |
| 用户定制风格 | `~/.trae/rules/style.md` | 代码风格偏好 | P1 |

---

## 4. 记忆读取顺序

新 AI 接手项目时，按以下顺序加载记忆：

1. **L3 全局层**：读 `~/.trae/rules/` 下所有 `.md` → 用户偏好和通用规则
2. **L2 项目层 - 概览**：读项目 `README.md` → 项目定位和结构
3. **L2 项目层 - 规范**：读项目 `PROMPT.md` → 开发规范、铁律、路由表
4. **L2 项目层 - 目录**：浏览项目目录结构 → 文件组织
5. **L2 项目层 - 单文件**：按需读取文件顶部注释 → 单文件元信息
6. **L1 即时层**：根据用户当前输入加载对应 reference

> 该读取顺序与 [07-ai-onboarding.md](./07-ai-onboarding.md) 一致，本文件是其在记忆维度的扩展。

---

## 5. 冲突优先级

当不同层级的记忆冲突时，按以下优先级处理：

```
用户当前会话最新指令（最高）
    ↓
L3 全局持久记忆（用户偏好）
    ↓
L2 项目 PROMPT.md（项目规范）
    ↓
L2 项目文件顶部注释
    ↓
L1 历史会话上下文（最低）
```

> 冲突时主动告知用户，让用户决定是否更新记忆。

---

## 6. 记忆失效与更新

### 6.1 失效判定

- **半年未触发**：移入归档 `~/.trae/rules/archive/`
- **项目已删除**：清理对应项目级记忆
- **规则被新规则覆盖**：标记为 `deprecated`，保留 1 个版本后删除

### 6.2 更新策略

- **增量更新**：只追加，不删除（git 可追溯）
- **版本号递增**：每次更新 `PROMPT.md` 版本号 +1
- **审计触发**：执行 `/baudit` 时同步审计记忆质量

---

## 7. 配套命令（`/bmem` 前缀）

| 命令 | 作用 |
|---|---|
| `/bmem show` | 显示当前所有记忆（L2 + L3） |
| `/bmem show global` | 仅显示全局记忆（L3） |
| `/bmem show project` | 仅显示项目记忆（L2） |
| `/bmem add <内容>` | 手动添加记忆（默认全局，写入 `~/.trae/rules/preferences.md`） |
| `/bmem add project <内容>` | 添加项目级记忆（写入 `PROMPT.md` 或对应 reference） |
| `/bmem clean` | 清理过期记忆（半年未触发） |
| `/bmem audit` | 审计记忆质量，输出报告 |
| `/bmem export` | 导出全部记忆为单个 md 文件 |

### 7.1 `/bmem` 命令执行规则

1. **加载方式**：先 Read 本文件了解机制，再根据子命令执行对应操作
2. **写入前确认**：写入 L3 前主动询问用户「将写入 `~/.trae/rules/xxx.md`，是否确认？」
3. **不修改 Skill**：`/bmem` 不修改 `web-project-flow/` 内任何文件，只写 `~/.trae/rules/` 或 `PROMPT.md`
4. **审计联动**：`/bmem audit` 触发时，同步调用 [08-project-audit.md](./08-project-audit.md) 的项目检查
5. **未识别子命令**：输入的 `/bmem XXX` 不在清单内 → 回复「未识别的子命令，输入 `/bmem show` 查看可用命令」

---

## 8. 记忆文件模板（用户参考）

> 以下模板供用户在 `~/.trae/rules/` 下手动创建时参考。本仓库不主动维护这些文件。

### 8.1 `~/.trae/rules/preferences.md`（用户偏好）

```markdown
# 用户偏好

> 全局通用偏好，跨项目生效

## 命名风格
- 变量：camelCase
- 常量：UPPER_SNAKE_CASE
- 类名：PascalCase

## 注释风格
- 简洁，只在复杂逻辑处加
- 不写废话注释

## 代码风格
- 缩进：4 空格
- 行宽：100 字符
- 单引号优先

## 框架偏好
- 后端：Python + FastAPI
- 前端：Vue 3 + TypeScript
```

### 8.2 `~/.trae/rules/corrections.md`（错误纠正）

```markdown
# 错误纠正记录

> 已纠正过的错误模式，避免重复犯错

## 2026-07-19：禁硬编码 token
- 错误：把 token 写死在代码里
- 正确：走 sys_config 表，通过 config('api_token') 读取
- 触发：[04-no-hardcode-fake-data.md]

## 2026-07-19：禁编造 API
- 错误：编造不存在的 /api/v1/users 接口
- 正确：基于事实回答，存疑标注「待核实」
- 触发：[06-anti-hallucination.md]
```

---

## 9. 与现有 Skill 的协同

| 现有提示词 | 协同点 |
|---|---|
| [07-ai-onboarding.md](./07-ai-onboarding.md) | 读取顺序与本文 §4 一致 |
| [09-docs-lifecycle.md](./09-docs-lifecycle.md) | 写入时机参考本文 §3 |
| [10-handover-docs.md](./10-handover-docs.md) | 生成交接文档时同步更新 L3 全局记忆 |
| [08-project-audit.md](./08-project-audit.md) | 审计时同步执行 `/bmem audit` |

---

## 10. 启动检查清单（新增）

新 AI 接手时，记忆相关确认项：

- [ ] 知道三层记忆架构（L1 / L2 / L3）
- [ ] 知道读取顺序（L3 → L2 → L1）
- [ ] 知道冲突优先级（用户最新指令 > L3 > L2 > L1）
- [ ] 知道 `/bmem` 命令清单和执行规则
- [ ] 知道写入 L3 前必须询问用户确认

---

## 11. 验证方式

- 输入 `/bmem show` → 显示当前所有记忆（L2 + L3）
- 输入 `/bhelp 12` → 显示本方案完整内容
- 输入 `/bmem` → 加载本方案
- 跨会话：新会话开始时 AI 自动按 §4 顺序加载 L3 + L2 记忆
- 冲突场景：用户当前指令与历史记忆冲突时，AI 主动询问是否更新
