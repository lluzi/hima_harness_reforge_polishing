# ATCS-04 — 补齐 worker XTop 上下文、wrapper 与 Site 资格面

状态：ready-after-ATCS-01  
依赖：ATCS-01  
产出：关闭 G34 的代码侧缺口；为 L4 提供候选 wrapper

## 问题

来源 Pack 的 worker session 缺少冻结 control Pack 已验证的 timing library、STA data、site map、
removable-filler、placement readiness 和 `eco_*` 设置。机械 XTop 操作可能成功，但研究结果无法代表有
timing 视角、与 replay 一致的 ECO。

## 代码范围

- `flow/templates/xtop-operator.tcl`、`xtop-replay.tcl`；
- `flow/atcs/adapters.py`、`workspaces.py` 和只影响 session context 的 fixture；
- `sites/linglong-atcs28/atcs-xtop-operator.sh`、`site.yml`、`permit.yml`、README；
- `siteCapabilities.json`、analysis-contract 输入；
- 新管理员 wrapper 路径和 binding 生成入口，不能覆盖历史 wrapper。

## 实施

1. 对照当前 `xtop-timing-closure` 已资格模板，列出每项上下文的来源、作用和是否适用于 ATCS。
2. worker/replay 使用同一 library/site/placement/eco 参数合同；slot edit domain 和 name prefix 仍独立。
3. STA data、library Tcl、LEF/netlist/DEF、site map 都有路径、hash、read-root 和存在性检查。
4. wrapper 固定 image、adapter/template/flow digest、workspace root、slot、license mode；不允许任意 Tcl source/exec。
5. route-preserving export、before/after dump、ops log 和 close 都有 typed command 与 receipt。
6. wrapper 作为新版本安装，历史 ATCS/control wrapper 保留。

## 验收

- 本地 fake wrapper 证明环境/argv完整，缺一项在启动 XTop 前拒绝。
- worker/replay 的合法性设置相同；差异均有业务理由和测试。
- Permit 只开放 Pack 所需 read/write roots 和新 wrapper。
- interactive command catalog 不含 raw shell、source、exec 或任意 Tcl。
- `empyrean-license old` 是 L4 前置；实现/单测不切 license、不启动 EDA。

## 测试

```bash
python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -p 'test_adapters.py'
python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -p 'test_workspace_isolation.py'
PATH="$HOME/.local/node24/bin:$PATH" node scripts/run-contract-tests.mjs local --files \
  test/contract/agentic-timing-closure-system.test.ts \
  test/contract/interactive-binding.test.ts \
  test/contract/interactive-runtime.test.ts
```
