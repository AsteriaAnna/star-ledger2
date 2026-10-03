# 星账 V2 · M4 应用架构与状态模型冻结报告

> **当前执行入口（2026-10-03 更新）**：[M1–M7 职责驱动计划](m1-m7-execution-plan.md) 与 [职责契约](responsibility-contract.md)。本文件保留历史设计/时点记录；后续顺序、实际状态及本轮明确修订以当前执行入口为准。

> 分支：`m4-v2-architecture`  
> 日期：2026-10-02  
> 目标：把 M3 已冻结的“用户任务 / 系统责任”转成可以直接支撑 M5 核心流程开发的应用架构，而不是把 V1 的 Draft、blocker、review queue 换一套名字继续保留。

---

## 0. M4 总结

M4 的核心不是新增页面，而是重新确定 **事实、解释、决策、账务结果、查询结果分别由谁负责**。

最终形成五条应用路径：

- T1 记录：`ManualRecordRequest → Record Service → LedgerIntent → Accounting Domain`
- T2 导入：`ExternalRecord → Interpretation → Resolution → LedgerIntent → Accounting Domain`
- T3 修改：`CorrectionRequest → Correction Service → relation revalidation → atomic BusinessCommand batch`
- T4 分析：`ConsumptionEffect → shared contribution query → aggregate → transaction drilldown`
- T5 对账：`BalanceAnchor/opening baseline → BalanceMovement → running ledger → reconciliation observation`

共享底座仍然是：

`BusinessAccountingService → Command[] → Operation log → projection → SQLite / encrypted GitHub sync`

M4 没有推翻 V1 已经正确的会计核心，而是把 V1 暴露给 UI 的应用编排责任收回到 application/domain 层。

---

# 1. M4.1 · T2 Import Service

## 1.1 要解决的问题

V1 的 `Draft` 同时承担原始来源、解析结果、推断结果、用户决定、工作流状态和 UI 选择状态，因此任何一个识别问题都会演变成“整笔账需要核对”。

M4.1 把导入拆成职责明确的阶段：

```
ExternalRecord
  → Normalize / Interpret
  → Source Deduplicate
  → Account Resolution
  → Relation Resolution
  → LedgerIntent
  → Commit
```

Resolution 内部统一采用：

```
Source Fact
→ Deterministic Rule
→ Resolution Memory
→ Contextual Inference
→ AI Suggestion（未来，可选）
→ Attention（最后手段）
```

## 1.2 主要代码

- `packages/importing/types.ts`
  - ExternalRecord
  - EventInterpretation
  - AttentionItem
  - ImportSession
- `packages/application/import-service.ts`
  - 导入应用编排
- `packages/application/import-ledger-intent.ts`
  - Resolution → LedgerIntent
- `packages/importing/account-resolution.ts`
  - 账户识别
- `packages/importing/relation-resolution.ts`
  - 退款等关系识别
- `packages/importing/dedup.ts`
  - SourceIdentity 去重
- `packages/importing/resolution-memory.ts`
  - 用户稳定决定的长期记忆
- `packages/importing/workspace.ts`
  - ImportSession / ExternalRecord / Attention 的设备本地恢复状态

## 1.3 采用的工程方式

### Ports / Adapters

Application 只依赖 `ImportWorkspaceRepository`、`ResolutionMemoryRepository` 等端口，不直接依赖浏览器 LocalStorage、SQLite 或 GitHub。

这样 M5 接 Web/PWA 时可以替换 adapter，而不重写业务判断。

### Partial certainty

“还有信息未知”不等于“整笔交易不能存在”。

例如：
- 消费金额、时间、消费事实明确，但付款账户未知：消费可以成立，BalanceMovement 的 account_id 暂为空。
- 退款事实明确，但原消费未知：退款可以成立，TransactionLink 暂不存在。
- 还款事实明确，但负债账户未知：还款可以成立，目标 Movement 后续绑定。

只有缺失信息会改变核心财务事实且无法安全延后时，Attention 才 blocking。

### Attention 是问题，不是状态

Attention 表达：
- “无法确定付款账户”
- “有两个可能的原消费”
- “组合支付缺少各账户金额”

而不是：
- “这笔账待核对”
- “REVIEW_REQUIRED”

用户只回答缺失问题，不重新审核系统已经知道的事实。

## 1.4 ImportSession

ImportSession 是：
- 批次恢复边界
- 幂等处理边界
- 批量撤销/恢复的未来基础
- 导入结果统计边界

它不是用户需要管理的工作流状态机。

`ImportSession / ExternalRecord / Attention` 保存在设备本地 workspace，不进入 Operation / GitHub 同步。

原因：它们是处理过程，不是正式账本事实。

## 1.5 ResolutionMemory

稳定用户决定属于长期知识，例如：

`微信支付 · 招商储蓄卡(1234) → account: cmb-1234`

这类信息通过类型化 key 写入现有 `import_rules` Operation，因此：
- 可同步
- 可冲突
- 可从旧 alias 安全迁移
- 不需要建立一个新的“万能规则系统”

旧 target alias 因语义混杂，不自动迁移。

---

# 2. M4.2 · T3 Correction Service

## 2.1 目标

T3 不再区分：
- 手工账
- 导入账
- 金额修正
- 账户修正
- 时间修正
- 类型修正

统一为：

`CorrectTransaction`

入口由 `packages/application/correction-service.ts` 负责规划，底层仍由 BusinessAccountingService 原子执行。

## 2.2 修改能力

统一 Correction 已验证：

- 金额
- 付款 / 到账账户
- 时间
- 交易性质
- 分类
- 名称
- 备注
- 单账户 ↔ 组合支付

修改时重新派生：
- BalanceMovement
- ConsumptionEffect
- posting_plan
- 受影响关系

旧 posting 不物理删除，而归零保留在 Operation 历史中；当前余额和账户流水只读取非零有效 Movement。

## 2.3 SourceRecord 与修改历史分离

V1 的 `CORRECT_IMPORTED_EVENT` 会创建“星账 · 导入修正” SourceRecord。

V2 普通 `CORRECT_TRANSACTION` 不再制造 SourceRecord。

原因：

- SourceRecord = 外部/原始证据
- Operation history = 用户后来做过什么修改

两者不是同一种事实。

V1 命令暂时保留为兼容入口，避免旧流程立即断裂。

## 2.4 TransactionLink 生命周期

M4 发现 V1 的 `transaction_links` 一旦创建无法正式解除，这正是旧版 `ACTIVE_RETURN_LINKS` 大量硬阻断的根源之一。

M4 增加：

- `deleted_at`
- `UNLINK_RETURN`
- detach / relink
- 同步历史
- legacy link 默认 active

Correction 的关系处理原则：

1. 暂时解除受影响关系；
2. 修改目标 Transaction；
3. 用修改后的事实重新验证关系；
4. 仍成立则重新连接；
5. 不成立则保留 Transaction / Refund 本身，只把关系留待确认。

如果一笔原消费存在多笔退款，而修改后无法支持完整退款集合，不按执行顺序擅自保留其中一部分。

---

# 3. M4.3 · T5 BalanceAnchor 与 Reconciliation

## 3.1 V1 问题

V1 只有：

- opening_balance
- opening_balance_at

它能表达“从哪里开始记账”，但不能表达：

> 2026-10-02 19:00，我确认银行卡实际余额为 8432.17 元。

如果用“其他收入/其他支出”强行补差额，会污染真实消费和收入。

## 3.2 新模型：BalanceAnchor

新增 `balance_anchors`：

- account_id
- observed_balance
- observed_at
- source_type
- created_at
- deleted_at

BalanceAnchor 是“某时刻被确认的账户余额事实”，不是 Transaction。

因此它：
- 不产生 ConsumptionEffect
- 不伪造收入/支出
- 只改变之后余额推导的基线

旧 opening_balance 继续作为第一个隐式 baseline，保证迁移兼容。

## 3.3 对账分两步

### Observation

用户输入实际余额时，先执行只读比较：

`observed balance - ledger balance = difference`

不立即写账。

### Calibration

只有用户明确选择“从这个余额继续”时，才创建 BalanceAnchor。

这样一次输入错误不会自动永久改账。

## 3.4 AccountLedger

`analytics/index.ts` 新增 running ledger：

`baseline → movement 1 → running balance → movement 2 → ...`

T5 页面未来直接基于它回答：
- 当前余额怎么来的？
- 哪一笔开始不一致？
- 哪些流水在最近 Anchor 之前，因此不参与当前余额？

## 3.5 冲突原则

同账户、同一时刻出现两个不同可信余额：
- 不静默选最新创建
- 不按设备 ID 选赢家
- 抛出 `AMBIGUOUS_BALANCE_ANCHOR`

不同设备的独立观察保留为独立事实，由 reconciliation 层解释歧义，而不是修改全局 CREATE 冲突协议。

---

# 4. M4.4 · T1 Record Service 与 T4 Analysis Query

## 4.1 T1 手工记录

手工记账不进入 Import Pipeline。

路径：

`ManualRecordRequest → buildManualLedgerIntent() → BusinessAccountingService`

用户入口仍可保持自然语言：

- 花钱
- 收钱
- 转钱

但三个入口不等于三种内部 event。

### 花钱

可以表达：
- 自己账户付款
- 付款账户暂时未知
- 外部代付 / 亲情卡
- 明确组合支付

### 收钱

可以表达：
- 收入
- 退款

退款不是普通收入。

### 转钱

可以表达：
- 自己账户互转
- 转给别人
- 还款
- 提现

“转账”本身不自动等于消费。

## 4.2 T4 单一统计口径

新增 `consumptionContributions()` 作为分析基础行。

以下查询都从同一 contribution 集合生成：

- period total
- category breakdown
- day breakdown
- transaction drilldown IDs

因此必须满足：

`总消费 = 分类合计 = 日期合计 = 贡献行合计`

退款在发生月以负 ConsumptionEffect 进入同一口径。

图表点击后直接使用聚合项携带的 transactionIds 下钻，不再重新写一套 Transaction 过滤逻辑。

---

# 5. M4.5 · 状态、持久化、同步、迁移冻结

## 5.1 状态归属矩阵

| 对象 | 持久化 | GitHub 同步 | 可重算 | 用户默认可见 |
|---|---|---|---|---|
| Transaction | SQLite / Operation | 是 | 否，正式事实 | 是 |
| BalanceMovement | SQLite / Operation | 是 | 可由 intent 派生，但正式 posting 保留 | 否 |
| ConsumptionEffect | SQLite / Operation | 是 | 可派生 | 聚合后可见 |
| SourceRecord | SQLite / Operation | 是 | 否，原始证据 | 详情可见 |
| TransactionLink | SQLite / Operation | 是 | 关系可解除/重建 | 关系语义可见 |
| BalanceAnchor | SQLite / Operation | 是 | 否，可信余额事实 | 对账时可见 |
| ResolutionMemory | import_rules / Operation | 是 | 用户决定不可随意重推 | 默认隐藏 |
| ExternalRecord | local workspace | 否 | 可从来源重新解析，但处理中需恢复 | 默认隐藏 |
| Interpretation | 不作为正式账本表 | 否 | 是 | 否 |
| Attention | local workspace | 否 | 部分可重算 | 仅有问题时 |
| ImportSession | local workspace | 否 | 否，处理恢复边界 | 导入结果层可见 |
| LedgerIntent | 不持久化为业务表 | 否 | 是 | 否 |

## 5.2 SourceIdentity 冻结

冻结关系：

- ExternalRecord → 1 SourceIdentity
- 同一外部记录重复导入 → 共享 SourceIdentity
- 一个已提交 SourceIdentity → 最多一个稳定 SourceRecord evidence identity
- Transaction → 1:N SourceRecord
- SourceRecord → 1 Transaction

不引入 SourceRecord ↔ Transaction many-to-many。

SourceIdentity 必须 namespaced，至少包含：
- source system
- platform
- profile
- raw source identity

`SourceIdentity ≠ EconomicEventIdentity`

两份不同来源证据可能最终描述同一经济事件，此时保留两份 SourceRecord 并挂到同一 Transaction，而不是把来源身份强行合并。

## 5.3 组合支付

PURCHASE 支持：
- `payer`
- 或 `payerAllocations[]`

REFUND/RETURN 支持：
- `destination`
- 或 `destinationAllocations[]`

约束：
- allocation sum 必须严格等于 event amount
- 同一账户不能重复出现在同一 allocation
- 外部 sponsor 与 own-account allocation 不能同时存在

如果来源只告诉“余额 + 银行卡”但没有各自金额：
- 仍产生 blocking `SPLIT_PAYMENT` Attention
- 不猜 50/50
- 不任选主账户

## 5.4 还款

REPAYMENT 允许 from / to 暂为 unresolved。

已知还款事实可以先进入账本：
- source movement = -amount
- target movement = +flow（未绑定时保留方向语义）

后续绑定时：
- source 必须 ASSET
- target 必须 LIABILITY
- 绑定到负债后按 liability sign rule 转换 movement amount

## 5.5 Local workspace

V2 import workspace 使用单一序列化 snapshot 保存：
- session
- records
- attention

`saveSessionSnapshot` 校验 session ownership 后一次写入，避免只保存了一半处理状态。

损坏时：
- fail closed
- 报 `CORRUPT_IMPORT_WORKSPACE`
- 不静默清空原始恢复数据

它明确不进入 GitHub Operation sync。

## 5.6 V1 → V2 迁移规则

### 自动兼容

- SQLite schema 顺序迁移至 v7
- V1 Transaction / Movement / ConsumptionEffect 保留
- 旧 TransactionLink 没有 deleted_at 时默认 active
- opening_balance 继续作为首个余额 baseline
- 安全的 payer/destination alias 可迁移到 typed ResolutionMemory
- legacy SourceIdentity 仅在默认 profile 下继续兼容
- V1 `CORRECT_IMPORTED_EVENT` 保留兼容行为

### 不自动迁移

- 旧 target alias：旧语义混合转账/还款，不足以安全推断
- V1 Draft workflow / review queue：不迁移成 V2 ImportSession
- blocker/status UI 状态：不进入 V2 正式模型
- 不确定组合支付金额：不自动拆分

原则是：只迁移语义确定的事实和稳定用户决定，不迁移旧 UI 工作流本身。

---

# 6. 关联修改清单

M5 写真实代码时，修改任何一层必须检查下列联动。

## 6.1 新增 / 修改 Event 语义

同时检查：
1. `domain/accounting.ts`
2. `accounting/business.ts`
3. financial invariants
4. Correction Service re-derivation
5. Import LedgerIntent
6. Manual Record Service
7. analytics / reconciliation
8. sync projection conflict behavior
9. regression tests

## 6.2 修改账户识别

同时检查：
- deterministic channel parser
- ResolutionMemory key
- legacy alias migration
- unresolved movement binding
- liability sign
- import Attention
- source identity scope

## 6.3 修改退款

同时检查：
- refund transaction
- consumption reduction
- destination movement / split destination
- TransactionLink lifecycle
- relation matcher
- correction detach/relink
- refund quota invariant
- analysis month attribution

## 6.4 修改余额

同时检查：
- opening baseline
- latest BalanceAnchor
- movements after baseline
- time correction crossing anchor
- running ledger
- reconciliation difference
- sync ambiguity

## 6.5 修改导入

不能只改 parser。

至少检查：
- ExternalRecord facts
- Interpretation
- SourceIdentity
- source dedup
- account resolution
- relation resolution
- Attention
- LedgerIntent
- ImportSession recovery
- batch rollback / retry
- SourceRecord evidence

---

# 7. M1 → M7 总路线回顾

## M0 · 现状审计 — 完成

结论：
问题不是“识别能力差”这么简单，而是识别、确认、状态、编辑和页面工作流彼此缠绕，导致用户承担系统内部责任。

## M1 · 产品概念审查 — 完成

结论：
- “入账”“核对”“Draft workflow”“blocker”等不应成为日常用户任务
- 12 种交易类型不应直接暴露
- status 默认隐藏
- 导入应从“逐条审核”转为“自动完成 + 少量具体问题”
- 分析必须可下钻
- 账户必须有 ledger / reconciliation

## M2 · 底层能力与模型审查 — 完成

保留：
- Transaction
- BalanceMovement
- ConsumptionEffect
- immutable SourceRecord
- BusinessAccountingService
- accounting invariants
- Operation / projection / sync

纠正：
- Draft 必须拆层
- TransactionLink 只保存已确认关系
- ImportRule 不再承担所有职责
- UI/main.ts 不应继续做 application service

## M3 · 用户任务与系统责任重构 — 完成

冻结五个核心任务：
- T1 记录
- T2 导入
- T3 修改
- T4 分析
- T5 对账

核心原则：
- 系统能知道的，不问用户
- 用户说过一次的稳定决定，要记住
- 不确定性只影响它真正影响的范围
- 关系未解决不等于交易不存在
- 修改应原地、原子、可追溯
- 对账解释余额，不制造假消费

## M3.5 · 成熟产品 Benchmark — 完成

吸收：
- first-confirmation memory
- account matching
- refund relation
- import session / batch recovery
- account running ledger
- analysis drilldown

不照搬：
- “导入不影响真实余额”
- 弱相似直接判重复
- AI 覆盖结构化来源
- 丢弃原始来源证据
- 默认账户静默猜测真实资金渠道

形成顺序：

`Rule First → Memory Second → Inference Third → User Last`

## M4 · 应用架构与状态模型 — 本报告冻结

M4.1：Import Service  
M4.2：Correction Service  
M4.3：BalanceAnchor / Reconciliation  
M4.4：Record Service / Analysis Query  
M4.5：持久化、同步、身份、迁移边界

完成 M4 后，V2 已经有足够明确的底层责任边界，可以进入真实流程实现，而不需要边写页面边重新发明账务语义。

## M5 · 核心流程实现 — 下一阶段

目标：
- 新版导入页面和结果页
- Attention 的具体问题交互
- 账单编辑接入 Correction Service
- 退款/关系交互
- 账户 ledger / reconciliation UI
- 分析 drilldown
- 手工记录新版入口

M5 的原则：**实现已经冻结的责任，不重新设计 M4。**

## M6 · 数据 / 同步 / 跨平台能力 — 后续

重点：
- Web/PWA 本地 adapter 正式化
- GitHub 同步真实端到端验证
- workspace 是否需要跨设备接力的产品决策
- backup / restore
- Windows / Android / iOS adapter 边界
- 大数据量与迁移性能

M6 不应重新把处理中间态全部塞进账本同步。

## M7 · 商业级体验与发布质量 — 后续

重点：
- 空状态 / 错误恢复
- 导入中断恢复
- 性能
- 可访问性
- 视觉统一
- 数据安全提示
- 发布与升级
- 真机 / 多设备 / 真实账单回归
- 危险操作与恢复策略

---

# 8. M4 冻结条件

M4 只有在以下条件同时满足时才正式冻结：

1. 当前分支完整 core + browser CI 绿色；
2. M4 新增模型都有回归测试；
3. V1 数据库可顺序迁移到当前 schema；
4. 旧 SourceRecord 不被覆盖；
5. 旧 link 默认 active；
6. V1 导入修正兼容入口仍通过；
7. Import workspace 不进入 GitHub sync；
8. SourceIdentity / split funding / repayment 三个 M4 follow-up 已关闭；
9. 不存在必须在 M5 页面开发前重新决定的底层语义。

满足后，下一步直接进入 M5，不再继续扩展 M4 模型。
