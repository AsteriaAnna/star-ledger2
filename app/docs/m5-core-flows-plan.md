# 星账 V2 · M5 核心流程实现计划

> 文档状态：历史设计/时点证据，保留原文。文中的“当前/下一步/已完成”只对应记录当时；最新状态见 [当前状态](project-status.md)，顺序与授权见 [唯一计划](m1-m7-execution-plan.md)，冲突与取消项见 [需求对照](plan-reconciliation.md)。本报告不能单独触发开发或部署。

> **当前执行入口（2026-10-03 更新）**：[M1–M7 职责驱动计划](m1-m7-execution-plan.md) 与 [职责契约](responsibility-contract.md)。本文件保留历史设计/时点记录；后续顺序、实际状态及本轮明确修订以当前执行入口为准。

> 基线：M4 merge `dc20c39f385050c26a81bf254ba041d79e5a73a9`

> 当前进度（2026-10-03）：三项导入生命周期缺陷已修复，PENDING 账户回答已推进；M5.1 尚未完成。详见 [生命周期修复进度](m5-1-lifecycle-fixes-progress.md) 和 [完整验收计划](2026-10-03-project-review.md)。

> 后续已接通部分来源决定和 PROCESSING/FAILED 继续处理入口，详见 [来源决定与恢复进度](m5-1-source-review-progress.md)。其他 typed Attention 与真实样本门槛仍保留。

> 用户任务核验：本轮修复筛选后的隐藏选择，并接通还款/提现/内部转账目标账户。底层服务不等于页面重构完成；改账、手工记账与对账仍待接通。详见 [用户任务与系统责任进度](m5-user-task-progress.md)。下一实现重点为 M5.2，M5.1 未通过门槛继续保留。

M5 只实现已经冻结的 M4 责任，不重新发明 Draft/workflow/blocker 状态机。

## M5.1 导入闭环
目标：上传 → 自动处理 → 导入结果 → 少量具体问题。

实施顺序：
1. 用 legacy parser 只做 Capture Adapter；Draft 不再作为页面工作流状态。
2. Draft 立即转换为 ExternalRecord + EventInterpretation。
3. ImportService 负责 dedup / account resolution / relation resolution / LedgerIntent。
4. 可安全提交的记录立即提交。
5. Attention 页面按“问题”显示，而不是按“待审核账单”显示。
6. ImportSession 显示结果统计并支持刷新恢复。
7. 旧 review queue 保留兼容入口，完成 V2 验证后再删除。

验收：
- 已知记录不逐条确认。
- 账户只在首次未知时询问并记忆。
- 未关联退款不阻塞退款事实。
- exact duplicate 自动跳过。
- split payment 缺少分摊金额时才 blocking。
- 刷新后未完成 session 可恢复。

## M5.2 账单修改
- 详情页改接 Correction Service。
- 金额/账户/时间/类型/分类/名称/备注统一保存。
- 关联退款由 service detach/revalidate/relink。
- 只有真实关系冲突才提示用户。

## M5.3 退款与关系
- 退款详情显示原消费关系。
- 未关联退款可单独存在。
- 多候选时只问“对应哪笔原消费”。
- detach/relink 不删除退款或原消费。

## M5.4 账户与对账
- 账户详情接 AccountLedger。
- 展示 running balance。
- 输入实际余额先 Observation。
- 优先修账；明确选择校准才创建 BalanceAnchor。

## M5.5 分析下钻
- 首页/分析页统一使用 consumptionContributions。
- 分类、日期图表携带 transactionIds。
- 点击聚合直接进入对应账单列表。

## M5.6 手工记账
- 页面只暴露“花钱 / 收钱 / 转钱”。
- Record Service 解释 contextual meaning。
- 不经过 ImportSession / Attention queue。
- 支持未知付款账户、外部代付和明确组合支付。

## 联动纪律
任何页面不得：
- 直接写 BalanceMovement / ConsumptionEffect；
- 自己推断退款关系；
- 自己维护 Draft workflow；
- 把未知账户当 sponsor；
- 为了对账制造虚假收入/支出；
- 用 UI 顺序解决同步或财务冲突。

M5 遇到真正的底层缺口时，新建 Issue 并说明是否阻塞；不得在 main.ts 里加特殊字段绕过 M4。
