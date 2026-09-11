# Desktop 分组文件内的非视觉兼容性验证

冻结源码：`ac2ed3a`。本次只执行L2行为，没有运行Desktop窗口验收。

先依据PLS-01逐例映射定位，再阅读当前函数体与依赖，确认10条声明均通过现有localFabric/真实Host，本地Job及Pack检查执行：budget 1、drill-down 2、fork-join 2、loop 2、strategy 3。已迁移到local的experience用例排除，避免重复计为新覆盖。

使用Node原生test runner、精确标题的完整锚定pattern，只加载已确认没有live初始化的5个文件；名称过滤仅用于选择这些已审查用例，不作为外部依赖隔离手段。同文件其余L3用例未选、未执行。

结果：**10 pass / 0 fail / 0 skip，退出0，32.259秒**。实际TAP标题与预先选定10条完全一致。Electron observer记录0个启动；SSH哨兵记录0次尝试；模型调用与远程EDA作业均0。

任务专属短TMPDIR/TMUX_TMPDIR、dsh/agents/user-data隔离，收尾只清理本次临时目录及明确socket。源码、测试、配置与lib的前后hash相同；Pack文件另外与冻结提交逐字节一致。没有构建、源码编辑、提交或GitHub操作。

- [选择及原函数体](selection.json)
- [完整命令与结果](nonvisual.json)
- [原始TAP](nonvisual.log)
- [对账核验](verification.json)
- [源码/lib前置hash](source-and-lib-before.json)
- [源码/lib后置hash](source-and-lib-after.json)
