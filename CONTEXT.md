# HimaHarness

面向芯片设计工程探索的业务语言。

## Language

**HimaPack**:
由产品 AE、PE 或方法学专家制作的透明、固定格式业务能力交付资产；在声明的输入、指定工具和 Site 能力满足时，承载方法、测量、判断、知识及 AI 探索位置，而不绑定某个客户 design 或精确工具版本。
_Avoid_: 插件、脚本集合、固定 design 自动化（作为整个方法的同义词）

**Pack 状态**:
Pack 作者对其交付成熟度的声明；状态供用户判断和界面展示，不改变 Pack 的格式、检查或 Runtime 执行逻辑。
_Avoid_: 另一种 Pack 类型、独立 Runtime 分支、由 Harness 推断的发布承诺

**Pack Ontology**:
HimaHarness 核心词汇与 Pack 领域词、别名之间的稳定语义映射，覆盖实体、状态、工具、知识来源和证据结果；它帮助 Agent 理解和展示，不替代 Judge 或 Runtime 规则。
_Avoid_: 通用 ontology engine、模型自行改写的规范、数值判断规则

**业务能力**:
客户购买的可验证业务结果：开源模型通过 HimaHarness、HimaPack 与配套 EDA 工具完成一项真实芯片设计任务。
_Avoid_: Harness、模型、工具或许可证本身（作为客户购买结果的同义词）

**HimaGuide**:
贯穿产品认知、Pack 使用、Site 建立、输入准备、Campaign 执行和结果理解的交互角色，主动取得系统可发现的信息，只在人类判断或任务受阻时向用户提问。
_Avoid_: 手册、表单向导、只回答问题的聊天机器人

**研究闭环**:
围绕工程问题进行分析研究、生成策略、组织试验，并根据试验结果反馈继续探索的连续工作。
_Avoid_: 固定流程执行、单次工具运行（作为整个闭环的同义词）

**Campaign Agent**:
绑定一个 Campaign 持久 Run、依据参考运行图和当前事实执行节点工作的可见 AI 对话主体；它是该 Run 的唯一业务 owner，用户切换到其他会话不改变其所有权。
_Avoid_: 隐藏执行 Agent、Fabric 的旁观者、多个并行 Run owner

**Side Talk**:
与 Campaign Agent 同处一个 HimaHarness、可以并行进行普通对话或 Coding 的独立非 owner 会话；它可以查看 Campaign，只有显式 handoff 后才能接管执行。
_Avoid_: Campaign 的第二执行者、右侧运行状态面板

**业务 Subagent**:
接受明确委派、以独立上下文和会话完成分析、研究、Coding 或获准操作的协作者；工程师可以独立查看其任务、保留的上下文、transcript 和产物。它的局部执行权限不等于 Campaign 的整体业务所有权。
_Avoid_: 后台 Job、不可查看的主 Agent 摘要、默认第二个 Run owner

**产品工作模式**:
工程师在同一工作区选择的任务入口与主要展示方式，当前包括 Campaign 与 Data Insight 两种同级模式。
_Avoid_: DSH 工具组合模式、另一套 Runtime、只切换视觉主题

**Campaign 工作模式**:
以准备、推进和观察一次 Campaign 为中心的产品工作模式，Live Run 是其中的执行视图。
_Avoid_: 所有数据浏览的强制入口、Campaign 业务实体本身的替代定义

**Data Insight 工作模式**:
以数据分析、可交互比较、发现和证据理解为中心，与 Campaign 同级的产品工作模式；需要实际计算或行动时关联既有受控执行能力。
_Avoid_: Live Run 子页、独立 BI 应用、第二份数据或执行权威

**HimaFabric**:
承载参考路线、运行事实和执行约束的业务基础设施，为 Campaign Agent 提供可追踪、可恢复的运行环境。
_Avoid_: 独立业务决策者、第二执行主脑

**知识资产**:
由研究闭环产生、供用户持续积累的研究结论与方法经验，成功结果和对失败的认识均可构成其内容。以含有证据、数据、环境声明的详实技术报告和必要支持材料交付，核心算法等方法材料属于交付内容。
_Avoid_: 成功报告（作为唯一含义）、无依据的解释

**知识基础设施**:
HimaHarness 软件离线自带的文档到知识能力，读取 Pack 内置知识并承载用户追加材料；材料在其获准所在环境中处理和读取，普通用户不负责部署独立知识服务。
_Avoid_: Pack 的一个 Markdown 文件、客户必须维护的 RAG 服务

**当前知识**:
用户为当前工作追加的临时文档知识，与相关会话、Campaign 或 Site 一起使用，不自动写回 HimaPack 方法或内置知识。
_Avoid_: Pack upgrade、共享方法知识、永久客户知识库（作为默认含义）

**Harness 兼容版本**:
HimaPack 声明的最低 HimaHarness 版本；后续 Harness 版本对既有 Pack 保持向前兼容，Pack 状态不参与兼容或执行判断。
_Avoid_: 精确版本锁、能力协商矩阵、Pack 状态门

**Pack 安装**:
将一个确定版本的 Pack 放入 HimaHarness 并运行其原样内容；新版本是另一个需要明确安装的包，不存在改变已安装 Pack 的自动更新生命周期。
_Avoid_: 后台自动更新、远端方法漂移、运行中替换

**现场证据**:
保存在客户环境中的 Campaign、工具、日志、输入身份、报告和 debug 材料，用于复核、恢复与问题定位；产品默认不自动上传这些材料。
_Avoid_: 遥测摘要、自动外发的诊断包、只保留成功结果

**Campaign Preparation**:
HimaGuide 在 Campaign 建立前完成的 Pack、Site、输入、知识和最小工具检查；全部必要条件就绪后才创建 Campaign 和持久 Run。
_Avoid_: Campaign 的第一批实验节点、正式业务结果、要求用户填写的配置表

**权限层级**:
用户为 DSH Agent 选择的本机操作范围；最高层级仍受 Hima Site Permit 和删除红线约束，不改变 Campaign 的远端业务权限。
_Avoid_: Site Permit、凭据、绕过业务约束的开关

**参考运行图**:
Pack 提供的业务环节与依赖关系所构成的方法基线，AI 不改写或删除它；研究可基于它回溯、调整节点策略并生长附加工作。
_Avoid_: 实际执行轨迹（作为同义词）

**执行轨迹**:
一次 Run 实际经过的执行、回溯、策略变化和研究分支的记录，保留已经发生的过程。
_Avoid_: 参考运行图、未来试验计划

**回溯**:
在研究中回到既有环节调整策略，保留历史，并重新执行受影响的后续工作。
_Avoid_: 删除历史、只移动进度标记

**运行介入**:
工程师直接或通过 Agent，对正在进行的 Run 的明确业务环节提出检查、暂停、修正或继续要求，并以实际执行状态确认其效果。
_Avoid_: 旁观运行、取消整个 Run（作为所有介入行为的同义词）

**Campaign**:
在一个 Site 上使用一个 HimaPack、围绕明确 Goal 开展的一次真实、有边界的芯片设计业务活动；它是用户组织和理解工作的中心，无论目标是否达成都留下事实。
_Avoid_: Research、Job、会话、Run（作为该业务实体的名称）

**Run**:
执行一个 Campaign 的运行实例和基础设施工具，包含中断恢复或解除阻塞后的继续执行；用户完成的是 Campaign，而不是把 Run 本身当作业务目标。
_Avoid_: Campaign、业务结果、Attempt（作为同义词）

**Job**:
由工具在 Site 上启动的一项 EDA 或计算作业，拥有自己的身份和生命周期。
_Avoid_: Run、Campaign

**Site**:
承载 Campaign 作业的客户 EDA 运行环境，由 HimaGuide 通过客户已有的系统访问权限发现并保存为可检查的安全配置。
_Avoid_: 一台服务器（作为完整定义）

**Matched Comparison**:
在流程、设置和工具完全一致、唯一变量为新增 Cell 时，对原方案和采用新 Cell 的方案进行的可比物理实现；最终数据库中的实际采用和更高 Fmax 构成足够的业务证据链。
_Avoid_: 重复性统计试验、噪声估计、仅 Cell 级指标、改变其他设置的对比

**Design State**:
某一优化迭代中，目标设计的网表、Library、约束、timing endpoint、可用物理上下文和已接受修改共同构成的事实快照；所有边际收益都以它为条件。
_Avoid_: 跨设计通用状态、只有网表文件、商业 EDA 的 session

**Design Information Graph（DIG）**:
从同一 Design State 投影出的异构设计关系图，把逻辑依赖、timing propagation、placement、互连寄生、clock关系和跨阶段 lineage 绑定在共同身份上，供 Opportunity Mining 使用。
_Avoid_: top-N timing path 列表、普通 instance adjacency graph、第二套设计事实源

**Phase DIG Snapshot**:
同一设计在一个明确流程 checkpoint 上的不可变 DIG；place 与 post-route snapshots 使用同一 schema、各自保留完整身份，不能互相覆盖或冒充同一物理图。
_Avoid_: 一个随流程原地更新的可变图、只有阶段名称没有 checkpoint hash

**CrossPhaseMap**:
连接 place 与 post-route DIG snapshots 的有证据 correspondence，允许一对一、一对多、多对一、semantic-region、ambiguity 和 absent；它把 Opportunity 投影为候选搜索区域，不直接产生 ECO target。
_Avoid_: instance-name 字典、强制 point-to-point 映射、自动选择一个歧义匹配

**Graph Annotation**:
绑定一个 DIG snapshot hash 和明确 subgraph scope 的派生信息，可记录结构指标、Opportunity、局部代理、决策或商业响应；它追加新认识但不能覆盖 Innovus 基础事实。
_Avoid_: 直接改写 graph facts、没有 producer/input identity 的缓存、把 proxy 写成商业事实

**LocalWindow**:
从一个 DIG snapshot 按 seed region、前后 trace、endpoint alternatives 和所需属性投影出的有界子图，是逻辑、物理和 timing 免费代理的共同输入。
_Avoid_: 每个代理自行重读全设计、没有 boundary/external load 的截断网表、完整设计 QoR 预测

**Endpoint Frontier**:
同一 timing path group 内，slack 接近当前最差值的一组唯一寄存器 endpoint；它们共同决定当前瓶颈，不能用一条 timing path 代替。
_Avoid_: top-N path 行、单个 endpoint、所有寄存器的无差别集合

**完整 Endpoint Frontier**:
除唯一 endpoint 及其 slack 外，还包含每个 endpoint 下可能迁移成最差路径的 launch path/timing cone；只有显式完备的 frontier 才能开启 E0，普通 top-N 报告必须标记为 sampled。
_Avoid_: 报告里每个 endpoint 恰好出现一次、把 path-family 归一化当作完备性

**Opportunity**:
从当前 Design State 的逻辑或物理结构中识别出的可评估改造位置，尚未授权修改设计，也不自带收益结论。
_Avoid_: Cell、已接受 Action、实验结果

**Slack-harvesting Opportunity**:
位于 primary timing frontier 外、具有明确时序余量的逻辑与物理内聚区域，可在保持 guard band 的条件下换取面积、线长、功耗或拥塞改善；它不自带 Fmax 收益声明。
_Avoid_: critical-path optimization、用面积收益替代频率收益

**Optimization Action**:
绑定具体位置、实现方式、影响 endpoint、成本、冲突和回滚的候选设计修改；可以采用单输出、多输出或物理合并实现。
_Avoid_: 抽象算法名称、Cell 类型、没有位置的策略建议

**ECO-only Action**:
由 Framework 明确写入网表且商业综合/物理优化不负责重新发现的多输出或物理合并 Action；商业观察必须保留该 ECO 实例，若工具删除则该 arm 只能说明 non-adoption，不能归因 Cell 收益。
_Avoid_: 允许优化器静默展开后仍声称 custom Cell 被采用、把 dont-touch 扩展到无关 foundry logic

**Custom Cell ECO Integrator（CCEI）**:
把已冻结的 Optimization Actions 和 Cell Demand 落实到 place 物理状态中的局部重综合能力；它根据 post-route anchors 在有界邻域重新发现 single/multi-output function 的实际引用位置，再负责位置种子、局部合法化、证明、保存和回滚。
_Avoid_: 新的执行 Agent、全量逻辑综合器、依赖精确 instance cluster 的 point-to-point ECO、重新冷启动 placement

**局部免费代理**:
在一个有界逻辑与物理窗口内比较 source cover 和 candidate cover，输出局部 margin、风险与不确定度；它用于阻止低质量 Action，不预测全设计最终 Fmax。
_Avoid_: 商业 QoR 模拟器、完整 P&R 替代品、跨设计 MHz 预测

**Action Portfolio**:
在同一 Design State 上共同评估、互不冲突，并以推动整个 Endpoint Frontier 为目标的一组 Optimization Actions。
_Avoid_: 独立 gain 的简单相加、Cell 清单、并行商业试验分支

**Cell Demand**:
由已选择 Action Portfolio 反向归纳的 Standard Cell 功能、电气、接口、物理和应用方式需求；它决定要生成什么 Cell，而不是由预先枚举的 Cell 反向寻找用途。
_Avoid_: 候选 Cell 目录、Library 本身、一个设计位置

**Marginal Gain**:
一个 Optimization Action 在当前 Design State 和已接受 Actions 条件下，对 endpoint frontier、WNS/TNS 及成本产生的增量关系；每次接受 Action 后必须重新计算。
_Avoid_: 单条 path 的局部 delay、从初始 baseline 独立计算后直接累加的收益

**Commercial Label**:
Matched commercial flow 对一个 Action Portfolio 在明确 Design State 下产生的采用、route survival、WNS/TNS、PPA、DRC 和限制条件记录；用于改善后续因子和选择，不变成跨设计收益承诺。
_Avoid_: 通用 QoR 预测、单颗 Cell 的固定收益、没有条件身份的成功或失败标签

**系统辨识**:
根据局部代理输入与 Commercial Label 的条件化关系，更新 Action 风险、模型不确定度、path migration 和下一轮 trust region；目标是改善闭环决策，不拟合跨设计固定收益。
_Avoid_: 训练商业工具替代模型、把单次结果外推成普遍规律

**试用版**:
已经接近正式产品、主业务路径和跨同等环境迁移可用的候选版本，只允许少量可快速修复且不破坏任务、控制、数据或证据的缺陷。
_Avoid_: 工程演示、机制验证包、需要开发者预配置才能运行的版本

**Golden Flow**:
用于学习业务方法和核对 HimaPack 行为的参考工程流程。
_Avoid_: HimaPack、探索目标、客户运行 Pack 的必要输入

**Goal**:
一次 Campaign 的主要目标及其声明的约束，含义明确、可检查，在该 Campaign 内保持不变。
_Avoid_: 策略、执行命令
