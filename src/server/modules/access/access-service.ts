import { prisma } from '@/lib/db';
import { getAppByKey } from '@/server/modules/app/app-service';
import { ErrorCode } from '@/lib/security/error-code';

/**
 * 接入中心向导服务（SPEC §3.1 开发者端 - 接入中心）
 *
 * 职责：
 * 1. 列出支持的语言 SDK（6 主流 + 6 小众示例）
 * 2. 按语言 + 应用配置生成接入代码片段
 * 3. 测试应用连接是否正常（verify_rsa 联通性检查）
 *
 * 设计：
 * - 语言清单由代码常量维护，新增语言在此登记
 * - 代码片段生成使用模板字符串，从应用配置读取真实数据
 * - 测试连接调用 getAppByKey 验证 AppKey 是否存在且 active
 */

// ---------------------------------------------------------------------------
// 语言清单常量（SPEC §1.4 多语言接入策略）
// ---------------------------------------------------------------------------

/** 主流 SDK 语言（平台自维护） */
const MAINSTREAM_LANGUAGES = [
  {
    code: 'python',
    name: 'Python',
    version: '3.8+',
    filePath: 'sdks/python/jicek_wlyz.py',
    description: 'Python 客户端 SDK，依赖 cryptography 库',
    installCmd: 'pip install cryptography',
    isMainstream: true,
  },
  {
    code: 'java',
    name: 'Java',
    version: 'JDK 11+',
    filePath: 'sdks/java/src/main/java/com/jicek/wlyz/WlyzClient.java',
    description: 'Java 客户端 SDK，依赖 Gson + JDK 内置 crypto',
    installCmd: 'Maven: com.google.code.gson:gson:2.10.1',
    isMainstream: true,
  },
  {
    code: 'php',
    name: 'PHP',
    version: '7.4+',
    filePath: 'sdks/php/JicekWlyzClient.php',
    description: 'PHP 客户端 SDK，依赖 openssl + curl 扩展',
    installCmd: '无需安装（PHP 内置扩展）',
    isMainstream: true,
  },
  {
    code: 'nodejs',
    name: 'Node.js',
    version: '18+',
    filePath: 'sdks/nodejs/index.js',
    description: 'Node.js 客户端 SDK，使用内置 fetch + crypto',
    installCmd: '无需安装（Node.js 内置）',
    isMainstream: true,
  },
  {
    code: 'go',
    name: 'Go',
    version: '1.21+',
    filePath: 'sdks/go/client.go',
    description: 'Go 客户端 SDK，使用标准库 crypto/* + net/http',
    installCmd: 'go get github.com/jicek-wlyz/sdk-go',
    isMainstream: true,
  },
  {
    code: 'e',
    name: '易语言',
    version: '5.9+',
    filePath: 'sdks/e/jicek_wlyz.e',
    description: '易语言模块，依赖精易模块 + OpenSSL DLL',
    installCmd: '导入 jicek_wlyz.e 模块文件',
    isMainstream: true,
  },
] as const;

/** 小众语言示例代码（社区贡献） */
const COMMUNITY_LANGUAGES = [
  {
    code: 'gglua',
    name: 'GG Lua',
    version: 'GG 修改器内置',
    filePath: 'examples/gglua/example.lua',
    description: 'GG 修改器 Lua 脚本示例（社区贡献）',
    installCmd: 'GG 修改器内运行 .lua 文件',
    isMainstream: false,
  },
  {
    code: 'andlua',
    name: 'AndroLua+',
    version: 'AndroLua+ 3.x',
    filePath: 'examples/andlua/example.lua',
    description: 'AndroLua+ Lua 脚本示例，调用 Java Crypto API',
    installCmd: 'AndroLua+ 内运行 .lua 文件',
    isMainstream: false,
  },
  {
    code: 'autojs',
    name: 'Auto.js',
    version: 'Auto.js Pro',
    filePath: 'examples/autojs/example.js',
    description: 'Auto.js Pro 脚本示例，Node.js 兼容 API',
    installCmd: 'Auto.js Pro 内运行 .js 文件',
    isMainstream: false,
  },
  {
    code: 'shell',
    name: 'Shell',
    version: 'Bash 4+',
    filePath: 'examples/shell/example.sh',
    description: 'Shell 脚本示例，依赖 curl + openssl + jq',
    installCmd: 'apt install curl openssl jq',
    isMainstream: false,
  },
  {
    code: 'anjian',
    name: '按键精灵',
    version: '按键精灵 2014+',
    filePath: 'examples/anjian/example.txt',
    description: '按键精灵脚本示例，通过 Call.Cmd 调用 curl/openssl',
    installCmd: '按键精灵导入 .txt 脚本',
    isMainstream: false,
  },
  {
    code: 'htmljs',
    name: 'HTML/JS',
    version: 'ES2020+',
    filePath: 'examples/htmljs/example.html',
    description: '浏览器端 HTML/JS 示例，使用 Web Crypto API',
    installCmd: '直接打开 .html 文件',
    isMainstream: false,
  },
] as const;

/** 所有支持的语言 */
const ALL_LANGUAGES = [...MAINSTREAM_LANGUAGES, ...COMMUNITY_LANGUAGES];

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export interface SdkLanguageInfo {
  code: string;
  name: string;
  version: string;
  filePath: string;
  description: string;
  installCmd: string;
  isMainstream: boolean;
}

export interface CodeGenOptions {
  baseUrl: string;
  appKey: string;
  /** 是否生成完整可运行示例 */
  withExample: boolean;
}

export interface CodeGenResult {
  language: string;
  fileName: string;
  code: string;
  instructions: string;
}

export interface TestConnectionResult {
  success: boolean;
  appKey: string;
  appName: string;
  cryptoMode: string;
  version: string;
  message: string;
}

// ---------------------------------------------------------------------------
// 1. 列出支持的语言
// ---------------------------------------------------------------------------

/**
 * 列出所有支持的语言 SDK
 * @param onlyMainstream true=仅主流 SDK；false=全部（含社区贡献）
 */
export function listSdkLanguages(onlyMainstream = false): SdkLanguageInfo[] {
  return onlyMainstream
    ? ALL_LANGUAGES.filter((l) => l.isMainstream)
    : ALL_LANGUAGES;
}

/**
 * 按语言代码查询
 */
export function getLanguageByCode(code: string): SdkLanguageInfo | null {
  return ALL_LANGUAGES.find((l) => l.code === code) ?? null;
}

// ---------------------------------------------------------------------------
// 2. 生成接入代码片段
// ---------------------------------------------------------------------------

/**
 * 按语言生成接入代码片段
 *
 * - baseUrl / appKey 从开发者后台配置读取
 * - 客户端 RSA 私钥标记为占位符（铁律 04：禁止硬编码真实密钥）
 */
export async function generateSdkCode(
  language: string,
  options: CodeGenOptions,
): Promise<CodeGenResult> {
  const langInfo = getLanguageByCode(language);
  if (!langInfo) {
    throw new Error(`不支持的语言: ${language}`);
  }

  const { baseUrl, appKey, withExample } = options;
  if (!baseUrl || !appKey) {
    throw new Error('待接入：baseUrl 和 appKey 必填');
  }

  const code = buildCodeByLanguage(langInfo.code, baseUrl, appKey, withExample);
  const instructions = buildInstructions(langInfo);

  return {
    language: langInfo.code,
    fileName: getFileName(langInfo.code),
    code,
    instructions,
  };
}

/** 按语言构造代码片段 */
function buildCodeByLanguage(
  code: string,
  baseUrl: string,
  appKey: string,
  withExample: boolean,
): string {
  const example = withExample ? `\n${EXAMPLE_CODE[code] ?? ''}` : '';
  return CODE_TEMPLATES[code](baseUrl, appKey) + example;
}

/** 构造使用说明 */
function buildInstructions(langInfo: SdkLanguageInfo): string {
  return [
    `语言：${langInfo.name} ${langInfo.version}`,
    `说明：${langInfo.description}`,
    `安装：${langInfo.installCmd}`,
    `源码：${langInfo.filePath}`,
  ].join('\n');
}

/** 获取建议的文件名 */
function getFileName(code: string): string {
  const map: Record<string, string> = {
    python: 'jicek_wlyz.py',
    java: 'WlyzClient.java',
    php: 'JicekWlyzClient.php',
    nodejs: 'index.js',
    go: 'client.go',
    e: 'jicek_wlyz.e',
    gglua: 'example.lua',
    andlua: 'example.lua',
    autojs: 'example.js',
    shell: 'example.sh',
    anjian: 'example.txt',
    htmljs: 'example.html',
  };
  return map[code] ?? `example.${code}`;
}

// ---------------------------------------------------------------------------
// 代码模板（每语言一个工厂函数）
// ---------------------------------------------------------------------------

const CODE_TEMPLATES: Record<string, (baseUrl: string, appKey: string) => string> = {
  python: (baseUrl, appKey) => `# Python 接入示例
from jicek_wlyz import WlyzClient, ClientConfig, generate_client_rsa_keypair

# 1. 生成客户端 RSA 密钥对（首次接入，公钥登记到开发者后台）
private_pem, public_pem = generate_client_rsa_keypair()

# 2. 初始化客户端
config = ClientConfig(
    base_url="${baseUrl}",
    app_key="${appKey}",
    client_rsa_private_key=private_pem,
)
client = WlyzClient(config)

# 3. 协商会话密钥（每次启动调用一次）
client.verify_rsa()

# 4. 验证卡密 + 激活设备
result = client.auth(
    card_code="XXXX-XXXX-XXXX-XXXX",
    machine_code="MACHINE_CODE_HASH",
    device_name="My Device",
)
print("Auth result:", result)
`,
  java: (baseUrl, appKey) => `// Java 接入示例
import com.jicek.wlyz.WlyzClient;
import com.jicek.wlyz.WlyzClient.ClientConfig;

// 1. 初始化客户端（客户端 RSA 私钥从安全存储读取）
ClientConfig config = new ClientConfig(
    "${baseUrl}",
    "${appKey}",
    clientRsaPrivateKeyPem  // 从安全存储读取，禁止硬编码
);
WlyzClient client = new WlyzClient(config);

// 2. 协商会话密钥
client.verifyRsa();

// 3. 验证卡密 + 激活设备
Map<String, Object> result = client.auth(
    "XXXX-XXXX-XXXX-XXXX",
    "MACHINE_CODE_HASH",
    "My Device"
);
System.out.println("Auth result: " + result);
`,
  php: (baseUrl, appKey) => `<?php
// PHP 接入示例
use Jicek\\Wlyz\\WlyzClient;
use Jicek\\Wlyz\\ClientConfig;

// 1. 初始化客户端
$config = new ClientConfig(
    "${baseUrl}",
    "${appKey}",
    $clientRsaPrivateKeyPem  // 从安全存储读取
);
$client = new WlyzClient($config);

// 2. 协商会话密钥
$client->verifyRsa();

// 3. 验证卡密 + 激活设备
$result = $client->auth(
    "XXXX-XXXX-XXXX-XXXX",
    "MACHINE_CODE_HASH",
    "My Device"
);
print_r($result);
`,
  nodejs: (baseUrl, appKey) => `// Node.js 接入示例
const { WlyzClient, ClientConfig } = require('./sdks/nodejs');

// 1. 初始化客户端
const config = new ClientConfig({
  baseUrl: "${baseUrl}",
  appKey: "${appKey}",
  clientRsaPrivateKey: clientRsaPrivateKeyPem,  // 从安全存储读取
});
const client = new WlyzClient(config);

// 2. 协商会话密钥
await client.verifyRsa();

// 3. 验证卡密 + 激活设备
const result = await client.auth(
  "XXXX-XXXX-XXXX-XXXX",
  "MACHINE_CODE_HASH",
  "My Device"
);
console.log("Auth result:", result);
`,
  go: (baseUrl, appKey) => `// Go 接入示例
package main

import (
    "fmt"
    jicek_wlyz "github.com/jicek-wlyz/sdk-go"
)

func main() {
    // 1. 初始化客户端
    config := &jicek_wlyz.ClientConfig{
        BaseURL:             "${baseUrl}",
        AppKey:              "${appKey}",
        ClientRSAPrivateKey: clientRsaPrivateKeyPem,  // 从安全存储读取
    }
    client := jicek_wlyz.NewClient(config)

    // 2. 协商会话密钥
    if _, err := client.VerifyRSA(); err != nil {
        panic(err)
    }

    // 3. 验证卡密 + 激活设备
    result, err := client.Auth(
        "XXXX-XXXX-XXXX-XXXX",
        "MACHINE_CODE_HASH",
        "My Device",
    )
    if err != nil {
        panic(err)
    }
    fmt.Println("Auth result:", result)
}
`,
  e: (baseUrl, appKey) => `.版本 2

.子程序 接入示例
    .局部变量 客户端对象, jicek_wlyz

    ' 1. 初始化客户端
    客户端对象.初始化客户端 ("${baseUrl}", "${appKey}", 客户端RSAPrivateKey, 10)

    ' 2. 协商会话密钥
    客户端对象.获取服务端公钥

    ' 3. 验证卡密 + 激活设备
    输出调试文本 (客户端对象.验证卡密 ("XXXX-XXXX-XXXX-XXXX", 机器码, "我的设备"))
`,
  gglua: (baseUrl, appKey) => `-- GG Lua 接入示例
local BASE_URL = "${baseUrl}"
local APP_KEY = "${appKey}"
local CLIENT_RSA_PRIVATE_KEY = [[...]]  -- 从安全存储读取

-- 完整流程参考 examples/gglua/example.lua
local session = verify_rsa(BASE_URL, APP_KEY, CLIENT_RSA_PRIVATE_KEY)
local result = auth(session, "XXXX-XXXX-XXXX-XXXX", get_machine_code())
print("Auth result:", result)
`,
  andlua: (baseUrl, appKey) => `-- AndroLua+ 接入示例
local BASE_URL = "${baseUrl}"
local APP_KEY = "${appKey}"
local CLIENT_RSA_PRIVATE_KEY = [[...]]  -- 从安全存储读取

-- 完整流程参考 examples/andlua/example.lua
local session = verify_rsa()
local result = auth(session.session_key, "XXXX-XXXX-XXXX-XXXX", get_android_id())
print("Auth result:", result)
`,
  autojs: (baseUrl, appKey) => `// Auto.js 接入示例
const BASE_URL = "${baseUrl}";
const APP_KEY = "${appKey}";
const CLIENT_RSA_PRIVATE_KEY = \`...\`;  // 从安全存储读取

// 完整流程参考 examples/autojs/example.js
const machineCode = device.getAndroidId();
await verifyRsa();
const result = await auth("XXXX-XXXX-XXXX-XXXX", machineCode, "Auto.js Device");
toastLog("Auth result: " + JSON.stringify(result));
`,
  shell: (baseUrl, appKey) => `#!/bin/bash
# Shell 接入示例
BASE_URL="${baseUrl}"
APP_KEY="${appKey}"
CLIENT_RSA_PRIVATE_KEY="/path/to/client_private_key.pem"

# 完整流程参考 examples/shell/example.sh
source ./example.sh  # 加载示例中的函数

verify_rsa || exit 1
auth "XXXX-XXXX-XXXX-XXXX" "$(hostname | sha256sum | awk '{print $1}')" "Shell Host"
`,
  anjian: (baseUrl, appKey) => `' 按键精灵接入示例
BASE_URL = "${baseUrl}"
APP_KEY = "${appKey}"
CLIENT_RSA_PRIVATE_KEY = "C:\\path\\to\\client_private_key.pem"

' 完整流程参考 examples/anjian/example.txt
If Not VerifyRsa() Then
    MsgBox "协商会话失败"
    Exit Function
End If

Dim authResp
authResp = Auth("XXXX-XXXX-XXXX-XXXX", GetMachineCode(), "按键精灵设备")
MsgBox "Auth 结果：" & authResp
`,
  htmljs: (baseUrl, appKey) => `<!-- HTML/JS 接入示例 -->
<!-- 完整流程参考 examples/htmljs/example.html -->
<script>
const BASE_URL = "${baseUrl}";
const APP_KEY = "${appKey}";
const CLIENT_RSA_PRIVATE_KEY = \`...\`;  // 从安全存储读取

async function main() {
    await verifyRsa();
    const result = await auth(
        "XXXX-XXXX-XXXX-XXXX",
        navigator.userAgent,
        "Browser"
    );
    console.log("Auth result:", result);
}
main();
</script>
`,
};

const EXAMPLE_CODE: Record<string, string> = {
  python: `# 完整示例包含：心跳保活 + 检查更新
# 详见 sdks/python/jicek_wlyz.py 文件末尾的 __main__ 块`,
  java: `// 完整示例：心跳保活 + 检查更新
// 详见 sdks/java/src/main/java/com/jicek/wlyz/WlyzClient.java`,
};

// ---------------------------------------------------------------------------
// 3. 测试连接
// ---------------------------------------------------------------------------

/**
 * 测试应用连接是否正常
 *
 * 检查项：
 * 1. AppKey 是否存在
 * 2. 应用状态是否 active
 * 3. RSA 公钥是否可读
 */
export async function testConnection(appKey: string): Promise<TestConnectionResult> {
  if (!appKey) {
    return {
      success: false,
      appKey: '',
      appName: '',
      cryptoMode: '',
      version: '',
      message: 'AppKey 不能为空',
    };
  }

  const app = await getAppByKey(appKey);
  if (!app) {
    return {
      success: false,
      appKey,
      appName: '',
      cryptoMode: '',
      version: '',
      message: '应用不存在，请检查 AppKey 是否正确',
    };
  }

  if (app.status !== 'active') {
    return {
      success: false,
      appKey,
      appName: app.name,
      cryptoMode: app.crypto_mode,
      version: app.version,
      message: `应用状态为 ${app.status}，请先在开发者后台启用应用`,
    };
  }

  if (!app.rsa_public_key) {
    return {
      success: false,
      appKey,
      appName: app.name,
      cryptoMode: app.crypto_mode,
      version: app.version,
      message: '应用 RSA 公钥缺失，请联系管理员重新生成密钥对',
    };
  }

  return {
    success: true,
    appKey,
    appName: app.name,
    cryptoMode: app.crypto_mode,
    version: app.version,
    message: '连接正常，应用可用',
  };
}

// ---------------------------------------------------------------------------
// 4. 接入步骤说明（用于向导展示）
// ---------------------------------------------------------------------------

/** 接入流程步骤 */
export const ACCESS_STEPS = [
  {
    step: 1,
    title: '创建应用',
    description: '在开发者后台创建应用，获取 AppKey + client_secret + RSA 密钥对',
  },
  {
    step: 2,
    title: '生成客户端 RSA 密钥对',
    description: '客户端生成 RSA-2048 密钥对，将公钥登记到开发者后台（用于服务端验签）',
  },
  {
    step: 3,
    title: '选择接入语言',
    description: '从 6 种主流 SDK 或 6 种社区示例中选择匹配的接入方式',
  },
  {
    step: 4,
    title: '复制代码片段',
    description: '使用接入中心生成的代码片段，填入 baseUrl + appKey + 客户端私钥',
  },
  {
    step: 5,
    title: '测试连接',
    description: '点击「测试连接」验证 AppKey 是否可用',
  },
  {
    step: 6,
    title: '上线运行',
    description: '在客户端集成 SDK，按 verify_rsa → auth → heartbeat 流程调用',
  },
] as const;
