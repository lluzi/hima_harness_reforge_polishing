# 增长、回溯、预算与知识资产批次

状态：实施中，尚未验收。基线 `6438c9f1cb76075bc31b25338b6937ac48d1a6bb`。
任务范围：PLS-10～12、PLS-14～17；PLS-18/26 完整 pilot 和独立用户验收另行保留。

## 执行与边界

先推进 PLS-10 与 PLS-14，分别解除 11→12 和 15→16、17 的依赖。
独立准备工作可以穿插，任务验收仍须满足依赖。沿用同一个对话执行 Agent、Fabric、
Ledger、Experience 和 Pack 的方法身份，不增加图引擎、归档服务或检索服务。

初始分工：Astra/High 主任务协调接口、集成、用户入口与验收；Sol/High 隔离 worktree
实现 PLS-10；Terra/Medium 隔离 worktree 实现 PLS-14。两 worker 不递归派工。
共享 Ledger 的记录类型/迁移、导出及测试清单由主任务合并；各自仅修改所属功能的部分。
后续实际模型、Effort、并发与升级在交付记录补记；token/费用尚未测量。

## 预先确定的验证接口

使用现有公开 Host 工具、Fabric 操作、Ledger 记录/RunView、真实文件安装/导出和
Experience 读取接口。用独立反例验证行为，不另建模拟 Fabric 或复制判断规则。

| 任务 | L0～L2 主验收 | 集中的昂贵检查 |
| --- | --- | --- |
| 10 | 声明位置追加、坏图拒绝、参考 hash 不变、去重、返回和重启 | L3 实际分支；L4 模型提议工具 |
| 11 | A→B→C 与独立 D；代码/输入变化、同名报告、残缺结果和重启 | L3 历史/当前；仅远程语义变化触发 L4 Site |
| 12 | 总预算、收尾预留、写入累计、取消优先及跨重启边界 | L3 停止提示；L4 小模型边界 |
| 14 | 实际材料、hash、缺失、早期失败、暂存/发布中断、篡改与补交付 | L3 离线阅读；新增传输用一份真实 Site 材料 |
| 15 | 真实/虚构引用、对照条件、环境声明/探测、算法及未知 | L3 报告；L4 有来源的研究解释 |
| 16 | 有限资产选择、授权/适用性、篡改拒绝、实际读取引用 | L3 出处；L4 一次历史负结果支持的新研究 |
| 17 | 内容审阅、确认失效、升级/迁移恢复、默认排除与显式分享 | L3 owner 确认；文件操作不启动 EDA |

每个切片先运行相关子集；最终集成后运行一次完整本地套件。L3 合并关键用户路径，
不在窗口穷举坏图或文件故障。L4 可在一项有限研究中覆盖关联工具，但逐项记录实际
触达的行为，不把一次模型回复冒充整组边界通过。历史真实 EDA 证据仅按原身份引用。

## 当前已核实缺口

- `experience.ts` 只有 Site 报告与 hash；没有 workspace 的早期结束返回 nothing，
  不能交付 Pack 内知识资产。
- 预声明 Loop/revisit 不能表示一个运行中才提出、参考方法中不存在的研究节点。
- `installPackMethod` 保留方法历史和资产，但中断 marker 使安装被拒绝；还需要可验证的
  恢复和基于实际清单的 owner 分享/迁移操作。

原始命令、退出码、耗时、通过/失败/未跑及实际依赖调用在完成后追加。

## PLS-17 独立准备切片

已实现现有 `release.ts` 内的 `recoverPackMethod`、`previewPackTransfer` 和
`applyPackTransfer`：恢复已持有旧/新方法的中断更新；按精确内容清单审阅升级、
方法分享、显式材料分享或自身迁移。确认内容变化即拒绝，暂存导出不显示成完整目录。
既有浏览器 session fence 内的 owner 入口在同屏工作区 `Pack & assets`。
单用户 owner 信任范围不扩展成企业租户授权；无公网发布操作。

这只是独立准备，不关闭 PLS-17：仍待 PLS-14 归档接口集成、升级/资产交接复核与
批次独立审查。最终完整 local 套件尚未运行。

证据位于 [owner-preparation](owner-preparation/)：

- 当前源码 build/typecheck、seam/boundary 检查通过。
- `test:local --files test/contract/pack-method-assets.test.ts`：14/14，13.538 秒，
  4 个 in-process Host，零 Electron/SSH。
- `test:desktop --files test/contract/pack-owner.desktop.test.ts`：排版修正后 1/1，
  16.999 秒，1 个 Electron，零 SSH。配置 replay provider 但不发送模型请求、不启动 EDA。
- 首次窗口检查因 fixture 未配置 provider，停在模型设置页；另有缺少测试目录和
  尚未实现接口的失败，原日志保留。修正 fixture 后真实 owner 点击与文件 hash 核验通过。
- 当前截图人工读取确认长路径换行，hash 摘要与完整清单可下钻；不是全产品视觉验收。

实际开发：主任务 Astra/High；两个 worker 仍分别推进 PLS-10 与 PLS-14。
API token/费用未测量。代码回滚限定这些新增函数、入口和对应测试，已存在资产不删除。
