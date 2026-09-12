# PLS-19 默认执行、恢复与旧 Run 接管切片

基线：`7dfe25d`；工作分支：`codex/pls19-recovery`。所有修改、依赖、Host、Job 和文件均在 polishing 工作区及其测试临时目录内；两个参考源码目录保持只读。

此记录只证明本切片的 L0/L2，不代表 PLS-19 整体验收、L3 桌面、真实模型或 EDA 已通过。图选择/完成协议、Workshop 和 UI 由主任务集成并独立验证。

## 执行与恢复语义

- 生产 `startRun` 必须有实际 live conversational owner；`resumeRun`、`drive` 和每轮 drive 均禁止回到自动路径。旧回归只在 `NODE_TEST_CONTEXT` 存在且 `HIMA_TEST_LEGACY_AUTO_DRIVE=1` 时使用原 driver；该判断仅定义于 `runs.ts`。
- 测试入口为旧套件提供 legacy/silent fixture 默认值。tools、commands、HTTP 仅在此隔离条件下省略 owner。新的 recovery 套件明确设为 `0`，通过真实 Host 创建 owner。
- 重启重新读取 Ledger 中的 admitted request、execution 和 launch intent，复用 `reconcileLaunchIntent` 找回原 Job；复用现有 `observeExecution`、observer map、drain、`resumeNode`、预算与 reader 规则。恢复既不选择下一节点，也不创建 Agent。
- 没有可确认 effect 的 admitted request 显式变为 uncertain，不自动重放。已经有旧 Job intent 的 interrupted completion 也不能借旧 Job 的成功退出变回 ready。
- intent 仍不确定时，取消返回 `not-stopped`；既有 Site 接纳 hook 继续阻止新 launch。Job 已启动但回执丢失时，从实际 launch 记录补齐漏计的 Job 用量，保留较大的原 meter。
- 旧 unowned Run 只观察已有 Job/reader 事实，保留状态与节点边界。旧 waiting 状态本身不等于取消；`passiveObservation` 是现有 Driving 的瞬时观察参数，沿用明确取消、最终停止、Host stopSignal 和硬预算规则。

## 接管语义

`executionAction(action='adopt')` 在已有 Run admission queue 内调用 `adoptHistoricalRun`，不建立第二 store 或 engine。

请求需要真实 live actor、expected epoch/revision `0/0`。接管只能发生在可核验的 outer 节点边界：已有 Job 确认结束且 node/reader result 已收集，或参考 Pack 中明确的 Wait 节点。开放 Loop/fork、在途或未知 Job、未闭合 session、无可确认 launch receipt 的一般中断均拒绝。

方法使用 Run 原 digest 通过 `loadRunPack` 解析。现场 workspace.json 按 Permit 读取，并核对原 WorkspaceRecord、Run/Pack id/version、campaign/site、workspace、flowRoot、design、container、preparedAt、copy list 及当前 Site 的原输入绑定。缺少额外输入的历史绑定凭据时准确拒绝。原 Run digest 缺失时不能从当前安装反推旧方法。

v19 的 WorkspaceRecord 可以没有 packDigest，现场 metadata 也可以没有该可选字段；已有 digest 若存在则必须一致。接管记录今天的 metadata SHA-256、原 workspace record seq 和 Run method digest，不补写或重写旧记录，不能把今天的验证说成历史文件已有 hash。

接管后 owner epoch/revision 为 `1/1`，Run 保持原 Goal、budget、strategy、generation、history 与已用 counters，并进入 `paused=['*']`，等待显式 continue。旧已闭合 human wait 及当前仍开放的真实 blocker wait 合并为固定 `adoption.legacyWaitedMs`；旧 active time 不重置，接管后的暂停继续消耗原总 time box。接管本身不写 `resumed`，不冒充工程师已清除业务阻塞。

## 验证与证据

Node `v24.16.0`，pnpm `11.25.0`，frozen lock 安装，使用 root 指定的 `.hima-tmp/pnpm-store`；无新依赖。

`test/contract/agent-recovery.host.test.ts` 的 8 条 L2 用例覆盖：

1. production unowned start 在 Run/Job 创建前拒绝。
2. historical waiting Run 重启后观察已有 Job，无隐式取消。
3. interrupted complete 即便有成功旧 Job 也保持 uncertain。
4. 缺失原方法、输入 metadata 变化、未确认中断边界拒绝接管。
5. 当前开放的旧 human wait 只结转一次，新 owner 暂停照常耗时并最终拒绝 continue。
6. 真实离线 v19 import 到新 home，第二个 Host 保留历史；无 WorkspaceRecord digest 仍按原身份验证接管，原 source bytes 不变，显式 continue 后可做新节点工作。
7. durable admitted intent 没有确认 effect，重启不重放，不宣称取消成功，不释放 Site 给新工作。
8. 实际 tmux launch 后注入回执存储失败；关闭并重新启动真实 Host，由 Ledger intent 找回同一个 Job，保留 owner/原节点、正确 Job 计数；无模型时仍可读/取消。

其中 launch 回执失败是定点 storage fault injection；Host 生命周期和重开的 Ledger、Jobs、文件均真实。它不等于操作系统 SIGKILL 的全进程测试。旧 v19 fixture 由当前真实 Job/文件事实转换到严格旧 schema 后，通过现有正式 importer 导入，非客户原始数据。

红灯证据保留在 `red-*.log`：默认未拒绝、丢失回执未恢复、unknown 被误报 cancelled、旧状态被改为 waiting、completion 被错误重新观察、漏计 Job、waiting 被误作停止。最终结果 `final-recovery.log`：**8/8 PASS，0 fail，0 skipped，28.006 秒，13 次 in-process Host，0 Electron，0 SSH**；构建/类型结果见 `build.log`、`typecheck.log`。`related-20.log` 是最后两项恢复收紧前的 20/20 相关回归（recovery + agent-execution + ledger-import），35.979 秒，18 次 in-process Host，0 Electron、0 SSH、0 skipped；不冒充最终源码的重复执行结果。

静态 seam/boundary 与 `git diff --check` 通过。完整 local、L3、真实模型、EDA、全进程杀死场景留给主任务的最终集成验证，没有计为本切片 PASS。

## 集成与回滚

Fabric 的小改动只有 default guards、内部 helper exports、adopt dispatch/identity acceptance，以及同一 observer map 对历史观察的复用；不重写图执行主体。主任务将 adopt 接入 Agent tool enum，并保证 native UI 不向 legacy unowned fixture 发模型提示。

回滚以本分支提交为界，不删除既有 Ledger/Job/历史文件。adoption 是 v20 RunControl 的可选字段；有此字段的记录不能被忽略新字段的旧二进制安全打开，回退前保留当前 ledger 与 source import 备份并使用原隔离 home，不能就地删除 owner/adoption 来恢复自动执行。
