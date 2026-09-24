# #44：双格式库绑定的有界 Design Compiler 检查

2026-09-24。在独立 Site 目录 `/data/eda/project/hima_harness/issue52-dc-qualification-20260924`，把当前 development Pack `custom-cell-fmax-dtco@5.2.13` 的 `flow/` 复制为私有方法；未修改此前的 Campaign、Site 原配置或任何 Liberty/DB。源与执行副本的 SHA-256 一致：`bind-inputs.py` 为 `03fc1b120ff990f9e01149477984b3fd3e42e3d278498d611408c912765a82af`，`stages.py` 为 `39b81a9925a021276b53edec4871abc11242bc44a0aa62d36b9610dd0c95b0de`，`domain/shared_synth.tcl` 为 `86aae308d887e92b109b2616d02ca6016adc0ebd904262358d5ffd0fa861e762`。

第一遍直接使用旧 Site `physical-inputs.json`，bind 在写 `inputs.json` 前拒绝：缺 `FOUNDRY_CDL`。隔离副本补入同一 TSMC28 family 的 `Back_End/spice/..._110a.spi` 后，再被当前 8 代容量门拒绝：原 `MAX_CELLS=160`，但 `8 × MAX_NEW_CELLS(40)=320`。仅把**隔离副本**调成 `MAX_CELLS=320`，副本 SHA-256 为 `a89d68e81f30bac0d2dcf8062b58efbd5dc955c6bb30a26ecb668e05f62cc04f`；第三遍 bind 通过，产生 7 个 RTL 文件的输入记录，`flow/inputs.json` SHA-256 为 `0b7e7798ffe0c9b97fdf2d7a6f3bbc357ec2162d2040a15c18d844dc6c60bd27`。其中 `FOUNDRY_LIB` 是 `...tt0p9v25c.lib`，`FOUNDRY_DB` 和 `foundryDb` 是匹配的 `...tt0p9v25c.db`。

随后只运行 `timeout 900 python3 flow/stages.py foundry-synth <isolated-workspace> 0.5`。Design Compiler `X-2025.06-SP3` 工具退出 0，Pack stage 为 `passed`；日志中 `File is not a DB file`/`DB-1` 命中 0。保留的 `flow/records/foundry-synth.json` SHA-256 为 `82fefcf0e829d39dc23b64aa338a07a2a01383c2a18be0384d14bf98bc9efc65`，记录 20 条 reg2reg 路径、WNS −0.11 ns；非空网表 926,143 B，SHA-256 `1f32a88651d5fa60a6dd2f53d0f987cf7f6781c28711e60846405d57e8acc4c0`，SDC SHA-256 `0945486405c4dc14922cf2a86d1dfa257943255a6c857d9fe002cec366ab79e8`。这些数字只证明当前绑定进入真实 DC 后被接受，不是新的 PPA/Fmax 结果。

本次没有运行同一 Fabric Campaign 中的 `compile → foundry-synth` 连续节点，也没有把隔离的 Site profile 修补回原配置；#44 仍开放。要进入完整 Campaign，Site owner 需先资格化并版本化 CDL 路径、320 的累计 Cell 容量和其余当前 Pack 绑定。执行前后 `empyrean-license status` 均为 `selected=new old=inactive new=active`；本作业使用 DC，没有启动 XTop 或 QuaLib API。

同一固定源码 `ee4a65ba0599e09e3af0955c7273ba9c11292a92` 的完整 local 套件随后通过 **632/632，0 失败，0 跳过，0 SSH 子进程**，日志 SHA-256 `5f6a24e66c7f1c9b83e8e22c36932f8bcd8361340737c829a507d346f59a7b51`，耗时 2,119 秒。它是 L0–L2 本地合同，不替代该 Issue 的连续商业链或 Claude 桌面拟人验收。开发与核对使用 GPT-6 Sol / high；该切片的独立模型 token/成本未可靠计量。
