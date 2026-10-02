# Resident Engineering Agent 与 OpenCode Timing Fix 外包实施规格

Issue: [#82](https://github.com/lluzi/hima_harness_reforge_polishing/issues/82)
状态：已实现并完成一次真实工程试验；现场业务效果成立，原 live 接回仍诚实为 FAIL，后修复只完成 retained-artifact integration 验证。
作者基线：`b20ef44a9672f8c5a5ab645e49e0ef3446e2c0f7`，当前方法 ATCS `0.3.0`；旧 `0.2.10` 方法快照继续只读保留。

## Problem Statement

工程师希望在 HimaHarness 中把完整工程任务交给已有的强 Coding Agent，而不是由 Hima 重复组织细粒度修复团队。当前 Fix Timing 路线在 Hima 内组织六个原生分支、Operator 和一个 retained Timing Lead；模型缺少完整工程工作环境，业务研究容易被接口、范围和格式问题打断。已经跑通的固定小程序任务只能证明连接和基本工具反馈，未证明真正的 Hima 工程 Agent 会使用 OpenCode 完成业务。

用户已确认：引入按任务启用的通用 Resident Engineering Agent 能力，首个实现为 OpenCode；Hima Agent 真正委派、沟通介入、停止和接收交付。OpenCode 自主学习 playbook、分析、Coding、使用获准工具并组织自己的协作者。Pack 必须明确哪些节点可以外包。首个 timing 任务在 XTop 中用各种合理手段修到极致，输出工程脚本、最佳结果及残余原因；业务效果超过普通迭代 AutoFix，其他代价不参与胜负。尽力后仍有残余可以诚实结束。

## Solution

Hima 增加一项小接口、完整任务能力：工程 Agent 在 Pack 明确可外包的 act 节点，提交完整目标和必要上下文，调用 Site 上按任务启动的 OpenCode。Hima 复用现有 Run、node execution、Job、权限和产物记录；OpenCode 内部的研究、Coding、XTop 操作、团队组织和试验循环由它自己负责。

任务内可以发新信息、回答问题、纠偏、查看进展或请求停止；正常 Agent 间跟进不算开发者替它写答案。任务结束保留实际脚本、报告、执行轨迹与残余事实，释放任务进程和资源。没有长期驻场服务、项目记忆系统或固定内部团队。

同一升级同时交付平台能力与新版 ATCS Pack。新版方法用一个完整 `fix-timing` 工程节点替代 Hima 六席和 retained Lead 内层编排；保留已有设计身份、native analysis/common R1、结果读取和工程归档能力，并采用 XTop-only 交付，不强制新增 APR/提取/PrimeTime 阶段。本次不会修改旧 Pack 的物理签核语义。

2026-10-02 的真实 Run 中，OpenCode 在长驻 XTop session 内将 Hold 从普通 AutoFix 的 82 条修到 0 条，将 Setup 从 24 条修到 18 条，并改善 Setup WNS/TNS；18 条残余令 Goal 保持 false。原 live test 因 Host 未把 result 引用的 checkpoint/support tree落入 Campaign而失败。后续实现增加 Pack `artifactPrefix`、完整 preflight、不可变 revisioned support 和站点端 hash/copy；原 ATCS Reader 的 focused 合同已证明目录树重建与 tree digest 接受，但没有重跑现场。

## User Stories

1. 作为工程师，我希望把完整工程目标交给 Hima，从而由实际 Agent 安排外包工作。
2. 作为工程师，我希望 OpenCode 获得目标、约束、背景与资料，从而自主学习和选择工程方法。
3. 作为工程师，我希望用正常的 OpenCode Coding 与工具能力，从而不把它限制为两个文件和一个命令的练习执行器。
4. 作为工程师，我希望 OpenCode 可以自主组织内部协作者，从而不由 Hima 再复制一套内部团队。
5. 作为工程师，我希望任务按需启动、用完释放，从而无需常驻服务或长期项目主会话。
6. 作为工程师，我希望保留脚本和成果，从而任务进程释放后仍能复核和使用。
7. 作为工程对接 Agent，我希望看到外包能力及适用节点，从而知道自己拥有能完成完整工程工作的执行者。
8. 作为工程对接 Agent，我希望读取 Pack 对该节点的完整方法，从而自己形成真实工程委派。
9. 作为工程对接 Agent，我希望补充目标和上下文，从而委派不是开发脚本预写的固定小题目。
10. 作为工程对接 Agent，我希望提交后获得明确的执行身份和状态，从而知道任务是否实际开始。
11. 作为工程对接 Agent，我希望任务运行时仍能响应用户，从而长工程执行不占死对话。
12. 作为工程对接 Agent，我希望把跟进发到同一个任务，从而保留该任务的已有认识与成果。
13. 作为工程对接 Agent，我希望看到资料或权限问题，从而能答复执行者或向用户解释缺项。
14. 作为工程对接 Agent，我希望能请求停止并看到真实停止结果，从而不会把请求送达当成工作已停止。
15. 作为工程对接 Agent，我希望收到实际产物和证据，从而根据结果判断是否采用和继续。
16. 作为工程对接 Agent，我希望尽力交付与目标达成分开，从而残余违例不被表述为已清除。
17. 作为 Pack 作者，我希望明示可外包节点，从而平台不会按 Pack 名称或节点猜测执行方式。
18. 作为 Pack 作者，我希望复用已有工具、参数、知识和输出声明，从而不写第二套宽泛任务合同。
19. 作为 Pack 作者，我希望声明通用工程角色，从而方法不绑定 OpenCode 内部团队或 CLI 布局。
20. 作为 Pack 作者，我希望未声明外包的节点维持现有行为，从而升级不隐式改变其他方法。
21. 作为 Pack 作者，我希望声明输出如何回到原节点，从而外包成果能够继续被 Reader 和规则消费。
22. 作为 Site 管理者，我希望固定配置实际可执行程序和工具环境，从而模型不选择任意远程启动命令。
23. 作为 Site 管理者，我希望明确任务读写目录，从而执行者具备充分工作能力且不改共享原始资产。
24. 作为 Site 管理者，我希望正常范围内不反复审批，从而 OpenCode 可以自主执行而不是等待无人处理的确认。
25. 作为 Site 管理者，我希望范围扩展被明确报告，从而批准普通任务不等于授予全机器权限。
26. 作为工程师，我希望凭据由已有原生认证使用，从而无需把密钥交给模型或写入报告。
27. 作为工程师，我希望工作中断后核对真实执行再恢复，从而不重复启动或重放已执行的修复。
28. 作为工程师，我希望消息重试不会重复递送，从而一次介入不会变成两次操作。
29. 作为工程师，我希望失联或不确定副作用被如实报告，从而失败不能被改写成成功。
30. 作为工程师，我希望既有用户会话和任务不被清理，从而外包只控制自身执行。
31. 作为 Fix Timing 使用者，我希望 OpenCode 获得完整 R1 和资料，从而动态发现问题而非依赖写死的设计对象。
32. 作为 Fix Timing 使用者，我希望它可以选择各种合理 XTop 修复手段，从而不被固定 mutation 类型或少量步骤限定。
33. 作为 Fix Timing 使用者，我希望它能写和运行私有分析脚本，从而处理大报告、拓扑、placement 和库信息。
34. 作为 Fix Timing 使用者，我希望它测量、保留或撤销试验，从而交付最佳实际状态而非最后一次操作。
35. 作为 Fix Timing 使用者，我希望返回 logical/physical ECO 与复现材料，从而成果可实际使用。
36. 作为 Fix Timing 使用者，我希望记录前后时序和残余，从而修复效果来自实际 XTop 数据。
37. 作为 Fix Timing 使用者，我希望约束、场景和库身份不被偷偷更换，从而清除违例不是改写问题。
38. 作为 Fix Timing 使用者，我希望尽力后能交付残余原因，从而不可修问题也形成工程认识。
39. 作为 Fix Timing 使用者，我希望与普通迭代 AutoFix 比较修复效果，从而回答真实业务目标。
40. 作为 Fix Timing 使用者，我希望费用和调用次数不决定胜负，从而不会以小任务速度冒充修复优势。
41. 作为 Fix Timing 使用者，我希望本次交付不强制等待 APR/提取/STA，从而先证明用户选定的 XTop 工程能力。
42. 作为工程师，我希望 XTop-only 结果有正确范围说明，从而它不冒充最终物理签核。
43. 作为历史 Run 的拥有者，我希望旧方法、产物和判据不被改写，从而新 Pack 不破坏旧证据。
44. 作为产品维护者，我希望复用现有执行和记录模块，从而新增的是能力而不是另一套控制器。
45. 作为产品维护者，我希望通过实际 Agent 使用的 Host 接口测试，从而不能用手插成功记录证明委派。
46. 作为产品维护者，我希望真实 Hima Agent 发送的任务可复核，从而不是固定脚本替它委派。
47. 作为产品维护者，我希望能回滚新能力和新 Pack，从而问题发生时保留历史与本次工程事实。
48. 作为产品维护者，我希望每个提交同步远端并能对应候选，从而规格、代码和实际运行身份一致。

## Implementation Decisions

### D1. 一个现有执行职责上的 adapter

复用现有 act/tool → Fabric execution → Site Job → Channel → Ledger 路径。新增任务级 OpenCode adapter 和必要的当前 execution/Job 元数据；不新增 Harness 注册组件、独立任务实体/数据库、任务服务、graph engine、团队控制者或常驻 daemon。

原生 DSH delegation 仍服务其现有调用者，不虚构 OpenCode 为 native child。现有 Tcl interactive adapter 与 Operator 授权保持原语义，不把 OpenCode 聊天包装成一条 Tcl mutation。Workshop 仍是原有代码编写/执行行为；本切片不为了复用名称而改其含义。

### D2. Pack 的最小声明

在现有工具方法声明上增加可选 `outsourcing`：`role` 固定为通用 `resident-engineering-agent`，`reads` 引用已有输出，`knowledge` 引用已有知识材料，`artifactPrefix` 声明 result 以外工程文件在 Campaign 中唯一可物化的目录，`produces` 指向一个已有 Reader 的结果输出。历史快照缺 `artifactPrefix` 仍可读，但不得启动新的 resident work。目标、工作与完成说明复用工具 `description`，任务启动材料复用 `file`，输入及 Goal 绑定复用 `inputs` 和图参数，许可数量及固定启动入口复用 `licences`、`argv`。任务私有目录与执行身份由 Host 生成，不由 Pack 写全局句柄。

图仍使用现有 act 节点和 tool 引用；引用此工具的节点明确可外包。没有声明不得启动工程外包，也不按 Pack ID/节点名称硬编码。没有该字段的旧 Pack 保持原行为。外包与普通 `work` 对同一次 execution 互斥；工程 Agent 明确选择执行方式，不能两个入口各启动一次。该工具不得同时声明 Tcl interactive，避免两个不同执行协议混用。

验证 role、输出/知识/输入引用与当前 Site capability；目的不明或缺少必要材料时返回具体错误。第一版只为 tool 实现真实 consumer，不把可选字段泛化到 Workshop、Team 或其他节点类型。

### D3. 实际工程 Agent 入口

在现有 `hima_execute` 增加 `action: engineering` 与 typed `engineering.operation` 操作族 `start/message/status/cancel/delivery/release`。保持当前 run/execution/actor、owner epoch、control revision、requestId 校验。start 接收实际 Agent 形成的完整目标和补充上下文；Host 结合 Pack 声明、当前输入/知识与 Site 授权生成任务材料。模型不得替换启动程序、工作目录、凭据、既定约束或输出要求。

start 在已 begin 的可外包节点执行，返回当前 execution/Job 绑定的 task reference，迅速交回对话。status 与既有 context 同源；message 递送同任务新信息或介入；cancel 请求实际停止；delivery 收取并校验当前任务产物；release 在保留交付后关闭任务资源。完成节点仍通过既有 `complete` 和输出/规则路径，原生工具返回、CLI exit0 或模型“完成了”都不单独构成节点成功。

第一版通用范围是任何 Pack 显式声明的工程 act 节点，不按 timing Pack 特判；其任务类型可以是研究、Coding 或工程工具工作。复用现有 Run/execution 授权，不另外建立无 Run 的独立业务任务平台。

该能力必须进入真实 owning Agent 的系统说明、工具描述和当前节点上下文：它知道可外包完整工程工作，知道此节点允许调用，并能提供目标、资料和正常跟进。验收必须保留实际模型生成的委派，不能由脚本预写答案、ECO 或任务拆分。主 Agent 正常跟进不等于 DRI/DL 人工逐步指导。

### D4. 按任务启动的原生 OpenCode

Site 配置具体 executor，Pack 只声明角色。第一版复用 Site 的 bindings：一个 `engineeringCapabilities` 配置材料描述固定 wrapper/实际 OpenCode 可执行文件、版本、原生 profile/认证环境、模型、读写/工具策略及退出宽限；声明与文件受现有 Permit 决定。没有配置时报告 unavailable，不自动安装、迁移 DSH 或换模型。

Site wrapper 作为普通 Job 启动。首个 adapter 使用任务本地 OpenCode ACP/stdIO 会话，以支持完整 prompt、正在进行任务的消息/事件、native permission、cancel 和关闭；不依赖 DSH 官方一次性 ACP provider 来假装已有持续子会话。OpenCode 自己启动的内部服务/协作者属于该任务，任务关闭后退出，不注册为 Hima 常驻服务。CLI/profile 以 Site 实际环境为准，现场版本为 OpenCode 1.18.34 与 `deepseek/deepseek-flash`；普通 run/JSON 可作原生协议证据，但不能把每次 message 变成新任务。

OpenCode 直接使用 Site 既有 native config/auth；Hima 不再提供 provider broker、task token、净化 profile 或 permission-kind 分类。当前 native session 的普通 ACP permission 统一 allow-once，foreign session 拒绝。任务的真实保护边界来自 Podman namespace、Site Permit、当前 task 身份、Campaign只读来源和 task-private写区。原生认证因此对 OpenCode 自己的执行环境可见；这是正常 executor 信任边界，不得描述成 Hima 已对 OpenCode shell 隔离账户密钥。Hima 不把字面 credential 复制进 prompt、request、trace 或 result。

wrapper/adapter 只做环境准备、协议转换、状态与产物衔接、退出清理；不代替模型实施修复、预写完整 ECO、整理后重放模型答案或再造内部团队。协议实现优先复用原生 SDK/现有传输能力；新增依赖必须确为最小且兼容，不引入整个新运行平台。

### D5. 上下文、任务授权与工作环境

实际任务材料包含当前目标和固定约束、输入身份与可读文件、完整相关 playbook/工具资料、工作目录、正常工程能力及交付位置。不用当前设计名称编写通用方法；真实对象来自本次任务材料与工具发现。普通文件读写、搜索、Python/Tcl/工程脚本、测试和授权的 XTop 原生能力应可用，不继承旧 ATCS 13 原语、固定几步或单次 mutation 配额。

在当前 Run 的私有任务目录完整工作；原始设计、库、公共工具与他人工作区保护。明确外部读目录、私有写目录、执行工具/环境和实际文件隔离；只配置 OpenCode edit/read 规则不能声称 Bash 也被文件系统隔离。复用原生 OpenCode 权限与 Site 环境，验证正常工程访问确实可行，并验证受保护资产不被写入。

当前 native session 的正常操作预先可用，不反复等待无人处理的弹窗，也不在 Hima 中按 read/execute/other 再建权限语义。越界由固定 namespace、Site Permit 与任务目录拒绝；需要扩展这些外层边界时仍走既有管理员授权，不用聊天文字绕过。凭据由已有原生认证/进程环境使用，可能被受信任的 OpenCode进程及其工具读取；Hima 不把字面凭据注入业务材料、请求、轨迹或报告。工具版本、有效目录和 native 环境须按实际安装版本核对。

### D6. 既有事实与控制的加深

任务绑定当前 node execution/Job；必要信息是外部 session、协议、任务材料身份、已收消息、当前执行和交付引用，不建立另一套业务状态机。复用现有 launch intent、execution receipt、日志/文件与产物保留。Host→wrapper 的同任务消息可用当前 checked write/read plumbing 的任务本地 request/receipt 文件；唯一 requestId、完整帧和摘要对应后才接收，不追加任意 SSH 命令语言。

重复 start/message 返回既有事实，不产生第二任务或双重操作。失联、崩溃或重启先 reconcile 现存 Job/消息结果；不确定递送不能自动重发，不确定副作用不能自动重跑。Owner 改变或 execution 失效后旧调用无效，已有任务交接/停止按真实状态处理。

保留现有 Run pause 含义：阻止新工作，已启动 Job 可能继续形成事实，不假称瞬间停止。明确 cancel 工程任务或 Run 时向 native executor 与 owned descendants 请求终止，并确认实际存活范围；tmux 消失、消息送达和 cancel 请求不等于停止。未确认停止时报告 unknown/still-running，不启动冲突修复或假释放资源。正常结束先收交付再 release；删除执行句柄不删除工程材料，也不清理外来/用户会话。

### D7. 新版 ATCS：一个完整外包节点

以当前 0.2.10 为基线发布新 Pack 版本。保留方法身份、输入就绪和设计/约束/库/场景身份绑定，复用 native analysis、共同初始 AutoFix/common R1 和现有 native/export/parser 能力。以一个 `fix-timing` 外包工程节点替代六个 Hima 分支/Team、join/collect/compose 与 retained Hima Timing Lead；Opencode 内部怎么分工由它决定。

给真实 Hima Agent 完整任务：使用 common R1/current reports/playbook，在 XTop 中自主研究、编写和运行工程脚本，使用各种合理方法充分修复，测量、保留或撤销，交付最佳状态。允许 resize/VT、插入、拆分、移动、绕行及工具支持的其他合理技术，不以其中单一动作类型判断能力；不限制为指定修复答案。可自行调用正常 AutoFix 作为工程策略，但不能由开发者事后替它补修再归功。

当前围绕旧 fix 的 baseline observation/residual 工具仍含 PT，physical baseline 含 Innovus；新版必须同时换成保留的合格输入或 native XTop 来源，不只是断开尾部 implement。移除新路线的强制 physical-refresh、implement/extract/sta/physical/adoption 与固定 seats/slot knobs/匹配耗时假设。保留旧 helper 与旧方法快照，不追求本次清理死代码。

常规路线为：输入/身份与 native R1 → Hima Agent 外包完整 fix → 同任务必要跟进 → 实际结果 Reader → XTop 修复效果/目标和残余报告 → 工程交付/诚实结束。方法中声明此节点可外包及其材料、结果和完成要求，其他平台控制节点不被隐式外包。

### D8. 交付与业务结果分离

Pack primary result 使用已有 output/Reader，附带当前任务/执行、base/R1/选中状态身份；实际 before/after 原始 XTop 测量；导出的 logical/physical ECO、生成工程脚本、选中 checkpoint/复现说明；真实残余/失败与停止原因；材料与输出摘要及 native 轨迹引用。复用已有 native 解析和 `_eco_pair` 类身份检查，必要的新 result handler 留在当前 Pack flow/Reader 职责内。模型叙述不是唯一数值来源。

尽力交付可以完成工程节点，即使仍有违例；下游 Goal 判据如实保持未达成。未知/缺场景/约束改变/伪造数字/缺工程脚本不能宣布修清或优于对照。声明 goal 的 ambition 保留全部目标违例修复；最佳状态与残余事实可以诚实交付。无实际修改时仍交付可复现无效结果/脚本、真实 before/after 与原因，不制造虚假 ECO；提供合法 no-op 工程出口而不是缺输出伪装成功。

沿用既有 XTop predicted/estimated 意义。新增 Pack-local XTop 交付/goal/比较值，绝不用没有 DB/SPEF/PT 的数据填旧 final/signoff PASS；旧物理 Readers、规则和用户历史维持原义。

### D9. 只以修复效果验证 timing 业务

使用相同工程输入、R1、约束、库、场景和 XTop 条件的普通迭代 AutoFix作为参照，直到普通手段停止改善；复用其现有控制算法或匹配的保留证据。新能力本身不需要 nativeDSH/OpenCode AB，也不以单轮弱 AutoFix 当参照。

胜负由实际 XTop 前后 WNS/TNS、违例/残余及回归事实决定：明确在哪些目标改善，是否牺牲其他必须满足的约束，能否支持优于普通 AutoFix。同效果是 tie，证据不足是 unknown；不再用成本、速度或调用次数作为次级胜负。实际修复交付可成功而效果比较为 NEGATIVE/INCONCLUSIVE，不能为制造 PASS 反复运行。XTop-only 不构成最终物理签核；APR/StarRC/PrimeTime不作为本升级前置。

### D10. 小切片交付与兼容

依次做：通用声明/fixture和真实 Host 操作闭环 → 最小原生 protocol/目录/控制 adapter → 新版 timing 方法/Reader → 实际 Hima Agent 调用 OpenCode → XTop 效果证据。能在同一切片完成的职责一并做，不为每一处建立独立审批/review阶段。

保持 DSH 0.1.5-alpha.1/Cordis 4.0.2；不为装社区插件迁移 DSH。新增 helper/adaptor 文件允许，但不得挂载新 Harness 生命周期组件。只有现有职责确实无法承载且有反例，才重写范围说明必要新增。

旧 Pack 缺声明保持兼容；新安装的 Pack 明确新版本/digest；历史 Run 使用其保存方法，不能在运行中换字节。旧 six-seat/referee 覆盖保留为旧版本回归，不强行让新版满足旧编排。切片稳定后一次关键接口/权限/事实真实性复核；所有 commit 立即 push 并核对 remote SHA。恢复前一个 Harness 与明确安装的旧 Pack 可以回滚新任务，保留新任务结果/未知状态；不 reset 用户工作或覆盖旧 Run。

## Testing Decisions

用户已确认：主测试 seam 是现有真实 Host / `hima_execute` 的完整节点外包闭环。测试行为与真实调用者一致，不以源码字符串、伪造 completed ledger 记录或指定模型话术证明能力。直接 parser/protocol tests 用于低成本反例，不代替主闭环。

- L0/L1：有效/无效 Pack 声明与 output/context 引用，普通 Pack兼容；native raw report/result fixture、partial/no-op/unknown/missing/tamper场景。所有模型需要产生的文档先有可通过的格式与 Reader fixture。
- L2：当前真实 Host、存储、Job/Channel和当前 owning Agent 身份，外部原生协议进程 stand-in 作为唯一昂贵依赖替身。通过公开工具从 begin 到 start/message/status/delivery/release/complete；覆盖未声明节点、错误 actor/epoch、重复/失联、不确定消息、实际 cancel、受保护目录、保留的产物和 Goal未达成的诚实结束。至少一个真实 tool admission 路径，而不是只调用私有函数。
- 新 Pack dry path：同一公开入口启动生产 adapter 的协议替身，返回 native-source样本和工程文件，Reader/Goal/残余及归档可消费；明确无 Innovus/StarRC/PT启动，不使用旧六席成功注入证明新委派。
- L4 技术依赖：冻结候选已完成实际 Site OpenCode 1.18.34初始化、完整任务/同任务沟通、目录权限与停止/释放；人类纠偏后的 direct-native-auth/full-current-session-permission代码只完成本地确定性验证，尚未重新部署或 live 复验。不得用旧候选的 provider broker 现场事实替新代码背书。
- 真实业务验收：真实 Hima owning Agent 知道可外包能力，自己形成 timing 目标/上下文/playbook任务并确实调用 OpenCode；它独立研究和操作 XTop，实际工程交付可读取，主 Agent据证据接受/跟进/结束。保留真实委派、native执行、脚本、before/after与残余，再按 D9 判断效果。无开发者逐步补写修复方案。
- L3 仅在既有 UI/context/control 投影改变时补关键路径，沿用现有 driver和Catsights；不另造resident面板或录制体系。
- 每层失败只追最小直接反例；已有正确部分、配置、数据和 native证据复用。pass/fail/blocked/negative/inconclusive分别报告，未运行不算通过。

具体可修改文件、现有测试先例、必要执行命令和切片依赖见 [实施入口与验收矩阵](IMPLEMENTATION-MAP.md)。本规格产出的文档只做静态差异与引用检查，不执行上述产品测试。

## Out of Scope

- 常驻工程服务、跨任务项目记忆/长期主会话、通用 Agent 服务/数据库/调度器。
- 在 Hima 重建 OpenCode 内部 DRI/DL/FL/固定团队，或固定三/六席和小mutation数量。
- nativeDSH vs OpenCode AB准入、单纯hello/smoke/步骤数的工程价值宣称、速度/费用胜负。
- 本升级强制 RTL-to-GDS/APR/StarRC/PrimeTime与物理签核；改写旧 final语义。
- 广泛重构、新 graph类型、新 Channel 任意shell语言、全局权限/认证改动、DSH升级或自动安装CLI。
- 第一版同时接入其他CodingCLI或强制改造所有Workshop/Team；任务之外的独立界面。
- 当前 user-owned/manual会话、旧方法/Run、其他工程任务的清理或移交。

## Further Notes

本次实现与独立复核按用户明确覆盖使用 GPT-5.6 Sol/high；产品 Hima/OpenCode 使用 DeepSeek Flash。模型选择、代码通过、provider可用都不能代替 XTop 工程效果与 Reader 接回。

已确认的需求、术语和责任取舍来自 Issue82、CONTEXT、产品定义、ADR-0017。现场已证明 Resident 的 XTop效果优于普通AutoFix；这不是最终物理签核。后续物化修复与认证/permission简化没有重新部署，不能描述成新的 live end-to-end PASS。
