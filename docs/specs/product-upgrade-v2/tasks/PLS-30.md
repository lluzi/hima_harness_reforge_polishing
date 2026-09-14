# [PLS-30] 在现有知识记录上提供离线 Pack 与当前知识

状态：ready-for-agent
父规格：[Product Upgrade v2 / #30](https://github.com/lluzi/hima_harness_reforge_polishing/issues/30)
Issue：[PLS-30 / #34](https://github.com/lluzi/hima_harness_reforge_polishing/issues/34)
模型：`gpt-5.6-terra` / medium；知识隔离和证据身份由 `gpt-5.6-sol` / high 复核
最低测试：隔离 POC + L0/L1/L2；接口稳定后一次 L4 模型

## 用户场景

安装 Pack 后，其知识无需外部服务或 key 即可被 HimaGuide/Agent 检索。用户追加 PDF 作为当前知识，跨重启可用、可以清理，但不改变 Pack 方法。普通用户没有 parser、Embedding、数据库或后台进程运维责任。

## 当前证据

- `packages/harness/src/workshop.ts:knowledgeForWorkshop` 只能按文件名返回整份 Pack Markdown。
- `ledger.ts:knowledgeRecord`、`appendKnowledge` 已记录来源、hash、字节、history 条件和保留路径。
- `experience.ts:listRunKnowledge/readRunKnowledge`、Pack `run-assets/` 已提供历史筛选和可验证回读。
- `packages/harness/cordis.patch.yml` 已配置 Pack/Site 目录，没有当前知识根。
- [知识组件调研](../../../research/2026-09-14-knowledge-components-for-himaharness.md)已说明候选，但最新产品约束要求离线、随软件交付、无用户运维；必须以真实 EDA PDF POC 重新选择最小实现。

## 固定代码范围

- `packages/harness/src/workshop.ts`：加深现有 knowledge search/read，不改变 Workshop 写权限。
- `packages/harness/src/ledger.ts`：只扩展 `KnowledgeRecord` 的 current/document 来源和定位字段；保持旧版本读取。
- `packages/harness/src/experience.ts`、`experience-report.ts`：当前知识生命周期、引用、归档/报告投影。
- `packages/harness/src/packs.ts`：仅由 PLS-28 所有者接入 `knowledge/manifest.yml` 声明；本任务不并行编辑。
- `packages/harness/cordis.patch.yml`、`packages/harness/src/index.ts`：当前知识根由 PLS-31 共享接线所有者落地。
- `packages/harness/package.json`、`packages/desktop/package.json`、`scripts/package-trial.mjs`：最终选定依赖与打包；本任务拥有知识依赖变更。
- 新增 `test/fixtures/knowledge/`、`test/contract/knowledge-documents.test.ts`；复用 `knowledge-reuse.host.test.ts`、`experience-files.test.ts`。

## 精确增量

1. 先用获准的代表性 EDA PDF 建立 gold questions/页码，比较可离线打包候选的文本、表格、阅读顺序、索引大小、CPU/内存、许可证和引用能力；POC 未通过不得进入产品依赖。
2. Pack 继续在 `knowledge/` 保存透明原文；增加 `knowledge/manifest.yml` 和可选 derived index。索引不兼容或损坏时由 Harness 从原文重建。
3. 提供小接口 `search(query, scope)` 返回少量候选身份，再由 `read(identity)` 返回有界原文；不得把整库或所有工具 schema 注入每轮请求。
4. 当前知识按 workspace/proposal/Campaign 关联保存在 Hima 自有本地根，跨重启可用、可列出和清理，不写入 Pack method folder/digest。
5. Campaign 实际读取知识时追加现有 `KnowledgeRecord`，记录来源、文档 hash、页/段定位、实际暴露字节和适用条件；索引命中本身不是证据。
6. Site-private knowledge 只保留 adapter interface 和来源表达，本任务不部署客户知识服务。
7. 产品默认零上传；support bundle 必须由用户审阅后显式导出。

## 保持项

- 原文、Pack folder、Site 文件和 Ledger 是权威；index/embedding 是可重建缓存。
- 用户追加文档不升级 Pack，不新增知识项目管理系统。
- 历史知识只帮助形成假设；当前 Fmax 仍由本次 Campaign 测量。
- 不采用需要用户运行 Docker、配置端口、数据库、Embedding API 或独立账号的方案。

## 验收标准

- Pack 知识在断网、无额外 key 的干净 macOS 环境可 search/read。
- 代表性 PDF 的 gold answers 能回到正确原文和页/段；解析缺失明确报告。
- 当前知识跨 Host/App 重启保持，清理后不可检索；Pack digest 不变。
- 两个 workspace/Campaign 的 current knowledge 不串线；Site/private source 不被默认复制或上传。
- 关键模型回答实际调用 search/read，引用对应 `KnowledgeRecord`；产品身份问题不启动大检索。
- 打包测试证明所有基础 runtime/model bytes 随软件提供，Pack 不重复携带引擎。

## 测试

- POC：只在隔离临时目录运行，不修改用户 Home，不调用 EDA；保存候选版本、许可证、输入 hash、资源和 gold 结果。
- L0/L1/L2：`pnpm run test:local --files test/contract/knowledge-documents.test.ts test/contract/knowledge-reuse.host.test.ts test/contract/experience-files.test.ts test/contract/pack.test.ts`。
- L4：接口稳定后一次 DeepSeek V4 Flash 文档问答，记录检索调用、实际片段和回答；不跑完整 Campaign。

## 并行与回滚

本任务独占 knowledge/ledger/experience 的知识增量和依赖选择。若 POC 未满足门槛，保留证据并停止集成，不以另一套无验证方案继续。回滚可删除 derived index/runtime，原 Pack知识、当前文档和旧 Ledger 仍可读。
