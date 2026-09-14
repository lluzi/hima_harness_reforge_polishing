# [PLS-34] 用现有格式交付可迁移的定制 Cell Fmax-DTCO Pack

状态：ready-for-agent
父规格：[Product Upgrade v2](../spec.md)
模型：`gpt-5.6-terra` / medium；方法/证据边界由 `gpt-5.6-sol` / high 复核
最低测试：L0 + Pack L1/L2；稳定后分开的 L4 tool/model probe

## 用户场景

用户安装一个业务 Pack，提供新的 RTL/design、约束、PDK/库和当前 DC/LC/Innovus Site。Pack 自己完成定制 Cell机会发现、生成、表征、采用、route和唯一变量 Matched Comparison，不要求 AES或客户 Golden Flow。

## 当前证据

- `packs/aes-tsmc28-dtco@5` 已表达完整 51节点业务、六路挖掘、Workshop、增长、route、报告和资产，但 `contract.yml` 明确要求 `aes_cipher_top`，`probe.py` 拒绝其他 design，并绑定 TSMC28输入。
- 当前 Campaign 得到负结果且存在 selector输入理解错误，不能证明 Pack 对新 design的自主研究价值。
- Harness 已支持 `analyze`、`grow`、`revise`、history、Judge和依赖失效；先改 Pack，不另加 Runtime动作。

## 固定代码范围

- 保留 `packs/aes-tsmc28-dtco/**` 原样作为历史/回归来源。
- 新增同格式 `packs/custom-cell-fmax-dtco/`：`INTENT.md`、`SPEC.md`、`FABRIC.md`、`TEST.md`、`VERSION.yml`、`contract.yml`、`graph.yml`、`semantics.yml`、`knowledge/**`、`tools/**`、`readers/**`、`rules/**`、`choosers/**`、`flow/**`。
- 优先复用/参数化现有 `flow/domain/**`、`stages.py`、`shared_synth.tcl`、PnR template、selection template和 readers；不复制无用 AES fixture。
- 新增 `test/contract/custom-cell-fmax-pack.test.ts` 和有限 held-out local fixture；复用 `aes-domain-stages.test.ts`、`aes-analysis.test.ts`、`aes-full-graph.host.test.ts`、`dc-reader.test.ts`。

## 精确增量

1. Pack 输入只要求真实生产资料：design root/RTL/top/clock/constraints、foundry/physical/library inputs、workspace和当前工具栈；Golden Flow不是必需输入。
2. Site binding承担路径、环境和工具入口；Pack声明 Design Compiler、Library Compiler、Innovus及推荐版本，不锁精确版本。
3. 工具小版本差异先由 Campaign私有 adapter/`revise` 查 Pack知识、手册、安装目录和man适配；成功形成 Pack Owner候选，失败给人完整报告。
4. 挖掘算法必须读取当前 design/netlist/timing/library真实数据，产生多个数据依赖候选；不允许固定 AES结构或预制答案。
5. Agent根据证据编写/修订选择算法并可使用现有 grow/revise；参考图保持，新增研究有影响范围、结束和返回。
6. A/B流程、设置、工具和输入完全一致，唯一变量是新 Cell/library content；公共 floorplan、constraint和PnR设置不得为一臂改变。
7. 成功要求 route完成、最终 database/report身份一致、新 Cell有效实例大于零，最终 timing从该 database得到更高 Fmax且没有使结论无效的已知故障。
8. 面积、功耗、拥塞和物理事实如实报告但不作为Fmax门；未测量明确标记。
9. 负结果、工具故障、覆盖不足和未知分开；Campaign知识进入现有 run-assets，不自动升级方法。

## 保持项

- 不改变 HimaFabric、Ledger、Judge、Run/Job或 reference graph语义。
- 不扩展到 Genus、Linux Desktop、通用 DTCO或自研 EDA工具。
- 不把原 AES成功/失败或 stand-in指标当 held-out结果。

## 验收标准

- `checkPack` 在两个不同 design绑定上通过，不含 `aes_cipher_top`、固定 TSMC28路径或 Golden Flow前提。
- 本地 fixture证明候选依赖输入、A/B唯一变量、adoption读取和无效比较拒绝；不声称Fmax。
- 一次 L4真实工具最小 probe证明当前 Site输入和报告格式；一次 L4模型任务证明Agent能根据新数据写不同算法。
- Pack报告能追到算法、Cell、最终 database、timing和其他PPA事实。
- 未出现现有 Pack无法表达的通用行为时，Harness源码零业务专用修改。

## 测试

- L0/L1/L2：`pnpm run test:local --files test/contract/custom-cell-fmax-pack.test.ts test/contract/aes-domain-stages.test.ts test/contract/aes-analysis.test.ts test/contract/dc-reader.test.ts test/contract/pack.test.ts`。
- L4：模型和真实工具分开，各一次最小 probe；不重复完整 Campaign。
- L5只在 PLS-35。

## 依赖、并行与回滚

方法内容可与 PLS-27～30并行；根 metadata/knowledge manifest在 PLS-28/30接口封板后接入。任务独占新 Pack目录。回滚删除未发布新 Pack，不修改或删除 AES Pack、客户输入或历史资产。
