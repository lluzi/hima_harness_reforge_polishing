# 视觉修正后的单窗口复核

Parent 从前次真实截图中发现固定代次表的数量与判定文字跨入邻列。根因是 `.ledger` 的 `.value` / `.verdict-line` 使用 nowrap，而表格同时固定列宽；Root 增加 `.ledger.fixed .value,.ledger.fixed .verdict-line{white-space:normal}` 后完成构建与类型检查。

本次只启动一个普通 stand-in 窗口，运行 2.35→2.30 ns 两代 Goal 达成路线，sleepSeconds=0，没有重复阻塞或恢复。使用已有 driver / Host / Site / 报告 API。所有交互在 zoom 1；截图时报告可缩放至 0.8，随后重新滚动、等待两次 animation frame 并核对目标矩形。

**结果：1 pass / 0 fail / 0 skip；1 次实际 Electron 启动；8.824 秒；SSH attempts 0。** Exact argv 与墙钟时间见 [visual.json](visual.json)，原始输出见 [visual.log](visual.log)。

DOM 检查涵盖实际 fixed-table 的 8 个 `.value` / `.verdict-line`，检查计算样式以及各文本 Range 的 fragment bounds 与所在 td 边界。全部 `white-space:normal`，左右最大溢出均为 **0 CSS px**。这只证明所呈现数据与当前尺寸，不泛化到所有 Pack 文本或窗口尺寸。

- [代次表](generation-table.png)：zoom 1，目标顶部 52.95 px。
- [实际报告顶部](report-top.png)：zoom 0.8，目标顶部 52.52 px，文档 scrollY 2753.75；包含 experience 标题、当前预览说明和报告内容。
- [研究结论与证据限制](report-research-limits.png)：zoom 0.8，目标标题顶部 52.73 px，文档 scrollY 3283.75。

上述目标在截图前与截图后的位置差异小于 2 px，且位于 sticky chrome 以下、实际视口内。报告全文高度超过一个窗口；两张报告图各自记录一个视口，不能宣称整份报告都在图中。前次名为 resumed-report 的图片实际是顶部概览，已在上级说明更正。

保存报告仍通过原 API 返回 200 / schema 2；返回 Markdown 的独立 SHA-256 与记录一致，页面保存文件链接指向对应 `/experience.md`。这一检查不把重新投影的正文当作已保存文件。

[summary.json](summary.json) 包含样式源码/产物 hash、逐截图 hash、DOM 范围、源变更列表和限制；[observations.json](observations.json) 保存完整观察。254 个源码、测试与 lib 文件在本次运行前后逐字节一致。模型、远端 Site、真实 EDA 和资深工程师研究验收均未运行。Parent 将直接视觉检查这三张未经图像编辑的真实窗口 PNG。
