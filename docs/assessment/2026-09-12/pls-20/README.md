# PLS-20：Step 4 快照整合

状态：代码、分级验证与独立审查已完成；Git 提交与同步见 [交付记录](delivery.json)。汇总见 [results.json](results.json)，全部失败和定点复验见 [attempts.json](attempts.json)。

在已交付 PLS-01～07 / UI-02 上接收 `ca47fa0` 的 Pack-local 数据、Model moment、Workshop、九阶段 stand-in、五阶段作者流程与 release 机制。正确的默认 Pack v2 方法、预检、重复恢复保护、诚实报告和原生对话旁的统一工作区保留。当前执行方式仍是接收基线；同一对话 Agent 的执行主导权属于 PLS-19，本切片没有提前实施。

- [三方处理及回滚](integration.md)：24 个重叠路径逐项去向、11 个文本冲突文件。
- [导入清单和构建身份](import-manifest.json)：B/P/U Git blob、结果 hash、独立构建的 145 个文件身份、源文件只读校验。
- [测试声明与断言迁移](test-inventory.json)：两侧静态测试逐项去向；静态数量不等于运行数量。
- [独立两轴审查](review.md)。
- [真实模型检查](live-model/2026-09-12-live-check-workshop.md)、[执行成本](live-model/execution.json)、[实际生成的脚本](live-model/miner.sh)。

## 验证范围

| 层级 | 本次内容 | 结果与边界 |
| --- | --- | --- |
| L0 | Node 24、seams、Pack boundary、构建、类型、54 文件分组完整性 | 已通过；保留 build-once 及 local/desktop/live-site 入口 |
| L1/L2 | 完整 local；方法对照、预检、并发控制、报告完整性、reader/moment/workshop/pipeline/release | 278/278 通过、0 skip；989.164 秒；Host 子进程 43，in-process Host 259，Electron/真实模型/SSH 均为 0 |
| L3 | 同屏对话草稿/Run/代码/报告、预检错误与竞争、恢复/取消、Workshop 和作者标记、旧 Ledger 启动拒绝、凭据不落盘 | 7 个不同用例均有通过证据；诊断与复跑共 14 次 Electron 启动，不把复跑当成额外覆盖 |
| L4 模型 | DeepSeek V4 Flash，1 个 Workshop 会话，写出并执行脚本，reader 读取结果 | 12/12 检查通过，53.727 秒，额外 1 次 Electron 启动；没有 replay |
| L4 Site / L5 | 真正 EDA、完整 DTCO、研究价值与独立工程师使用 | 未运行，不在快照导入的自动验收范围 |

真实模型检查只证明装配和执行机制：本例按 fixture 指定的方法从 stand-in 的 Cell Area 派生计数，**不是定制 Cell 挖掘算法，更不是 Fmax 提升证据**。Run 如实结束为 `ended-goal-not-met`。脚本 bytes 与 Code record 的 SHA-256 一致。共 1 次实际模型会话；底层 API 请求数和 token 数未计量，不能把一个会话写成一次 API 请求。只读取本地受控材料，真实 SSH/EDA 作业为 0。

密钥通过不回显的 stdin 进入本次子进程环境，未写入仓库或配置。运行后对生成 home 的 118 个文件进行了扫描，未发现密钥；交付材料省略了上游检查脚本默认记录的凭据前缀。生成 home 已由检查器清理；脚本与记录身份归档在上面的证据中。

## 测试分级与失败处理

当前分组为 local 34 文件、desktop 17、live-site 3。Moment、Pack readers、Workshop、pipeline 四组的非窗口断言移入真实 Host；组合前后分别保持 84、92、248、153 个断言调用。原有窗口案例仍保留，未选中的 desktop/live-site 案例明确为未跑。

没有为导入再造执行引擎或测试服务。只扩展现有测试入口的启动计数；local 组若经 driver 启动 Electron 就失败。SSH 哨兵兼容 Node 的 `promisify(execFile)`，包括错误对象的输出，且该入口也不能绕过 SSH 拒绝。

发现并处理的实际反例：

1. 初次三方整合的测试夹具仍绑定旧方法或 graph v1，与已交付 Pack v2 不一致。将新 reader/Workshop/释放封印夹具对齐 v2；需要测试 bundle shadowing 的案例明确安装 legacy 绑定，保留全部原断言。
2. SSH 哨兵包装 `execFile` 时丢失了 Node 的 custom Promise 语义，导致上游 boundary 检查无法读取 stdout/stderr。恢复原接口，并验证 promisified SSH 仍被拦截。
3. 上游新整数校验拒绝原有报告测试使用的 `0.01` 秒延迟。stand-in 恢复非负小数秒支持，保留危险语法、负值和非规范数字的拒绝；报告测试无需增加等待成本。
4. 新恢复用例把“blocked 节点已持久化”当作“Run 已写成 waiting”。改为等待第二个真实状态，节点、Job、顺序与未伪造 observation 的断言均保留。
5. 新 Workshop 窗口夹具误等 replay 模型已配置时不会出现的对话框，并曾用不属于 installed Pack 的目录测试坏 Pack。修正夹具后重跑对应文件，产品拒绝规则未放宽。

首次完整 local 是诊断运行，包含 12 个上述失败；修正期间运行树发生变化，因此它不是最终构建的验收证据。最终以冻结源码/构建下的完整 local 输出为准，不以定点通过替代全组。

## 数据兼容与下一步

Ledger domain 14 → 19，沿用 version gate，旧 home 明确拒绝且文件保留，不做原地迁移；独立桌面案例已验证拒绝信息及原数据不变。Experience v1/v2 文件按保存时的原字节/hash 读取。根 README 使用独立的 `pls20-dev` home 路径，回滚代码时仍使用原来的旧 home。

下一工作前沿为 PLS-21（Goal/参数与启动输入）、PLS-22（正式 Pack 作者流程）、PLS-13（方法身份与资产分离），按共享文件和接口安排并行。PLS-19 在 PLS-21 后接管节点执行；正式 AES probe 与真实研究继续遵守后续任务的验收门槛。
