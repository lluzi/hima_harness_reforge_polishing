# P04 / #101：可信本机 Pi/OpenCode 原生验收

日期：2026-10-13。范围：用户自有 Mac/办公 LAN 上受信任的原生进程与插件。
默认执行为 Host → OAR → Pi/OpenCode，DBOS 仍为唯一持久执行内核。
强 OS 隔离、恶意同 UID 防护、App 打包/Linux 分发不属于本次验收；#110 保持 HOLD。
本记录不授权 main 合并或产品发布。

## 实际组件与配置

- Node 24.20.0；OAR 0.46.0；OAR bundled Pi peer 1.1.0；本机 OpenCode CLI 1.18.6。
- 使用现有 DeepSeek 配置：Host 当前选择 `deepseek-official / deepseek-flash`；环境字段优先，缺值复用 Host。默认无需另建成员 profile。
- 开发验收从现有安装缓存通过 `HIMA_OAR_MODULE` 指向固定 SDK，OpenCode 从本机 PATH 解析；不要求 `HIMA_TEAM_RUNTIME` 或 engineering-engine 就绪。
- 独立 cwd/config、最小环境、Host grant/API 权限、密钥脱敏、真实事件、实际文件哈希与进程收束保留。目录/进程分离不表示安全沙箱。
- 用户批准 OpenCode 成员及本次原生 L4 总进程树上限 2048 MiB；Pi 成员 768 MiB、96 PIDs、冻结的绝对期限与 Host 内存/磁盘/swap 守卫保留。原 Git hooks 总进程树 1536 MiB 不变。
- OpenCode 采用其现有 `OPENCODE_DISABLE_MODELS_FETCH` 开关停止背景模型目录刷新；工具、插件、原生压缩/子任务能力未被替换。未声称该开关降低内存。

## 已验证

| 检查 | 结果与边界 |
| --- | --- |
| L0 | 新构建、类型检查、seams/boundary/inventory 通过；提交/推送继续执行原 hooks |
| 本地合同 | 配置 10 项、真实 Node 子进程生命周期、丢 ACK 不重启、结果关联/交接与授权等子集通过；最终全 local 以 pre-push 输出为准 |
| 原生 L4 | 两 runtime 的正常执行、真实 MCP Host 成员上下文、实际 proof.txt/SHA256、成果接回/retained trace、正常关闭；两会话实际工具工作期间共存并分别取消，closed 且无成功结果 |
| L4 开销 | 一真实 Host，1/1 PASS、0 skip；100.886 s；采样总进程树峰值 1863.96875 MiB，低于批准的 2048 MiB；API 请求/token 数未单独计量 |
| L3 | 实际 Electron/Host 保存两种 runtime 的独立假凭据 profile、重载并核对导出不含密钥；1/1 PASS，25.310 s，零产品模型/原生成员启动；Catsights 指定屏幕，正常退出后所属 PID/PG PID 文件均清理 |
| 独立复核 | Sol/high 复核；大回复持久化与期限两项 P2 已修；交付 schema/身份及记录文字增量复核通过，最终 0 未关闭 P1/P2 |

本次 OpenCode 成果 SHA256：`8822ebe1c456a23bd2f14f09c14ded0b00451b49b1d6c741637f11453b876400`。
Pi 成果 SHA256：`08f52ae38f430d692cc9346241062344002150cff400a3e320e8a0c2fc126972`。

## 失败、修正与证据

保留先前 C7/安全探针失败，未恢复其执行。未被默认路径引用的实验 confinement 源码已按原字节保留到 scratch，不随本次原生入口交付。
本次真实反例包括 OAR 的 UUID 输入要求、OpenCode 旧 768 MiB 限额停止、Pi 缺少交付 envelope schema、团队任务 ID 与执行节点 ID 混淆。调用边界稳定映射、用户批准的 2 GiB、完整现有 schema 与明确 artifactIdentity 分别修正；Host 始终拒绝错误交付，未改写成果身份冒充通过。
OpenCode ACP 实际拒绝 `--smol`；通过零模型 argv 复现后删除此候选参数。
大回复在持久化前转为有界明确错误，旧超限回复可恢复；成员遵守冻结 Run 期限，不套用隐含四分钟时限。

本机证据根为 `.scratch/himateam-issue97/`：

- `issue101-live/2026-10-13T08-03-36-066Z/functional-results.json`：完整两 runtime 实际交付、取消、facts。
- `local-memory-bounded/native/integration-issue101-trusted-native-both*`：TAP 与 RSS/Host 守卫记录。
- `../oar-model-playwright/2026-10-13T08-08-49-823Z/`：界面结果、截图与正常退出证据。
- `2026-10-13-trusted-local-scope/native-final-review.md`：独立复核与源文件 SHA256。
- `local-memory-bounded/native/integration-issue101-native-final-local*`：最终文字回归首轮 32 PASS/1 夹具准备 FAIL；补齐 effect intent 后，相关 5 项 PASS。原失败未删除。

真实成员通信、busy 介入/恢复组合由 #105 承担；Hindsight 记忆由 #104 承担。本票不宣称这些后续组合已完成。
