# aiX 去除重复标记与品牌包 v2

状态：aixui 本地未提交候选，未推送或合入。范围仅为品牌视觉与交付包，不扩大原有 ATCS/DBOS 回归问题。

展开侧栏和启动页去掉最左侧独立 X，保留 Empyrean + aiX Harness 单行。收起导航与独立应用图标仍使用同一 X。正常 16 px、紧凑约 14 px、启动 24 px 的单行、容纳和基线测量见本目录 JSON；相关近景及完整窗口截图同时保留。

验证：GUI 构建、类型检查、seam/boundary、样式 3/3、原生品牌/主题路径 1/1 均通过。窄面板配置和主题切换可用。原两处用户测试改动的 patch SHA256 仍为 e0c7efe456b64e667973bde9293b114b62113ec6e449474f3a3bf296eff98d5c。开发沿用当前 Codex 会话，独立增量复核 gpt-6.1-sol/high，见 review.json。未测量本轮独立 token 开销。

交付包：output/empyrean-aix-brand-system，18 组母版、12 页规范 PDF、12 页品牌规范 PPTX、10 页广告/产品模板 PPTX，更新 SVG、PNG、文案、字体、动效和 A3 印刷稿。每份 PPTX 的最终字节结构/布局校验及回读记录见本目录 validation.json，副本与最终哈希一致。22 页最终渲染均检查：18 页与前次已目检图片逐字节相同，4 页改动图单独复看。专家广告正文与 X 的重叠、规范页行首标点已修正。

正文保留原生可编辑文本，品牌字母和 X 为可编辑自由曲线，Empyrean 保留原标识图片。编辑前安装包内 fonts/powerpoint 完整静态字体。未以本机 Microsoft PowerPoint 执行作兼容性签收。

离线索引用 ego-browser 验证：1440 与 390 宽无水平溢出，广告筛选 7 项、无观察到的失效图片，动效暂停和 reduced-motion 规则正常。该浏览器的截图导出超时，未将旧版网页截图混入 v2；实际 PDF、PPTX 渲染预览已更新。

完整结构验证和交付哈希见包内 08-production/quality-report.json、manifest.json 与 SHA256SUMS.txt。

PDF 文本导出改为同一文本流内按实际坐标写入，完整中文标题与正文短语搜索/复制验证通过；13 张 PDF 页面渲染与修复前逐字节一致。方案包最终 184 个文件，含 48 份有效 SVG；SHA256 全量核对及 ZIP CRC 校验通过。
