> 用户于 2026-10-13 提供的历史研究材料 3（粘贴的文本 (3).txt）。原附件 SHA-256：e6069d0bb3cfd4ef93c97ce13f202906bf610eacb02516481e9f8b6221ab0406。
> 原文基于 main@63ab2e2；建议、冻结提议、旧暂停点和停止语句均非当前指令。不得把上传材料视为用户重新批准所有建议。仅移除复制时夹带的 Mermaid CSS，正文保留。价格、指标、实现状态均须按实际任务重新核验。

# star-ledger2 工程接管摘要 · Phase 4

适用基线：**`main@63ab2e2`**。本轮只核对接管所需的代码位置、约束与测试入口，未修改文件、未运行测试。

以下区分两类内容：

- **代码事实（Level A）**：现有实现直接证明。
- **接管规则**：依据这些事实制定的开发约束，不表示代码已经强制执行。

## 1. AI 开发地图

**接手时先定位实际用户入口，再沿调用链修改。不能只找到名称相似的服务，就认为修改会影响产品。**

下面路径均相对于 `app/`。

| 需求           | 入口文件 ↓ 应用层 ↓ 领域逻辑 ↓ 数据保存                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **手动记账**     | `apps/web/src/main.ts`：`newRecord → commandFrom` ↓ **当前绕过独立 application 服务**，调用 `store.business` ↓ `accounting/business.ts`：`BusinessAccountingService → interpret` ↓ `AccountingService` 生成 Operation、投影 ↓ Web `store.mutate/write` 保存 IndexedDB |
| **文件导入**     | `main.ts`：`importFile`、`importer.ts` 解析 ↓ `import-v2-flow.ts`、`application/import-service.ts`、提交与执行规划器 ↓ `BusinessAccountingService.executeBatch` ↓ 同次提交保存账务操作和处理结果；导入准备快照也通过仓储单独持久化                                                              |
| **截图记账**     | `main.ts`：`capture` → `ocr.ts` → `parseScreenshot` ↓ OCR 草稿先保存；用户确认后进入 `captured-record.ts` ↓ 重复检查、业务记账、来源关联规则 ↓ `mutate` 一起保存账务及草稿完成状态                                                                                                           |
| **修改、删除、恢复** | `main.ts` 详情 / 回收站入口 ↓ `detail-editor.ts → detail-edit.ts` 或 `transaction-lifecycle.ts` ↓ application 中的编辑 / 生命周期规划器，调用业务解释逻辑 ↓ `AccountingService → mutate`；未提交详情草稿另存 localStorage                                                               |
| **同步**       | `main.ts` 登录 / 同步按钮及自动触发 ↓ `cloud-sync.ts` 校验身份、准备密钥 ↓ Web `store.synchronizeEncrypted`、`PortableSyncEngine`、投影与冲突检测 ↓ 本机 IndexedDB 分阶段保存，CloudBase provider 上传下载密文批次                                                                             |
| **统计**       | `main.ts`：`analysis/total/categoryData/balance` ↓ 部分直接调用 `analytics`，部分在页面独立聚合 ↓ 从账务投影计算余额与消费 ↓ **统计结果不另存为账务事实**；预算设置走独立保存路径                                                                                                                      |

代码入口：[手动记账](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/apps/web/src/main.ts#L148)、[文件导入编排](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/apps/web/src/import-v2-flow.ts)、[截图保存](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/apps/web/src/captured-record.ts)、[Web 同步保存](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/apps/web/src/store.ts#L72)。

**特别注意：Web 账本当前保存在 IndexedDB。修改 `packages/storage` 中另一套存储实现，不等于修改了 Web 保存行为。**

## 2. 修改边界地图

这里的“禁止”是未来开发规则；不代表现有底层 API 无法执行这些操作。

| 修改内容            | 应经过的位置                                    | 不应直接做什么                                                |
| --------------- | ----------------------------------------- | ------------------------------------------------------ |
| 新增交易、结算待支付交易    | 当前入口 → `BusinessAccountingService` 对应业务命令 | 单独创建 Transaction，或直接 PATCH `status`，然后假定资金与消费影响会自动补齐   |
| 金额、账户、时间、交易性质修改 | `planDetailEdit` 及其使用的业务更正逻辑              | 只改 `display_amount`、Movement 或 Effect 中的一个字段           |
| 删除、恢复及关联退款      | `planTransactionLifecycle`                | 仅切换 `deleted_at`，跳过关联退款处理                              |
| 导入识别与入账政策       | 解析器 → 解释 / 解析服务 → 提交规划器 → 业务执行            | 在页面中直接生成账务实体；只改解析器便宣称导入闭环完成                            |
| 截图保存            | `saveCapturedRecord`                      | 把账务保存和草稿标记完成拆成互不关联的成功步骤；跳过去重、版本检查                      |
| 来源证据            | 按现有来源创建路径新增记录                             | 覆盖已有 `SourceRecord.raw_payload` 来“修正”账单                |
| 余额、消费统计         | 现有 analytics 计算及其真实页面调用者                  | 用展示金额直接推导余额；只改一条统计路径便声称所有页面口径已变                        |
| 同步、恢复           | 现有批次验证、加密和合并路径                            | 直接覆盖 `state.ops`、手工清空 pending、按时间选冲突赢家，或信任客户端提供的 owner |
| UI 文案、布局        | Web 展示与交互代码                               | 借 UI 改动悄悄改变业务判断、默认入账条件或存储协议                            |

这些边界的依据是：

- `AccountingService` 负责操作验证、命令分组、投影和原子执行，**不等于完整业务校验器**。[代码](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/packages/accounting/index.ts#L9)
- 编辑与生命周期规划器额外处理快照、资金影响及退款关系。[编辑](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/packages/application/transaction-edit.ts)、[生命周期](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/packages/application/transaction-lifecycle.ts)
- SourceRecord 的非创建操作被底层明确拒绝。[验证器](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/packages/domain/index.ts#L28)

**不能把“禁止绕过业务规划器”误写成“禁止使用 AccountingService”。现有规划器本来就通过它提交结果。**

## 3. 核心业务不变量清单

以下均为当前业务代码已有的规则，未来修改必须保护；“保护范围”说明它们在哪里成立。

| 必须保护的规则                                     | 当前保护范围与代码证据                                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **金额以安全整数分表示，累加不能溢出。**                      | 实体金额验证、业务求和与 analytics 求和均有检查。[domain 验证](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/packages/domain/index.ts#L28)、[analytics](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/packages/analytics/index.ts#L4)                                                  |
| **一次业务命令产生的操作必须作为完整命令组保存；失败不能留下部分账务。**      | `command_id/index/size`、`store.atomic` 与 Web IndexedDB 事务共同承担；不能通过拆分保存削弱。[AccountingService](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/packages/accounting/index.ts#L9)、[Web write](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/apps/web/src/store.ts#L60) |
| **SUCCESS、PENDING、FAILED 不能只当展示标签。**        | 正常业务路径仅为 SUCCESS 生成实际 Movement / Effect；PENDING 保存预期过账计划，结算走状态命令。**低层直接改字段不保证这一关系。**[业务解释器](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/packages/accounting/business.ts#L283)                                                                                                 |
| **成功消费与资金来源必须对应；亲情卡 / 他人代付计消费，但不扣本人账户。**    | PURCHASE 分支创建消费影响；EXTERNAL_SPONSOR 禁止本人付款账户或付款分摊。[L316 起](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/packages/accounting/business.ts#L316)                                                                                                                                   |
| **负债账户的余额表示剩余欠款，其符号不能套用资产账户。**              | Movement 按账户类型转换资金流符号；还款要求资产转出、负债转入。[L293 起](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/packages/accounting/business.ts#L293)                                                                                                                                                |
| **内部转账、还款不重复计消费；提现手续费与本金分开。**               | 对应业务分支产生资金影响；提现仅手续费产生消费影响。[L323 起](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/packages/accounting/business.ts#L323)                                                                                                                                                          |
| **多账户分摊之和必须等于指定总额；已知账户不能重复。**               | allocations 分支显式验证；这是业务路径保护，不是任意低层操作都能保证。[L300 起](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/packages/accounting/business.ts#L300)                                                                                                                                           |
| **关联退款不能超过原交易可退金额及消费 / 非消费额度；删除恢复须处理关联关系。** | 业务处理、`financialIssues` 和生命周期规划器共同约束。[不变量检查](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/packages/domain/invariants.ts#L30)、[生命周期](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/packages/application/transaction-lifecycle.ts#L22)                             |
| **原始来源证据不可被编辑覆盖。**                          | `source_records` 非 CREATE 操作被拒绝；修改交易与修改来源是不同动作。[domain L42](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/packages/domain/index.ts#L42)                                                                                                                                         |
| **余额由余额基准及之后的有效资金变化计算；消费由有效消费影响计算。**        | analytics 明确筛选交易有效性、时间范围与资金 / 消费实体。[计算实现](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/packages/analytics/index.ts#L18)                                                                                                                                                        |
| **旧页面提交不能无条件覆盖新账务；并发冲突不能静默挑赢家。**            | 编辑、生命周期、截图各有快照或版本检查；Operation 记录因果关系；统计遇冲突停止计算。[编辑器](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/apps/web/src/detail-editor.ts#L66)、[投影](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/packages/sync/projection.ts)                                            |

必须随清单保留的限制：

**`financialIssues()` 返回空数组，不代表所有账务关系正确。** 它只检查已实现的有限条件；例如来源重复检查目前只读取 `raw_payload.version === 2`。前三阶段已经证明的低层不一致状态，不能因为“没有 conflict”而被新 AI 当作合法业务样例。

## 4. AI 高风险区域

以下尺寸是本轮实际测量；风险后果属于 **Level B【推测】**。

| 区域             | 已有事实                                                        | 容易改错的原因                             |
| -------------- | ----------------------------------------------------------- | ----------------------------------- |
| `main.ts`      | 278 行、约 100 KB，多个完整函数压在单行；包含表单、导入、统计、登录和生命周期入口              | 按行数会低估复杂度；局部文本替换容易同时影响事件绑定、默认值和业务调用 |
| Web `store.ts` | 98 行、约 16 KB，承担存储、账本切换、备份恢复、设置及同步                           | 看似普通存储封装，实际包含提交顺序、版本检查和重试语义         |
| 多条业务入口         | 手动、文件导入、截图、详情修改进入不同编排路径                                     | 改到一个服务不等于其他入口同步生效                   |
| 多组状态           | 正式账务、导入工作区、截图草稿、详情草稿、同步 pending 分开保存                        | 容易把“账务成功”误当成所有流程状态都成功，或扩大“恢复”的含义    |
| 规则跨文件          | 退款规则涉及 business、application、invariants、projection、analytics | 只改本地输入校验，可能遗漏合并历史、删除恢复及统计行为         |
| 测试与产品路径不同      | 部分测试使用内存 / SQLite、模拟远端；Web 使用 IndexedDB；OCR 离线脚本使用合成图片      | 测试通过可能被误报为真实 Web、真实账单或真机验收通过        |
| 现有 AGENTS      | 含阶段性“只整理文档”、旧基线与分支进度，以及多份强制先读文档                             | 新 AI 可能把历史授权当永久限制，或把旧进度当当前事实        |

**接管时尤其不能只读测试名称。** 例如 `secure-sync.test.ts` 的部分测试保护的是另一套同步引擎及模拟 GitHub HTTP 适配路径，不能替代 Web CloudBase 往返验证；OCR 离线脚本验证合成付款图片，也不能证明真实微信 / 支付宝截图准确率。

## 5. 最小 AGENTS.md 设计

建议只保留**一份根级长期规则**；现有 `app/AGENTS.md` 若保留，只放 app 特有命令，避免重复。这里仅设计内容，不写入仓库。

| 必要部分      | 最小内容                                                                                    |
| --------- | --------------------------------------------------------------------------------------- |
| **项目目标**  | 当前维护 `app/` 的个人账本；具体产品行为由本次已确认需求决定。`legacy-duo/` 只读，其他分支功能不计入当前分支。                      |
| **基线与证据** | 开始核对分支、HEAD 和工作区；不得覆盖未提交工作。本次审查锚点是 `63ab2e2`，不要求未来永远停在此提交。完成度分别注明源码、本地测试、浏览器、真实云端及用户验收。 |
| **架构与入口** | 放第 1 节的六条精简调用链；注明 Operation 是历史、Web 使用 IndexedDB、多个输入入口尚未统一。                            |
| **禁止事项**  | 不直接修补投影来改账；不覆盖来源；不拆散完整业务提交；不静默消解冲突；不把其他分支、旧文档或生成产物当当前实现。                                |
| **修改原则**  | 用户描述体验问题后，先定位实际入口，说明期望行为、牵连规则与验收案例；已有代码能回答的问题由 AI 查明。仅有产品选择无法推导时才询问用户。                  |
| **验证与交付** | 根据影响选择测试；报告改了什么、影响哪些入口、实际运行了什么、尚未验证什么。运行代码变化必须检查实际 diff，不能只信提交标题。                       |

测试要求应保持短而具体：

- **账务规则变化**：验证受影响交易的 Transaction、Movement、Effect、来源及关联关系；至少包含正常结果与一个相关失败 / 边界案例。
- **编辑、删除恢复变化**：覆盖过期提交与受影响退款；现有 `transaction-financial-edit.test.ts` 已有金额、负债账户、来源保留、分摊及待支付更正断言，可作为相关回归入口。
- **Web 流程变化**：补查真实 UI 调用路径与保存后重开行为，不能仅测试未接入页面的服务。
- **同步变化**：核对实际使用的引擎，覆盖重试、完整批次、身份 / 密钥不匹配和冲突保留；模拟结果不得称真实云端通过。
- 使用现有脚本：`npm test`、`typecheck`、`typecheck:web`、`check:platform`、`build:web`；按影响运行 Web 导入或 OCR 脚本。**本章未执行这些命令。**

脚本依据：[package.json](https://github.com/AsteriaAnna/star-ledger2/blob/63ab2e2/app/package.json)。浏览器脚本读取 `web-dist`，因此必须确认测试的是本次构建产物。

无需把历史计划、阶段性授权和所有旧报告继续放进长期必读列表；它们应在任务确实涉及其内容时读取。

## 6. 最终开发接管结论

**当前仓库可以进入有明确范围、逐项验收的持续开发；尚不足以支持 AI 仅凭一句模糊需求就自主跨模块修改并宣布完成。** 这是基于前三阶段事实作出的接管判断，不是发布结论。

开始持续开发前，最少需要补齐三件事：

1. **把长期 AGENTS 与历史阶段说明分开。** 将本章的入口、边界和证据纪律落入现有接手文件，消除过期基线与阶段授权歧义；无需新增一批文档。
2. **为下一项任务明确一个可验证的用户结果。** 由 AI 负责翻译为实际入口、关联规则、改动范围和验收案例，不要求用户提供技术方案。
3. **取得与该任务相关的基线验证结果。** 记录哪些检查实际通过、哪些受环境限制；尤其不能把此前未验证的浏览器或云端行为默认成正常。

**不需要先进行大规模结构调整才能继续开发。需要先建立的是：每次修改都能说明改到了哪条真实路径、保护了哪些账务关系，以及完成结论由什么证据支持。**

Phase 4 完成，停止于此。
