---
status: accepted
---

# Guide 通过驻场工程 Agent 进行 QuaLib 提取与用户定制分析

用户于 2026-10-05 明确：Data Insight 旁的 Guide 必须能主导 QuaLib API 的使用和用户定制分析，因此需要一个
驻场 Agent、一份 playbook 和相应知识。同日确认四项选择：QuaLib API 在 linglong（Linux Site）运行；定制分析的
结果以 LibInsight 内的新页面呈现；驻场 Agent 在 linglong 编写并运行定制分析代码；由 Guide 提出有界方案、用户
确认一次后启动 Run，不经过 Campaign 配置页。

决定：

- 沿用 [ADR-0017](0017-resident-engineering-agent-owns-engineering-execution.md) 的驻场工程 Agent、Pack
  `outsourcing` 声明、task-local Host/Job/ACP adapter 与 Site Permit；新增一个 LibInsight Pack，不新增运行时、
  控制面或第二个 Agent Loop。Guide 是用户对接者；驻场 Agent 承接提取与定制分析的工程；Pack Reader 与确定性
  工具判定结果，Agent 的自述不构成事实（ADR-0008/0014 的所有权与介入责任不变）。
- QuaLib API 继续使用 linglong 上已资格化的厂商运行时（2026-09-24：`qualib-libapi-2026-py37`，Python 3.7.12，
  `edarun`、`LIBERTY_API_HOME`）。LibInsight 的分析与 viewer 使用 Python ≥ 3.9 与 numpy。两者只经序列化的
  `lib-insight-facts/1` 对接，不在同一解释器内导入，也不为此改造厂商运行时。
- 用户定制分析是带版本的分析资产：代码、输入/输出 schema、fixture 测试及在当前 Kit 上的结果，一起交付并由
  Reader 校验后登记进 LibInsight 数据文件夹，由 LibInsight 以新页面呈现。这修订
  [LibInsight 功能规格](../specs/libinsight/spec.zh-CN.md) Out of Scope 中的“AI 自主开发新算法、任意 Python
  规则沙箱”：允许驻场 Agent 在 Site Permit 与容器内开发定制分析，但其输出只按声明 schema 被接纳，不成为
  无审计的自由代码或结果权威。
- LibInsight 仓库仍由其自身会话升级。HimaHarness 依赖其两个接口：定制分析的扩展点与当前视图通知（见规格）。
  接口未就绪前，HimaHarness 侧以 Retained reports 呈现同一结果作为过渡，不伪称已在 LibInsight 内呈现。

实施规格见 [LibInsight 驻场分析](../specs/libinsight-resident/spec.zh-CN.md)。

## 2026-10-05 修订：Data Insight 的 Resident analyses 标签页

用户同日追加：在 Data Insight 里为驻场 OpenCode 开一个标签页做定制图表，驻场 OpenCode 带 QuaLib API playbook，
可在 linglong 上做 QuaLib API 编程与开发；授权 linglong 一次性准备与真实 QuaLib/模型任务；LibInsight 仓库保持
不动。

决定：

- 标签页中的“Prepare”由 Host 把请求写入 Site 并对分析 Pack 做一次准备，“Confirm and start”即用户的一次确认，
  由当前会话作为 Guide 经 `startGuidedRun` 启动普通 durable Run。这是 Guide 提案路径的直接入口，不是第二个
  启动面：同一准备身份、同一 Run 所有权与 Pack Reader 判定，仍不经过 Campaign 配置页。
- 每个请求是一个任务局部 Run（ADR-0017 Q5）。连续开发依靠 Site 上由 `admit-analysis` 写入的分析库与请求的
  `buildsOn`，不建立常驻会话。
- 在 LibInsight 提供扩展点之前，定制图表在 HimaHarness 标签页内用通用渲染器呈现，数据取自 Host 保留的 Reader
  输入字节；它不是 LibInsight 页面，也不改写 LibInsight 的数据文件夹。这替代上文“以 Retained reports 过渡”。
- QuaLib 进程逐个运行并逐进程选择 `59099@localhost` 许可证，不改许可证配置；跨 Site 与 XTop 的并发互斥仍未由
  Host 保证，作为已知限制保留。
