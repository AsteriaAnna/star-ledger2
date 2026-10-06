# K05a真实PG部分验收与修复

记录：2026-10-06 19:19（北京时间）用户转交已连接CloudBase MCP的Codex报告。R03/C02/C05/C06/M5.1-O/F。以下云端事实来源为该报告，本会话未独立复查；修复代码的本地验证另列。

> 后续状态：20:43用户转交[最终整改复测](2026-10-06-capture-pg-retest-accepted.md)，PG子项已通过；本页保留首轮失败与修复时点，不再作为重复复测授权。

## 用户报告的真实验收

环境xingzhang-dev-d0g4a950c6f1204d1 / ap-shanghai，baas_trial，postgres-45ay1vm6，PostgreSQL 17.11。代码a46f130，使用Manager executePGSql和调用期间STS，运行仓库原有CapturePostgresRepository与RemoteCaptureService。

**K05a部分通过，不能判通过。** 数据库语义不等于仓库可用。

| 项目 | 报告事实 |
| --- | --- |
| create/replace | INSERT/UPDATE已提交，API返回Columns:null、Rows:null、AffectedRows:1；仓库却抛INVALID_CAPTURE_SQL_RESULT |
| 未命中/CAS落败 | SELECT返回Columns:[payload]、Rows:null；仓库错误拒绝合法空结果 |
| SQL幂等/并发CAS | SQL层正确，仓库路径因返回值适配失败而未通过 |
| publish和回滚 | 仓库真实单CTE使READY与完整证据同时出现；插入触发器注入失败时任务与结果整体回滚 |
| 取消后迟到 | 仓库publish拒绝旧版本；取消本身用SQL落库，因为原replace不可用，尚非完整service.cancel闭环通过 |
| scope与客户端权限 | 不泄漏跨scope数据，但未命中get抛错；报告anon/authenticated直接访问全部拒绝 |
| service_role权限 | 默认ACL导致两表实际arwdDxtm，超出task三项/result两项；迁移未先撤销service_role旧授权 |
| 资源 | 实际云函数3秒，未修改可配范围；表结构/约束/FORCE RLS报告正确 |

迁移RequestId：6d917a22-bbc0-429f-a62d-daf904401095（幂等重跑），首轮fcdf37d0-3103-428e-b060-974931760592、3487e65a-25e6-4710-b8c7-b5595a9b112e。报告已清理synthetic-k05a-probe记录及注入触发器/函数，剩余task/result均0；注册、同步、Handler、托管未修改。

## 根因与本轮修复

此前替身为DML返回payload行，掩盖真实API形状；测试甚至将合法AffectedRows:1误定义为传输错误。这是实现和测试契约错误，不能归为云资源故障。

- postgres.cjs分开SELECT与DML：create/replace不再请求RETURNING，直接检查AffectedRows为整数0或1，分别返回false/true。没有追加SELECT或第二次写入。
- SELECT保留payload列校验，将Rows:null归一为空数组。get/result返回null、publish CAS落败返回false。缺列信息、缺受影响行数或异常行数继续作为技术错误，不能任意把所有null响应当成功。
- 003历史迁移保持原样；新增004-capture-service-role-privileges.sql，只撤销这两张表上PUBLIC/anon/authenticated/service_role现有权限，再授予task SELECT/INSERT/UPDATE、result SELECT/INSERT。不改全局default ACL，不改角色成员关系/BYPASSRLS，不碰注册表。
- capture-privilege-audit.sql检查实际有效权限（含继承），不只看直接ACL。PostgreSQL17的8种权限全部核对；若仍有超额，不自动撤销其他角色或表所有者权限，先定位继承路径再限定处理。

权限修复迁移尚未在本会话执行，不能称线上权限已收敛。

## 修复验证

新增4项：真实DML样本成功/幂等/CAS败落、真实空SELECT样本、SQL适配器贯通queue/重复queue/cancel/read、无效AffectedRows/缺列信息拒绝。调整已有fake DML返回形状及错误预期；publish空结果测试改成Rows:null。

本地核心460/460、核心/Web类型及平台检查通过。新增样本来自用户真实报告，但执行仍是替身，不宣称新的真实PG验收。未改Web运行代码，本轮未重跑构建/浏览器；无模型请求、函数部署或云端写操作。

## 给已连接Codex的定向复测指令

```text
星账K05a整改复测，拉取AsteriaAnna/star-ledger2分支
feature/capture-foundation-20261005最新头，记录实际commit。
读app/docs/2026-10-06-capture-pg-real-acceptance-and-fixes.md。
仅操作xingzhang-dev-d0g4a950c6f1204d1 / ap-shanghai。

已有003表保留，不重复建库/重置结构。
应用且只应用app/cloudbase/migrations/004-capture-service-role-privileges.sql，
单条DO请求，保留RequestId。运行app/cloudbase/capture-privilege-audit.sql，
比较48项actual与expected，报告所有不一致。
若继承权限仍超额，列出来源，不扩大修改角色/全局default ACL。

用真实executePGSql注入最新仓库CapturePostgresRepository，
运行最新RemoteCaptureService，不用手写SQL替代queue/cancel路径。
只使用synthetic-k05a-probe前缀，不创建真实用户、不传真实图、不调模型。

复测：首次queue成功；同ID/同图重复queue返回同任务；异图拒绝；
不存在/跨用户/跨账本get/result/read返回null，无INVALID_CAPTURE_SQL_RESULT；
同版本两个repo.replace并发，严格一个true一个false；
service.cancel真正成功落库，旧版本worker无法publish；
publish CAS落败返回false；正常publish/完整证据读取成功；
注入结果保存失败后仍整体回滚；客户端anon/authenticated访问继续拒绝。
成功DML不得再抛返回形状错误，记录AffectedRows/Columns/Rows形状。

权限验证必须包括service_role对result的UPDATE/DELETE/TRUNCATE/
REFERENCES/TRIGGER/MAINTAIN及task的额外权限，预期全部无权限。
不为测试给service_role增权；清理探针由管理角色完成（先结果后任务）。
移除本轮注入对象，确认前缀记录归零。
不改注册/同步/认证/正式Handler/托管，不部署截图函数。
报告通过/失败、RequestId、权限差异、残留、源码commit。
本轮通过前仍标K05a部分通过，不推进真实图片调用。
```

下一停止点：等待上述定向真实复测。保持已选模型和整体单人→注册/云闭环→双人→安装路线，不用本轮修复宣称K05或页面完成。
