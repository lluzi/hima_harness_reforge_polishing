# #49：Library E1 开发 worker 的有界原生校验

2026-09-24，在独立目录 `/data/eda/project/hima_harness/library-intelligence-e1-manual-20260924` 手动执行当前 `library-intelligence@0.1.0` 的 Pack-local worker，不通过 Hima Run。该 development Pack 的默认图从 `blocked` 开始、没有可启动的 native tool；这是因为当前 Host 尚不能在 Job 启动前证明 Site 传入的 Permit 快照就是它实际加载的 Permit，也不能执法 QuaLib/XTop 的互斥模式。本次手动资格不能解除这两个产品门。

仅在 `empyrean-license status` 显示 `selected=new old=inactive new=active` 且未见活动 XTop 客户端后，复制 worker 和 Reader 到隔离目录。Site-local 资格 manifest SHA-256 `9a5d7f4fbb644a6f27b13bed1f4b5d36380a15c7e11feada4236894227f61ef5`；其中 Permit **仅为这次手动试验的快照**，SHA-256 `e8425f7bf1c0f9c93df986f49f68490352e845ecb1022abf37392f5e18bd719b`，不是 Host 已认证的 Site policy。worker SHA-256 `06d8b42a44994ff4ac6b3d3a4fcfdef8cd425672e9057fcfb9d4e819d45b9dcd`。它绑定 Python 3.7.12、`tmlib.py`、`_tmlib.so`、`libparser_wrapper.so` 的独立 SHA，以及源文件哈希；厂商 API 安装与 Liberty 原件未修改。

`timeout 600 /usr/local/bin/edarun <qualified-python3.7> <worker> <manifest> <workspace>` 退出 0。worker 为三份输入分别启动 native 子进程，查询 library/units/Cell/pin/arc/NLDM，写私有 `copy.lib`，重读并核对关键不变量；每项 exit 0、signal null、source-after SHA 与 source-before 相同。

| 输入 | 源 SHA-256 | 副本 SHA-256 | child 记录 SHA-256 |
| --- | --- | --- | --- |
| 厂商 `testParser.lib` | `0f72cff56a3ccb7e1bfeff4234c44bb85c42524d31eed18df7a59c40b4f47877` | `7a3bf3a6fd67599319767c7e7b107f511c1821b79f527a36ea00c34c4cb76278` | `c3866113acb8e0920e1b2bbe03d03bea03a3b738ad9c4db342eb4d1d63e01a7e` |
| SAED14 RVT TT | `49962e1b61d08eae063633ba32ab76fc002c405d40e391e181e92ff445442571` | `45718252a2055e9c2c09c84594f588c26ae8610e482970d04b18656470f40738` | `a896bed63f76e041a8467a7daaefb28a5333a4c07dc86f63f9054c0a21c29bb0` |
| TSMC28 TT | `a07fbf556c5aed51e08cbf19d916371dbb1b631ca926e46893ac8781fcb707b5` | `8896322785e97533e0b159d431489ff520dd50cc7a660f59205f436bef5dc485` | `92894172c8c31929bc80ab863642679e1527eb390b574ab900fe1a2765743397` |

最终 `flow/qualification/receipt.json` SHA-256 `5af540a97cb554b069757d6993d4e50e8c013053a8daf382a82828203785247d`，其中 `nativeStatus=passed`，但 `status=blocked`、`reason=hima/library-permit-unattested`、`permitAttestation=unverified-site-binding`。另用 Pack Reader 对保留的 manifest、源、worker、child、日志、副本和 receipt 重新核验，得到 `library_qualification_ok=0`。许可证执行后仍为 `selected=new`；没有运行 XTop、完整 corpus 或设计关联分析。

本地开发/验证采用 GPT-6 Sol / high。真实 Host 的**安全默认**用例证明即使绑定伪造的宽松 Permit，当前图也不能启动 native Job；独立 Reader/Judge 测试只证明零值与 blocked 判据。定点本地 22/22、0 SSH，TypeScript 测试类型检查和 seam/boundary 检查通过；该证据不等于 E1 产品接纳。后续需在现有 Site/Job/Fabric 职责内做启动前 Host Permit 同一性与来源路径检查、固定 `edarun` 字节身份、强制 QuaLib new/59099 与 XTop old/59001 互斥，再运行真正的 Pack/Host L4。E2–E4 仍未开始真实数据验收。
