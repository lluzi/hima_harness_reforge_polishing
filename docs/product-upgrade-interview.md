# 真人试用后的产品升级访谈

状态：进行中。本文记录 2026-09-14 开始的产品升级访谈决定，不代表实现完成或产品验收。
访谈以现有 HimaHarness 架构和代码为起点，目标是升级已有产品能力，不重新定义一套产品。

## 第 1 轮：产品根节点

### 已确认

1. **Campaign 是用户中心。** 用户做的是一次真实业务 Campaign；Run 是执行 Campaign 的工具，不是用户理解产品的中心。
2. **首个攻坚场景。** 以新 design 上的定制 Cell 机会发现、生成、表征、采用和完整物理对照为首个核心场景。它跨阶段、跨领域和多个工具，足以证明能力。
3. **客户购买业务能力。** 客户购买的是开源模型、HimaHarness、HimaPack 和未来配套 EDA 工具共同交付的真实芯片设计结果，而不是其中任一技术要素。Harness 与配套 EDA 工具共同形成能力锁定。
4. **Pack 作者与用户分离。** Pack 通常由 EDA 产品 AE、PE 或方法学专家制作；日常用户使用独立交付的 Pack，不负责把一项既有人工流程先做完再交给系统自动化。
5. **Pack 的承诺以生产要素为准。** 输入、输出、工具和环境能力达到 Pack 声明要求时，任务应可执行。工具版本不是默认锁定条件；兼容性由能力和实际检查判断。
6. **不要求用户选择模式。** 用户表达任务，HimaGuide 和系统选择普通 Coding 或 Campaign 所需能力。
7. **HimaGuide 主动完成 onboarding。** 用户不承担固定的最小输入表；安装 Pack 后可以直接询问用途、条件和运行方式。HimaGuide 主动发现、解释和提问，只把确实需要用户判断的事项返回用户。
8. **Site 由 HimaGuide 辅助建立。** 用户可能只提供 SSH 地址、账号和少量服务器说明；HimaGuide 应像真实工程师一样进入环境、读取文档、发现能力并创建 Site 声明。
9. **权限按阻碍申请。** 系统先在安全沙箱和已有权限内推进；删除是红线。高风险配置变化或大批 EDA 任务不作为默认动作，只有任务确实无法继续时才请求额外授权。
10. **检索由系统负责。** 用户不负责指定每次检索范围。Agent 应知道已有知识、在需要时主动检索，并将不同用户、design、工艺或版本的材料按来源和适用条件用于思考；权限仍决定可见性。
11. **知识随产品和 Pack 交付。** 普通用户不部署或配置独立知识服务。Pack 携带自己的知识；知识基础设施由 HimaHarness 自己提供，并在 HimaHarness 所在环境中运行。
12. **会话持续可用。** 没有 Campaign 时是普通 Coding Agent；有 Campaign 时仍可继续对话和做其他工作。Campaign 异步执行，需要用户判断时主动通知，关闭运行视图不停止执行。
13. **正向收益的来源。** 首个价值证明必须来自定制 Cell 的最终物理采用，并建立定制 Cell、采用和最终收益之间的证据关系。
14. **试用版接近正式产品。** 允许极少量可快速修复的缺陷；在同等环境的另一服务器上应能运行，对 RTL 或顶层端口差异具有强适应能力。
15. **持续升级授权。** 团队在现有架构下自主打磨模块和实现；改变产品或架构定义由用户决定。Pack 方法的默认版本可由指定 Pack Owner确认，具体授权在后续轮次继续澄清。

### 本轮暴露的待澄清分叉

- 既有决定要求“同一个对话 Agent”拥有业务执行；本轮又要求 Campaign 执行不占用用户持续聊天。需要确定一个 Agent 的准确身份、会话和并发关系。
- “权限允许时可使用跨用户、跨 design、跨工艺知识”与既有客户资产隔离要求需要统一成可执行的授权和来源语义。
- “知识服务部署在服务器内”“Pack 知识库在 Desktop 本地运行”“运行在 HimaHarness 所在机器和服务器上”包含多个可能部署位置，需要确定一个产品模型。
- Pack 以能力而非版本匹配，需要定义工具能力检查、兼容失败和 adapter 归属。
- 首个正向收益必须来自最终物理采用，还需定义 matched baseline、噪声、功能与物理约束的验收门。

## 第 2 轮：执行、知识、Site 与价值门

### 已确认

16. **并行会话采用现有 DSH 能力。** 参考 Codex：Campaign Agent 执行时，用户可在同一产品内新开 Side Talk 继续其他对话。代码核查确认 DSH 已支持多个 live root Agent/Session、原生 New Session、打开 owner conversation 和显式 handoff，不需要第二个 Hima Agent Loop；仍需一个 L3 场景验证切换会话后原 Campaign Agent 持续 live、非 owner 不获得执行权。
17. **一个 Campaign 一个持久 Run。** Run 只服务该 Campaign，不再用多个 Run 表达对照、恢复或探索，以控制管理成本。
18. **模型接口兼容客户部署。** 大部分客户使用服务器内部署的 DeepSeek 模型服务；研发可继续使用 DeepSeek API。客户提供新的内部 base URL 时应可替换而不改变产品行为。
19. **内置知识属于产品资产。** HimaHarness 与 Pack 自带完成业务所需的知识，不依赖客户理解其 design 或提供先验方法。内置知识基础设施运行在 HimaHarness 本地环境。
20. **支持通用文档到知识。** 用户可以追加文档；EDA 服务器上的材料必须在该服务器上提取和读取，不能为了索引移出。文档到知识能力需要可在材料所在 Site 工作。
21. **系统权限就是访问授权。** 芯片研发环境以账号和目录权限控制访问；进程能够读取的目录不再要求另一套逐人授权。检索结果仍须保留来源和适用条件。
22. **工具名明确、版本推荐。** Pack 至少声明 Design Compiler、Genus 等具体工具；给出经过测试的推荐版本而不锁死版本。同一工具的其他版本先由 Agent 查手册、工具目录或 man 自主适配，失败时报告，必要时由 Pack Owner现场升级 Pack。
23. **凭据保存由用户选择。** 遵循业界安全存储惯例；用户选择保存时创建可见、可修改和升级的 safe profile。
24. **最少打扰。** 删除保持红线；其他额外权限只有任务受阻、无法继续时才请求。
25. **以 Matched Comparison 判断收益。** 流程、设置和工具一致，采用新 Cell 的方案得到更好 PPA，且事实链条合理，即构成足够结果。不要求重复运行、估计噪声或排除一切可能因果。
26. **试用版缺陷分界接受。** 主业务、安装、控制、数据、证据和同等环境迁移不能有阻塞；只接受少量可恢复、可快速修复的问题。
28. **Pack Owner 在平台限制内升级 Pack。** AE、PE 或方法学专家按确定的 Harness 能力制作和升级 Pack；只有需要改变 Harness 架构时返回用户确认。
29. **保留当前 prerelease。** 不删除现有 Release，作为持续迭代历史保留。
30. **下一候选必须带可用内容。** 接受产品知识、真实 Fmax-DTCO Pack、Pack 知识、参考图、Pack 入口、Site 入口和明确教学示例的最低交付集合；不携带客户私有资产或伪造结果。

### 未回答与新分叉

- Q27“同等环境”的能力等价标准本轮未回答，保留到下一轮。
- Q20 同时要求本地内置知识和 Site 内处理客户材料，需要定义知识索引、检索结果及原始材料分别留在哪里。
- Q21 的系统目录权限与现有 Hima Permit 的关系尚未确定：Permit 是额外读取授权，还是只负责限制写入和执行。
- Q25 以 PPA 改善为结果，还需定义一个指标改善、其他指标退化时的 Goal 表达和试用验收。

## 第 3 轮：权限、对照与产品携带能力

### 已确认

27. **同等环境按能力判断。** 不按 IP、路径或精确版本判断；指定工具、许可证、PDK/库输入、Channel 行为、资源和最小 probe 满足 Pack 即为同等环境。第二 Site 由 HimaGuide重新发现，不复制原 Site YAML。
31. **HimaGuide、Campaign Agent 与 Side Talk 分层。** 所有对话具备 HimaGuide/Coding 能力；绑定 Campaign 的可见会话成为唯一 Campaign Agent，其他会话是非 owner Side Talk，显式 handoff 才转移执行。
32. **应用内通知足够。** Campaign Agent 保留完整上下文；当前活动会话和 Live Run 提供提醒与返回入口，不要求操作系统通知。
33. **系统权限允许读取和传输。** 账号和目录读权限就是实际允许；通过跳板机访问不改变此原则，系统不增加一套阻止已获系统权限读取或复制的授权流程。
34. **两种知识来源、一个产品。** HimaHarness/Pack 使用自有知识体系；Site 私有知识由 Site 提供接口，Hima可以像 Coding Agent 一样对接。Pack 只声明知识类别，不关心存储位置。
35. **权限层级复用 DSH。** 参考 Claude Code、Codex、OpenCode 和 DeepSeek Harness 的既有权限分级；允许最高权限模式，也提供更受限层级，不另造一套普通用户授权体系。
36. **现场 adapter 留在 Campaign。** Agent 可在私有 workspace 中适配和验证；成功后形成 Pack upgrade candidate，由 Pack Owner确认，不能直接改已安装 Pack。
37. **首版只做当前工具栈。** 不要求同时支持其他综合或实现工具；未来 adapter 另行讨论。
38. **Fmax 是唯一首要收益指标。** 其他 PPA 指标允许变化；本 Campaign 只要求证据显示新增 Cell 后 Fmax 提升。
39. **物理采用看最终数据库。** 最终 route database 中存在新 Cell，并且下频率结论的最终阶段使用该数据库，即构成采用证据。
40. **唯一变量只能是新 Cell。** Matched Comparison 的流程、设置和工具全部一致，不允许通过其他参数或流程变化获得提升；否则比较数据不可信。
41. **知识广泛检索、分级使用。** 接受按来源与适用条件表达当前、跨 design、跨版本和共享经验；当前结论仍由本次结果决定。
42. **知识后台无用户运维。** HimaHarness 可以自动部署和管理随产品携带的后台进程；用户不配置数据库、Embedding、端口或生命周期。
43. **未来 EDA 工具不扩大当前范围。** 先完成当前 Harness 与 Pack 任务；自研工具 roadmap 建立在本产品已经产生业务能力之后。
44. **当前只交付 macOS。** Linux/Rocky/CentOS EDA 环境留作未来迁移规划；当前 Desktop 工作只要求 macOS。

### 新分叉

- 系统权限作为实际授权已经确认；仍需决定最高 DSH 权限是否可以绕过 Hima Site Permit 和删除红线。
- EDA Site 私有材料可按系统权限读取和复制；知识运行位置仍需根据“Pack 自有知识本地、Site 私有知识走对接接口”确定统一 URI、引用和缓存语义。
- Fmax 是首要收益且其他指标可变；仍需确认功能错误、无效时序约束或不可实现物理数据库是否允许被报告为有效 Fmax 结果。
- 当前工具栈范围明确，但 Pack 对工具小版本差异的现场 adapter、测试和升级候选需要转成具体契约。

### 代码事实补充

- 当前 Hima profile 已继承 DSH session 级 permission presets、sandbox、approval 和 credentials，无需另建权限系统。锁定版本内置 `workspace-write`（workspace sandbox + ask）和 `danger-full-access`（无文件 sandbox + never ask）；profile 可以增加 `read-only` 等 preset。这里的 `never` 表示审批请求自动拒绝，不是自动允许。
- DSH 权限控制本机 Agent 工具的粗粒度 file-effect；Hima Site Permit 继续控制特定 EDA Site 的 read/write roots、Pack wrapper 和固定 Channel verbs。两者不能互相生成或覆盖。
- SSH 继续复用用户 OpenSSH 配置、key 和 agent；需要保存的模型等凭据可以使用 DSH credentials provider，secret 不进入 Site 或 Pack。

## 第 4 轮：Preparation、Pack 形态与试用签收

### 已确认

45. **最高权限仍受业务约束。** 接受 Observe、Standard、Full 三层方向；Full 不绕过 Hima Site Permit和删除红线。
46. **Fmax 结果保留最低真实性门。** route 正常完成、数据库与 timing 身份一致、新 Cell 有有效实例、A/B 输入和设置一致，且不存在已知会使结论失效的约束或执行故障。
47. **HimaGuide 提出 Campaign。** 用户用自然语言表达任务；HimaGuide 完成检查并给出简短 proposal，用户一次确认后当前会话成为 Campaign Agent，高级运行参数不作为默认入口。
48. **复用现有侧栏。** Campaign 身份叠加在现有 DSH Session 行，不新增 Campaign 管理系统；Run ID 留在诊断层。
49. **导航不改变执行。** 关闭 Live Run 或切换 Side Talk 不停止 Campaign；退出 App 后本地 Agent停止新决策，已启动的远端 Job继续，重启后恢复；只有 Pause、Stop、End 改变 Campaign 状态。
50. **先 Preparation，后 Campaign。** Pack、Site、输入、知识和最小工具 probe 全部完备后才建立 Campaign，避免把准备错误变成无意义的业务运行。
51. **Site 自动保存、凭据可选保存。** 发现完成后保存可修改的 safe Site profile；secret 与 Site 分离，用户决定仅本次使用或安全保存。
52. **知识归属自动选择。** Pack、用户 supplemental、Campaign 和 Site knowledge 按来源归属；HimaGuide 只在归属含糊或分享时询问。
53. **Harness 软件与 Pack 分开交付。** Pack 使用固定格式封装自己的知识库，HimaHarness 负责读取；产品本身不与 Pack 打成一个交付物。
54. **Pack 状态不分叉 Runtime。** Pack 作者声明开发或其他状态，界面展示该状态；所有状态使用同一种 Pack 格式、检查和执行逻辑，不增加 Runtime 负担。
55. **团队先完成低层产品验收。** 下一候选先按干净安装、无手册、Site 发现、新 design、Matched Comparison、Side Talk 和控制标准自行测试；用户最终亲自签收，并把注意力放在品味和高级产品问题上。

### 新分叉

- Pack 固定知识格式需要确定原文、结构化内容、索引和可重建关系；Q53 没有直接回答是否完全离线或允许自动取得本地模型。
- Pack 状态由作者声明但不改变 Runtime，还需确定状态 vocabulary、测试证据和界面信任表达是否完全自由。
- Preparation 不创建 Campaign，需要定义失败、恢复、缓存和可审阅结果怎样保存，同时避免引入新的用户管理对象。
- Fmax 是唯一收益指标且其他 PPA 可变化，仍需确认其他 PPA 是否必须完整报告，以及功能/物理有效性的最低门。

## 第 5 轮：Pack 固定格式与知识交付

### 已确认

56. **统一使用 HimaPack/Pack。** 产品能力资产称 HimaPack 或 Pack；Package 只表示磁盘发布包，不增加用户领域概念。
57. **加深现有 Pack 格式。** 接受 identity、version、status、方法文件、contract、graph、tools/readers/rules/choosers、知识原文/manifest、可选索引、测试记录和独立 run-assets 的既有目录形态；没有必要时不新增交付件。
58. **Pack 当前保持透明。** 安装后方法、知识、图、规则和算法可读，不采用不透明加密 Pack。
59. **知识引擎随软件离线提供。** 接受 Harness 携带 parser、索引、检索 runtime 和基础本地能力；不把模型或知识服务配置交给用户，也不把引擎重复放进每个 Pack。
60. **用户文档只进入当前知识。** 追加文档作为当前、临时知识使用，不写回 Pack，不因该特性改变 Pack 方法、digest 或产品结构。
61. **Pack 状态由 ontology 辅助规范。** 提供推荐词汇但不强制；AI 可将不清晰作者词汇映射为稳定语义，同时保留原声明。状态不改变 Runtime。
62. **其他 PPA 完整报告但不作门槛。** Fmax 是成败指标；能取得的面积、功耗、拥塞和物理信息仍如实展示，缺失标为未测量。
63. **Preparation 不新增管理对象。** Site profile、实时 Pack check 和当前 HimaGuide proposal draft 承载准备结果；确认时写入 Campaign，相关输入变化使检查失效。
64. **Golden Flow 不是客户输入。** 客户提供真实生产资料；Golden Flow只用于 Pack 作者学习、开发、校准和测试方法。
65. **模型配置完全归 DSH。** HimaHarness 直接使用 DeepSeek Harness 当前选择和配置的模型，不为 base URL 或部署位置增加另一套兼容层或验收主线。
66. **作者能力保留但不占主路径。** 普通用户看到安装、理解和运行；Pack 作者继续使用现有 authoring pipeline，本轮只修复阻碍当前 Pack 的问题。
67. **兼容使用普通最低版本依赖。** Pack 声明最低 Harness 版本，Harness 工具版本向前兼容；不建立严格 capability negotiation，Pack 状态不参与执行判断。

### 新分叉

- 用户明确要求建立稳定语义体系和 ontology，仍需确定它覆盖产品词汇、Pack 状态、工具名称、知识类别、证据类型还是全部；优先复用 `CONTEXT.md`、Pack semantics 和现有字段，不默认建设 ontology engine。
- 当前知识不进入 Pack，但“临时/当前”的恢复、自动清理和跨会话可见范围尚未确定。
- Pack 知识引擎随软件离线提供，仍需选择原文、结构化文档、倒排/向量索引和本地模型的最小组合；这是实现调研，不要求用户运维。
- Pack 最低 Harness 版本尚需选择字段位置和版本策略；当前 `@hima/harness` 已有 `0.1.0` 软件版本，现有 Pack contract 只有自身版本。
