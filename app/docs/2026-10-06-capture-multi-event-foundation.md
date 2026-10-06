# K03a：一图多事件来源结构与兼容验收

后续状态：[K03b-1](2026-10-06-capture-ledger-evidence-persistence.md)已补齐正式来源证据保存/恢复；下文“仅工作区”是K03a阶段边界，不再作为当前下一步。

更新2026-10-06；R03/R09/C01/C02/C05/M5.1-O/F。完成来源结构、已有工作区/备份及安全匹配接入；无新模型调用、正式网页/云部署。K03整体未完成。

## 本轮实现

CaptureEvidence保存一图的一版提取证据（内容指纹、原提取文字、schema/prompt/model、提取摘要和时间），不存图片字节；平台与profile分开。CaptureObservation区分EVENT与SUMMARY；合计保留在原提取证据，不生成ExternalRecord。每个付款/退款产生独立ExternalRecord和观察位置，共同引用容器；继续复用既有单项interpretation/outcome，未另建结果系统。

有自身订单/退款号时用与旧Excel字节一致的v2强身份，抽到source-event-identity.ts共享。无自身退款号仅生成图内稳定观察身份；不同图片的近似金额/原单不能自动强合并；同图提取版本变化保持同观察键身份。退款详情里的原支付号只进入originalOrderId，退款refundId才是自身强身份；重复事件身份/原号冲突拒绝。

新截图关闭LEGACY_ORDER与旧source-id回退，以免退款按原号匹配成消费；仍保留明确sourceIdentity匹配。旧入口行为不变。旧来源补强兼容要在K03b验证，不能把禁回退当全部查重完成。

工作区新增可选captureEvidence[sessionId]；旧快照无需该字段。InMemory/Local/Web repository、prepare、正式来源payload引用和Web备份验证/合并贯通。Local saveSessionSnapshot先保存候选，成功才替换内存，配额失败不让这一保存路径假成功；其他旧工作区写法未扩改。

## 文件范围

| 层 | 文件 |
|---|---|
| 结构/身份/查重 | importing/types.ts、新capture-evidence.ts/source-event-identity.ts、dedup.ts、workspace.ts |
| 公共应用 | application/ports.ts、import-service.ts、import-ledger-intent.ts |
| Web兼容 | apps/web/src/importer.ts（身份函数抽取）、import-v2-repositories.ts、store.ts（备份校验/合并） |
| 测试 | 新tests/capture-evidence.test.ts |

仅合成编号和证据文字进仓库；真实原图/响应仍私密。schema/prompt标签不表示v2提示已实测。

## 验收

新10项通过：原单79.59+两退款0.26/0.44三个来源、合计不入事件；与真实parseRows输出身份一致；退款原号仅关系；跨图无号不强匹配；新退款拒绝旧号回退/旧入口不变；工作区重开与备份保存一证据三来源三结果；引用缺失/持久失败不改原快照；版本不可覆写/篡改；软件记录截图不作原始凭证、重复身份/原号冲突拒绝；现有prepare保留容器与三项解释不写账。

全量核心414/414、核心/Web typecheck、平台边界通过；Web构建成功（仍有既有大chunk提示）。浏览器导入回归启动失败：当前环境无Playwright Chromium可执行文件，未执行、不记通过。真机未测。

## 后续门槛

- 合成结构测试不等于15真实响应财务解释或真实Excel互导。05→06无号到强证据升级、14两退款后到Excel、唯一匹配/冲突与双向顺序属K03b。
- 删除态REVIVE_EXISTING未在本轮修复；K03b按显式恢复要求复现修改，正式执行前不能遗漏。
- 容器仅存本机工作区/本地备份；正式source_records记录事件事实和容器引用，完整容器尚未进入正式账本/加密同步。正式写账后清工作区仍可能失去完整原提取文字，必须在K03b/K04处理正式保存与恢复后才接自动入账/清理。
- sourceCount仍表示事件级来源数；K06需分别显示图片数和新增事件数。
- 本软件记录页拒绝原始凭证转换不等于产品拒绝上传；K04须凭上下文走已有记录证据路径。
- K02a任务与图证据未接实际API/图片存储/worker。真实Excel文件需恢复；可以用合成规则推进，但不冒称实测。

下一小单元K03b：正式证据保存、强弱身份升级与删除态门槛，然后K04回放冻结响应。无需重新整套调用模型。
