# aiX 字标修订与浅色风格

用户反馈：改用开源字体绘制 ai，X 与左上角标记一致；重点调整品牌视觉，其他界面保持，增加浅色风格。

本轮是 `aixui@c4ed93f8` 之上的本地工作区候选增量，尚未提交。用户已选择保留本地候选，不扩展 ATCS/DBOS 回归修复，也不继续推送或合入。

- `ai` 使用已内置的 Manrope 700（SIL OFL 1.1），取消手工圆圈与竖线字形。
- 主字标和侧栏 aiX Harness 复用字标组件；导航、字标和 App 图标共用 `aix-symbol.ts` 中的四段式 X。
- 修正原生单行品牌席位的高度限制，使 Empyrean / aiX Harness 两行完整显示。
- [浅色实机截图](light.png)：白底、浅蓝灰表面、深蓝字标。
- [深色实机截图](dark.png)：深蓝底、冰蓝字标。
- [原生 Appearance](appearance.png) 继续拥有 Light / Dark / System，未增加主题状态。
- [App 图标](app-icon.png) 使用同一 X。

验证：新构建、类型检查、seam 检查通过；既有 client-style 合同 3/3 通过；真实 Electron 品牌/主题/窄面板路径 1/1 通过、0 跳过。窗口断言覆盖实际字体加载、三个品牌席位的 X 绘制一致、字标配色、侧栏品牌完整容纳、手动明/暗覆盖相反 OS 媒体、草稿保留和配置可用。实际截图经检查，侧栏无裁切。ICNS 经 macOS iconutil 解码成功（16–1024 px）。没有运行整套已知失败回归，也没有产品模型、SSH 或 EDA 调用。

独立增量复核沿用 gpt-6.1-sol/high 的 adversarial 复核上下文：无发现。复核覆盖字体许可、共享几何、Node 24 导入、PNG/ICNS 和品牌席位 CSS；它没有独立运行测试，最终窗口结果由本轮真实桌面运行取得。没有重启整套代码审查。

原有两处 task-effects 测试的未提交补丁逐字节保持：SHA256 `e0c7efe456b64e667973bde9293b114b62113ec6e449474f3a3bf296eff98d5c`。原有本地提交和历史验收材料保留。原始日志在 `.scratch/aixui/wordmark-*.log`。
