# #50：交互式 EDA Operator 的生产隔离前置检查

2026-09-24 在 `linglong` 只验证运行环境的文件系统边界，不运行 XTop、QuaLib API、Hima Campaign 或交互 ECO。许可证执行前后均为 `selected=new old=inactive new=active`。所有写入位于新建的 `/data/eda/project/hima_harness/issue52-operator-isolation-20260924` 内，其中 `private/` 为允许写入，`protected/` 为同一试验拥有但不应被容器写入的负例目录。

- `bwrap` 可执行文件存在，但该账号的独立运行在设置 UID map 时被拒绝：`bwrap: setting up uid map: Permission denied`。这条路径当前不具备最小可用资格。
- 已安装的 `/usr/local/bin/edarun` 使用长期 Podman 容器；检查其脚本发现 `/data/eda`、`/home` 读写挂载，host network、`seccomp=unconfined` 和容器内 root。它适合已有 EDA 兼容环境，但不能单凭这条边界将自由命令的生产 mutation 标为隔离合格。
- 另一个临时容器使用 `podman run --rm --userns=keep-id --network none --read-only`，将 `/data/eda` 只读挂载，仅将试验 `private/` 再挂成读写。容器在 `private/allowed-podman.txt` 写入成功；写 `protected/should-deny-podman.txt` 返回 `Read-only file system`，宿主上该负例文件不存在。容器结束后没有保留服务或运行会话。

这只证明当前镜像和 Podman 能在该简单负例中执行只读全树、单个私有写根；没有验证 XTop 的运行依赖、许可证网络、脚本 `source/exec`、交互回执/恢复、数据库保存、其他逃逸路径或客户 Site policy。现有 `interactive-binding.ts` 的生产 `mutation: unavailable` 门应保持。后续 F3 需先冻结工具镜像、只读依赖和私有工作区，再切换到用户指定的 `empyrean-license old`（59001）进行小型 XTop 资格；运行前确认无 QuaLib 2026 客户端，结束后核对许可证状态。开发/核对使用 GPT-6 Sol / high；没有可可靠归因的 token/成本统计。
