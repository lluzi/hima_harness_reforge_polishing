# PLS-02：按成本选择且只构建一次的验证入口

基线：`d923fb3`（PLS-01）；产品与外部依赖版本保持不变。生产模块、Pack、lockfile 未修改。源 prototype 与旧 himaharness 保持只读。

## 根因和改动

原 `test:contract` 自己 build，pre-push 又先 build，导致同轮两次构建；pre-commit 直接检查测试类型，在没有 `lib/types` 时顺序错误。原分组入口只支持整组，相关小修改没有受控的文件子集入口。

- `package.json` 提供 `check:local`（Node → seams → 一次 build → typecheck → 完整 local）、三个叶命令和 `test:contract` 兼容入口。
- 现有 `run-contract-tests.mjs` 接受 `--files` 精确子集，并在导入前验证组归属、非空、唯一和文件清单完整性。TAP 保留真实 pass/fail/skip，另输出选中/未跑、耗时及退出码。未新增测试框架或缓存判定层。
- pre-push 仅调一次 `check:local`；pre-commit 用新构建的类型做静态检查。这里只修改 hook 文件，未安装 hooks。
- 空 unit 集合明确写出 0 文件、未运行、无覆盖声明；Node 前置条件同样生效。

## 验证结果

验证在本工作区 `.hima-tmp/pls02-validation/` 内的干净副本执行，未使用 prototype 的构建产物或 node_modules。首个副本从本次当前源码的 286 个跟踪文件复制，初始无 lib/node_modules，身份见 [源码清单](clean-source-manifest.json)。本地 pnpm store 已有包缓存，安装时间不是首次联网下载成本。

- [初始 red](red-subset.tap)：新增的 CLI 子集行为失败（3 pass / 1 fail），原因是旧入口拒绝 `--files`。
- [对应 green](green-subset.tap)：4 pass / 0 fail / 0 skip，包含原三条 CLI 反例，没有删除原断言。
- [初始化与完整 local 结果](clean-results.json)、[原始输出](check-local.log)：首个副本 frozen install 4.629 秒；`check:local` 443.676 秒，155 pass / 0 fail / 0 skip，退出 0；其中 local 437.320 秒，SSH 尝试 0。原始输出确认根 build 只调用一次（分别构建 Harness/Desktop 两个 package）。
- [首个构建计时](build-timing-results.json)：为单独计时，用同一源码清单的第二个干净副本执行 frozen install 4.167 秒、首次 build 2.581 秒；未在第二副本重复完整 suite。
- [静态入口结果](static-results.json)：Node 22 拒绝为预期退出 1；空 unit 明示未运行；清单/desktop/live 预览均不执行用例。

同一副本、同一新构建随后运行以下命令；每行是单独一次执行，重复用例不能累加成唯一覆盖。[完整命令与计时](leaf-results.json)、[汇总核验](validation.json)。

| 执行 | pass / fail / skip | 命令总耗时 | 退出码与意义 |
| --- | --- | --- | --- |
| `test:local --files test/contract/test-entry.test.ts test/contract/boot.test.ts` | 6 / 0 / 0 | 3.298 秒 | 0；相关 CLI 与真实 Host 小集合 |
| `test:desktop --files test/contract/honest-standin.test.ts` | 1 / 0 / 0 | 23.504 秒 | 0；一个真实窗口完成原三 Campaign 对照 |
| 同一个 desktop 命令，副本内暂移 Electron symlink | 0 / 0 / 1 | 0.384 秒 | 0；明确缺 Electron，不能计作通过 |
| `test:local --files test/contract/dc-reader.test.ts`，副本 manifest 指向不存在的 fixture 目录 | 5 / 9 / 0 | 2.042 秒 | 1；预期负例，缺 fixture 让依赖它的九例失败 |
| 同一个缺 fixture 命令，显式 `HIMA_FIXTURES_OPTIONAL=1` | 5 / 0 / 9 | 1.742 秒 | 0；九例明确 skip，只有其余五例通过 |

Desktop 的原始输出见 [窗口验证](desktop-before-migration.log)；只读 subprocess 观察器记录 [一次实际 Electron main 启动](desktop-boots.jsonl)，`driver=true`。这是 PLS-03 迁移前的单次成本样本，不是稳定 p95。缺依赖反例仅在验证副本暂移包 symlink/改 manifest；实际 fixture 目录未改变，副本原件已恢复并对 286 个文件重新核对 hash。

[跨组构建核验](cross-group-build.json) 确认叶命令前后的全部 124 个 lib 文件内容相同；各叶命令没有 build。主验证链合计一次根 build；用于单独计时的第二副本有它自己的一次 build，不能将整轮所有计时投入说成只构建一次。

短 local 3.298 秒、关键 desktop 23.504 秒均在各自 3/5 分钟目标内。完整 local 保留所有原用例，仍约 7 分钟；耗时来自 Fabric/retry/recovery/Job 的真实本地进程及故障等待，不把整组说成短反馈，也未删断言压缩时间。

远程 live-site 仅列举三个文件，没有执行；其可达性未认证。真实模型、远程 EDA 与完整 pilot 未运行，stand-in 的通过不能认证这些能力。默认 local/本次 desktop 均记录 SSH 尝试 0。

## 审查

主 agent 独立安排 Standards / Spec 审查，两项均无代码 blocker。文档审查发现 `docs/testing-strategy.md` 中两处仍将 PLS-02 写成未来工作，主 agent 在集成时同步。脚本 Node 语法检查、两个 shell hook 语法检查及 `git diff --check` 均通过。

## 范围与回滚

PLS-01 的 154 个本地原例保持；本任务新增 1 条 CLI 子集测试。分组成员没有变化，仍为 local 19 文件、desktop 11 文件、live-site 3 文件。恢复本次 scripts/package/hooks/README/测试入口的改动即可回滚，不涉及产品存储迁移。执行临时目录和依赖不提交。
