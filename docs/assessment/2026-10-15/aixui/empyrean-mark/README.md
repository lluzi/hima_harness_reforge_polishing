# Empyrean 英文公司标识

用户指定 https://en.wikipedia.org/wiki/Empyrean_Technology 中的英文标识。使用页面指向的原始 PNG，公司图形与英文字母均保留；不使用字体替代、不重绘。源文件和出处记录在 `packages/harness/assets/brand/`。

原图 490×203，英文有效墨迹 x=25..469/y=0..87，中文从 y=103 开始。显示视框 x=24/y=0/447×88，仅显示英文并保留两侧 1 px 源图留白。浅色保留原蓝，深色以同一透明轮廓显示白色。图像复制和嵌入前后字节一致，无运行时远程图片请求。

- [浅色侧栏与主界面](light.png)
- [深色侧栏与主界面](dark.png)
- [浅色启动页](startup-light.png)
- [深色启动页](startup-dark.png)

启动/错误页使用同一公司图片、Urbanist 500 字体和由 canonical 几何生成的 X SVG；现有主字标比例未变，系统窗口标题等文本仍保留产品名。

新构建、类型、seams/boundary 通过；既有 client-style 合同 3/3 通过，实际 Electron 品牌/主题/配置路径 1/1 通过、0 跳过。断言实际显示的源图片 data URL 与资产精确一致，英文视框比例与图片解码尺寸正确，侧栏品牌完整显示；实际生成的启动页嵌入同一图片，startup 字体可加载且四个 X 多边形与实际 client 一致。启动页明暗截图来自同一真实窗口的本地 starting.html，而非新建 mock 页面。所有字体和图形均为离线资产。

独立增量复核沿用 `gpt-6.1-sol/high` adversarial 上下文，无发现；复核未独立执行测试。没有重启全套审查或已知失败的全量回归，没有产品模型、SSH、EDA 调用。请求数/token 未测量。

公司标识的来源与权利说明和 OFL 字体许可分开记录。按用户决定继续保留本地 aixui 候选，尚未提交、推送或合入；原有两处 task-effects 测试补丁逐字节未变。原始日志 `.scratch/aixui/empyrean/`。
