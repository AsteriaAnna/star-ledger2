# 职责分配专项对标：采用什么、不采用什么

> 文档状态：历史设计/时点证据，保留原文。文中的“当前/下一步/已完成”只对应记录当时；最新状态见 [当前状态](project-status.md)，顺序与授权见 [唯一计划](m1-m7-execution-plan.md)，冲突与取消项见 [需求对照](plan-reconciliation.md)。本报告不能单独触发开发或部署。

查阅日：2026-10-03。目的：为[职责契约](responsibility-contract.md)提供具体机制依据，不以功能数量或品牌评价代替验证。商业软件只依据官方帮助中的可见行为，未实机体验，也未推测其内部存储或事务实现；开源部分复读固定提交源码。以下“星账取舍”是本项目设计判断，不是竞品已有功能的延伸事实。

## 同任务对照与项目决策

| 对象与证据 | 已核实行为/实现 | 星账采用的经验 | 不照搬与原因 | 对应节点 |
| --- | --- | --- | --- | --- |
| Actual 导入说明 [A1] | 检查来源 ID，再尝试日期、金额、收款方匹配；文件导入从账户入口开始 | 来源身份去重与同事件匹配分开；匹配结果可解释 | 微信/支付宝单文件有多个渠道，不强制先选一个总账户；弱相似只给候选，不能直接合并 | R02/R09，M5.1-D |
| Actual merge.ts [A2] | 合并入口读取最新交易并验证；显式处理转账两端、分类拆分，以及保留/补齐字段 | 修改/合并集中编排；每个字段保留策略显式定义；关系完整性由系统处理 | 不复制其模型；其保留 imported_id 一方、优先非空字段的策略不能替代星账“用户改动不可被重导覆盖” | C01/C04，M5.0-B/M5.2 |
| Actual 转账说明 [A3] | 创建转账维护两端账户；预算内转账不需要分类；预算外有不同分类规则 | 转账是一件用户任务，两端联动属于系统责任 | 不引入其预算内/外账户体系；星账保留消费影响与资金变化分离 | R06，M5.1-B/M5.6 |
| Actual 对账说明 [A4] | 提供账户流水、输入实际余额、查看差额和逐步核对路径 | 差额要有可追溯的流水解释 | 不把逐条 cleared/locked 状态强加给普通记账；不照搬负债负数输入，表层可表达“欠款” | R12，M5.4 |
| Firefly Data Importer ApiSubmitter.php [F1] | 按记录更新进度、查重并保存任务；来源字段重复检查可包含已删除记录；逐条调用交易 API | 逐条结果与失败位置明确；删除后的来源身份不能忽略 | 服务器任务与逐行 API 不是本地原子事务模板；不能让用户承担配置查重方法或修文件来维持正确性 | C03/C05，M5.1-E/U |
| Firefly 转账导入说明 [F2] | 识别双方账户会影响交易类型；不同参考号/描述等可能妨碍两份转账记录查重 | 账户身份解析与同事件重复识别必须分别建契约 | 不要求用户把文件改成完全相同再去重；不能因为目标未知自动假定消费 | R04/R06/R09，M5.1-D |
| YNAB 文件导入与编辑说明 [Y1/Y2] | 文件导入会尝试匹配手工记录；提供移动账户、匹配/解除等交易操作 | 一笔现实交易可有多个入口；修错账户是正常编辑；匹配后仍可追踪 | 不把日期窗口/同金额直接当星账强证据；不沿用“要先删掉重记”的旧入口 | R07/R09，M5.2/M5.1-D |
| YNAB 对账排错说明 [Y3] | 对照实际余额和流水；可选择余额调整 | 对账属于完整用户任务，有独立的差异诊断 | 星账已冻结 Observation→显式 Anchor；不使用收入/支出伪造差额 | R12/C06，M5.4 |
| Monarch 规则说明 [M1] | 修改交易时可建立快捷规则；规则可预览、回溯应用和删除 | “仅改本笔”与“以后同样处理”必须分开；记忆要可查看和撤回 | 不建默认必学的万能规则引擎；渠道记忆限定身份与范围，不能暗中追改历史 | R04/C05，M5.1-C |
| Monarch 审核偏好 [M2] | 用户可控制是否把新交易或未分类交易标为待审核 | 自愿整理偏好与财务提交状态分开 | 星账默认不强制审核全部新记录；缺分类不应让确定交易不能存在 | R02/C03，M5.1 |

## 研究边界与来源冲突

- Actual 当前网页 [A1] 与仓库动态 API 文档 [A5] 对文件导入“重导已删除记录”的默认值出现不同描述。本次不据此宣布其实际默认值；固定版本实机复核前只采用“策略必须明确、API 与界面需一致”的经验。星账目标契约另行明确为软删除不因普通重导自动复活，显式恢复保留用户更正；当前代码符合性在 M5.0-B 核查。
- YNAB 部分帮助页的全文抓取为空；相关摘要来自官方域名搜索结果。仅采用可核实的任务行为，不以摘要推导私有架构、所有平台细节或完整自动批准策略。
- 这些产品的分类拆分不等于多个付款账户的组合支付；规则自动化也不等于系统可以知道真实资金归属。
- 不照抄外部源码、不添加依赖。本轮只有文档；所有目标仍需本仓库机制测试和用户路径验收。

## 对计划造成的实际更新

1. 增加 M5.0-A 职责基线和 M5.0-B 契约符合性检查，引用现有 M3/M3.5/M4，而不是重建路线。
2. 将字段保护、证据基数、状态与问题、原子修改、记忆与撤销、派生与持久化定义为 C01–C06。
3. M5.2 必须覆盖全字段编辑和草稿安全，不能只换一个“更正”按钮；M5.3 提供关系生命周期后，再收口导入晚到原消费等能力。
4. M5.1 显式加入批次撤销 U、截图路径 O、记忆管理 C；仍保留真实 338 行样本门槛。
5. M6 负责真实数据可靠性与跨端能力；M7 验证正常任务、异常恢复和用户负担。商业软件的“流畅”被转换为可测路径，不以美化页面代替。

## 可复查来源

- A1 [Actual 导入](https://actualbudget.org/docs/transactions/importing/)（动态帮助页，本日查阅）
- A2 [Actual merge.ts](https://github.com/actualbudget/actual/blob/5e39105f59aade083f8446e648b4ef9254f67bfc/packages/loot-core/src/server/transactions/merge.ts)（固定提交 `5e39105f59aade083f8446e648b4ef9254f67bfc`；核对 mergeTransactions、mapAndValidateTransactions、mergeTransactionsNoTransfer、determineKeepDrop）
- A3 [Actual 转账](https://actualbudget.org/docs/transactions/transfers/)
- A4 [Actual 对账](https://actualbudget.org/docs/accounts/reconciliation/)
- A5 [Actual API reference](https://github.com/actualbudget/actual/blob/master/packages/docs/docs/api/reference.md)（动态 master；仅用于记录默认值描述差异）
- F1 [Firefly ApiSubmitter.php](https://github.com/firefly-iii/data-importer/blob/07fa5e972a7a933be9c263c9021f78f319a4fd49/app/Services/Shared/Import/Routine/ApiSubmitter.php)（固定提交 `07fa5e972a7a933be9c263c9021f78f319a4fd49`；核对 processTransactions、uniqueTransaction、processTransaction）
- F2 [Firefly 转账导入文档源码](https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/data-importer/import/transfers.md)
- Y1 [YNAB 文件导入](https://support.ynab.com/en_us/file-based-import-a-guide-Bkj4Sszyo)
- Y2 [YNAB 编辑与删除](https://support.ynab.com/en_us/how-to-edit-and-delete-transactions-BJG4oS1s?mobile-help=true)
- Y3 [YNAB 对账排错](https://support.ynab.com/en_us/troubleshooting-reconciliation-issues-rJkijlVki)
- M1 [Monarch 规则](https://help.monarch.com/hc/en-us/articles/360048393372-Transaction-Rules)
- M2 [Monarch 审核偏好](https://help.monarch.com/hc/en-us/articles/5528707082516-Reviewing-Transactions)
