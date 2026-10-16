# aiX 布局反馈验证（2026-10-16）

基线：aixui@d95c55ff。此前保留为本地候选；用户现已明确要求提交并合入 HUG-DBOS，实际同步以 Git 历史为准。既有 ATCS/DBOS 问题不扩大修复范围。实现与测试沿用本机 Codex 单一写者，独立复核 gpt-6.1-sol/high；本轮独立 token 开销未测量。

用户规格见 docs/specs/aixui/layout-20261016.md。截图位置属于空会话正文，不是临时 Electron 启动页，因此只改 AiXHeroBrand。原 Urbanist 500、X 几何与侧栏单行品牌组合不变。

## 复现与改动

品牌实机检查在修复前失败：sameRow=false。Guide/Project 实机检查在修复前失败：fillsPane=false，Campaign 516.6px、Live 400.6px；截图还显示从配置页切换后沿用滚动位置，整个 Live 被滚出视野。首次启动测试未配置 PostgreSQL runtime，属于环境失败；指定现有固定16.15 runtime 后得到上述真实布局失败，原始失败均保留。

AiXHeroBrand 增加同排标题行，字体根据正文可用宽度缩放，描述独立排版。Campaign 改为填满父面板；摘要最多25%，内容单独滚动。配置/项目的滚动容器按当前视图和Run区分身份，以进入新项目时回到顶部；记忆草稿仍由现有父级状态保存。

## 结果与范围

构建与类型检查通过。现有 client-style/canvas-layout 共50/50通过；三条真实桌面路径3/3通过，无跳过，使用隔离Home、固定PostgreSQL16.15、零产品模型/SSH。其中短窗口860×700增加长摘要内容压力，验证摘要<=25.5%、Live>65%且位于可见面板内；明暗模式及860宽配置页均通过。配置、Guide草稿和模式切换的原有断言继续通过。

正常实测见live-layout.json：Campaign填满面板，摘要约12%，Live约456px，完整可见。截图为实际窗口，不把本地样例状态当作真实工程目标达成。

seam通过。boundary原始被packages/.DS_Store当成包目录挡住；暂移该Finder元数据后检查通过，随后按原字节复位，不改检查脚本，也不将原始失败抹去。原用户两处task-effects文件差异SHA256仍为e0c7efe456b64e667973bde9293b114b62113ec6e449474f3a3bf296eff98d5c。

本轮不重跑全套已知失败业务回归，不发布App安装包。独立复核结果见review.json。

## 09:41 工具栏补充

用户补图进一步指定顶部工具栏，同一行且小于25%。已将模式切换、项目选择、刷新、新项目及文件/Pack工具入口排成单行；辅助动作使用既有16px图标风格、30px按钮、保留title/可访问名称/合同标记及原回调，窄面板隐藏模式标签的视觉显示。新增plus图标归属既有glyphs.tsx。

初次独立复核发现窄窗口标语末尾裁切，补充Range与scrollWidth检查后重现原失败。单行工具栏降低右侧布局的宽度需求后，860px窗口正文可用宽度约324.2px，字标加标语约273.1px，保留完整句点。字体几何不变。原P2已由同一复核者关闭，其余摘要/key变更无新发现；见review.json。

工具栏实际高度占比见toolbar-layout.json（普通配置约8.5%、窄配置约5.9%）；活动项目窄窗约9%，保持单行且控件全部位于边界内。长摘要的窄窗压力测试占比约25%，Live仍占主要高度并完整位于可见面板内。final-native.log包含3/3实际路径：品牌/主题、Guide/Project切换、Pack authoring原生入口；保留原有按钮功能及草稿断言。已完成简洁性自查：5个现有实现文件内的呈现改动，几何测量复用测试辅助函数，不引入新模块或运行时。

截图已同步NAS luzh_exchange/Empyrean-aiX-Brand-System-v2.0/software-screenshots/2026-10-16-layout；旧10月15日版本仍保留。
