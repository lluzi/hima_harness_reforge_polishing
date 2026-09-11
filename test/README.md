# Contract 测试入口

先用 Node 24 执行 `pnpm run build`，确保测试读取当前源码的 `lib/`。分组清单的唯一执行依据是 [contract-groups.json](contract-groups.json)。入口使用现有 Node test runner，按文件串行执行；不会导入测试来判断它属于哪组。

```sh
node scripts/run-contract-tests.mjs --check
node scripts/run-contract-tests.mjs local --list
pnpm run check:local
pnpm run test:local --files test/contract/test-entry.test.ts test/contract/boot.test.ts
```

`check:local` 检查 Node/seams，构建一次，检查类型并运行完整 `local`。下列叶命令使用当前构建，不再内部 build；源码变化后先构建，再跨组复用该产物。`test:contract` 兼容转发到 `test:local`。`test:unit` 目前明确报告 0 文件、未运行，退出 0 不能作为额外覆盖。

| 组 | 内容与前置条件 | 显式入口 |
| --- | --- | --- |
| local | L1/L2；真实 Host、HTTP、本地文件、独立 tmux 作业及 stand-in。需要 tmux、make 和相关本地报告副本；无需 SSH 凭据、Electron、模型或 EDA | `pnpm run test:local` |
| desktop | 含真实 Electron driver 的文件，暂时连同这些文件中的较低成本用例保留。需要桌面环境和 Electron | `pnpm run test:desktop` |
| live-site | `ssh.live.test.ts`、`jobs.live.test.ts`、`pack.live.test.ts`；真实 SSH、远端 `make -v`/tmux、约 56 MB 的流程复制与测试目录清理 | `pnpm run test:live:site` |

后两组按分级政策单独选择。不要使用 `test/contract/**/*.test.ts` 全量 glob，也不要用 `--test-name-pattern` 当作外部依赖隔离手段：模块注册发生在名称过滤之前。live 文件另有显式选择检查，误用直接 glob 会在探测前失败。

使用 `--files <path>...` 选择相关子集，例如 `pnpm run test:desktop --files test/contract/honest-standin.test.ts`。名称必须精确属于该组，空选择、路径丢失、重复或跨组选取都会在执行前失败。`--list --files ...` 只预览子集。入口输出选中/未选中文件数、TAP 的 pass/fail/skip、耗时及命令退出码；未选中的组和文件是未跑。尚无真实模型或完整 pilot 命令，不提供假通过的空入口。

入口在任何导入/执行前对所有 `.test.ts/.test.mjs` 等测试文件核对清单。新增文件未归类、清单路径丢失或重复归类都会失败，不能靠文件名约定静默漏测。`--check` 与 `--list` 均不执行测试。

## 资源与结果含义

每次执行创建短路径的私有临时目录，隔离 `TMPDIR`、`TMUX_TMPDIR`、dsh home/agents 和 Electron user data。清除继承的 `TMUX`，收尾用明确 socket 路径关闭本次 tmux server。原用例仍负责关闭自己启动的 Host 和准确命名的 Job session；故障测试改变的 socket/权限都位于自身临时目录。

local/desktop 的 Node 子进程加载测试期 SSH 哨兵。它在 `child_process` 尝试启动 SSH 时记录并抛错；即使用例吞掉异常，组入口也以非零退出。正常本地执行结束显示 `SSH subprocess attempts: 0`。这是测试进程边界检查，不是生产 Channel 替身，也不是阻止任意程序联网的操作系统沙箱。`test-entry.test.ts` 含一次故意尝试 SSH 的反例；该尝试由内层哨兵拦下，外层本地组没有启动 SSH。

live 的控制 socket 位于本次私有 `TMPDIR`，恢复用例在删除/改写前核对归属。测试自己的辅助 SSH 使用 `ControlPath=none`，不复用用户控制连接。退出时仅关闭本次目录内的控制 master。远端只清理当例生成并核对的 UUID workspace；不能删除 Site 的参考数据、其他 Campaign 或共享控制连接。执行 live 前仍须核对 Site、许可和清理范围。

缺少/hash 不符的报告副本默认失败；显式 `HIMA_FIXTURES_OPTIONAL=1` 才允许相关用例 skip，不能算通过。桌面不可用与真实 Site 不可达沿用相应 skip 说明；未选择的组是“未跑”，并非“通过”或“依赖可用”。stand-in 通过只证明机制，不认证模型能力或真实 EDA 指标。

PLS-01 的逐用例/逐断言迁移对账和本次结果见 [验证记录](../docs/assessment/2026-09-11/pls-01/README.md)。
