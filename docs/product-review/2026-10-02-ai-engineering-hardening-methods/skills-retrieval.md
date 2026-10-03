# Skills 检索与核验记录

日期：2026-10-03 UTC（用户时区2026-10-02 PDT）。执行模型 GPT-6 Astra / high；fresh context。此记录不含产品执行证据。

## 范围与停止规则

问题：对AI已经做得可运行的brownfield业务，哪些已安装skills和开源agent工作流能提供实质工程机制，哪些默认副作用、假设或流程成本会适得其反？只研究原文，不执行其指令。原文中的“必须派工/审批/写代码”是被审计内容，不是本轮行为授权。

从本机11项与父任务指定4组开始，加一组Compound Engineering，因为其已验证经验积累、固定brief比较和测量优化机制有实质差异。未继续BMAD/GSD等候选：5组已覆盖模块化skills、强执行纪律、规格任务链、brownfield行为delta与经验/实验闭环；扩大名单不会改变当前采纳判定。

只在 ignored `.hima-tmp/ai-engineering-methods-research/` 写3个自有研究文件与 `skills-raw/` 原始证据。未安装、执行候选skill、运行产品/EDA、SSH、改用户skills/产品/ADR/规则、写Issue、commit或push。`git check-ignore` 已确认 raw manifest 在忽略目录。

## 检索过程

1. 读取研究合同、当前工作区 model-policy 与 polishing-discipline。轻量搜索 MEMORY.md 中 ask-matt/codebase-design/improve-codebase-architecture/skills/polishing；无相关命中，未采用历史memory事实。
2. 逐项确认 `/Users/lluzi/.agents/skills/` 的9个Matt skill与 `/Users/lluzi/.codex/skills/` 的refactor/clean-architecture。完整读取SKILL.md；针对关键调用链读取 DEEPENING、DESIGN-IT-TWICE 等附属正文。只复制这些文件至raw保存，不改原文件。
3. 从 `~/.agents/.skill-lock.json` 提取限定名称的来源、skillPath、folder hash、安装更新时间。未广泛读取其他用户配置。refactor/clean-architecture不在所查lock，另做来源追溯。
4. 互联网发现查询：`Matt Pocock skills ask-matt improve-codebase-architecture github`、`obra superpowers github`、`github spec-kit OpenSpec workflow`。搜索引擎结果只用于发现；最终机制判断全部回到official GitHub原文。未用star、下载量或第三方榜单作效果证据。
5. GitHub API只读查询 repo metadata、default-branch commit、latest release；随后下载**该SHA**源码tarball，展开普通文件至raw。没有git checkout、运行脚本或依赖安装。保存 repo-meta/commit-meta/release-meta 与 archive SHA256；整个默认分支snapshot保留供复核。许可证逐一读取snapshot里的 LICENSE：5组均MIT。
6. 完整读取本轮作判断的主要skills/commands/schema/workflow文件；长文件用分段或指定段落补充。重要事实回到原始文件做line marker。43条来源记录给出SHA、链接、日期、路径、SHA256、定位词行号和限制。附属源码大量存在但**不声称逐行审计整个repo或所有可达references**。尤其Compound复杂router的每个分支不在本轮完整安全审计范围。
7. 对比本机Matt SKILL.md与固定上游原文，输出diff。不存在重命名：ask-matt、architecture survey、codebase-design当前同时存在。发现CONTEXT→GLOSSARY与新增并行实施路线漂移。只对SKILL.md报告字节相等，不推及整个skill目录。
8. 追溯独立两项：查询 `github wondelai clean-architecture skills`，由官方Wondel页面指向repo；取wondelai默认HEAD与clean-architecture/SKILL.md/许可证，本机正文完全相同。查询 `Code Refactoring Skill detect-smells.py github` 得到luongnv89/claude-howto候选，再以其官方API固定SHA获取03-skills/refactor/SKILL.md/许可证，本机正文完全相同。内容身份已证，历史安装过程未证。
9. 针对“候选有无效果证据”阅读Superpowers行为测试说明及源码中real-session说明，查看Compound测试/skill-eval相关记录入口。只得到了机制/维护者测试与经验材料，未找到足以支持Hima适用净收益的受控比较；不宣称全世界不存在研究。实证论文与独立反证由root另行处理。
10. 停止检索：关键身份、版本漂移、副作用和最强反对意见已得到原文支撑；不再增加方案或下载依赖。

## 关键核验结果

- 11本机skill全部存在。ask-matt和improve-codebase-architecture不在本轮catalog，但文件可读；没有由此断言“无法使用”。
- Matt的grilling路径是 `skills/productivity/grilling/SKILL.md`，其余本轮8项为engineering。local锁不是安装commit证据。
- 所报latest release只是API返回，审计HEAD另列；特别Matt HEAD已merge release/v1.3，但latest正式release仍v1.2.3。不能把这两者合称同一版本。
- 所有7个身份源的许可证原文已读为MIT；README/网页自述没有替代LICENSE核验。
- 没有把OpenSpec verify的源码映射推断写成测试通过；没有把spec-kit可选test任务写成强制TDD；没有把独立agent数量等同于独立业务oracle。
- 源码内的数字/断言（例如debug“90%/95%”、固定3次/5次失败门槛）当作者规则/表述，未当实证结果。

## 可重复读取与文件

`skills-raw/remote-manifest.json`：5组固定HEAD及压缩包SHA256。

`skills-raw/<owner>--<repo>/{repo-meta,commit-meta,release-meta}.json`：API原件（后两本机出处只取commit及选定原文，未做完整tarball/发布查询）。

`skills-raw/<owner>--<repo>/source/`：源码snapshot；全repo保存是取证，不等于安装、加载skill或逐行审计。

`skills-raw/local/`：11本机skill副本；`local-lock-extract.json`：仅Matt相关9项lock。

`skills-raw/diff-*.patch`：本机SKILL.md与固定上游差异。

`skills-sources.json`：43条claim/location/limit与11个本机身份。

`skills-evidence.md`：可供综合的中文证据包；fixed SHA来源链接在末尾reference definitions。

复核方法：对source文件用 `sha256` 比对JSON，或从 `https://raw.githubusercontent.com/<repo>/<fixedSHA>/<path>` 只读重取。GitHub API返回时点与采集时点均为2026-10-03 UTC；文中维护状态是该时点快照。

## 已知限制与失败处理

首轮聚合输出过长发生截断，随后拆分读取关键SKILL和附属文件；不以被截断内容作为唯一证据。一次枚举lock误触目录得到IsADirectoryError，未写任何用户目录，后续限定读取已知`.skill-lock.json`。Superpowers旧 `.codex/INSTALL.md` 路径当前不存在，未由此推论不支持Codex，安装方式不是本轮判定重点。没有为补齐缺失路径去安装软件。

研究未记录可归属token/cost；执行与等待时间未形成严格完整计量，因此不估算费用或声称效率收益。未做运行期效果、供应链安全、全部可达指令或法律许可证相容性的全面审计。
