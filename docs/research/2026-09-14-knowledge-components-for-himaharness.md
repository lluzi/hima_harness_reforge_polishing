# HimaHarness 文档知识库组件调研

日期：2026-09-14

范围：DeepSeek Harness 生态、WeKnora、OpenViking、RAGFlow、Docling、PageIndex 与自建 RAG 组件

状态：一手资料调研完成，尚未安装或运行候选组件

## 结论

HimaHarness 确实需要比当前 Pack 内 Markdown 更完整的知识能力。问题不只是文件格式，而是缺少文档导入、结构解析、检索、来源定位、版本隔离、权限范围、按需读取和用户可见的知识管理。

当前最值得进入小规模 POC 的方案是 **WeKnora**：

- 官方提供原生 DeepSeek Harness 插件 `@wxg-prc-cpg/dsh-weknora`；
- 支持 PDF、Word、图片、Excel、PPT 等文档导入；
- 提供混合检索、完整文档读取、引用、文档预览、分块编辑和版本回退；
- DSH 插件只读，可仅启用 `list/search/readDocument` 三个工具，让 Hima 的 DeepSeek Agent 自己完成理解与判断；
- 主项目和 DSH 插件均采用 MIT 许可证；
- 有自托管能力，适合客户不愿将 EDA 手册、内部方法和设计资料上传公共云的场景。

**OpenViking** 是第二候选。它与 DSH 的集成更深，并把资源、记忆和 Skills 统一为 Agent 上下文数据库，L0/L1/L2 分层读取也很适合降低 token。但它的服务器主体是 AGPL-3.0，默认 DSH bundle 会自动 recall、capture 和 commit，会触及客户数据、Campaign 预算和 Hima 事实权威边界；现阶段只适合关闭自动写入、通过 MCP 进行显式只读检索的隔离 POC。

**RAGFlow** 的复杂 PDF、OCR、表格和引用能力很强，但部署要求明显更重，官方最低建议为 4 核、16 GB RAM、50 GB 磁盘，依赖 Docker 与多项后端服务。它适合作为解析质量的上限对照，不适合作为第一轮产品接入。

**Docling** 是优秀的离线解析器，不是完整知识库。直接采用 Docling 加 Qdrant/SQLite 再自行构建导入、检索、权限、引用和 UI，会把一个现成产品问题变成我们长期维护的新平台。除非现有知识平台无法满足 EDA 文档质量或部署约束，否则不应首先自建。

建议下一步以真实 EDA 文档做一次有金标准的 POC，首测 WeKnora，OpenViking MCP-only 作为对照；只有两者的解析质量不够时再引入 RAGFlow/Docling/PageIndex 解析对照。尚无真实语料测试，因此本文不宣称任何候选已经适合生产。

## 1. 需求应如何定义

用户给 HimaHarness 的不只是若干 Markdown，而是不同来源、版本和权限的知识材料：

1. HimaHarness 自身的产品说明、能力边界和当前安装内容；
2. Pack 的方法学、适用条件、输入输出和参考运行图；
3. EDA 工具、PDK、IP 和流程的 PDF 手册；
4. Site 探索得到的环境事实和操作方法；
5. Campaign 形成的算法、实验、报告、失败经验和知识资产。

这些材料的权威性不同，不能全部塞进同一种 RAG 语料：

| 知识类别 | 事实来源 | 推荐注入方式 |
| --- | --- | --- |
| 产品身份与当前能力 | 当前发行版和 Runtime inventory | 小而稳定的产品上下文，直接注入；不为回答“你是谁”启动 RAG 或扫描代码 |
| 已安装 Pack/Site/Run | Hima Runtime 当前状态 | 通过现有 Hima 工具实时查询；知识库不得覆盖当前事实 |
| Pack 方法学 | Pack 固定版本与 digest | 保留 Pack 原件，同时建立可检索索引；回答带 Pack 版本和来源 |
| PDF 手册和客户文档 | 原始文件、版本、hash 和授权范围 | 文档知识库检索，先 search 再 read，返回可核验引用 |
| 历史研究资产 | Ledger、Run archive、manifest | 先按 Pack/Site/design/授权筛选，再进入检索；历史只生成假设，不替代当前测量 |

核心原则是：**原始文档和 Hima 记录仍是事实源，知识库索引是可重建的派生物。** 向量分数、自动摘要和模型生成的 Wiki 不能成为结论权威。

## 2. DeepSeek Harness 自身能提供什么

截至本次调查，DeepSeek Harness 官方仓库 `master` 的根版本为 `0.1.5-rc.2`，仍明确标记为 developer preview，并警告会有 breaking changes。本项目当前锁定的是 `0.1.5-alpha.1`，任何插件都必须在隔离 Home 中做精确版本兼容测试。

DSH 本身没有完整的 PDF/RAG 知识库，但已有合适的接入缝：

| DSH 能力 | 可以解决 | 不能解决 |
| --- | --- | --- |
| Skills | 按需加载“怎样使用知识”的指导，避免每轮注入全文 | 不解析或检索大批 PDF |
| Agent instructions/context | 注入稳定的产品身份和必要上下文 | 不应承载不断增长的技术手册 |
| File upload/attachment | 将用户选择的文件送入会话或工具 | 不自动完成持久索引、版本管理和引用 |
| MCP Client | 将外部知识服务器的 Tools 注册为原生 Agent 工具 | 当前只桥接 MCP Tools，不桥接 Resources/Prompts；知识服务仍由上游负责 |
| Cordis plugin | 原生扩展 Host、Agent 工具和 UI | 插件生态仍在快速变化，topic 不是官方质量认证 |

DSH 官方已经提供三种默认关闭的第三方 memory MCP 示例：Memorix、MCP Reference Memory 和 Engram。这些示例证明了 DSH 的 MCP 接入，但它们面向跨会话记忆，不是 PDF 技术知识库。MCP Reference Memory 甚至只是实体/关系/观察上的大小写不敏感子串搜索，没有 Embedding、文档解析或自动摘要。

官方 MCP Client 的重要限制：

- 每个外部工具的描述和 schema 会进入模型请求，工具数量直接增加 token；
- 目前只桥接 Tools；
- DSH 不负责下载、初始化、迁移或运维第三方服务；
- stdio 子进程会清除凭据形态和 `DSH_*` 环境变量，必须显式配置所需凭据；
- 第三方工具结果不会自动成为 Hima 的 Ledger/Archive 证据。

因此，Hima 应当复用 DSH 的插件和工具机制，但必须由产品完成安装、配置、范围绑定和引用落账，不能再次把这些步骤交给用户。

来源：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)、[MCP group](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/README.md)、[MCP Client](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md)、[官方 memory MCP 指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/mcp-memory.md)、[Skills](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/README.md)、[Context](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/README.md)。

## 3. 候选组件比较

| 候选 | DSH 接入 | PDF/文档能力 | 引用与治理 | 部署与许可 | 当前判断 |
| --- | --- | --- | --- | --- | --- |
| **WeKnora 0.8.0** | 官方原生 DSH 插件，4 个工具 | PDF/Office/图片/OCR；多解析器、混合检索、GraphRAG、父子分块 | chunk、文档、引用、预览、版本回退、RBAC/API key | 自托管；MIT；完整服务较重 | **首选 POC** |
| **OpenViking 0.4.20** | 官方 DSH bundle + MCP | PDF 转 Markdown、图片/表格；资源树、L0/L1/L2、层级检索 | URI、ACL、多租户、记忆和 Skills；自动 recall/capture 可配置 | Python/HTTP；server AGPL-3.0，DSH plugin Apache-2.0；需 Embedding/VLM | **第二 POC，MCP-only** |
| **RAGFlow 0.27.2** | 可由 DSH MCP Client 连接其 MCP Server | DeepDoc、OCR、版面、表格、公式、图像；可选 Docling/MinerU | grounded citations、chunk 可视化 | Apache-2.0；4C/16GB/50GB、Docker、多服务 | 解析质量对照，暂不主接入 |
| **Docling 2.127.0** | 可包装成 MCP/API/CLI | 高质量 PDF 版面、阅读顺序、表格、代码、公式、OCR；导出 Markdown/JSON | 不提供完整 KB 权限、索引、历史和产品 UI | MIT；可本地/air-gapped | parser 对照或后续替换件 |
| **PageIndex 0.2.17** | SDK/自建工具；本地版无 MCP | 对长篇、文本型 PDF 建树并用模型推理检索 | 本地页级引用；Cloud 行级引用 | MIT；本地无需向量库，但每次检索使用模型；本地图像理解缺失 | 长手册专项实验，不作通用底座 |
| **Qdrant** | 需自建 MCP/工具 | 不解析 PDF，只保存向量和 payload | 支持过滤、混合检索和快照；权限模型由调用者实现 | Apache-2.0；新增 DB 与 Embedding 生命周期 | 只有实测证明需要时采用 |

版本是 2026-09-14 的调查快照。GitHub star、`dsh-plugin` topic 和项目自述只用于发现候选，不等于生产质量证明。

## 4. WeKnora 专项评估

### 4.1 为什么最贴近当前需求

WeKnora 官方 DSH 插件 `@wxg-prc-cpg/dsh-weknora@0.1.0` 注册四个原生工具：

| 工具 | 对 Hima 的价值 |
| --- | --- |
| `weknora_list_knowledge_bases` | Agent 看见当前凭据实际可访问的知识库，不扫描磁盘猜测 |
| `weknora_search` | 返回原始命中段、文档、`knowledge_id`、`chunk_index`、得分和截断状态 |
| `weknora_read_document` | 按顺序读取完整文档，首屏带标题和摘要，长文分页 |
| `weknora_ask` | 由 WeKnora 的另一个模型完成跨文档问答并返回引用和工具过程 |

插件本身只读，不上传、修改或删除知识。它允许关闭任意工具，并设置 `maxResults` 和 `maxChunkChars` 控制模型上下文。官方说明其 `search` 返回证据给 DSH Agent 自己推理，而 `ask` 会再调用服务端模型，速度更慢且结论更间接。

第一轮建议只启用 `list/search/readDocument`，关闭 `ask`：

- 避免同一个问题调用两层模型；
- 让 DeepSeek Harness 中的执行 Agent 保持唯一的解释和决策主体；
- 返回原始段落，便于 Hima 记录引用；
- 减少工具 schema 与运行成本。

WeKnora 对我们的另一个优势是已经有知识管理 UI：用户可以上传 PDF、查看解析状态、预览文档、检查引用、编辑 chunk 并回退版本。产品集成后，这些能力应通过 Hima 的“Knowledge”入口呈现，后台部署与 API key 不应暴露为普通用户任务。

### 4.2 当前阻塞

1. 插件官方验证的是 DSH `0.1.0-rc.8`，本项目锁定 `0.1.5-alpha.1`；插件没有 DSH runtime dependency、直接调用 `ctx.tools.register()`，但这只是降低兼容风险，不是兼容证明。
2. DSH 插件是只读检索面，PDF ingestion 仍走 WeKnora UI/API；Hima 必须补一个简单的“添加资料”产品入口，不能要求用户切换到后台管理系统。
3. 插件返回 `knowledge_id/chunk_index`，尚不足以满足 Hima 的不可变证据要求。Hima 还需记录原文件 SHA-256、版本、页码或版面定位、知识库和授权范围。
4. WeKnora 完整部署比一个桌面内嵌库更重。要评估由我们托管、客户 VPC/服务器自托管和单机试点三种形态，不能把 Docker/数据库配置交给普通工程师。
5. WeKnora 支持多种 parser/vector backend，不代表默认组合适合 EDA 手册；需要真实 PDF 金标准验证。

来源：[WeKnora](https://github.com/Tencent/WeKnora)、[v0.8.0](https://github.com/Tencent/WeKnora/releases/tag/v0.8.0)、[DSH plugin README](https://github.com/Tencent/WeKnora/blob/main/packages/dsh-weknora/README.md)、[插件源码](https://github.com/Tencent/WeKnora/tree/main/packages/dsh-weknora)、[知识搜索 API](https://github.com/Tencent/WeKnora/blob/main/docs/api/knowledge-search.md)、[知识管理 API](https://github.com/Tencent/WeKnora/blob/main/docs/api/knowledge.md)、[MIT LICENSE](https://github.com/Tencent/WeKnora/blob/main/LICENSE)。

## 5. OpenViking 专项评估

OpenViking 将资源、用户记忆和 Skills 组织在 `viking://` 虚拟文件系统中。目录带 L0 摘要、L1 概览和 L2 原文，Agent 可以先判断相关性，再读取细节。其 `find` 做快速语义检索，`search` 会用会话上下文生成 0–5 个 TypedQueries，再做目录层级检索与 rerank。

它提供原生 DSH bundle `@openviking/dsh-memory-plugin@0.3.2`，会：

- 在会话开始注入用户 profile 和记忆索引；
- 每个模型 step 前自动检索并注入相关记忆；
- 捕获用户、助手和可选工具结果；
- 达到 token 阈值或退出时 commit；
- 通过 MCP 暴露 search/read/list/tree/add_resource 等工具。

这套机制对通用个人记忆很强，但 Hima 当前不能直接按默认方式启用：自动捕获可能把客户会话、不同 Pack 或 Site 的内容写到错误范围；自动 recall 可能在没有 Hima Ledger 记录的情况下影响 Campaign；退出 commit 也可能违反预算到期停止分析写入的规则。

第一轮若评估 OpenViking，应只用显式 MCP 工具，或至少设置只读/隔离策略：

- `syncTurns: false`；
- `OPENVIKING_RECALL_PEER_SCOPE=actor`；
- 不自动捕获工具结果；
- 关闭跨客户、跨 Pack 默认 recall；
- 每个命中由 Hima materialize 为带 hash 的 KnowledgeRecord 后才可成为引用。

OpenViking 的 PDF parser 本地模式基于 pdfplumber，将页码标记、文本、表格和图片转为 Markdown；也可连接 MinerU。这个实现是否能正确处理 EDA 手册的波形、复杂表格、公式和多栏版式尚未验证。

许可方面要区分：OpenViking server 主体为 AGPL-3.0，官方 DSH memory plugin 是 Apache-2.0。用于商业闭源产品前必须完成部署和衍生作品边界审查，不能只看插件许可证。

来源：[OpenViking](https://github.com/volcengine/OpenViking)、[v0.4.20](https://github.com/volcengine/OpenViking/releases/tag/v0.4.20)、[DSH integration](https://github.com/volcengine/OpenViking/blob/main/docs/en/agent-integrations/17-dsh.md)、[DSH plugin](https://github.com/volcengine/OpenViking/tree/main/examples/dsh-memory-plugin)、[MCP tools](https://github.com/volcengine/OpenViking/blob/main/docs/en/guides/06-mcp-integration.md)、[retrieval](https://github.com/volcengine/OpenViking/blob/main/docs/en/concepts/07-retrieval.md)、[PDF parser](https://github.com/volcengine/OpenViking/blob/main/openviking/parse/parsers/pdf.py)、[LICENSE](https://github.com/volcengine/OpenViking/blob/main/LICENSE)。

## 6. 为什么暂不自建 RAG

“Docling + Embedding + Qdrant”看起来很轻，实际上我们必须自行负责：

- PDF 转换、OCR、表格与图片质量；
- chunk 策略和版本迁移；
- Embedding 与 rerank 模型；
- metadata、权限过滤和多租户隔离；
- 文档更新、删除、重建和回滚；
- Agent 工具与 token 限制；
- 引用定位、原文预览和用户 UI；
- 离线部署、监控、失败恢复和评测。

这会新增一个真正的产品级组件，并迫使多个 Hima 模块适配。既然 WeKnora/OpenViking 已经覆盖大量能力，快速扭转阶段应先验证可用的现成系统。Docling、PageIndex 和 RAGFlow用于建立解析与检索质量对照；只有外部系统无法满足数据权威、部署或性能要求时，才接受自建成本。

Docling 的价值仍然很高：MIT、可本地或 air-gapped 运行、可解析 PDF 版面/阅读顺序/表格/代码/公式/OCR，并导出 Markdown 和 lossless JSON。若未来需要自有 parser adapter，它是首选候选。

来源：[Docling](https://github.com/docling-project/docling)、[Docling MCP](https://docling-project.github.io/docling/usage/mcp/)、[RAGFlow](https://github.com/infiniflow/ragflow)、[RAGFlow MCP](https://github.com/infiniflow/ragflow/blob/main/docs/develop/mcp/launch_mcp_server.md)、[DeepDoc](https://github.com/infiniflow/ragflow/blob/main/deepdoc/README.md)、[PageIndex](https://github.com/VectifyAI/PageIndex)。

## 7. 建议的 Hima 集成形态

不把 WeKnora 或 OpenViking 的后台界面直接交给普通用户。HimaHarness 应提供一个简单的 Knowledge 入口：

1. 用户选择 PDF、文件夹或已存在的知识库。
2. Hima 显示资料名称、版本、来源、数据范围和预计处理方式。
3. 后台完成上传、解析、索引和状态轮询。
4. HimaGuide 自动知道有哪些知识库，但只在需要时调用 search/read。
5. 回答显示文档、版本、页码/段落和可点击原文。
6. 用户可以看到知识被哪个 Pack、Site 或 Run 使用。
7. 删除、更新和分享都由用户明确操作，不由 Agent 自动决定。

建议把知识范围分成至少四层：

```text
Product knowledge   产品身份、概念、入门与能力边界
Pack knowledge      方法、适用条件、输入输出、图与案例
Site knowledge      工具版本、环境说明、经授权的现场资料
Run knowledge       当前客户的实验、报告、算法和失败经验
```

检索必须先由 Hima 给出 allow-list，再交给知识引擎排序。知识引擎不能通过“相似”扩大可见范围。

对于 `what can you do`、`什么是 Pack` 这类问题，不调用大型知识库。由小型产品上下文加 Runtime inventory 直接回答，目标是零代码扫描、一次模型响应。知识库主要服务 EDA 手册、Pack 方法和历史研究等大规模材料。

## 8. POC 建议

### 8.1 语料

选择 3–5 份获准使用、能代表真实困难的资料：

- 一份 500 页以上的 EDA command/reference manual；
- 一份包含复杂表格和约束说明的用户手册；
- 一份带图、公式或扫描页的技术文档；
- 两个不同版本、内容存在冲突的同类手册；
- 一份 Hima Pack 方法说明和一次历史负结果报告。

人工准备 30–50 个 gold questions，至少覆盖：精确选项、表格单元格、跨页条件、版本差异、组合步骤、资料中不存在的问题和禁止外推的问题。

### 8.2 候选顺序

1. WeKnora：使用官方 DSH 插件，只启用 list/search/readDocument。
2. OpenViking：关闭自动 capture/commit，以 MCP-only 方式测试 find/search/read。
3. Docling/PageIndex 或 RAGFlow：只在前两项解析或检索失败的文档上做质量对照。

### 8.3 指标

| 指标 | 要证明什么 |
| --- | --- |
| parser fidelity | 标题、段落、表格、公式、图片说明和阅读顺序是否正确 |
| recall@k | 正确证据是否进入前 k 个候选 |
| citation resolution | 每条回答能否回到正确版本、页码/段落和固定原文 |
| unsupported-answer rate | 资料没有答案时是否拒绝编造 |
| version isolation | 是否会混用旧版和新版手册 |
| scope rejection | 未授权 Pack/Site/客户资料是否绝不返回 |
| token/latency | 一次常见问答的上下文、模型调用次数和响应时间 |
| operation burden | 从导入 PDF 到 Agent 可用需要多少人工配置与管理员操作 |

POC 的关键门槛不是“能搜到一些相似文字”，而是 Agent 能在不扫描代码库、不读取整本手册的情况下，快速取得正确、可定位、权限正确的证据，并据此完成一项真实任务。

## 9. 需要后续确认的事项

1. 真实 POC PDF 与 gold questions 尚未确定。
2. WeKnora 官方插件与本仓库 DSH `0.1.5-alpha.1` 的兼容性尚未验证。
3. 客户希望采用本机、客户服务器/VPC，还是由我们托管的知识服务，需要产品决定。
4. PDF 原文件、派生 chunk、Embedding 和模型请求分别允许留在哪个数据边界，需要明确。
5. WeKnora 返回的 chunk 身份如何映射为 Hima 的 SHA-256、页码和 Ledger citation，需要小规格。
6. OpenViking AGPL 与商业部署边界需要正式审查。
7. 候选项目的可选模型和 parser 依赖各自有许可证，主项目许可证不能替代依赖盘点。

## 一手来源索引

- [DeepSeek Harness official repository](https://github.com/deepseek-ai/deepseek-harness)
- [DeepSeek Harness MCP Client](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md)
- [DeepSeek Harness memory MCP guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/mcp-memory.md)
- [Tencent WeKnora](https://github.com/Tencent/WeKnora)
- [WeKnora DSH plugin](https://github.com/Tencent/WeKnora/tree/main/packages/dsh-weknora)
- [Volcengine OpenViking](https://github.com/volcengine/OpenViking)
- [OpenViking DSH integration](https://github.com/volcengine/OpenViking/blob/main/docs/en/agent-integrations/17-dsh.md)
- [RAGFlow](https://github.com/infiniflow/ragflow)
- [Docling](https://github.com/docling-project/docling)
- [PageIndex](https://github.com/VectifyAI/PageIndex)
