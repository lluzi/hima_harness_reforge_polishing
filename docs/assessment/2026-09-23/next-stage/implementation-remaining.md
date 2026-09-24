# #52 后续实现与资格边界

起点：`1257e95086977b88f7ffb3fafff3b2cc4cc43350`。本次继续实现已批准的剩余规格，保留现有 DSH 会话、Fabric、Job、Site、Ledger 和 Workbench。没有恢复 Claude trial30、真实模型或商业 EDA。

## 已实现的产品路径

- **控制与恢复（S01）**：退出先在原 RunControl 中记录 admission fence；等待原 Job 到可恢复边界，或由用户明确选择保留/停止作业。退出不等于取消 Campaign。关窗仍只隐藏同一窗口。全局退出接口要求本次 Desktop 启动签发的私有控制 token，普通浏览器会话不能调用；停止作业失败则撤销本次退出 fence，不假称已经退出。启动先核对原 Job，再恢复具备有效原生身份、项目和权限的 owner；人类暂停保持，预算不重置。
- **Guide（S04）**：原 Guide 可通过已认证 UI 代传人类控制，仍由原执行会话负责工作。重要结束/受阻状态带来源通知原 Guide，重复控制不重复通知。Guide 到 Pack 作者的交接带项目内 SOP/脚本/报告的路径、字节数和 SHA-256，进入独立原生会话的 inbox；交接本身不启动模型、阶段或 Job。
- **记忆（S05）**：普通会话、child 和 Campaign 的工作摘要复用 workspace 文件。Host 签发实际 Run/原生历史引用；验证的是保留历史前缀，后续事件使旧摘要陈旧，不把摘要提升为当前事实。原生 `/compact` 的成功、失败和跨重开证据分别测试；没有另写一套压缩/记忆服务。
- **团队（S06）**：通过真实 continuable child 创建、跟进、取消及回收候选。原 Ledger 记录 intent/结果及预算分配；父 Run 暂停、owner epoch 变化、退出或期限到达均限制 child 写入。coding 只写指定私有子目录，禁止 shell、递归委派和取得 Run 控制权。有效工具、模型、限制及未知项可查看；当前原生 API 没有任务总 token/费用硬限额，因此请求这类限额会明确拒绝。
- **Workbench（S02/S07/S08）**：可编辑并保存有来源的工作摘要、对精确经验候选说明原因并选证据纠偏；可查看 child 保留 transcript 和当前原生上下文、继续或取消委派。Guide 只能查看确属其所指 Run 的 child；报告读取限定于不超过 2 MiB 的保留版本并校验字节 hash，不能直接吸收已变化的现场大文件。Insight 可读取 hash 绑定的 Experience、代际反馈，以及明确标为 synthetic 的 Library fixture。按实际 generation/loop 显示分析；代际视图保留原目标分母、覆盖、五类 endpoint、可比性和具体 Cell Demand，缺失值保持未知。Site 再发现冲突保留原政策，并有重新发现/审阅入口。
- **两个 Pack（S07）**：DTCO `5.2.12` 与 XTop `1.0.7` 在现有报告内生成 `hima-generation-feedback/1`。Reader 对照完整、hash 绑定的源资料重算或复核；名单被上下文压缩截断时类别为未知，不能用截断名单宣布 fixed。XTop 改变时序条件后，已有物理 endpoint 仍算已观察到，但其时序增量不可比。DTCO 的商业响应在新比较开始时撤销 current 指针；比较失败或输入身份变化不会继承上一代的 current 反馈。两者都是 development 方法，旧运行保留原版本。
- **交互协议（S09/F2）**：已声明的 Pack tool、原执行节点、Site Permit、Job 配额和原 Ledger 回执构成有界 PTY 协议。typed 输入不能选择 actor、argv、workspace 或伪造资格。每次输入有持久 intent、单写者、Host nonce、有限等待与独立期限；发送不确定时不重发。Tcl 参数作 literal 传递，成功/报错分开；同一 Job 的真实 exit 由既有 Fabric observer 接回原节点。真正的生产环境隔离仍无合格验证器，因此当前生产交互入口拒绝启动；本地正例带明确 test-only 资格，不能解释为 XTop 已获授权。
- **作者路径（S10）**：复用五阶段、测试、seal、transfer review 与原作者 guard。新交接不替人选择阶段，不复制或修改源文件；中断后仍从实际文件、检查结果和已保留证据恢复。

## 明确尚未证明的部分

| 规格 | 本地可观察增量 | 当前验收边界 |
| --- | --- | --- |
| S01 控制与恢复 | 退出 fence、同一 Job 的等待/保留/停止、原 owner 恢复、人类 hold 保留。 | 本地 Host 与隔离 Desktop；客户长期 Run 未测。 |
| S02 Site 政策 | 冲突预览后重新发现和显式审阅。 | 本地文件与 Desktop；真实 SSH Site 未测。 |
| S03 结果有效性 | 保留 Phase 1 的完整覆盖门；unknown 不采用。 | 真实物理报告语法仍待资格。 |
| S04 Guide | 独立任务、可信 human control 回执、重要边界通知、作者会话交接。 | Replay 与本地会话；真实模型对话质量未测。 |
| S05 记忆 | 精确 source、陈旧判定、编辑、停用/重新采用、原生 compaction 与重开读取。 | 本地历史；真实长任务模型行为未测。 |
| S06 团队 | 有界原生 child、私有读写范围、冷恢复结果、跟进/取消、证据引用。 | Replay 的真实 Host 子会话；真实研究能力未测。 |
| S07 反馈 | 两个 Pack 写入并由 Reader 核对分母、覆盖、类别和下一动作；陈旧商业反馈撤销。 | 冻结/合成资料；商业 EDA 与真实 AI A/B 未测。 |
| S08 工作区 | 同一视觉体系的 Campaign/Insight、child/context、纠偏、代际变化和 synthetic Library finding。 | 隔离 Desktop；客户 Library 分析未测。 |
| S09 交互 EDA | 原 Job/Site 配额上的单进程 PTY、typed 输入、失败与重试回执。 | `tmux/tclsh` 测试资格；生产 Operator 尚未开放。 |
| S10 Pack 作者 | 项目源 SHA 交接、五阶段、seal/transfer review 保持原流程。 | 现有本地作者流程；本次两份 development 方法没有新的正式 seal。 |
| S11 Library | 离线 typed fixture、双轴 finding/filter、缺值与 provenance 展示。 | `lib.name` exit 139；无真实 API facts。 |
| S12 交付 | App 和 Pack 分别记身份；候选 App 带两份 development 方法和本地样例。 | 本地结构、安装、Host、Desktop；J3 需独立真实试验。 |

上述“本地”只表示被列出的接口按保留或合成资料执行过。具体通过数在本次最终验收后写入同目录机器可读回执；任何一行都不等于客户设计的 PPA、时序收敛或 Library 签核。

| 规格 | 外部资格或仍需交付的证据 |
| --- | --- |
| S03 / XTop | 实际完整物理检查报告的语法与覆盖资格；unknown 继续禁止 best DB 采用。 |
| S06 / S09 F3 | 真实 XTop adapter、受约束工具环境及 Operator 委派资格。没有随包发布可用于商业工具的 mutation binding；本地 Tcl 测试不能替代它。 |
| S07 | 真实 DeepSeek 反馈 A/B 和商业工具的跨代业务收益。界面显示有证据的变化，不宣称已经自主创新或取得 PPA 收益。 |
| S11 | 原生 Liberty API 的 `lib.name` exit 139 接入门仍未解除；按既定要求没有调试/替换厂商 API、扩大 Permit 或运行 corpus。没有真实 Library 结论。 |
| S12 | 独立客户场景中的人工时间、迭代周期与价值验证；签名公证属于发布资格，不能由本地测试替代。 |

管理员资格文件是显式配置，不是模型参数。当前没有证明任意第三方 EDA 或任意 Tcl 具有隔离与事务性；未配置或字节身份改变会拒绝。命令完成、Job exit 0、Reader 通过与最终业务采用是不同层级。

## 验证与同步

最低层级采用真实本地 Host、replay、tmux/tclsh 和隔离 Desktop。真实模型、SSH/商业 EDA 与客户 pilot 分开，不用于阻塞普通软件发布。最终通过数、审查发现、源码身份和 App 字节身份由同目录验收记录补齐。

App 候选为 `0.3.0-trial.18`，Ledger schema 29。候选内带两个 development Pack 的方法文件，以及只供本地 stand-in 示例用的 timing-probe；首次启动只安装缺失的方法，不覆盖已有 Pack、历史快照或客户资产。已有 Home 在任何准备/安装动作前先检查 Ledger；损坏、非普通文件或版本不匹配都拒绝，不改动旧资产。`trial-manifest.json` 分别记录 App 文件身份、三个 Pack 的包含情况和回滚引用；结构与实际打包 Host 启动检查完成前，它一直处于 building，不能被外部验证器当作合格候选。打包先从干净源码重建所有发行入口并比对身份，不把 development Pack 称为独立 seal。旧 home 不原地迁移；支持显式离线导入 v19–v28 到空目标，保留原输入字节。不要用旧 App 打开新 home；回滚使用旧 App 与原先保留的旧 home。导入 Ledger 本身不等于迁移或重新授权原生会话。

开发分工：主任务负责共享接线；Terra/Medium 的记忆与 UI 初稿后，针对已发现的 UI 时序/合同缺口由新 Sol/High 完成；Sol/High 负责原生 child、交互 Job 与关键独立审查。并行工作按文件归属进行，未新增开发模型成本计量；“零模型”仅指被测产品未请求真实模型。
