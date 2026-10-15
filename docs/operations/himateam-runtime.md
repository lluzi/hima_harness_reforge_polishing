# HimaTeam 冷备份与停止态恢复

本说明对应 #108 在 `9aa32ccc1f761196be57756995617d98e2273ad2` 上的维护增量。叶模块已有
文件系统验证；Host 关闭顺序、Desktop 原生入口及服务内部维护选项须与同批共享接线一起集成。
真实 Hindsight/PG 组合、Mac 原生窗口和 Linux 原生窗口尚须分别验收。本说明不是安装资格、
整票完成或发布声明；#110 的打包与 Linux 分发 HOLD 不因此解除。

源码中的固定基线为 Desktop `0.3.0-trial.47`、Harness `0.3.0`、DSH `0.2.0-rc.2`、
DBOS `5.2.11`、PostgreSQL `16.15`。Team 组件目录固定 Hindsight `0.10.3`、Python `3.12.13`、
pgvector `0.8.7`、OAR `0.46.0`、Pi `1.1.0`、OpenCode `1.18.34`。实际运行身份仍须核对
分发 manifest、Team manifest、可执行字节与许可材料；目录中的版本并不证明已安装或已通过验收。
资产与许可证清单见 `packages/desktop/team-runtime.pin.json` 及各分发物内 notices。
本增量不下载组件、不安装服务，也不另建数据库或执行内核。

## 原生维护入口

集成后，普通 App 在准备 Home、启动 Host/PG 前提供原生选择：`Open selected Home`、
`Data maintenance`、`Choose Home`、`Quit`。可以明确选择已有 held Home。维护返回后，只有
人选择打开 Home 才进入准备流程。Driver 模式不走此对话框，不能用 Driver 的通过替代原生入口验收。

准备失败的窗口仍保留 `Data → Offline backup and restore…`。已有 Host 或启动流程仍在运行时，
先正常 Quit，再重开 App 选择维护；隐藏窗口没有停止 Host。维护还会核对实际 Host PID 与 PG PID
回执，无法证明已停止时保留 Home，不删除锁、PID 文件或强制结束未知进程。

维护操作由原生目录/保存选择器选路径，无需开发者终端：

- `Inspect backup`：核对完整 manifest、全部文件、服务导出及 hash，显示版本与平台。
- `Create backup`：从停止的权威源创建一个新的备份目录。原目录和已有备份不被覆盖。
- `Final backup for transfer`：先选唯一的新 Home 目标，再选备份目录；完成后退休源 Home。
- `Restore held`：将所选备份复制到不存在的新 Home；导入前先写 hold，不启动 Host、服务或任务。
- `Qualify restored Home`：人审查最终源退休备份和较晚的决定/外部效果后，使用原冻结 App 做资格核对。
  核对失败继续 held；成功也不启动 Host 或投递任务。之后由人明确打开 Home，团队工作仍须原控制中的人工继续决定。

完整备份与资格核对需要原完整分发物及其相邻的 `trial-manifest.json`。源码窗口可检查与导入备份，
不能假装自身就是固定分发物。恢复限定同 OS、同架构和兼容的固定 PostgreSQL；Mac 的通过不覆盖 Linux，
不承诺跨机或跨 OS 可执行迁移。两个 Home 外的私有 lineage 权威仍是最终退休资格的一部分。

## `/2` 的完整边界

继续复制整份停止的 PGDATA、Home、原分发物、原运行时及引用材料。应用库保留团队定义/版本/成员、
附件与修订原字节、消息/投递 attempt/引用、经验原文及更正/采用/禁用事件、原生会话/上下文与轨迹、
任务控制/撤销、冻结程序与 DBOS 状态。Hindsight 的服务数据同时保留在物理集群和完整原生 admin 导出中。
服务导出是实际字节，逐项核对 cutId、generation、路径、字节数、SHA256 及真实停止回执。

这是一份敏感的完整备份，包含凭据、对话、工程材料和记忆。按整个目录保护它；不要仅分享 manifest，
也不要把 refs-only 清单称为无敏感数据的完整备份。

统一静止 cut 的顺序是：

1. 既有 Host admission fence 拒绝新工作及记忆写入；加入已接纳的记忆调用，收束所有成员和 Job。
2. 复用真实退出状态核对 ready、空 agents、各 Run 的资源已关闭，并固定 finalizing request。
3. PG 仍在线时，在同一事务中对 Hindsight 全部 public 表取得 SHARE 锁，阻止异步 worker DML。
4. 调用原固定 admin exporter，核对实际文件/hash；跨越导出到真实 service stop 期间一直持锁。
   若服务先前已停，只运行同一 admin CLI，不为备份重启 Hindsight worker 或恢复记忆操作。
5. 写入完整的维护 cut 回执；停止其他服务、DBOS/连接池及原私有 PostgreSQL，留下实际冷态 authority。
6. 冷态 API 核对同一 Host/process identity、未释放的 finalizing request、时序、服务数据库回执及所有字节。
   只有这些条件与原 `/1` 完整分发/外部资源要求同时成立，才发布 `/2` 完整目录。

空目录、窗口关闭、单独 status 或一份以前成功的导出均不是统一 cut。新尝试先使旧 cut 失效；中断、
异 cut、异代、缺项、零字节、hash 改变、Host/PG/原 Job 仍存活或外部效果不明均不能报告 complete。
服务锁/导出失败不妨碍 Host 继续尝试正常资源收束，但该 Home 缺少新 cut，不能生成完整 Team 备份。
应保留原 Home 和 partial，使用原 App/固定运行时核对失败原因后重新取得有效 cut。

## 旧备份、失败与回退

`hima-cold-backup/1` 仍可检查及 held 恢复，原 final retirement、原材料路径、原 effect、版本和
lineage 检查保留。旧 `/1` 的读取不等于补发了一份 `/2` 服务 cut。存在 Team 数据的新源没有新 cut 时，
不能通过降写 `/1` 绕过服务完整性。只含旧业务、未产生 Team 数据且没有新 cut 的源保留旧创建行为。

旧 `/1` reader 的版本检查会拒绝 `/2`；应用数据库也沿用既有 schema 版本拒绝不支持的库。不要修改
manifest format、schema_version、applicationVersion、hold 或 lineage 文件强行打开。
回退保留原 App、原停止的 Home、原完整备份及相应 notices；已产生新决定/外部效果时须取得该源的
新最终退休快照，不能恢复旧备份并把较晚事实当作不存在。

资格核对始终用最新完整快照替换整个 held Home，不合并选定表或 checkpoint；前一份导入保留为
previous 目录。原绝对材料路径有冲突时不覆盖。经验的禁用/撤销记录原样保留，导入或资格核对不调用
重新采用、重投递、模型或工程任务接口。未知较晚外部事实、已激活目标丢失、源未退休、库/分发不兼容
或资源停止不明时继续 held，并保留具体原因。

## 原生成员与停止态导出的补充边界

原生成员的 lease、control/config、DB effect facts 和 checkpoint origin 都保留原身份与原 cwd，
不通过批量替换旧 Home 字符串来恢复。资格核对须找到同一原 effect 的 lease/关闭事实，核验归属于
已退休 Home 的成员材料目录、原始字节和所需 checkpoint，并仅恢复这些材料子树。已有原目录字节
冲突时拒绝，不覆盖原件。资格回执记录经核对的原目录及 lease/config hash；新 Home 的原生读取器
只在既有 hold、lineage、manifest、epoch 和退休归属检查通过后使用该绑定。

原冻结读取器也必须支持此路径绑定。旧读取器、不完整的原成员目录、缺失原 effect/关闭证明或不支持
的 predecessor 绑定继续 held；不能显示为已经可完整继续。原生身份、checkpoint hash 和 cwd 的原守卫
保持；取得读取绑定本身不创建成员、调用模型或投递任务。真实 PG/native 接续资格仍须 I 的独立窗口，
纯文件中的 staged/never-started lease 与合成会话检查不能替代它。

停止态 admin 导出使用独立的 DB-only 配置回调，仅取得既有私有 `hima_hindsight` 连接，不读取或要求
模型、provider 或 API key，也不复用缓存的 worker 环境。普通服务启动继续执行原模型配置守卫。
维护只读取原私有凭据并使用当前已拥有的本地 PG 端口，不调用会初始化数据库/扩展的启动准备接口；
缺失或不合法的原凭据明确拒绝，不创建新的凭据或空数据库来替代原数据。
固定 admin CLI、数据库和导出文件仍须真实验证；缺少这些资产或不能取得原数据库时明确失败，
不通过伪 key 或启动 worker 绕过维护失败。
