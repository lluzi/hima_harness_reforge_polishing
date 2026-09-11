# PLS-01 完成与验证记录

2026-09-11；对应 [Issue #2](https://github.com/lluzi/hima_harness_reforge_polishing/issues/2)。工作与运行全部在 polishing；prototype 与旧 himaharness 没有写入。本任务未推送代码。

本地完整组 **154 通过、0 失败、0 跳过、0 取消**，耗时 **437.770 秒（约 7 分 18 秒）**。SSH 子进程启动尝试为 0；无真实模型调用、远程 Job、EDA 或 Desktop 启动。主结果见 [full-local.log](full-local.log) / [results.json](results.json)。

## 基线、根因与改动

源提交 `b4ac9d9360ad6da68b5fd2824621ba6edab7408b` 的 159 个导入文件实施前逐一 hash 相符。本地已有导入与规格在本任务先保存为 `d6cadfbe820594d543655ff32d27e8ba270c423a`，使本次改动可单独审查和回滚；实现提交为 `618fee42c23388aa85f382c347d3935adb506724`。后续收尾提交包含证据、现状文档、入口缺失文件反例的退出码断言，以及三个文件的尾部空行整理。

原 `pack.test.ts`、`ssh.test.ts`、`jobs.test.ts` 都在 describe 注册参数中执行 `probeSite()`。第三处由本次 29 文件逐例核查发现，补上原任务列出的两处；仅拆两处不能达到本地不尝试 SSH 的要求。原 SSH/socket 故障用例还可能处理按目标地址派生的共享控制路径。

把各文件的 live describe、探测与专属辅助代码移到相邻 `.live.test.ts`；本地配置/schema/Host/Job/Pack 断言保留。`scripts/run-contract-tests.mjs` 按显式清单选文件，在导入前拒绝未归类、重复或缺失项；`test:contract` 构建后只跑 local。live 导入须有显式选择和私有临时目录；socket 故障注入先核对目录归属，辅助 SSH 不复用用户 master。`support/site.ts`、`support/tmux.ts`、产品 packages/Pack/Channel/Fabric 及 lockfile 未改，见 [source-verification.json](source-verification.json)。

构建一次和 hooks/短反馈编排仍属于 PLS-02。完整本地组 7 分多钟是当前量测值，不宣称达成 3 分钟的日常相关子集目标；慢点主要在原有重试、重启、资源竞争和不可读 Site 用例的真实本地等待。没有删掉这些断言来缩短本轮数据。

## 覆盖、资源与未跑范围

- 原 29 个文件、230 处测试声明、2,640 处断言表达式均有去向；断言全文逐字匹配，未删改原断言。文件内共享 helper 移动/复制时会映射到多个位置，这不是新增业务覆盖。
- local：18 个原文件的本地部分共 151 处原声明，加 1 个入口回归文件的 3 个新用例；本次共 154 个实际通过。
- desktop：11 个文件、64 处原声明本轮未选。live-site：3 个文件、15 处原声明本轮未选。没有把它们报成依赖可用、跳过或通过。
- 当前所需本地报告副本存在并通过既有 hash 检查；没有使用 HIMA_FIXTURES_OPTIONAL，也没有制造缺失副本。缺失默认失败、显式 optional 才 skip 的规则及依赖不可用说明见 [测试入口](../../../../test/README.md)。
- [逐例位置/级别](case-mapping.json)、[逐断言位置/文字/hash](assertion-mapping.jsonl)、[29 文件资源与清理核查](resource-audit.md)、[统计](inventory-summary.json)。静态声明数不等于断言运行次数或测试覆盖率。

本地组使用已有真实 Host、文件/HTTP、tmux 和 stand-in；没有新的 Host/Fabric 模拟器。临时 home、agents、user data、socket 由本次入口隔离，完成后日志中的私有入口目录已不存在。真实 Site 清理仅做了代码核查，未执行。

## 本次验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 构建 | 通过，生成本次产品源码对应产物；产品源码未改 | build.log |
| L0 类型检查 | 退出 0，3.255 秒 | l0-typecheck.json / .log |
| L0 seam 检查 | 退出 0，0.296 秒 | l0-seams.json / .log |
| L0 文件清单 | 33 个文件各归属一次，退出 0 | l0-inventory.json / .log |
| 注册时探测反例 | 改前无匹配名称仍尝试 SSH 3 次，由哨兵在启动前拦截，预期退出 1 | red-registration.json / .log / -ssh.jsonl |
| 拆分后加载 | 相同名称过滤，退出 0、尝试 0；这是加载边界检查，不计业务测试通过 | green-registration.json / .log |
| 新入口回归 | 3/3 通过；覆盖选择、list/check 不导入、未归类/缺失/重复拒绝及吞掉 SSH 错误仍失败 | entry-tests-final.json / .log |
| live 未显式选择 | 三个真实 live 文件在探测前拒绝，预期退出 1、SSH 尝试 0；未执行 L4 | live-not-selected.json / .log |
| socket 归属 | local 选择拒绝、拥有路径接受、共享路径拒绝、TMPDIR 不一致拒绝；不启动 SSH | socket-scope.json / .log |
| 完整 L1/L2 本地组 | 154/154，0 skip；437.770 秒，退出 0；SSH 尝试 0 | full-local.json / .log |
| L3/L4/L5 | 未跑，按 PLS-01 范围无需启动 | results.json |

每项判断均对应当前实际输出，完整组只运行一次；单文件/小集合按错误诊断与验证需要执行，重复用例不累加为不同覆盖。SSH 哨兵只拦截测试 Node 进程的 child_process SSH 启动并观察记录；不能由此宣称阻止了任意程序的所有网络行为。

保留两个实施中的失败：`typecheck.log` 与 `split-local.log` 暴露拆分误删了 local Pack 仍需的 randomUUID/quote import，已按实际引用恢复；该失败使旧测试在 try 外创建的 Host 留存，162 秒时仅终止确认属于本次用例的 Node worker，未改产品生命周期。`entry-tests.log` 的 2 个失败源于新 CLI 用例继承 NODE_TEST_CONTEXT（子 runner 被当成递归测试而不执行）以及生成源码的新行编码，已修正测试夹具后复核。失败记录未覆盖，最终完整组与类型检查均通过。

## Standards

审查固定范围 `d6cadfb...618fee4`，独立审查者静态检查，没有运行昂贵依赖。

1. 文档问题 P3：测试方案还写着分组未实现，并引用已迁移的探测行号。已更新 docs/testing-strategy.md 现状和 live 文件链接，明确 PLS-02 未完成范围。
2. 可选低优先级 smell：三个 live 文件的辅助 SSH 参数重复。保留本次迁移的直接写法，暂不为潜在未来调整抽象执行 helper；已有统一的目录归属检查。此项不是代码阻断问题。

计数：1 项文档问题已修正；1 项可选 Duplicated Code 判断保留。无未解决的代码阻断项。

## Spec

独立审查未发现缺项、错误实现或范围扩张。三个拆分文件原有 51 条测试声明中，50 条正文完全一致；一条只在取得 stale socket 路径时增加归属检查。将 jobs.test.ts 纳入拆分直接满足全量清点和本地零 SSH 的要求。所有原断言的全量对账独立于这一静态结论。

计数：0 项 findings。

## 复现与回滚

从仓库根目录、Node 24 环境执行，先 `pnpm run build`，然后：

```sh
python3 docs/assessment/2026-09-11/pls-01/run-check.py replay-local node scripts/run-contract-tests.mjs local
node docs/assessment/2026-09-11/pls-01/inventory.mjs
node docs/assessment/2026-09-11/pls-01/check-socket-scope.mjs
```

run-check.py 在测试子进程环境中移除模型 API key/认证 token/SSH agent 和 fixture optional 开关，使用私有临时目录，并把退出码、耗时及哨兵记录留在此目录；命令也存于各检查 JSON。重放使用新名称以保留历史证据。入口常规用法见 test/README.md。

回滚本次实现与收尾提交即可恢复 `d6cadfb` 的测试组织；保留导入、产品规格和历史验证资料。回滚会恢复旧的混合测试及默认全量 glob 的 SSH 行为，因此回滚后不能把旧 test:contract 当作离线入口。
