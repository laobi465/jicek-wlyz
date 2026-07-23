# jicek-wlyz APK 注入工具文档

> 版本：1.0 ｜ 状态：M5 APK 注入 ｜ 最后更新：2026-07-23
>
> 本文档定义 APK 注入工具的使用方式、安全策略、API 接口与命令行工具规范。

---

## 1. 概述

### 1.1 功能定位

APK 注入工具为开发者提供「一键将 jicek-wlyz 验证 SDK 注入到任意 APK」的能力，无需开发者手动修改源码或集成 SDK。注入后的 APK 启动时自动加载 SDK，完成设备绑定、卡密验证、心跳保活等流程。

### 1.2 两种使用方式

| 方式 | 适用场景 | 特点 |
|---|---|---|
| **在线注入**（Web API） | 开发者后台一键上传 | 服务端 Docker 沙箱执行，BullMQ 异步任务，无需本地环境 |
| **命令行注入**（CLI 工具） | CI/CD 自动化、批量注入 | 本地执行 apktool + apksigner，需安装依赖 |

### 1.3 注入流程

```
1. 上传 APK（magic number + 大小校验 + SHA-256）
2. apktool d 反编译
3. 注入 SDK smali 代码（WlyzSdkEntry / WlyzAntiDebug / WlyzIntegrityCheck）
4. 注入配置文件（assets/wlyz_config.json）
5. apktool b 重新打包
6. apksigner 签名（平台 keystore）
7. 上传注入后 APK
8. 返回下载链接
```

---

## 2. 安全策略（SPEC §2.6.3 21 项）

### 2.1 核心防护

| # | 防护 | 实现 |
|---|---|---|
| 1 | SDK 自签名校验 | 注入 SDK 内置平台公钥，启动时校验宿主 APK 签名哈希 |
| 2 | 完整性校验 | classes.dex SHA-256 与服务端登记值比对 |
| 3 | 反调试 | Native 层 ptrace / frida / xposed 检测 |
| 4 | 代码混淆 | VMP 虚拟化关键逻辑 |
| 5 | 通信密钥保护 | RSA 私钥存 Native SO |
| 6 | Java + Native 双层签名校验 | 双校验，绕过任一层另一层拦截 |
| 7 | 全文件完整性校验 | dex + arsc + manifest + SO 全部 SHA-256 比对 |
| 20 | 沙箱执行 | 独立 Docker 容器，宿主机隔离 |
| 21 | apktool 参数白名单 | 命令注入防护，所有参数严格校验 |

### 2.2 配置项开关

```typescript
interface InjectionConfig {
  appKey: string;                    // 应用 AppKey
  serverUrl: string;                 // 服务端验证 URL
  sdkVersion: string;                // SDK 版本（白名单：1.0.0/1.1.0/1.2.0）
  sdkPackage: string;                // SDK 包名（必须 com.jicek.wlyz. 前缀）
  enableAntiDebug: boolean;          // 反调试
  enableVmp: boolean;                // VMP 虚拟化
  enableStringEncrypt: boolean;      // 字符串加密
  enableControlFlowFlatten: boolean; // 控制流平坦化
  enableSoPack: boolean;             // SO 加壳（需商业授权）
  enableAntiDump: boolean;           // 防内存 dump
  enableAntiEmulator: boolean;       // 反模拟器
  enableAntiVirtualSpace: boolean;   // 防多开
  enableDualSignatureCheck: boolean; // Java + Native 双层签名校验
  enableFullIntegrityCheck: boolean; // 全文件完整性校验
  enableHeartbeat: boolean;          // 心跳保活
  heartbeatTimeoutSec: number;       // 心跳超时（60-3600 秒）
  enableHardwareFingerprint: boolean;// 硬件设备指纹
}
```

---

## 3. 在线注入 API

### 3.1 上传 APK 创建任务

```
POST /api/apk-injection/upload
Content-Type: multipart/form-data
X-User-Id: <开发者 ID>
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| file | File | 是 | APK 文件（≤500MB） |
| appKey | string | 是 | 应用 AppKey |
| serverUrl | string | 是 | 服务端 URL |
| sdkVersion | string | 否 | SDK 版本（默认 1.2.0） |
| sdkPackage | string | 否 | SDK 包名（默认 com.jicek.wlyz.sdk） |
| enableAntiDebug | string | 否 | 反调试（'true'/'false'，默认 true） |
| enableVmp | string | 否 | VMP（默认 true） |
| ...其他配置项 | string | 否 | 见 InjectionConfig |

**响应**（202 Accepted）：

```json
{
  "code": 0,
  "data": {
    "taskId": "cuid_xxx",
    "jobId": "bullmq-job-id",
    "status": "pending"
  }
}
```

### 3.2 查询任务列表

```
GET /api/apk-injection/tasks?status=pending&limit=20&offset=0
X-User-Id: <开发者 ID>
```

**响应**：

```json
{
  "code": 0,
  "data": {
    "tasks": [...],
    "total": 42
  }
}
```

### 3.3 查询任务详情

```
GET /api/apk-injection/tasks/{taskId}
X-User-Id: <开发者 ID>
```

### 3.4 取消任务

```
DELETE /api/apk-injection/tasks/{taskId}
X-User-Id: <开发者 ID>
```

仅 pending 状态可取消，processing/success/failed 不允许。

### 3.5 下载注入后 APK

```
GET /api/apk-injection/tasks/{taskId}/download
X-User-Id: <开发者 ID>
```

**响应**：

- Content-Type: `application/vnd.android.package-archive`
- Content-Disposition: `attachment; filename="injected-app.apk"`
- X-SHA256: 注入后 APK SHA-256

---

## 4. 命令行工具（CLI）

### 4.1 安装依赖

```bash
# 安装 apktool
wget https://bitbucket.org/iBotPeaches/apktool/downloads/apktool_2.9.3.jar -O /usr/local/bin/apktool.jar
echo '#!/bin/bash\njava -jar /usr/local/bin/apktool.jar "$@"' > /usr/local/bin/apktool
chmod +x /usr/local/bin/apktool

# 安装 Android SDK build-tools（含 apksigner）
# 从 https://developer.android.com/studio 下载 command-line tools
# apksigner 路径：<android-sdk>/build-tools/<version>/apksigner
```

### 4.2 环境变量

```bash
export APK_SIGN_KEYSTORE_PATH=/path/to/keystore.jks
export APK_SIGN_KEYSTORE_PASSWORD=your_keystore_password
export APK_SIGN_KEY_ALIAS=wlyz
export APK_SIGN_KEY_PASSWORD=your_key_password
```

### 4.3 命令

#### inject - 本地注入

```bash
npx ts-node tools/apk-injector/cli.ts inject \
  --input app.apk \
  --app-key ak_xxxxxxxx \
  --server-url https://api.example.com \
  --output injected-app.apk
```

可选开关（默认全部启用）：

```bash
--no-anti-debug          # 禁用反调试
--no-vmp                 # 禁用 VMP
--no-string-encrypt      # 禁用字符串加密
--no-control-flow        # 禁用控制流平坦化
--no-anti-emulator       # 禁用反模拟器
--no-anti-virtual-space  # 禁用防多开
--no-heartbeat           # 禁用心跳保活
--no-hardware-fingerprint # 禁用硬件指纹
--heartbeat-timeout 300  # 心跳超时秒数（60-3600）
```

#### verify - 校验 APK

```bash
npx ts-node tools/apk-injector/cli.ts verify --input app.apk
```

输出：

```
校验通过:
  文件名:    app.apk
  大小:      12345678 字节 (11.77 MB)
  SHA-256:   a1b2c3d4...
  Magic:     504b0304 (PK\x03\x04)
```

#### sign - 签名 APK

```bash
npx ts-node tools/apk-injector/cli.ts sign \
  --input unsigned.apk \
  --output signed.apk \
  --keystore /path/to/keystore.jks \
  --ks-pass 123456 \
  --key-alias wlyz \
  --key-pass 123456
```

---

## 5. 注入后 APK 结构

注入后 APK 新增以下文件：

```
injected-app.apk
├── smali/
│   └── com/jicek/wlyz/sdk/
│       ├── WlyzSdkEntry.smali          # SDK 入口类
│       ├── WlyzAntiDebug.smali         # 反调试（可选）
│       └── WlyzIntegrityCheck.smali    # 完整性校验
├── assets/
│   └── wlyz_config.json                # SDK 配置
└── lib/
    └── <abi>/
        └── libwlyz.so                  # Native 库（反调试 + 签名校验 + 加密）
```

### wlyz_config.json 示例

```json
{
  "app_key": "ak_xxxxxxxx",
  "server_url": "https://api.example.com",
  "sdk_version": "1.2.0",
  "sdk_package": "com.jicek.wlyz.sdk",
  "features": {
    "anti_debug": true,
    "vmp": true,
    "string_encrypt": true,
    "control_flow_flatten": true,
    "anti_emulator": true,
    "anti_virtual_space": true,
    "heartbeat": true,
    "heartbeat_timeout_sec": 300,
    "hardware_fingerprint": true
  }
}
```

---

## 6. 错误码

| 错误码 | 含义 |
|---|---|
| 8001 | APK 文件格式错误 |
| 8002 | APK 签名校验失败 |
| 8003 | APK 完整性校验失败 |
| 8004 | APK 注入任务不存在 |
| 8005 | APK 注入任务状态不允许操作 |
| 8006 | APK 注入失败（apktool/smali/签名错误） |
| 8007 | APK 文件大小超限 |
| 8008 | APK 注入配置参数非法 |

---

## 7. Worker 部署

### 7.1 独立进程启动

APK 注入是 CPU 密集型任务，Worker 必须在独立进程运行，不在 Next.js 主进程。

```bash
# 编译 Worker
npx tsc src/server/modules/apk-injection/apk-injection-worker.ts \
  --outDir dist/workers \
  --module commonjs \
  --target es2022 \
  --moduleResolution node

# 启动 Worker
node dist/workers/apk-injection-worker.js
```

### 7.2 Docker Compose 配置

```yaml
# docker-compose.yml 追加
services:
  apk-injection-worker:
    image: jicek-wlyz:latest
    command: node dist/workers/apk-injection-worker.js
    restart: unless-stopped
    environment:
      - DATABASE_URL=postgresql://...
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - APK_SIGN_KEYSTORE_PATH=/data/keystore.jks
      - APK_SIGN_KEYSTORE_PASSWORD=${APK_SIGN_KEYSTORE_PASSWORD}
      - APK_SIGN_KEY_ALIAS=${APK_SIGN_KEY_ALIAS}
      - APK_SIGN_KEY_PASSWORD=${APK_SIGN_KEY_PASSWORD}
    volumes:
      - ./keystore.jks:/data/keystore.jks:ro
      - /var/run/docker.sock:/var/run/docker.sock  # 沙箱执行用
    depends_on:
      - postgres
      - redis
```

### 7.3 沙箱执行

生产环境推荐使用 Docker-in-Docker 沙箱：

1. Worker 容器挂载 `docker.sock`
2. 每个注入任务创建独立容器执行 apktool + apksigner
3. 任务完成销毁容器，宿主机完全隔离

---

## 8. 限制与约束

### 8.1 不支持的场景

- **加固应用**：360 加固 / 腾讯乐固 / 爱加密等已加固 APK，smali 已被抽取，注入会失败。建议开发者提供未加固版本。
- **超大型 APK**：>500MB 拒绝（可在管理员后台调整上限）
- **多 dex 应用**：当前仅注入主 dex（classes.dex）， multidex 应用需手动处理

### 8.2 性能参考

| APK 大小 | 注入耗时（参考） |
|---|---|
| 10MB | 30-60 秒 |
| 50MB | 2-5 分钟 |
| 100MB | 5-10 分钟 |
| 200MB | 10-20 分钟 |

实际耗时取决于服务器 CPU 和磁盘 IO。

---

## 9. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| 1.0 | 2026-07-23 | M5 APK 注入：在线 API（上传/列表/详情/取消/下载）+ CLI 工具（inject/verify/sign）+ Worker（BullMQ 异步）+ 安全策略 21 项 + 配置白名单 + apktool 参数白名单 + 沙箱执行 |
