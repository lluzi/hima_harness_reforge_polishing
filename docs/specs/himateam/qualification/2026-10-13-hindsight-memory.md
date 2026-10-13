# P07 / #104：持久经验、中文召回与纠正

日期：2026-10-13。源码起点为 `8af3f1add5cf553ff4005b22dddf58cd278ff0cf`，工作分支 `codex/himateam-platform`。
本记录覆盖现有开发环境中的功能；不授权 main 合并或发布，App/Linux 分发 #110 继续 HOLD。
最终 Git hooks、推送及远端 SHA 由同票交付记录补充，未完成这些步骤前不关闭工单。

## 行为与事实归属

应用 PostgreSQL 迁移 5 保存不可变内容版本、采用/撤销/纠正事件及固定 UUID 的待索引操作。
反馈先落库；依赖停机时状态与原事实可读。人类明确采用后才允许注入；Guide/成员只能提议。
纠正立即产生替代候选，新版本需另行采用，迟到索引不能改变当前版本或采用状态。
撤销与独立的人类纠正不依赖旧源仍可读；重新采用仍需要撤销之后的新证据。
派生经验的反馈来源被纠正/撤销时，在最后一次应用库检查抑制；旧来源与原请求重放保留历史意义，不重新采用旧结论。

成员私有、项目条件经验、团队方法分别使用 Host 解析的范围。当前授权包含项目及原 Team 身份；成员私有范围进一步绑定成员。
同一已授权 Team 后续任务可查共享项目/团队经验和自身私有经验；按定义创建/复制的新 Team 没有原记忆绑定。
这不是给同一文件系统项目中的所有 Team 自动开放历史资料，也不进行自动跨项目提升。
材料、成果和归档仍由已有来源读取/完整性接口核对；Hindsight 不取代原件、Run 事实或授权。
Team 的首次采用事件在应用 PG 中保存，不把 Team 状态伪装成旧 `experience.json`，也不改变旧 Ledger 格式及 disabled/re-adopted 历史。

Hindsight 0.10.3 通过现有 Host 生命周期和 DeepSeek 环境配置使用。
异步 ACK 仅记 submitted；父 `batch_retain` 完成且精确原文、版本元数据和文档身份吻合后才记 confirmed。
丢 ACK/依赖恢复核对原 UUID；仅父操作及文档均确证不存在才用原 UUID/原内容再提交。
已清理父操作而文档仍在时保留 unknown。服务密钥、bank、连接和私有载荷不进入公共投影。
显式刷新/查询可推进有界补写，没有新增后台调度器。

## 实际验证

| 层级 | 结果与边界 |
| --- | --- |
| L0 | 正常 Node 24 构建及整仓/客户端/测试类型检查通过；最终提交仍执行原 hooks |
| 登记 local | 协议、配置、UI、记忆叶模块及真实 Host/PG 反例通过；最终全 local 以原 pre-push 输出为准 |
| Host/PG | 两个登记用例，三次真实 Host 启动；并发同请求唯一身份、不同内容冲突、不可变 v1/v2、陈旧 CAS、迟到旧 retain、反馈源伪造、跨成员/项目/过期/撤权、查询期间撤销、跨候选源检查竞争、新证据重新采用、重开/clone 保持分别验证 |
| 原生中文 L4 + 实际 UI | 1/1 PASS，0 skip，75.384 s；App/Host/PG/Hindsight 总 RSS 峰值 2893.89 MiB，在既有 3072 MiB / 600 s 与原 Host 守卫内；Catsights 屏幕，实际点击保存、采用、查询、纠正、再次采用及撤销 |
| 固定组件 | Hindsight 0.10.3；DeepSeek `deepseek-flash`；BAAI/bge-small-en-v1.5 commit `5c38ec7c405ec4b44b94cc5a9bb96e735b38267a`；ms-marco-MiniLM-L-6-v2 commit `233902d25c440f23af6f7d6e94d2946bac0bee0a`；实际权重哈希与固定 manifest 核对 |
| 中文独立预期 | 工程师反馈 SRAM 37 ns；中文问法和 SRAM/access latency 混合术语均返回精确 Host 事实、原生摘录、原文 hash/来源与 v1 文档。纠正为 23 ns 后明确采用，两个问法只应用 v2；撤销后不注入；clone/其他项目拒绝串用，停机后原事实仍可读 |
| L3 布局补验 | 仅 CSS/已有 Team 滚动容器变化后，以零模型实际 Electron 重走保存/采用/纠正/撤销及窄面板几何检查。Team/记忆区没有横向溢出，卡片在可见边界内；6.269 s，1700.97 MiB；不重跑未变记忆引擎的真实模型验收 |
| 资源收束 | 原生测试明确停止同一 Hindsight generation，再正常退出 App；监控纳入 daemon PG。最终 owned PID 均不存在、PG PID 文件移除；不处理其他历史数据库 |
| 模型/复核 | 主协调 gpt-6.1-sol/high，实际当前 session 元数据核对；明确叶编码 Sol/medium；独立 Standards/Spec Sol/high，来源失效/共享范围/补写/条件及 UI 权限等发现已修复；实际 DeepSeek 请求/token 数未单独计量，Pi/OpenCode 本票验收未启动 |

召回也返回了一个已采用的 UART 干扰事实；上述通过证明固定组合能找到正确 SRAM 事实与纠正，不宣称精准排序或普遍中文质量。

## 失败与修正

保留所有原失败：keyless 引导错误等待已配置环境的对话框；隐藏模型配置输入导致 locator 歧义；旧 watcher 实际 1536 MiB 与获准 3072 MiB 不符；实际面板区块覆盖输入；长来源与 Team 身份横向溢出。
前两项在进入 Hindsight/模型前失败。错误 watcher 中断留下唯一自有 PG 25698，已按精确数据目录通过 `pg_ctl -m fast -w stop` 收束，原 Home 与关闭凭证保留。
后续监控严格使用既有 3072 MiB，纳入已 daemonize 的自有 PG 及子进程，不增加预算。
布局缺陷修在现有 Team 页面、记忆面板样式与工作台滚动容器，真实控件/几何补验通过；没有 force click 或掩盖断言。

证据根为主 polishing 工作区的 `.scratch/himateam-issue97/`：

- `2026-10-13-parallel-next/memory-*-result.md`、`memory-*-review*.md`：叶证据、独立发现与关闭。
- `local-memory-bounded/native/integration-issue104-*.log`、`*-result.json`：预期 RED、类型失败、受影响 local/Host 与构建资源。
- `issue104-live/2026-10-13T17-34-40-888Z/`：实际中文输入、原生摘录/documentId、组件/权重身份、UI 动作、截图及最终 cleanup/result；`source-build-identity5.json` 绑定源码与构建。
- `issue104-desktop/2026-10-13T17-56-18-829Z/`：零模型控件与可见宽度几何/截图/关闭。
- 先前 live/desktop attempt 目录：原失败；`issue104-live/2026-10-13T17-27-09-349Z/manual-pg-closure.json` 是唯一残留 PG 的追加关闭凭证，不把原中断改成 PASS。

#107 负责 Hindsight × 活动 Pi/OpenCode 上下文纠正、退出补写/不唤醒及后续组合；#108 负责同 cut 备份/恢复。
本票不宣称已运行成员忘记旧内容、不证明备份完整、不发布安装包；这些边界不阻止独立 #104 功能交付。

回退须保留原 Home/数据与当前二进制。迁移 5 之后旧迁移 4 构建会明确拒绝该数据库；不为回退删除记忆表或撤销事实，也不把旧构建直接接到已升级数据上。
