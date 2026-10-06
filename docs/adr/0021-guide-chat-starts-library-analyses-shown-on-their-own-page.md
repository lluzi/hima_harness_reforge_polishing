---
status: accepted
---

# 定制库分析从 Guide 对话发起，结果在独立网页呈现

用户于 2026-10-05 明确：

- Data Insight 中内嵌的 LibInsight 页面是**默认分析**，按 [ADR-0019](0019-data-insight-frames-the-libinsight-app.md) 保留。
- 定制分析的入口是 HimaHarness 对话。用户与 Guide 聊天，Guide 让驻场 OpenCode 用 QuaLib API 编写代码，在
  linglong 上运行。
- 结果数据在一个**新网页**中呈现，与默认的 Data Insight 标签页相互独立。
- 用户明确否定 Data Insight 中“Resident analyses”标签页的表单（输入框 + Prepare/Confirm 按钮）。

本决定替代 [ADR-0020](0020-guide-conducts-libinsight-through-the-resident-agent.md)
“2026-10-05 修订：Data Insight 的 Resident analyses 标签页”中的入口与呈现两点。ADR-0020 的 Pack、Site、
驻场 Agent、Reader、登记与许可证模式不变。

## 决定

- **对话入口。** Guide 获得工具 `hima_insight_analysis`，它有四个动作：
  - `propose`：把用户的问题、`.lib` 源与 `buildsOn` 写成 Site 上的请求文件，并对分析 Pack 做一次准备，
    返回有界方案。方案包括问题、源、沿用的分析、Pack 版本、Site、时间盒，以及未就绪原因。
  - `confirm`：只在用户于对话中明确同意后由 Guide 调用，经 `startGuidedRun` 启动普通 durable Run。
    Host 强制这一点：方案之后，该对话必须收到至少一条用户本人输入的消息（来源为 user，不含插件通知、
    工具结果与模型自身文字）。否则 `confirm` 被拒绝，因此 Guide 不能在提出方案的同一轮里自行确认。
  - `list`：列出本项目中的分析 Run 及其状态、登记情况。
  - `result`：返回已接纳结果的摘要、假设、限制、图表标题和独立网页地址。
  这四个动作与原标签页共用 `libinsight-analyses.ts` 的 `propose/confirm/list/detail`：同一准备身份、
  同一 Run 所有权和 Pack Reader 判定，不形成第二个启动面。Run 结束或受阻时，Host 已有的 Guide 边界通知会
  让 Guide 读取结果并在对话中汇报。
- **对话卡片。** 对话中的 `hima_insight_analysis` 调用以卡片呈现：
  - 方案卡显示问题、源、沿用分析、Pack、Site 与时间盒，并提示“在对话中回复以确认”；
  - 启动卡与结果卡提供“Open analysis page”。
  卡片不提供确认按钮：确认就是用户在对话中的回答。
- **独立网页。** Host 在 `/hima/analysis/<runId>?session=<id>` 提供服务端渲染的 HTML 页面，并经过与
  Workbench 相同的浏览器会话栅栏、会话校验与项目 Run 授权。页面内容包括：
  - 问题、状态（运行中、Reader 已接纳、已登记为 `id@version`，或未登记及原因）；
  - 摘要、全部图表（SVG）与数据表、假设与限制；
  - 源 hash、运行命令与主脚本。
  数据只取自 Host 保留的 Reader 输入字节。页面不含脚本，并带 `default-src 'none'` 的 CSP。运行中每 10 秒
  自刷新，等待人工时每 60 秒刷新。桌面 App 在新窗口中打开该页面，不替换主窗口。
- 对话中的结果以卡片按钮打开网页：dsh 对话只把绝对 http(s) 地址渲染为链接，而网页地址是 Host 相对路径。
- `result` 返回给 Guide 的数据集有上限：每个数据集最多 40 行，单元格最多 200 字符，总量约 24 KiB。
  完整数据在网页上。
- **移除标签页。** Data Insight 只保留 LibInsight pages 与 Retained reports，删除 Resident analyses 标签页
  及其 `propose/confirm` HTTP 路由，`/libinsight/analyses` 只保留只读的列表与详情。

## 保持

- Run 仍是任务局部 Run（ADR-0017 Q5）。连续开发依靠 Site 分析库与 `buildsOn`。
- 驻场 Agent 的交付只按声明 schema 被接纳，Agent 自述不构成事实。
- LibInsight 仓库与其数据文件夹不被读取或改写。

## 回滚

本 ADR 的实现提交可整体回退，恢复 ADR-0020 修订中的标签页。Pack 与 Site 不受影响。
