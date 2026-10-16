# 单行组合标识与光学对齐

用户明确要求 Empyrean、aiX、Harness 放在同一行，并控制文字与图标的相对位置。此增量保留在本地 aixui 工作区，未提交/推送/合入。

- [浅色组合近景](lockup-light.png) / [深色组合近景](lockup-dark.png)
- [紧凑组合](lockup-compact.png)
- [启动页浅色近景](startup-lockup-light.png) / [深色近景](startup-lockup-dark.png)
- [浅色完整窗口](light.png) / [深色完整窗口](dark.png)
- [启动页浅色](startup-light.png) / [深色](startup-dark.png)

近景直接由同一真实 Electron 页面按 DOM 边界截取，没有对截图作事后图像编辑；源 PNG 公司标识、Urbanist 500 与 X 几何均未改变。

## 排版约定

公司英文标识以原图文字的光学基线 y=70 对齐产品文字。公司图宽 5.37em，原图大写字面高度约 56 px，缩放后与 Urbanist i 的含点墨迹高度接近。公司图框下移 .216242em 补偿原图下伸部。母品牌到产品间距 .625em，aiX 到 Harness 间距 .375em；Harness 同属产品字标，使用 Urbanist 500。界面正文仍为 Manrope。

侧栏字号按原生按钮容器在 12–16 px 缩放，始终为单行。按钮保留 24 px 最小高度，展开行独立 X 为 20 px；容器小于等于 168 px 时收起重复的独立标记，完整 Empyrean + aiX Harness 仍保留。原生收起导航继续显示原 X，不受这个命名容器影响。

启动页保持同一单行比例，字号 16–24 px 随窗口调整，应用图块为 40 px。字面、基线与间距都采用相同 em 规则。

## 证据

真实桌面用例 1/1 通过、0 跳过，包含正常侧栏、160 px 容器约束、明暗、窄配置、启动页与原有字体/X/草稿检查。160 px 是施加在真实按钮上的受控 CSS 容器检查，不声称通过原生拖拽改变了侧栏持久设置。

正常侧栏为 16 px，母/产品间距 10 px，光学基线差约 .00177 px。紧凑容器为 12 px、间距 7.5 px，全部内容完整容纳。启动页为 24 px、间距 15 px，基线差约 .00106 px。原始尺寸见对应 JSON。

保留首次紧凑反例：原生按钮缩至 14.68 px 高，公司标识底沿超出约 .595 px。源码与矩形测量定位到收起重复标记后丢失原有高度支撑；最小高度 24 px 修正后反例转绿，没有放宽完整容纳的断言。日志在 `.scratch/aixui/inline/compact-red.log`、`compact-probe.log` 与 `final-desktop.log`。

新构建、类型、seam/boundary 与 client-style 3/3 通过。独立增量复核沿用 gpt-6.1-sol/high adversarial 上下文，无发现；复核者未独立运行测试。未重启全套审查/已知失败的全量回归，也未运行产品模型、SSH 或 EDA。原有两处 task-effects 未提交补丁逐字节未变，未改变用户保留本地候选的决定。
