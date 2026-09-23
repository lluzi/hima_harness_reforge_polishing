---
status: accepted
---

# Library Intelligence 只呈现三类用户分析

用户于 2026-09-22 决定：Library Intelligence 是 HimaHarness 基于 Liberty API 提供的原生业务能力，
用户通过同一对话发起分析，在右侧 Workbench 查看洞察并形成后续行动。产品面不按 Catalog、图表、
Finding、Rule Studio、Insight Builder、报告、Sandbox 或 Action Center 拆分功能，只呈现三类用户任务：

1. 库健康与发布风险分析——这套库可靠吗、能不能交付；
2. 库性能与竞争力分析——这套库强在哪里、弱在哪里、应该优先改什么；
3. 设计影响与行动分析——这些结果对当前芯片意味着什么、下一步做什么。

自定义规则、数据探索、可视化、证据追溯、报告、候选副本和后续动作是三类分析共用的实现能力，
只在对应任务中出现或按需下钻，不成为一级导航和需要用户先学习的产品概念。Liberty API 提供 Library
内事实和安全候选能力；当前设计采用、真实 PPA、模型相关性和芯片结果必须由 HimaHarness 的设计证据
与实际 EDA 验证补充。右侧 Workbench 继续投影 Host/Ledger 事实，Campaign Agent/Fabric 保持唯一行动
和执行控制边界，不建立第二 BI 事实源或执行控制面。

Trend 的 load 切换、Cell filter、多维视图和客户算法属于三类分析共用的交互/分析能力。客户 Python
算法必须经过 schema、fixture、版本、预算和权限约束。Milkyway、NDM 等第三方数据库只能通过各自的
只读 adapter 和合法 Site 工具投影事实，不得因为 Liberty API 本身是 Python API 就宣称直接支持。
