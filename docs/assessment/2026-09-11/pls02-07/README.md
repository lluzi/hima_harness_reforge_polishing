# PLS-02～07 实施交付与集成验证

2026-09-11；用户指定按依赖顺序、在有条件时用 subagents 并行实施。本批六项完成，产品始终沿用 prototype 当前架构，源 prototype 与旧 himaharness 无写入。最终代码提交 `93d79925053add9a3e0d2b054a46fbc86a5be149`；Issue #3～#8 均已关闭，代码未 push。分工与放行记录见 [coordination.md](coordination.md)。

## 交付内容

| 任务 | 实际变化 | 主要证据 |
| --- | --- | --- |
| PLS-02 / #3 | check:local 构建一次并做完整本地检查；叶命令按 local/desktop/live-site 与显式文件子集选择；hooks 避免重复 build，空 unit 不充当通过 | [干净副本与命令验证](../pls-02/README.md) |
| PLS-03 / #4 | 三 Campaign 方法矩阵使用真实 Host/local Job，25 条原断言保留，单独保留表单到结果窗口路径 | [迁移与成本](../pls-03/README.md) |
| PLS-04 / #5 | 默认 Pack 方法 v2，使用既有 over-constraining-push；保留明确 legacy 反例，版本、派生 fixture、独立验收 oracle 同步 | [方法与边界](../pls-04/README.md) |
| PLS-05 / #6 | Pack/Site 静态匹配、准备责任与错误；拒绝过时响应、保留输入/焦点、阻止重复提交；startRun 仍做最终验证 | [真实 Host 与窗口反例](../pls-05/README.md) |
| PLS-06 / #7 | 修复两个并发恢复重复清除同一 blocker；只串行准入，Job 在队列外运行；核验取消、重启、分支与历史保留，修正可读性问题 | [控制验证](../pls-06/README.md) |
| PLS-07 / #8 | 报告 schema2 区分执行结束、可追溯结论、有效负结果、残缺/未知；schema1 原文件可核验且不重写；9 个报告矩阵改在真实 Host | [报告与兼容性](../pls-07/README.md) |

PLS-02 完成后才开始后续产品修改；PLS-04 等 PLS-03 验收后开始。PLS-05/07 及稍后的 PLS-04 在独立 worktree/node_modules/lib 中并行，窗口按需串行预约。主任务合并后统一检查共享接口与测试，而非把各分支单独通过直接当作集成通过。

## 集成与独立回归

业务集成提交 `ac2ed3a36f40a4cb1da7c076fa92eee5818344ae`：

- 新构建 1.947 秒，类型检查 3.053 秒；重点 26 用例先通过（69.433 秒）。
- **完整 local 181 pass / 0 fail / 0 skip**，命令 505.079 秒，Node 部分 504.824 秒，**0 Electron / 0 SSH**，见 [最终整组](final-local.log) 与 [命令记录](final-local.json)。
- 仍在 desktop 文件中的 **10 个非视觉 L2 用例**单独精确选择，10/10、32.259 秒、0 Electron/SSH；与上述 181 条无重叠，见 [补充验证](nonvisual-desktop/README.md)。
- [混合分支状态](../pls-06/partial-fork/README.md) 单项 real Host 探测：1/1，6.616 秒；确认一支阻塞而同伴仍运行时视图/Job 一致，最终只恢复阻塞分支。
- **6 个必要的既有桌面用例**经定点执行全部通过：默认 seeded-local 启动、两条输入/响应顺序/纠正路径、报告打开、取消、阻塞后继续。另有一次脚本 checkpoint 完成真实本地失败→修正→恢复→保存报告，原失败历史保留。它不是资深工程师的实际研究价值验收。

完整 local 和上述非视觉矩阵在同一新构建上执行，源码/测试/lib 前后 hash 一致。真实模型、远程 EDA、真实 Site 套件及完整 pilot 均未运行；15 个 live 声明仍属未跑。共 40 个正式 contract 文件（local 25、desktop 12、live-site 3），未选择的其余窗口行为不算通过。各任务先前验证与集成验证存在重复，不能相加为唯一覆盖。

## 集成中遇到的失败与修正

唯一 cherry-pick 内容冲突发生在 experience.test.ts：PLS-04 改两代输入，PLS-07 迁移旧报告矩阵。保留 Host 迁移，将 2.35→2.30 的输入同步到窗口和 Host 两处；没有把移走的八个昂贵窗口矩阵重新加回。合并后构建/类型及 26 个重点用例通过。

最终窗口初轮 3 pass / 1 fail：旧填表 helper 只等 Pack 的 knob 标识，没有等 Site 异步静态检查；检查期间 Start 禁用且完成时按钮位置变化。实际控制延迟重现了这一点。修正仅在测试支持中观察当前 Pack/Site 的 fit，再让调用方点击，随后原失败例与两个尚未执行的控制例通过；同一等待逻辑供已有截图/验收脚本的手工填表循环复用。没有把一次事件送达当作 Run 已创建。

第一次 checkpoint 因拍照 zoom0.85 后自动点击坐标未命中 resume 而失败；用实际 click.note 区分了工具操作错误与 Fabric 失败。后一次在控制前恢复 zoom1，真实恢复成功。所有失败、修正和定点重跑保留在 [桌面记录](desktop/README.md)，未重跑整个桌面套件。

视觉复核发现固定表格数值和判定文字的 nowrap 使其覆盖相邻列；只在既有 CSS 中让这两类文字正常换行。新构建/类型通过，单窗口视觉检查 1 pass、8.824 秒，8 个实际文本元素的左右越界都是 0 CSS px；父任务已查看 [代次表](desktop/visual-final/generation-table.png)、[报告顶部](desktop/visual-final/report-top.png) 和 [研究结论/限制](desktop/visual-final/report-research-limits.png)。报告路径/版本/preview 身份及已保存文件链接可读；详情长表保留原有横向滚动。此前误名为“报告”的截图实际在卡片顶部，已明确纠正，不把它当作报告视觉证据。

完整 181+10 回归后，业务代码未再改动；后续仅有上述一条表现层 CSS 和自动操作的就绪等待/调用点，并按其影响重新做 L0、必要 L3。没有为这些局部显示/工具修正再跑一轮全部 Job 等待。完整批次已知实际 Electron 启动合计 **19 次**（包含各分支验证、反例、修正与集成），其中集成/视觉阶段 10 次；不是把最终通过用例数当作全部成本。

## Standards

两条审查轴独立并行，固定范围 `d923fb3...ac2ed3a`，各切片也经其他 subagent 复核。Standards 未发现代码阻断或需要扩大修改的 smell：现有模块边界、checkPack/Judge/Ledger 权威、真实 Host/Job seam、历史报告字节保护与分级测试均保留。旧现状文档、一个 guard-band 遗留注释已同步。后续就绪等待经独立只读审阅；手工脚本复用同一逻辑以及一条 CSS 修正由主任务审查并做针对性验证。

计数：最终 0 项未解决的规范阻断。

## Spec

独立 Spec 审查未发现实现缺项或额外架构。主要校验：v2 默认方法及 legacy 反例不混淆；静态 fit 不声称真实资源就绪；重复恢复只清除一次；报告必须有当前可追溯 judge 证据，无法满足时明确不成立；当前 renderer preview 与已保存文件分别标识，新 v2 与历史 v1 各自保留身份。评审不替代实际测试，最终结果来自上述日志。

计数：最终 0 项未解决的规格阻断。

## 范围与后续

这是已确认的第一批 polishing，不是完整 DTCO/AI 研究 pilot 完成。Step 4 模型/Workshop、运行图增长、完整代码/输入失效、Pack 内归档与知识复用仍按 PLS-08 之后的依赖推进。当前报告只输出有依据的执行/测量事实和限制，不伪造 AI 因果分析，也不把 stand-in 数值当真实 Fmax 改善。

原 b4ac9d9 导入身份保留；生产 Judge、chooser YAML、Channel、Ledger schema 和依赖锁在本批未修改。方法与报告的新版本属于不同身份。各任务可按独立提交回滚，已保存报告/历史证据不删除；需按依赖逆序回滚共享接口和测试调用点。Git hooks 文件已改，未自动安装。

原始结果见 [results.json](results.json)，实际执行路径/产物 hash 在各检查 JSON 与子目录。生成的 runtime home/临时 Job/socket 均由执行者清理；隔离 worktree 与安装副本保留在忽略的 .hima-tmp 中供复查，不进入产品或提交。
