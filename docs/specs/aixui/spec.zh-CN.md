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

## 2026-10-15 字标修订

用户要求重点调整 aiX 视觉：取消圆圈加竖线手绘的 a，采用开源英文字体；X 与左上角的四段式图标保持一致，并提供浅色风格。其余界面继续沿用当前候选。

- 现有 Manrope（SIL OFL 1.1）负责真实 `ai` 字形；不再拼接小写字母。
- 主字标和左上角 `aiX Harness` 复用同一字标组件；导航、字标和原生图标复用同一 X 几何数据。
- 浅色为白/浅蓝灰表面配深蓝字标，深色为深蓝表面配冰蓝字标，沿用原生 Light/Dark/System。
- L0 构建/类型、既有样式检查及一条真实桌面品牌/主题路径；保留明暗对照截图。
- 用户已选择只保留本地 aixui 候选，不扩大回归修复范围；不重新启动推送/合入或整套已知失败回归。

## 2026-10-15 Urbanist 500 与 X 比例定稿候选

用户选定 Urbanist 500，要求缩小 X 中心留白并规定与 i 竖笔画的比例。[品牌规范](brand-mark.md)以 i 竖笔画 t 为基准，规定 X 斜线厚度 t、45°、中心核心菱形对角线 2t、i–X 墨迹边界间距 t，并按 i 的含圆点墨迹高度与基线对齐。所有品牌 X 共用唯一几何；正文与其余界面继续沿用现有候选。

真实桌面检查测得 64 px 字标的 i 与 X 笔画均约 5.376 px，间距约 5.352 px，基线对齐。[实机证据](../../assessment/2026-10-15/aixui/x-proportions/README.md)保留明暗截图及原始测量。按用户决定继续保留本地候选，不提交、推送或合入，不扩大 ATCS/DBOS 回归范围。

## 2026-10-15 Empyrean 英文母品牌标识

用户指定 https://en.wikipedia.org/wiki/Empyrean_Technology 中的英文标识。使用该页原始公司标识图片的英文行（原图不变，视框 x=24/y=0/447×88）；侧栏及启动/错误页母品牌位置使用原始图形，浅色保留原蓝色，深色显示相同轮廓的白色版本。aiX 的 Urbanist 500、四段式 X 比例和其他界面保持。该公司标识与 OFL 字体资产分开记录来源，不重新绘制字体或引入运行时远程图片请求。继续保留本地候选，不提交/推送/合入。

## 2026-10-15 单行组合标识

用户明确要求母品牌与产品名称在同一行，并控制文字/图标相对位置。本地候选已按 [单行比例约定](brand-mark.md) 合成，侧栏与启动页验证单行、完整容纳和光学基线；母/产品间距 .625em、产品内部间距 .375em，并保留规范中的 X 比例。[实机证据](../../assessment/2026-10-15/aixui/inline-lockup/README.md)包括近景和完整窗口。继续保留本地未提交候选，不推送/合入。

## 2026-10-15 去除重复标记与视觉方案包 v2

按用户要求，展开侧栏与启动页去掉最左侧独立 X，母品牌与 aiX Harness 保持单行及既定相对位置。同步历史主视觉包为 v2，包含更新的明暗字标、统一比例 X、广告、产品应用、规范 PDF 与两份可编辑 PPTX。原生实际窗口验证通过，证据见 [本轮记录](../../assessment/2026-10-15/aixui/brand-v2/README.md)。继续保留本地 aixui 候选，不提交、推送或合入，不扩大 ATCS/DBOS 范围。
