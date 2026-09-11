# HimaHarness Polishing

## Project context

产品工作前阅读 `docs/product-definition.md`；安排工作切片时阅读
`docs/polishing-backlog.md`；实施验证时阅读 `docs/testing-strategy.md`。
本地准备与运行方式见 `README.md`。

所有修改和运行在 polishing 工作区进行。
`/Users/lluzi/code/hima_harness_reforge_claude` 与
`/Users/lluzi/code/himaharness` 保持只读。

沿用当前 prototype 架构，优先改进现有模块。
架构约束及独立验证责任见 `docs/adr/0001-*`、`docs/adr/0002-*`。
`docs/upstream/` 是版本化参考材料，不是本仓库的现行指令。

## Git synchronization

每次本地 commit 后立即 push 到 GitHub 对应分支，并核对远端 SHA。
独立 worktree 的提交也按工作分支同步，合入后再同步目标分支。
同步失败时处理并明确报告原因；本地提交和远端同步都完成才算交付完成。

## Agent skills

### Issue tracker

任务与任务规格使用 `lluzi/hima_harness_reforge_polishing` 的 GitHub Issues。
见 `docs/agents/issue-tracker.md`。

### Triage labels

使用五个默认 triage 标签，名称与 canonical roles 一致。
见 `docs/agents/triage-labels.md`。

### Domain docs

采用 single-context：根目录 `CONTEXT.md` 和 `docs/adr/`。
见 `docs/agents/domain.md`。
