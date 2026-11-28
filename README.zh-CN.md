<div align="center">

<img src="assets/brand/zelyq-banner.png" alt="Zelyq: build, automate and ship software with AI" width="100%" />

[English](./README.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md) · [Español](./README.es.md) · [Português](./README.pt-BR.md) · **简体中文** · [हिन्दी](./README.hi.md) · [Italiano](./README.it.md) · [日本語](./README.ja.md)

### 开源开发者平台：在一个地方构建、保护、交付并运行软件。

用像工程师一样工作的 AI 代理构建应用。把每一项凭据放进一个加密的 Vault。
在你自己的机器上测试和部署，并让一位 AI DevOps 工程师照看正在运行的一切。
**可自托管，也可直接在线使用。自带模型。没有遥测。**

[![CI](https://github.com/CrowPus/Zelyq/actions/workflows/ci.yml/badge.svg)](https://github.com/CrowPus/Zelyq/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.12-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](./tsconfig.base.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-black.svg)](./CONTRIBUTING.md)

**[官网](https://zelyq.dev)** · **[在线试用](https://app.zelyq.dev)** · [快速开始](#快速开始) ·
[教程](./docs/tutorial.md) · [文档](./docs/README.md) · [自托管](./docs/self-hosting.md) ·
[架构](./docs/architecture.md) · [路线图](./docs/roadmap.md) · [参与贡献](./CONTRIBUTING.md)

</div>

---

## 目录

- [为什么选择 Zelyq](#为什么选择-zelyq)
- [平台](#平台)：[应用](#应用)、[Studio](#studio)、[代理](#代理)、[Vault](#vault)、
  [流水线](#流水线)、[部署](#部署)、[Ops](#ops)
- [团队、套餐与语言](#团队套餐与语言)
- [快速开始](#快速开始)与[更新](#更新)
- [自带模型](#自带模型)
- [工作原理](#工作原理)
- [安全](#安全) · [项目状态](#项目状态) · [参与贡献](#参与贡献) · [许可证](#许可证)

---

## 为什么选择 Zelyq

交付软件通常需要好几个产品：一个 AI 应用生成器、一个密钥管理器、一个 CI 服务、一个部署工具，
再加上一个值班的人。这意味着好几个登录、好几张账单，以及好几个可能泄露密钥的地方。Zelyq
把整条路径放进一个平台，并按照工作的实际流程来组织：

| | 模块 | 作用 |
| --- | --- | --- |
| **构建** | **[应用](#应用)** | 描述一个应用。代理会规划它，在属于你的真实文件中构建它，并在宣布完成前检查它 |
| | **[Studio](#studio)** | 生成图片和视频，可用于你的应用，也可单独使用 |
| | **[代理](#代理)** | 让 Claude Code、Cursor、VS Code、Gemini CLI 或任何 MCP 客户端使用自己的模型在 Zelyq 中工作 |
| **保护** | **[Vault](#vault)** | 每项凭据只存一次，加密、带版本并留有审计记录，供应用、流水线和你自己的服务器使用 |
| **交付** | **[流水线](#流水线)** | 每次都以相同方式测试和构建，可在 Zelyq 服务器上，也可在你自己的 Linux、macOS 和 Windows 机器上 |
| | **[部署](#部署)** | 按环境把应用部署到你的机器上，支持审批、冻结和自动回滚 |
| | **[Ops](#ops)** | 一位可以对话的 AI DevOps 工程师：它会制定计划、等你批准、证明每一次更改，并持续监控正在运行的一切 |

一切都属于一个**团队**。邀请成员，给每个人分配角色，每个模块都会遵循它。

---

## 平台

### 应用

描述你想要的东西。代理会阅读、规划、编写文件、运行命令并启动实时预览。它工作时，你能看到每一次
工具调用和它改动的每一个文件。

- **经过检查，而不只是生成。** 代理完成后，Zelyq 会运行项目自己的类型检查或构建，并检查预览是否
  崩溃。弄坏了东西的一轮会退回给代理修复，而不会被报告为完成。
- **清楚自己知道什么。** *工程师模式* 区分已验证的和推测的内容，说明它没有选择的方案，并在任何
  不可撤销的操作之前先询问。
- **先规划，再构建。** *架构师模式* 把需求变成一份可供审阅的设计（需求、决策、数据模型、API、构建
  计划），并等待你的同意。随后 *自动模式* 会自行执行该计划，直到设定的上限。
- **专家随时待命。** 设计师（`DESIGN.md`）、DevOps 工程师（CI、Dockerfile、部署配置）、安全/QA
  工程师（测试和安全扫描）以及动效工程师（随滚动变化的页面）。
- **全栈。** React + Vite、带 Python（FastAPI）后端的 React，或 Expo React Native，每种都从一套
  设计系统起步。Supabase Postgres，并为每种操作设置行级安全。
- **从已有内容开始。** 导入 GitHub 仓库，用 `/clone <url>` 重建一个线上网站，或用
  `/figma <链接>` 依据 Figma 画框及其设计令牌来构建。
- **每一轮都能撤销。** 每轮之前都有快照，精确显示改动的 diff，并可一键还原。项目就是磁盘上的普通
  文件，你可以随时带走。

参见[模式](./docs/modes.md)和[代理如何工作](./docs/agent-behaviour.md)。

### Studio

- **图片**：OpenAI、Google 或 xAI，支持参考图和私有图库。
- **视频**：Google Veo 或 xAI，可从文字或一张静态图片生成。

Studio 使用你自己的提供商密钥，费用记在你自己的账户上。为某个项目开启后，代理可以在你设定的限制内，
为它正在构建的应用制作图片和视频。视频片段可以拆分成图片序列，用于随滚动变化的页面。参见
[Studio：图片](./docs/Image-gen/implementation.md)和[Studio：视频](./docs/Video-gen/README.md)。

### 代理

带上你已经在用的 AI 工具。**代理**让 Claude Code、Cursor、VS Code、Gemini CLI、ChatGPT 或任何
MCP 客户端用它自己的模型和订阅在 Zelyq 中工作。Zelyq 只开放你选择的应用、流水线和环境。

- **逐项设置权限**：关闭、允许或需要审批，涵盖读写代码、运行命令、推送、流水线、部署、Studio 等。
- **重要的事由人来批准。** 推送、流水线运行和部署变更都是在收件箱中等待处理的请求。
- **可以放心撤销。** 代理修改应用之前会先创建撤销点。
- **绝不显示机密值。** 代理只能看到应用会收到哪些机密的名称。

参见[代理](./docs/agents.md)。

### Vault

每项凭据**只存一次**，到处都能用，无需把它粘贴进任何文件。

- **静态加密**（AES-256-GCM），带有**版本历史**、用于生产密钥的**受保护**标记，以及每次查看和
  修改的记录。
- **通过引用使用。** 应用变量、模型密钥、流水线和环境都指向 `vault://名称`。只有在需要的地方、
  需要的时候才会填入值。
- **日志中自动遮盖。** 出现在流水线日志里的机密会显示为 `***`。
- **你自己的服务器也能用。** 用受限的服务密钥获取机密，或运行 `zelyq vault run -- <命令>`
  带着机密启动进程，而不在磁盘上写任何东西。
- **导入 `.env` 即可迁入。**

参见 [Vault](./docs/vault.md)。

### 流水线

流水线是一个简短的 YAML 文件，也可以是一张点击即可编辑的图。阶段按顺序运行，步骤也按顺序运行，
每个步骤都是一条命令或一个现成的模块。

```yaml
name: Shop
runs-on: local                      # the Zelyq server, or one of your machines
source: { app: Shop }
stages:
  - name: Test
    matrix: { node: [20, 22] }      # one copy per version, at the same time
    steps:
      - checkout: true
      - setup: node@${{ matrix.node }}
      - run: npm ci && npm test
        tests: reports/*.xml        # JUnit: passed / failed on the step
  - name: Deploy
    steps:
      - deploy: { to: production, port: 3000 }
```

- **在你选择的地方运行。** 在 Zelyq 服务器上的一次性容器中，或在你自己的 **Linux、macOS 和
  Windows** 机器上。一台机器只需一条安装命令即可加入，并通过 HTTPS 主动连接 Zelyq，无需开放任何
  端口。也支持通过 SSH 连接的机器。
- **快速而灵活。** 同时运行的阶段、每个阶段使用不同的机器、矩阵构建，以及在流水线之间共享的模板。
- **插件。** 把一个步骤连同输入、来自 Vault 的机密和输出打包一次，然后在任何流水线中使用。参见
  [流水线插件](./docs/pipeline-plugins.md)。
- **任何事件都能触发。** 手动、git push（支持路径过滤）、拉取请求、定时、另一条流水线结束、代理对
  应用的改动，或任何持有服务密钥的 CI。
- **真正的流水线所需的一切。** 工具安装与缓存、服务容器（Postgres、Redis）、步骤输出、JUnit
  报告、制品、审批、重试、超时和并发控制。
- **结果回报。** 在 GitHub 或 GitLab 的提交和拉取请求上显示 ✓ / ✗。

参见[流水线](./docs/pipelines.md)。

### 部署

- **环境**，例如 `staging` 和 `production`，各自在你的一台机器上，各自拥有自己的变量。staging
  用测试密钥，production 用正式密钥，都来自 Vault。
- **从流水线部署**，让应用在上线前先经过测试。Zelyq 在你的机器上构建镜像，使用应用的
  `Dockerfile`，或由它为 Node、Python、Go 和静态网站编写一个。无需镜像仓库。
- **自动回滚。** 如果新版本没有通过健康检查，上一个版本会自动恢复。
- **使用你自己的域名和 HTTPS**，版本切换期间不停机。
- **实时日志、CPU 和内存**，重启和停止，以及一键回滚到更早的版本。
- **晋升**：把在 staging 测试过的同一个镜像直接推到 production，无需重新构建。
- **受保护的环境**需要管理员批准。**冻结**会在发布期间停止所有部署。

参见[部署](./docs/deploy.md)。

### Ops

**Ops** 是团队的 DevOps 工程师。你可以用文字或语音让它上线一个应用、发布新版本、配置域名，或解释
为什么某个东西变慢了。

- **先查看，再给出计划。** Ops 可以自由查看，但每一项更改都是一份等待你批准的精确步骤清单。
  不可撤销的步骤会单独确认。
- **证明每一次更改。** Zelyq 会亲自检查结果。只有检查通过，一个步骤才算完成。
- **从不停止监控。** 网站和应用每分钟检查一次，机器每五分钟一次，证书和域名每天一次，全程不使用
  模型。告警会通过邮件、Telegram、Slack 或 Discord 发给你。
- **只接触你分配的内容。** 管理员逐一为它分配环境、机器、流水线和代码，并为每一项设定信任级别。
  它只能看到机密的名称，永远看不到值。
- **它会记住。** 你给它的规则和从故障中得到的教训都会保存下来，并在每项工作之前读取。
- **控制权始终在你手里。** 可设置每月支出上限，**暂停 Ops** 会立即停止一切。

---

## 团队、套餐与语言

| 角色 | 可以 |
| --- | --- |
| `viewer` | 查看应用、文件、运行记录、环境和部署历史 |
| `editor` | 以上全部，另外可以向代理下达任务、运行流水线和部署 |
| `admin` | 以上全部，另外可以管理成员、代理、环境、审批和受保护的机密 |
| `owner` | 完全控制，包括团队本身 |

- **活动记录。** 每一项更改都会记录在团队的活动中：一次机密查看、一次流水线编辑、一次部署回滚。
- **套餐与用量。** 每个团队在应用、存储、流水线运行、成员和预览方面都有上限，由服务器管理员设定。
- **为他人运行 Zelyq。** [托管模式](./docs/managed-mode.md)让登录经过你自己的账户服务，
  [管理 API](./docs/admin-api.md) 让你的系统管理人员、团队、套餐和健康状态。
- **九种语言。** 界面和内置帮助支持英语、法语、德语、西班牙语、葡萄牙语、中文、印地语、意大利语
  和日语，每个人可以自行选择。
- **闲置应用会休眠。** 一段时间无人打开的应用可以移到兼容 S3 的存储桶或文件夹中，打开时会自动
  唤醒。参见[存储](./docs/storage.md)。

---

## 快速开始

**最快的方式：** 在 **[app.zelyq.dev](https://app.zelyq.dev)** 创建账户。有免费套餐，无需安装任何
东西。

**自己运行：**

```bash
# Requires Node >= 20.12 and pnpm >= 9
git clone https://github.com/CrowPus/Zelyq.git
cd Zelyq
cp .env.example .env    # your configuration: check it before the first start (below)
pnpm install
pnpm dev                # web :5173 · server :8787 · agent :8788
```

打开 <http://localhost:5173> 并创建第一个账户，该账户负责管理整个实例。在 **设置 → 模型** 中添加
你的模型密钥（直接输入或从 Vault 选择），打开 **应用**，创建一个应用并描述你想要的东西。

**在虚拟机或远程服务器上**，请在首次启动前修改 `.env` 中的以下设置。把 `203.0.113.10` 换成你机器的
地址或域名：

| 设置 | 改为 | 原因 |
| --- | --- | --- |
| `ZELYQ_WEB_HOST` | `0.0.0.0` | 否则界面只在本机响应 |
| `ZELYQ_PREVIEW_HOST` | `203.0.113.10` | 否则应用预览会拒绝你的浏览器 |
| `ZELYQ_CORS_ORIGIN` | `http://203.0.113.10:5173` | 你打开 Zelyq 时使用的地址 |
| `ZELYQ_PUBLIC_URL` | `http://203.0.113.10:5173` | 用于 webhook 和登录链接 |
| `ZELYQ_ALLOW_REGISTRATION` | 你的账户创建后设为 `false` | 否则任何找到该地址的人都能注册 |

在防火墙中开放 5173 端口和预览端口（`ZELYQ_PREVIEW_PORT_MIN`–`MAX`，默认 4300–4399）。如果机器可以
从互联网访问，请把 Zelyq 放在 HTTPS 之后：参见[自托管](./docs/self-hosting.md)。其他所有设置都在
`.env.example` 和[配置](./docs/configuration.md)中有说明。

**使用 Docker：** `docker compose -f docker/docker-compose.yml up`。参见[自托管](./docs/self-hosting.md)。

**下一步：** [教程](./docs/tutorial.md)会一步步带一个应用从 Zelyq 走到生产环境：Vault、一条流水线、
你自己的机器、一次带回滚的部署，以及 GitHub 推送和拉取请求。

### 更新

你的数据会留在原处。数据库、生成的媒体和加密密钥在 `data/` 中，你的应用在 `workspace/` 中，你的设置
在 `.env` 中。Git 会忽略这三者，服务器启动时会自行应用数据库变更。

```bash
cd ~/Zelyq                                    # wherever you cloned it
# 1. Stop Zelyq (Ctrl+C if it runs as `pnpm dev`)

# 2. Back up first
cp -a data ~/zelyq-data-backup-$(date +%F)
cp -a workspace ~/zelyq-workspace-backup-$(date +%F) 2>/dev/null
cp .env ~/zelyq-env-backup-$(date +%F) 2>/dev/null

# 3. Get the new version and rebuild
git pull
pnpm install
pnpm build

# 4. Start Zelyq again the same way as before
```

请用克隆 Zelyq 的那个用户运行这些命令。如果 Git 因 `detected dubious ownership` 停止，请用
`su - <用户>` 切换到该用户，而不要添加 `safe.directory` 例外。

使用 Docker 时：先 `git pull`，再 `docker compose -f docker/docker-compose.yml up -d --build`。你的
数据在 `zelyq-data` 卷中，所以**永远不要**运行 `docker compose down -v`，它会删除这个卷。

更多细节（包括 PostgreSQL）：[自托管 → 升级](./docs/self-hosting.md#upgrading)。

---

## 自带模型

| 提供商 | `ZELYQ_PROVIDER` | 默认模型 |
| --- | --- | --- |
| Claude | `anthropic` | `claude-opus-5-5` |
| Gemini | `google` | `gemini-pro-latest` |
| OpenAI | `openai` | `gpt-6.1-terra` |
| Grok (xAI) | `xai` | `grok-4.6` |
| DeepSeek | `deepseek` | `deepseek-v4-flash` |
| Mistral | `mistral` | `mistral-large-latest` |
| Groq | `groq` | `llama-3.3-70b-versatile` |
| OpenRouter | `openrouter` | `anthropic/claude-sonnet-4.6` |
| **你自己的**：Ollama、vLLM、LM Studio，任何兼容 OpenAI 的服务 | `custom` | 设置 `ZELYQ_MODEL` |

在 **设置 → 模型** 中配置密钥（直接输入或从 Vault 选择），也可以让每个团队在 **团队设置 → AI 密钥**
中自带密钥。Claude Code 或 Codex 的登录可以代替 API 密钥。使用 `custom` 时，你项目的任何内容都不会
离开你的网络。参见[配置](./docs/configuration.md)。

---

## 工作原理

三个进程加一个命令行工具，建立在四个共享库之上。应用的文件和命令只能通过一条路径访问，即
`RuntimeDriver`，这让本地、容器和远程主机以相同的方式工作。

```
   Browser                                 zelyq CLI  (zelyq vault run …)
      │                                        │
      │  REST + WebSocket                      │  HTTPS, service key
      ▼                                        ▼
 ┌──────────────────────────────────────────────────────────┐
 │ apps/server   Fastify · owns the database                │
 │ teams · apps · Vault · pipelines · deploys · Ops         │
 └────┬───────────────────────┬─────────────────────┬───────┘
      │ HTTP + SSE            │                     │ outgoing HTTPS or SSH
      ▼                       │                     ▼
 ┌──────────────┐             │             ┌────────────────────────────┐
 │ apps/agent   │             │             │ Runners and environments   │
 │ model loop,  │             │             │ your Linux, macOS, Windows │
 │ tools        │             │             │ machines: pipelines,deploys│
 └──────┬───────┘             │             └────────────────────────────┘
        │                     │  files, previews, snapshots
        ▼                     ▼
 ┌──────────────────────────────────────────────────────────┐
 │ RuntimeDriver   the only path to disk and shell          │
 │ local · container (one per project) · remote host        │
 └──────────────────────────────────────────────────────────┘
```

| 部分 | 职责 |
| --- | --- |
| [`apps/web`](./apps/web) | 界面：聊天、编辑器和预览、Studio、Vault、流水线、部署、Ops |
| [`apps/server`](./apps/server) | 团队、应用、Vault、流水线引擎、部署和 Ops；唯一与数据库通信的进程 |
| [`apps/agent`](./apps/agent) | 模型循环。它从不直接操作文件：每个工具都经过 `RuntimeDriver` |
| [`apps/runner`](./apps/runner) | 安装在你机器上的 runner；它连接到 Zelyq 并执行流水线和部署 |
| [`apps/cli`](./apps/cli) | `zelyq` 命令行，例如 `zelyq vault run` |
| [`apps/registry`](./apps/registry) | 已签名插件的仓库 |
| [`@zelyq/core`](./packages/core) | 领域类型、流水线文件格式和通信协议 |
| [`@zelyq/runtime`](./packages/runtime) | `RuntimeDriver` 及其实现；唯一会启动进程的代码 |
| [`@zelyq/db`](./packages/db) | Drizzle 模式和迁移：默认 SQLite，扩展时用 PostgreSQL |
| [`@zelyq/tools`](./packages/tools) | 代理的工具，针对 `RuntimeDriver` 只写一次 |

完整说明：[架构](./docs/architecture.md)。

---

## 安全

Zelyq 的设计便于审查：简单的存储、普通的文件、没有遥测，机密在静态时加密，绝不会出现在命令行或
日志中。部署前请了解以下限制：

- **`local` 运行模式不是沙箱。** 代理的命令以服务器用户的身份运行。只适合一台机器上的一位可信
  开发者。任何共享或面向互联网的使用，请设置 `ZELYQ_RUNTIME=container`。
- **容器模式的出站网络默认开放。** 它始终会阻止云元数据端点和项目之间的流量。设置
  `ZELYQ_CONTAINER_EGRESS_ALLOWLIST` 可限制其余部分，或对不受信任的代码使用
  [严格沙箱](./docs/strict-sandbox.md)。

部署前请阅读[威胁模型](./SECURITY.md#threat-model--read-this-before-deploying)，并按照
[SECURITY.md](./SECURITY.md) 中的说明私下报告漏洞。

## 项目状态

Zelyq **处于早期，发展迅速**。应用、Studio、代理、Vault、流水线、部署和 Ops 都已端到端可用，并且
每天都在使用。`1.0` 之前可能会有不兼容的变更。参见[路线图](./docs/roadmap.md)。

## 参与贡献

欢迎提交 issue、参与讨论和发起拉取请求。[CONTRIBUTING.md](./CONTRIBUTING.md) 介绍了开发流程、仓库
结构以及改动通常应放在哪里。发起拉取请求前，请运行 `pnpm lint`、`pnpm typecheck` 和 `pnpm test`。
所有参与者都遵守[行为准则](./CODE_OF_CONDUCT.md)。

## 许可证

Zelyq 以 [GNU AGPL-3.0](./LICENSE) **开源**：你可以运行、修改、自托管和 fork 它。如果你通过网络把
*修改过的* Zelyq 作为服务提供给他人，AGPL 要求你向这些用户提供你的源代码。

对于闭源产品以及政策不允许使用 AGPL 软件的组织，我们提供**商业许可证**（同样的代码，但没有 AGPL
的网络源代码要求）：**support@dee-empire.com**。标记为“Zelyq Enterprise”的功能（`ee/` 路径）是
单独的订阅，适用 [Zelyq Enterprise License](./LICENSE_EE.md)。[LICENSING.md](./LICENSING.md) 用通俗的
语言做了说明。`v0.1.0` 及之前的版本仍可在 Apache-2.0 下使用。

<div align="center">
<br />

© 2026 [Dee Empire](https://dee-empire.com) · “Zelyq”及 Zelyq 标志是 Dee Empire 的商标。

</div>
