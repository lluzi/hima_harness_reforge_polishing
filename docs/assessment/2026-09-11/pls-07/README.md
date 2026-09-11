# PLS-07 — 执行结束、研究证据与原始报告

基线：`a9228de32b941f2658491c7ff32cba56c3542598`（PLS-02 已完成），prototype 导入身份仍是 `b4ac9d9360ad6da68b5fd2824621ba6edab7408b`。全部安装、修改、运行发生在 polishing 下独立 worktree，未访问/修改源与旧项目。任务为 [#8](https://github.com/lluzi/hima_harness_reforge_polishing/issues/8)。没有执行真实模型、远端 Site、EDA 或完整 pilot。

## 根因和修改范围

原公开 `experienceReport` 返回执行 `ending`、代次与路径，却没有研究结论、有效证据范围或未知环境声明。取消且无完整试验的最小输入返回 schema 1 和 ending，但没有研究说明：[原始反例](reproduction.log)，退出 1；修改后同一反例退出 0，见 [固定后输出](reproduction-fixed.log)。原 `reasoningOf` 把 report 的 clock period 直接称为 measured，容易与输入约束或实测 Fmax 混读。

`generationsOf` 原投影丢弃普通代次的 observation 身份、判定记录身份及代内节点轨迹，使报告无法区分同代已完成判定、未完成的新尝试和借来的旧引用。本次只增加已有记录的可选投影字段；原 `GenerationState`、Ledger schema、Judge 判定与 Fabric 调度均未改变。

schema 2 新报告把研究部分与原执行结束并列：成功执行后 FAIL 是测量负结果，失败/未完成执行与未解析、陈旧、UNDETERMINED 引用不支持明确结果；收敛不证明最优或策略普遍无效。Goal 需要完整、同源的判定依据，同代的必需并行分支不能由一个完成分支代替。自查加入该反例，确实发现初版条件过宽：[失败反例](fork-counterexample.log)，随后在同一纯报告投影中收紧，最终 L1/L2 全部通过。

报告不计算 Fmax 或改善百分比，不编造因果/AI 分析。已有 WorkspaceRecord 的 design、flowRoot、containerName 作为**声明**披露；实际工具版本、OS、设计内容身份与跨试验可比性仍明确未知。报告列出记录值、判定 ID、观测路径/hash、完整语义数据，以及最后提出但没有进入下一代的策略。

已有 `readExperience` 的文件/hash 校验与 `writeExperience` 的写后记录、重复写保护被保留。无 workspace 的 Run 明确说明不能交付文件，已有执行记录仍可查。schema 1 原文件继续按原字节读取；新报告写 schema 2，不重新渲染或重写已保存的 Markdown/JSON。读取验证两个文件的 hash，并检查报告 schema、Run 和写入时间身份。

两个报告 UI 原本已说正文是记录投影；本次进一步明确它是**当前预览，非已保存文件**，并删除升级后仍能保证字节相同的错误注释。原 `sha256` 属性作为兼容别名保留，显式加 `source=ledger-preview` 和 `recorded-file-sha256`；保存文件链接走原 hash 校验路径，不增加每秒 Site 读取。`scripts/acceptance-step3.ts` 仅把新报告 schema 断言改为 `EXPERIENCE_SCHEMA`，未运行该真实验收。

## 旧断言迁移

[逐用例映射](test-migration.json) 保留原 9 个业务用例的名称和落点：

| 原报告用例 | 当前主要验证 | 断言变化 |
| --- | --- | --- |
| Goal 达成、双文件/record/数值一致 | `experience.host.test.ts`，另留一例 `experience.test.ts` | 原 HTTP、文件、hash、路径、代次和账本断言保留；窗口打开、marker、显示及 IPC 检查留在唯一 L3 |
| 收敛规则写入双文件 | Host | 保留原规则、代数、结束原因断言 |
| generation/time-box 预算结束 | Host | 保留两种边界与原报告断言 |
| 运行中取消及单次报告记录 | Host | 保留实际 tmux Job、取消原因与一次记录；Run ID 从真实 Host 的 `/hima/` 列表读取 |
| 同一 home 重启不重写 | Host | 保留原 mtime、hash、同一记录与报告读取断言 |
| session 拒绝、文件修改、文件丢失 | Host | 保留 401/409/503 和两条报告路由；预览来源由 Host HTML 检查，L3另验证同一来源标签 |
| 写入失败后下次启动补写 | Host | 保留结束已落账、无伪报告、恢复后内容一致 |
| `/hima status` 双文件说明 | 原真实 in-process Host | 只移动文件，原断言不变 |
| Hard blocker 和原样 log tail | Host | 保留取消、完整空行/反引号块、失败原因及双文件断言 |

移除的是上述内容矩阵的重复窗口启动，不是 Host、真实本地 Job 或文件边界。原首例的完整窗口连接证据保留；仅报告来源文案和明确 hash 属性增加了相应断言。迁移初次尝试误用了不存在的 GET `/hima/api/runs`，另错用了 HTML marker 名；[首次结果](migration-first.log) 保留 13 pass / 3 fail。核对实际路由/marker 后修正测试，9 项迁移全部通过，见 [迁移复测](migration-fixed.log)。没有为这些测试错误修改产品路由。

新增 7 个 L1 用例覆盖完整 Goal 依据、有效负结果、失败/取消尝试、未知或陈旧引用、未执行下一策略、空/旧投影、并行分支。新增 3 个 L2 文件边界覆盖无 workspace、独立编写的 v1 历史文件 fixture（原字节/mtime/hash/重启）、Markdown 写成而 JSON 写失败时的恢复。v1 fixture 证明格式读取兼容，不冒充某个客户历史 Campaign 的现场迁移。

## 实际验证

使用 Node `v24.20.0`、pnpm `11.25.0`，独立 node_modules、冻结 lockfile、现有 store。每次修改源码后先构建，叶测试入口复用对应产物。

| 层级/命令 | 本次结果 | 日志 |
| --- | --- | --- |
| `pnpm run build` | 退出 0 | [build](build.log) |
| `pnpm run typecheck` | 退出 0 | [typecheck](typecheck.log) |
| `pnpm run check:seams` / inventory `--check` | 退出 0；全部 36 文件恰归一组 | [seams](seams.log)、[inventory](inventory.log) |
| `pnpm run test:local --files test/contract/experience-report.test.ts test/contract/experience-files.test.ts test/contract/experience.host.test.ts` | **19 pass / 0 fail / 0 skip，38.423 秒**；SSH attempts 0 | [local](local.tap) |
| `pnpm run test:desktop --files test/contract/experience.test.ts` | **1 pass / 0 fail / 0 skip，12.119 秒**；SSH attempts 0 | [desktop](desktop.tap) |

窗口检查发生在最终“并行分支必须共同支持 Goal”的纯投影修正之前；之后未改变 UI 或该单分支 Goal 路径，已重新执行全部 19 项 L1/L2。没有为这个纯条件反例重复启动窗口。最终代码/测试文件 hash、命令结果与此证据适用范围见 [results.json](results.json)。两次本地组合的时间不同，受同期工作影响；不以一次时间声称稳定性能提升。最终路径涉及 13 次 Host 子进程启动和 4 次 in-process Host 启动（按通过用例调用路径计数），真实窗口仅一例。

其余 local 文件、另外 10 个 desktop 文件、真实 Site/模型及完整 pilot 均未运行，不能把未选范围记为通过。现有报告矩阵运行在本工作树基线的 Pack 上；PLS-04 改默认方法后，root 需协调两代试验输入的调整并验证集成结果，Pack 方法版本与报告 schema 版本分别治理。

## 兼容、边界与回滚

新字段均为已有账本事实的视图/报告投影，不是新增组件、第二套判定或恢复引擎。旧保存文件不添加 research 段，不改变 hash/mtime。schema 2 是新写入格式；schema 1 和 2 的读取都保留。未来回退 renderer 时也应保留这两个读取分支，且不得删除运行事实与新旧报告文件。

当前证据检查不声称实现 PLS-11 的完整代码/输入版本失效机制；无法证明来源或比较条件的内容明确受限。AI 技术分析、算法材料归档和真实研究质量分别属于后续 PLS-15/14/pilot。本次无因果结论、Fmax 收益或真实 EDA 能力认证。
