# ATCS-05 — 关闭发布前 portability 与 correctness 缺口

状态：ready-after-ATCS-01

依赖：ATCS-01

产出：G33 关闭，post-route 发布路径无开放 P0

## 范围

本任务只处理会使 Pack 绑定 SWERV28 名称、错误判定证据或无法形成可迁移发布的代码缺口。
full-flow APR 的 Foundation stage pre-step 不在首个 post-route release 中实现；在 capability/readiness 中
明确标记 unsupported，防止误走。

## 代码范围

- `flow/atcs/core.py`：移除业务代码中的固定四 scenario authority；
- `adapters.py`、`verification.py`、`refresh.py`、`state.py`：从已验证 policy/scenarios 输入传递
  `requiredScenarios`；
- Site input fixtures、Python tests、Reader/semantics；
- SPEC/FABRIC 中 G5、G7、G19、G25、G29、G31/32/33 的当前结论。

ATCS-03 集成 `contract.yml`/`graph.yml`；本任务通过小提交交付其所需字段，不并行编辑共享 YAML。

## 实施

1. 两组不同 scenario 名称的 synthetic contracts 都能通过同一逻辑；缺失、重复、corner/library 映射冲突
   fail closed。
2. required scenario identity 在 baseline、observe、residual、presta、STA、evaluation、refresh 中一致。
3. clean mode、`-0.00`、PT violated annotation、truncation、missing endpoint 和 unconstrained regression 的
   现有保护不回归。
4. full-flow lifecycle 缺少已资格 stage pre-step 时，readiness 明确为 post-route-only；不自行重建。
5. `maxPaths` revisit、degraded-state follow-up 和 insertion RC unknown 保持诚实；若不阻塞 post-route
   correctness，记录为 release limitation，不扩张 Runtime。

## 验收

- Pack/flow 业务代码中没有四个 SWERV scenario literal；它们只可存在于 Site fixture、历史文档和测试输入。
- 两个不同 scenario-set fixture 通过；错误 set 的反例拒绝。
- 真实报告 corpus preflight 保持原结果或对每个变化给出解释。
- 首个 release 的 capability 明确 `post-route-only qualified`；UI/Guide 不宣称 full-flow APR 可用。

## 测试

```bash
python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests
python3 scripts/atcs-corpus-preflight.py --help
PATH="$HOME/.local/node24/bin:$PATH" node scripts/run-contract-tests.mjs local --files test/contract/agentic-timing-closure-system.test.ts
```

corpus preflight 的真实 SSH 读取属于 ATCS-06；本任务只运行 synthetic/local 路径。
