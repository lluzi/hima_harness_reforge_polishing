# aiX UI：HUG-DBOS 视觉体系升级

来源：用户于 2026-10-15 要求以 HUG-DBOS GUI 为基线，统一界面、颜色与图标，在 `aixui` 分支完成升级后合入。

## 用户结果与范围

工程师在同一 App 中使用对话、Project、Data Insight、配置、报告、团队、记忆和设置时，看到统一的 Empyrean aiX Harness 品牌、深蓝/冰蓝色彩、SVG 图标、控件和信息层级。保持已有导航、控制、Run 事实与本地数据位置。

基线：`HUG-DBOS@969cf62b8ae9ac8468ee070ab64c94b497ec34bf`，创建同名工作分支 `aixui`。目标合入分支为 `HUG-DBOS`。当前工作区两处未提交测试改动及所有原有未跟踪资料不属于本升级。

## 当前证据

- 既有 `workbench-style.ts` 混用暖灰背景、橙色 active 和紫色 accent；原生聊天区使用另一组主题别名。
- 原生主题以 `body[data-ds-dark-theme]` 和文档 color-scheme 表达；工作台旧规则未完整消费同一状态。
- 品牌席位由 `client/index.ts` 注册，当前为 H 图标、HimaHarness 名称与原生 Into the Unknown 标题。
- 已通过既有真实桌面用例 `Guide keeps its conversation while Campaign and Data Insight remain peer modes`，改版前截图位于 `.scratch/aixui/before/`。测试运行在 Catsights，使用隔离 Home、固定 PostgreSQL 运行时、本地任务；零真实模型与商业 EDA 调用。

## 行为归属与实现边界

1. 在现有 client adapter 内维护品牌标记和原生 shell 的展示适配；不增加运行模式、状态权威或新执行服务。
2. 统一原生聊天与工作台所用的主题别名，保留原生 light/dark/system 选择与字体大小设置。
3. 深蓝为品牌和选择态，成功/警告/失败仍有独立且可读的语义颜色；未知、未完成与失败不染成成功。
4. 品牌固定为 `Empyrean aiX Harness`，标语 `Orchestrating the Extraordinary.`，按顺序强调 e、a、i、x。小尺寸使用模块化 X，较大品牌席位使用 aiX 组合标记。
5. 图标继续使用既有 16 px inline SVG 网格和 currentColor。保留可访问名称、键盘焦点、原 data-hima-control 和宿主导航合同。
6. 统一按钮、输入框、选择态、分隔线、圆角、状态与面板层级，尊重窄面板、缩放与 reduced-motion。
7. 桌面标题、启动/错误页和 App 图标采用同一品牌；原 `HimaHarness` 用户数据目录、HIMA_* 环境变量、API、Pack、Run 和存储身份继续保留。

预计代码范围：现有 `client/index.ts`、`workbench-style.ts`、`glyphs.tsx`、`HimaWorkbench.tsx`；同一 client 模块内的品牌组件/样式与字体资源；`desktop/src/main.ts`、图标生成脚本和资产。根据实际公开 UI 文字更新对应显示与测试，避免运行时和业务模块改动。

## 验收

- 同一窗口中的原生聊天与 Project 具有一致的冷色表面、品牌强调、输入框、选中态、文字和图标。
- 明/暗/跟随系统均采用原生主题设置，手动明色不能被系统暗色覆盖，反之亦然。
- 启动画面与空会话展示新标记和标语；原生工作区选择、权限和输入仍可使用。
- Project 配置、图、结果、报告、Data Insight、Pack 管理和设置仍能打开与操作；切换不清空草稿或改变 owner。
- 1440 px 桌面与窄面板可用；按钮有焦点、禁用和 hover 状态，错误/警告/未知可区分。
- 原有两处测试文件未提交差异与升级前逐字节一致。

## 验证与交付

视觉修改不增加镜像实现的断言；复用现有 client-style、client registration、工作台、桌面和配置检查。对新增品牌展示与主题组合，通过真实窗口验证用户可见结果。

最低 L0 构建、类型与 seam/boundary；相关 L1/L2 回归；Catsights 上 L3 原生窗口、双模式/配置/报告与主题截图。真实模型、商业 Site 和 EDA 不用于纯视觉升级。稳定后独立审查一次，修复有效发现，再提交、立即 push 并核对 SHA；完成后合入 HUG-DBOS 并同步远端。

实现为本机 Codex 原生执行；共享样式、品牌与注册接线有依赖，保持单一写者。独立复核按 `docs/agents/model-policy.md` 使用 fresh context。回滚保留 aixui 的独立提交，沿用原 App 与原 Home，不进行数据迁移。
