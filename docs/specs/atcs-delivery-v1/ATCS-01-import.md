# ATCS-01 — 将来源 Pack 接入当前 main

状态：ready-for-agent  
依赖：无  
产出：可审查的 ATCS development Pack，不改变 Runtime 行为

## 范围

从 `claude/himapack-development-c56369@a9b2e881` 将下列资产迁入当前 `main`：

- `packs/agentic-timing-closure-system/**`；
- `sites/linglong-atcs28/**`；
- `scripts/atcs-corpus-preflight.py`；
- `test/contract/agentic-timing-closure-system.test.ts`；
- ATCS package-development、qualification 和来源计划文档。

对 `docs/package-development/THE_DEVELOPMENT_OF_HIMA_PACK.md` 和
`test/contract-groups.json` 做语义合并，不用来源分支覆盖当前文件。来源分支的 79 个开发提交保留为
历史引用；集成分支从当前 main 创建。

## 实施

1. 记录 merge-base、来源 SHA、main SHA 和文件清单。
2. 只导入 ATCS 新资产及必要索引增量。
3. 修正当前 Pack schema、workshop argv、test inventory 引入的兼容问题；不借此改方法学。
4. 在 ATCS handoff 顶部记录新的 integration baseline 和原来源 SHA。
5. Pack 版本保持 development；没有真实测试前不生成 TEST/VERSION。

## 验收

- 810 个 Python tests 保持通过，skip 原因不扩大。
- `loadPack`、local/linglong Site `checkPack` 通过。
- `agentic-timing-closure-system.test.ts` 登记在 local group，inventory 无 missing/duplicate/unclassified。
- 当前 `xtop-timing-closure`、历史证据和 Runtime diff 为零。
- `rg` 不发现客户报告、PDK内容、绝对 Campaign workspace 或来源 worktree 路径进入 Pack。

## 测试

```bash
python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests
PATH="$HOME/.local/node24/bin:$PATH" pnpm run build
PATH="$HOME/.local/node24/bin:$PATH" node scripts/run-contract-tests.mjs local --files test/contract/agentic-timing-closure-system.test.ts
PATH="$HOME/.local/node24/bin:$PATH" node scripts/run-contract-tests.mjs --check
```

完成记录包含 commit、remote SHA、导入文件清单和未运行范围。

