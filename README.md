# 小酒馆 × mem0 记忆版（带长期记忆系统） / SillyTavern × mem0 (Memory-enabled)

本仓库基于 SillyTavern（小酒馆）与 mem0 组合，提供一个“可检索、可写入、可降级”的长期记忆系统：在生成前检索记忆注入提示词，在聊天保存时将最近对话写入记忆库。  
This repository combines SillyTavern and mem0 to provide a long-term memory system with retrieval + write-back + graceful degradation: retrieve memories before generation and inject them into the prompt, and write recent turns into the memory store when a chat is saved.

## 需求说明 / Requirements

### 背景与目标 / Background & Goals

- 目标：让角色/群聊具备跨天、跨上下文窗口的连续性，并且不影响原有可用性。  
  Goal: Improve continuity across days and context-window boundaries for characters and group chats, without breaking the original experience.
- 原则：记忆服务是“可选依赖”。mem0 不可用时，聊天生成与保存仍然正常。  
  Principle: The memory service is an optional dependency. If mem0 is down, generation and saving still work.

### 功能需求 / Functional Requirements

- 生成前检索注入 / Pre-generation retrieval injection  
  - 在后端生成入口检索 mem0 记忆，并以 system 段形式注入到消息列表。  
    Retrieve mem0 memories at the backend generation entrypoint and inject them as a system message.
  - 支持检索参数：limit、threshold、timeout、max injected chars。  
    Support retrieval params: limit, threshold, timeout, max injected chars.
  - 支持 fallback（在召回为空时，用近期上下文增强 query 再检索一次）。  
    Support fallback (if empty, enhance query with recent context and retry).

- 聊天保存时写入 / Write-on-save  
  - 在聊天保存链路抽取最近若干条非系统消息，写入 mem0。  
    Extract the latest non-system messages during chat save and write them into mem0.
  - 具备去重/幂等：同一段落盘内容不会重复写入。  
    Idempotent behavior: avoid writing the same saved content repeatedly.

- 模型配置（记忆侧） / Memory-side model configuration  
  - 支持通过 mem0 的 REST API 热更新记忆抽取使用的 LLM 配置。  
    Allow hot-updating the LLM config used by mem0 via REST APIs.
  - 前端提供一个配置面板用于切换 Chat Model（SillyTavern）与 Memory Model（mem0）。  
    Provide a UI panel to switch the Chat Model (SillyTavern) and the Memory Model (mem0).

### 非功能需求 / Non-functional Requirements

- 可用性 / Availability：mem0 超时或不可达时静默降级，不阻塞主链路。  
  Silent degradation when mem0 times out or is unreachable; never block the main flow.
- 性能 / Performance：检索有超时上限；注入文本有长度上限。  
  Retrieval has a hard timeout; injected text has a hard length cap.
- 可配置 / Configurable：通过配置项/请求参数开关、可调参数。  
  Feature-flagged and tunable via config and/or request overrides.

## 设计说明 / Design

### 总体架构 / Architecture

- SillyTavern（Node.js）  
  - 聊天 UI、角色/群聊管理、调用模型 provider 的后端代理。  
  - 集成点：生成前检索注入、保存时写入记忆。  
  SillyTavern (Node.js): chat UI + backend proxy; integration points are retrieval injection and write-on-save.

- mem0 REST Server（FastAPI）  
  - 统一对外提供 /search 与 /memories 等接口，内部使用 mem0ai 组件完成抽取、向量化、检索。  
  mem0 REST Server (FastAPI): exposes /search and /memories; uses mem0ai to extract, embed, and retrieve memories.

- 存储 / Storage  
  - Postgres + pgvector：向量存储。  
    Postgres + pgvector: vector store.
  - Neo4j：图存储（关系/结构化记忆）。  
    Neo4j: graph store.
  - mem0 history（本地文件/SQLite）：用于 mem0 配置与历史数据持久化。  
    mem0 history (local files/SQLite): persists config and history.

统一启动推荐使用 [docker-compose.yaml](file:///mnt/role_chat_xiaojiuguan_mem0/docker/docker-compose.yaml)。  
For unified startup, use [docker-compose.yaml](file:///mnt/role_chat_xiaojiuguan_mem0/docker/docker-compose.yaml).

### 关键数据流 / Key Flows

#### 1) 生成前：检索并注入 / Before generation: retrieve & inject

- 入口：SillyTavern 后端 `/generate`。  
  Entry: SillyTavern backend `/generate`.
- Query1：取最后一条 user 消息作为检索 query。  
  Query1: use the last user message as the search query.
- Fallback：当结果为空时，用最近若干轮对话拼接成 “Context + User Question” 再检索一次。  
  Fallback: if empty, build “Context + User Question” from recent turns and retry.
- 注入：将召回的记忆格式化为列表，插入到最前面的 system 消息之后。  
  Injection: format retrieved memories as a bullet list and insert it after leading system messages.

实现位置 / Implementation:
- 生成链路检索注入：[chat-completions.js](file:///mnt/role_chat_xiaojiuguan_mem0/SillyTavern/src/endpoints/backends/chat-completions.js#L1887-L1971)

#### 2) 保存时：写入 mem0 / On save: write to mem0

- 触发：SillyTavern 保存聊天文件时，从 chatData 中提取最近的非系统消息写入 mem0。  
  Trigger: when SillyTavern saves a chat, extract latest non-system messages and write to mem0.
- 幂等：通过 marker 记录 “上次写入的最后消息标识”，避免重复写入。  
  Idempotency: a marker is persisted to avoid repeated writes.

实现位置 / Implementation:
- 保存链路写入：[chats.js](file:///mnt/role_chat_xiaojiuguan_mem0/SillyTavern/src/endpoints/chats.js#L101-L169)

### 身份与隔离 / Identity & Isolation

- 隔离维度 / Isolation keys：`user_id` + `agent_id`。  
  Isolation keys: `user_id` + `agent_id`.
- `user_id`：取 SillyTavern 的用户 handle（启用 accounts 时）。若为空则跳过 mem0 调用。  
  `user_id`: derived from SillyTavern account handle. If missing, mem0 calls are skipped.
- `agent_id`：  
  - 单角色：`char:<character_name>`（或从头像衍生的稳定标识）。  
    Single character: `char:<character_name>` (or a stable avatar-derived id).
  - 群聊：`groupChat:<group_chat_id>`。  
    Group chat: `groupChat:<group_chat_id>`.

### 配置项 / Configuration

SillyTavern 侧 mem0 相关配置键 / mem0-related keys on SillyTavern side:

- `mem0.enabled`：是否启用检索注入与保存写入。 / Enable retrieval injection and write-on-save.
- `mem0.baseUrl`：mem0 服务地址（例如 `http://localhost:58001`）。 / mem0 base URL (e.g. `http://localhost:58001`).
- `mem0.timeoutMs`：mem0 调用超时（毫秒）。 / Timeout for mem0 calls (ms).
- `mem0.limit`：每次注入最多召回条数。 / Max number of memories injected per generation.
- `mem0.maxChars`：注入文本最大字符数。 / Max characters for injected memory text.
- `mem0.threshold`：可选，相似度阈值（留空使用 mem0 默认）。 / Optional similarity threshold (empty = server default).
- `mem0.rewrite.enabled`、`mem0.rewrite.prompt`：预留的“query 重写”配置（当前后端未启用重写调用）。  
  Reserved query rewrite config (rewrite call is not enabled in backend yet).

mem0 侧关键环境变量 / Key env vars on mem0 side:

- `POSTGRES_HOST/PORT/DB/USER/PASSWORD`：向量库连接。 / Vector DB connection.
- `NEO4J_URI/USERNAME/PASSWORD`：图数据库连接。 / Graph DB connection.
- `OPENAI_API_KEY`（可选）：当 mem0 使用 OpenAI 作为 LLM/Embedder 时需要。 / Required when using OpenAI in mem0.

### 接口契约 / API Contract

mem0 REST API（核心） / mem0 REST API (core):

- `POST /search`：按 query 检索记忆（支持 `user_id`、`agent_id`、`limit`、`threshold`）。  
  Search memories by query (supports `user_id`, `agent_id`, `limit`, `threshold`).
- `POST /memories`：写入记忆（messages + identifiers + metadata）。  
  Create memories (messages + identifiers + metadata).
- `GET /config`、`POST /configure`：读取/热更新 mem0 配置（会持久化，且会掩码返回 api_key）。  
  Read/hot-update config (persisted; api_key is masked in responses).
- `GET /models`、`POST /models`：模型列表与自定义模型管理。  
  List and add models.

实现位置 / Implementation: [main.py](file:///mnt/role_chat_xiaojiuguan_mem0/mem0/server/main.py#L289-L391)

### 降级策略 / Degradation Strategy

- 检索失败 / Retrieval failures：返回空并跳过注入，继续正常生成。  
  Return empty and skip injection; generation proceeds.
- 写入失败 / Write failures：吞掉错误，不影响聊天保存。  
  Errors are swallowed; saving proceeds.
- 超时控制 / Timeouts：对 mem0 请求使用 AbortController（Node）与服务端异常捕获（FastAPI）。  
  Requests are time-bounded (Node AbortController) and server errors are handled (FastAPI).

### 安全与隐私 / Security & Privacy

- mem0 `/config` 返回会掩码 api_key（显示为 `****`）。  
  mem0 masks api_key in `/config` responses (`****`).
- 建议仅在内网/本机暴露 mem0 端口；生产环境务必加鉴权/网络隔离并替换默认口令。  
  Expose mem0 only to localhost/internal network; add auth/isolation and replace default passwords for production.
- 本 README 的使用说明不包含任何实际密钥、真实用户标识或本机私有路径。  
  The usage section below does not include real keys, real user identifiers, or private local paths.

## 使用说明（不含隐私信息） / Usage (No private info)

### 方式 A：Docker Compose 一键启动 / Option A: One-command Docker Compose

1) 准备依赖 / Prerequisites  
- 安装 Docker 与 Docker Compose。  
  Install Docker and Docker Compose.

2) 配置环境变量（如使用 OpenAI）/ Configure env vars (if using OpenAI)  
- 在运行 compose 前设置环境变量 `OPENAI_API_KEY`（使用你自己的密钥）。  
  Set `OPENAI_API_KEY` before running compose (use your own key).

3) 启动 / Start  
在仓库根目录执行：  
From the repo root:

```bash
docker compose -f docker/docker-compose.yaml up -d --build
```

4) 访问 / Access  
- SillyTavern：`http://localhost:58000`  
  SillyTavern: `http://localhost:58000`
- mem0 OpenAPI：`http://localhost:58001/docs`  
  mem0 OpenAPI: `http://localhost:58001/docs`

5) 卷路径提醒 / Volume path note  
`docker/docker-compose.yaml` 里包含了示例用的宿主机挂载路径。请将其替换为你自己的目录或改为相对路径挂载。  
The compose file contains example host volume paths. Replace them with your own paths or use relative mounts.

### 方式 B：分别启动（开发/调试） / Option B: Split services (dev/debug)

- 先启动 mem0（含 Postgres + Neo4j），确认 `http://localhost:<mem0_port>/docs` 可访问。  
  Start mem0 (with Postgres + Neo4j) first and verify `http://localhost:<mem0_port>/docs` is reachable.
- 再启动 SillyTavern，并将 mem0 的 Base URL 指向 mem0 服务地址。  
  Then start SillyTavern and point mem0 Base URL to the mem0 server.

### 在 SillyTavern 中启用记忆 / Enable memory in SillyTavern

- 在设置页启用 `Enable mem0 memory`，并填写：  
  Enable `Enable mem0 memory` in Settings and set:
  - mem0 Base URL：`http://localhost:58001`（按你的部署调整）  
    mem0 Base URL: `http://localhost:58001` (adjust to your deployment)
  - Timeout / Limit / Max Chars / Threshold：按需配置  
    Timeout / Limit / Max Chars / Threshold: tune as needed

等价的配置（如你偏好文件配置）/ Equivalent YAML config (if you prefer config files):

```yaml
mem0:
  enabled: true
  baseUrl: "http://localhost:58001"
  timeoutMs: 1200
  limit: 6
  maxChars: 2000
  threshold:
  rewrite:
    enabled: false
    prompt: ""
```

### 配置“记忆模型”（mem0 LLM）/ Configure the “memory model” (mem0 LLM)

- 打开页面右侧的 `LLM Configuration` 面板（芯片图标）。  
  Open the `LLM Configuration` drawer (chip icon).
- 在面板中：  
  In the panel:
  - Chat Model：更新 SillyTavern 当前聊天模型配置。  
    Chat Model: updates the chat model used by SillyTavern.
  - Memory Model / Provider：通过调用 mem0 `/configure` 更新 mem0 侧的 LLM 配置。  
    Memory Model / Provider: updates mem0 LLM config via `/configure`.

实现位置 / Implementation: [llm-config.js](file:///mnt/role_chat_xiaojiuguan_mem0/SillyTavern/public/scripts/llm-config.js)

### 如何确认记忆在工作 / How to verify it works

- 最直观方式：与角色对话、保存聊天，然后在后续提问中观察是否出现“跨轮次/跨天”信息回忆。  
  Easiest: chat, save, and later ask about past facts/preferences and see if they are recalled.
- 技术方式：访问 mem0 的 OpenAPI 文档（`/docs`），用占位符 identifiers 调用 `/search` 或 `/memories`。  
  Technical: use mem0 `/docs` to call `/search` or `/memories` with placeholder identifiers.

## 进一步资料 / Further Reading

本仓库还包含更详细的业务与架构草案（中英混合，以中文为主）：  
More detailed (draft) business and architecture notes (mostly Chinese) are available here:

- [02-业务设计.md](file:///mnt/role_chat_xiaojiuguan_mem0/a-doc/02-业务设计.md)
- [03-架构设计.md](file:///mnt/role_chat_xiaojiuguan_mem0/a-doc/03-架构设计.md)
- [04-待开发事项.md](file:///mnt/role_chat_xiaojiuguan_mem0/a-doc/04-待开发事项.md)
