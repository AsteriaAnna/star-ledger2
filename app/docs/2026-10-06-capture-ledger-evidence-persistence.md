# K03b-1：正式识别证据保存与恢复

更新：2026-10-06（北京时间）；R03/R09、C01/C02/C05/C06、M5.1-O/F。完成一个小单元：把K03a已定义的提取证据贯通到正式来源记录。本轮无模型请求、云端操作或网页部署，K03整体未完成。

## 问题与实现

K03a只在导入工作区保存完整CaptureEvidence；正式source_records只有事件事实和引用。正式写账后清工作区，会丢失完整原始识别文字。本轮复用不可变source_records和现有账务命令批次，不另建数据库表或同步协议。

新的截图来源payload继续使用version:3，增加captureEvidenceVersion:1和完整captureEvidence；其中包含原始提取文字、图像指纹、提取版本/model、摘要、时间，不含图片字节。单个事件保存自己的capture引用及facts。Excel与旧手工来源格式保持兼容。

这是**一份逻辑证据、多份自包含事件来源**：同图多事件来源行会重复保存同一提取容器，恢复时按不可变证据ID合并为一份。选择自包含的原因是避免新建一套实体/迁移/外键及跨批次依赖，确保每个事件的来源单独可恢复。代价是多事件图片重复存文字、扩大操作/备份体积；当前不声称已通过大规模体积与性能验收。原图仍不长期保存，不复制整个任务或临时工作区。

来源构建前必须获得对应容器并验证引用。ImportStatementService.resolve从工作区取得证据，传递到提交计划；新增入账、来源变更附加、继续导入与KEEP_EXISTING/APPLY_SOURCE均携带对应版本。缺失容器时拒绝生成新的正式截图来源，不能成功入账后才发现丢失证据。

新增readPersistedCaptureEvidence从正式实体读取容器及事件引用；验证摘要、不可变ID、平台/profile、原始观察与外部引用的一致性。同一ID不能覆盖提取时间，提取时间必须沿用该证据版本的原值。旧引用型来源可以读取，但明确报告missingEvidenceSourceIds，不伪造缺失的原文。

SQLite启动/投影和Web MemoryStore重建/投影复用验证；证据不合法会令现有原子事务回滚，包括账单、派生、操作与待上传记录。现有操作备份/完整批次携带自包含来源，所以恢复不依赖工作区。哈希仅作一致性验证，不代表AI内容正确或具备签名真实性。

## 修改范围

| 层 | 文件与动作 |
| --- | --- |
| 来源结构与恢复 | importing/capture-evidence.ts复用引用校验；新persisted-capture-evidence.ts读取/验证正式证据 |
| 公共导入 | application/import-ledger-intent.ts构建自包含来源；import-service.ts传递容器；import-commit.ts贯通新增与来源变更 |
| 来源选择 | application/import-source-attention.ts在重新解析已有解释和附加来源时携带证据，不调用模型 |
| 持久与恢复 | storage/index.ts启动/投影验证；apps/web/src/store.ts重建/投影验证（复用现有备份和批次流程） |
| 回归 | 新tests/capture-persistence.test.ts；原capture-evidence.test.ts显式提供容器 |

## 本地验收

Node 24.19.0；新增7项通过：

1. 合成原付款79.59与退款0.26/0.44实际执行正式账务批次，清工作区、关闭并重开SQLite后恢复一份逻辑证据和三个事件引用；消费78.89、资金合计-78.89。
2. Web MemoryStore操作JSON备份重建、PortableSyncEngine模拟传输后，无工作区也恢复相同来源。
3. 新截图缺证据拒绝构建/提交；Excel来源保留既有version:3且不增加截图字段。
4. 证据篡改时Web/SQLite整批写入回滚，无交易、操作或待上传残留。
5. 缺容器、引用冲突、同ID不同时间拒绝；旧引用型来源报告缺口，旧非结构化来源兼容。
6. 现有planResumeImport从已保存解释恢复提交，保存容器与三条COMMITTED结果，不重新识别。
7. 来源变更选择保留或采用，保留旧/新提取证据，不重复新增交易。

全量核心421/421、核心/Web类型检查、平台边界和Web构建通过；构建仍有既有大chunk提示。浏览器回归环境仍缺Playwright Chromium，本轮未执行，不计通过。以上操作JSON/模拟批次验收不等于浏览器IndexedDB备份界面、加密云端、真实PostgreSQL同步、真机或用户验收。

## 下一步及门槛

- 下一小单元K03b-2：无自身编号退款后续取得强证据、05→06及14两退款的唯一候选/冲突、截图与Excel两种到达顺序；先用既有冻结响应/合成案例，不重跑整套模型。
- K03b-3：删除后普通重导不得静默复活；现有REVIVE_EXISTING路径尚未修复，正式产品自动执行前必须解决。
- 真实169+169 Excel当前未恢复；不能用合成测试代替真实互导验收。
- 任务、API、照片实际清理与页面仍未接。证据保存基础通过不授权立即启用自动入账或删除照片；先补完身份/删除/任务集成及真实验收。
- CloudBase同步PostgreSQL适配、账户权限/密钥恢复仍属于后续主阶段，不宣称本轮完成。
