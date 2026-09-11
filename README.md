# HimaHarness Polishing

HimaHarness 产品打磨工作区。原型位于 `/Users/lluzi/code/hima_harness_reforge_claude`，按用户要求只读；运行和修改在本工作区进行。

用户已于 2026-09-11 确认产品定义。以 prototype 提交 `b4ac9d9360ad6da68b5fd2824621ba6edab7408b` 的固定导入为基线，已完成 PLS-01～07 的实现、分级验证与独立审查，见 [本批交付记录](docs/assessment/2026-09-11/pls02-07/README.md)。Polishing 以当前 prototype 架构为基础，非万不得已不新增组件；旧版架构仅供参考。

- [Polishing v1 规格与 18 个实施任务](docs/specs/polishing-v1/README.md)
- [具体工作顺序与验收要求](docs/polishing-backlog.md)
- [本地基线结果及未验证范围](docs/assessment/2026-09-11/local-baseline/README.md)
- [代码导入清单](docs/assessment/2026-09-11/source-import.json)
- [Prototype 的版本化参考材料](docs/upstream/README.md)

## 本地准备

要求 Node 24 及锁定的 pnpm 版本，见 `.node-version` 和 `package.json`。本机默认 Node 是 22；本轮使用已有的 Node 24 路径，未修改系统默认配置：

```sh
export PATH="/Users/lluzi/.local/node24/bin:$PATH"
pnpm install --frozen-lockfile --store-dir "$PWD/.hima-tmp/pnpm-store"
pnpm run check:local
```

`check:local` 依次检查 Node/seams、构建一次、检查类型、执行完整本地组；全新副本没有 `lib/` 也适用。测试的类型声明来自 Harness 的构建输出，因此源码变化后，执行叶测试命令前必须先 `pnpm run build`。依赖和构建产物仅用于本工作区，不与 prototype 共享可写目录。

日常修改先构建一次，再选择相关文件获得短反馈；提交前按影响补足对应验证。以下两组共用同一份新构建：

```sh
pnpm run build
pnpm run test:local --files test/contract/test-entry.test.ts test/contract/boot.test.ts
pnpm run test:desktop --files test/contract/honest-standin-window.test.ts
```

`test:local`、`test:desktop` 和 `test:live:site` 只运行选定组，不隐式构建。`test:contract` 是 `test:local` 的兼容入口。`--files` 必须明确列出属于该组的现有文件；不传时执行整组，空选择或跨组选取会失败。完整 local 与相关短子集分别计时，不能把子集通过当成全组通过。

隔离的本地桌面入口如下；`local` 使用受控 stand-in，不是真实 EDA：

```sh
DSH_HOME="$PWD/.hima-tmp/dev/dsh" \
DSH_AGENTS_HOME="$PWD/.hima-tmp/dev/agents" \
HIMA_USER_DATA="$PWD/.hima-tmp/dev/electron" \
DSH_TELEMETRY_DISABLED=1 \
pnpm run desktop --site local
```

当前 `--site local` 每次启动会刷新样例 Pack 和生成的 flow；Campaign workspace 保留。Pack 内资产保留尚未实现，见 POL-07。文件归属、显式入口、资源隔离及未跑/跳过含义见 [测试入口](test/README.md)，入口验证见 [PLS-02 记录](docs/assessment/2026-09-11/pls-02/README.md)。Git hooks 仍须显式 `pnpm run hooks:install` 安装；pre-commit 构建并检查静态类型，pre-push 执行一次 `check:local`。Hook 通过只认证所跑的本地范围，窗口、模型或 Site 检查由实际改动决定。

## 产品依据

- [产品访谈与决定记录](/Users/lluzi/code/hima_harness_reforge_polishing/docs/product-interview.md)
- [产品定义与验收目标](/Users/lluzi/code/hima_harness_reforge_polishing/docs/product-definition.md)
- [Pilot 进度方案](/Users/lluzi/code/hima_harness_reforge_polishing/docs/pilot-plan.md)
- [分级测试方案](/Users/lluzi/code/hima_harness_reforge_polishing/docs/testing-strategy.md)
- [领域术语](/Users/lluzi/code/hima_harness_reforge_polishing/CONTEXT.md)
- [沿用 prototype 架构的决定](/Users/lluzi/code/hima_harness_reforge_polishing/docs/adr/0001-polish-within-prototype-architecture.md)

- [产品与代码架构初步理解](/Users/lluzi/code/hima_harness_reforge_polishing/docs/assessment/2026-09-10/project-understanding.md)
- [旧版 himaharness 对标简报](/Users/lluzi/code/hima_harness_reforge_polishing/docs/assessment/2026-09-10/legacy-benchmark.md)
- [源代码清单与 SHA-256 基线](/Users/lluzi/code/hima_harness_reforge_polishing/docs/assessment/2026-09-10/source-inventory.json)
- [开发事项快照](/Users/lluzi/code/hima_harness_reforge_polishing/docs/assessment/2026-09-10/open-issues.json)

首次调研基线为原型本地 `main` 的 `55e6ba18f5d8fa67c02fe0ac8651a28d7b5ff573`；访谈中的后续只读核查已记录源项目推进到 `2a82cd342711bd65fb445ad2d22b4966cde0b7dd`。这些是各次阅读的快照，开始实施前须重新核对源项目。历史验收结果与 polishing 自身验证严格区分。
