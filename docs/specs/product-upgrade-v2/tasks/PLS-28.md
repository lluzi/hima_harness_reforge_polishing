# [PLS-28] 加深现有 Pack 格式、安装和兼容信息

状态：ready-for-agent
父规格：[Product Upgrade v2](../spec.md)
模型：`gpt-5.6-terra` / medium；兼容与方法身份由 `gpt-5.6-sol` / high 定点复核
最低测试：L0 + L1/L2 Pack 子集

## 用户场景

用户安装一个透明 HimaPack，先查看业务用途、输入输出、参考图、工具栈、知识、作者状态和最低 Harness 版本；安装哪个固定 Pack 就运行哪个，不出现自动更新或状态专用 Runtime。

## 当前证据

- `packages/harness/src/packs.ts:loadPack/loadPackFrom/checkPack/installedPacks` 已从同一 folder snapshot 读取 contract、graph 和数据身份。
- `packages/harness/src/release.ts:installPackMethod/previewPackTransfer/applyPackTransfer` 已有预览、hash 和安装实现。
- `pack-folder.ts` 与 `VERSION.yml` 已密封 Pack 文件并排除独立 run-assets。
- 当前 `PackContract` 没有作者 status、最低 Harness 版本、工具推荐版本或 ontology aliases；`@hima/harness` 版本为 `0.1.0`。

## 固定代码范围

- `packages/harness/src/packs.ts`：`packContract`、`Pack`、`loadPackFrom`、`checkPack`、新增纯读取的 Pack overview/ontology normalizer。
- `packages/harness/src/release.ts`：现有 install/preview/apply 路径。
- `packages/harness/src/pack-folder.ts`：只在 manifest/index 的文件身份规则需要时修改。
- `packages/harness/package.json`：Harness 版本事实；不新增运行服务。
- `packages/harness/src/card-labels.ts`：作者 status 原文与推荐 ontology label 的显示词。
- `test/contract/pack.test.ts`、`pack-method-assets.test.ts`。

## 精确增量

1. 在现有 contract 中增加向后兼容的可选 metadata：作者原始 `status`、`minimumHarnessVersion`、具体工具名称/推荐版本、领域别名和知识 manifest 引用。
2. 采用简单 `major.minor.patch` 最低版本比较；Pack 不声明时保留旧行为。Harness 对同 major 的旧 Pack 向前兼容；真正破坏兼容的变化必须提升 major。
3. status 接受作者字符串，映射到 development/trial/released/deprecated 等推荐词用于展示，同时保存原值；status 不进入 `fit`、节点、预算或执行分支。
4. 从现有 INTENT/SPEC/PACK、contract、graph、knowledge 声明和 stage 生成 `PackOverview`，不建立第二 manifest 数据库。
5. 加深现有 install preview，使一个来源 Pack 可以被识别、完整检查并安装到 `packsDir/<id>`；继续使用同一 preview/hash/confirm 写入。
6. 新版本是另一次显式安装；不加入更新检查、后台下载或替换活动 Campaign 方法。

## 保持项

- Pack 仍是现有透明目录和 release seal，不新增 `.hima-pack` 强制格式或第二 loader。
- status 只展示；所有状态执行相同检查和 Runtime。
- 已开始 Campaign 的 pack digest、旧版本、run-assets 和归档保持可读。
- 不加入 capability negotiation 矩阵或精确工具版本锁。

## 验收标准

- 旧 Pack 不修改即可 load/check/run。
- 一个新 Pack 的 overview、原始 status、规范映射、工具推荐版本和最低 Harness 版本可读取。
- status 变化不改变 `checkPack.fit` 或同输入 Run 行为。
- 高于当前 Harness 最低版本的 Pack 在 Preparation 前被一个依赖错误拒绝；兼容版本通过。
- 安装预览列出固定文件/hash；确认后 `installedPacks()` 出现；重复安装相同 bytes 为幂等。
- run-assets 不改变方法 digest，新方法 bytes 必须改变 digest。

## 测试

- L0：build/typecheck/boundary。
- L1/L2：`pnpm run test:local --files test/contract/pack.test.ts test/contract/pack-method-assets.test.ts test/contract/historical-words.host.test.ts`。
- 不运行 Desktop、模型或 EDA；UI 安装路径由 PLS-31/33 保留一条 L3。

## 并行与回滚

本任务独占 `packs.ts`、`release.ts` 和 Pack metadata schema。PLS-34 可以并行修改新 Pack 方法文件，但在本任务封板前不修改新 Pack 根 metadata。所有新字段可选，回滚不会使旧 Pack 或 Ledger 不可读。
