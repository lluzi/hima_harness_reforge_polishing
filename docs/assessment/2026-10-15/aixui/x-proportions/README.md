# Urbanist 500 与四段式 X 的比例验收

当前是本地 `aixui@c4ed93f8` 之上的未提交增量。用户选择 Urbanist 500，并要求缩小 X 中心留白、明确与 i 竖笔画的比例、所有品牌 X 保持一致。

[正式比例规范](../../../../specs/aixui/brand-mark.md)定义 t、中心留白、对齐、间距与统一缩放。[调整前后及尺寸对照](x-proportions.png)使用真实 Urbanist 500 字形，X 几何由生产源码导出；[SVG](x-proportions.svg)为可缩放版本。[浅色窗口](light.png)、[深色窗口](dark.png)是真实 Electron 截图。

本轮只将品牌字母改用 Urbanist 500；原 UI 字体 Manrope 及原生 Light/Dark/System 设置保持。X 的四条斜线垂直笔画宽度等于 i 竖笔画，45°、中心核心菱形对角线 2t；导航、字标与 native PNG/ICNS 由同一源码生成。字体资源保留 Urbanist OFL 和第三方声明，嵌入本地包。

构建、类型与 client-style 3/3 通过。真实桌面品牌/主题/配置用例 1/1 通过，0 跳过；新增断言读取浏览器真实字体墨迹与 SVG 投影，不比较两份复制的实现。在 64 px 字标中，i 竖笔画 5.3759997 px，X 斜线 5.3758326 px，i–X 墨迹间距 5.3519249 px，基线误差 0.0000610 px，详见 [测量记录](wordmark-metrics.json)。截图确认无侧栏品牌裁切。macOS iconutil 成功解码所有 ICNS 尺寸。

独立增量复核沿用 `gpt-6.1-sol/high` adversarial 上下文，无发现。检查了共享几何对称和边界、字体嵌入/许可、CSS、native 图标及实机截图；复核者未独立运行构建或测试。未重启整套代码审查。开发模型开销和 token 未测量。

原有两处 task-effects 测试未提交补丁逐字节未变。按用户选择继续保留本地候选；未提交、推送或合入，没有扩大 ATCS/DBOS 回归修复范围，也没有运行产品模型、SSH 或 EDA。原始日志在 `.scratch/aixui/x-refinement/`。
