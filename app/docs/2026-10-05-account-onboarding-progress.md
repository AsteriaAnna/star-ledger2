# 受邀用户名密码注册：R14 / C05 / C06 / M6

用户确认现阶段仅本人和受邀的人注册。手机号、微信登录后续考虑，不实现开放自助注册。

## 实现和证据

- 独立账户应用服务编排注册、登录、选择本地用户账本及准备同步；main.ts 只调用弹窗入口。
- 登录与受邀注册互相切换，只保留用户名。密码、确认密码和邀请码不进入 URL、账本或本地存储；请求结束清除。
- 服务器使用 256 位随机邀请码，仅配置摘要、指定用户名和有效期。事务先领取，再创建普通 ACTIVE externalUser，不接受客户端角色/UID；并发只允许一个领取成功。
- 配置缺失、邀请码错误/过期、持久化失败均拒绝注册。创建账号结果不确定时不释放邀请码、不重置密码，提示尝试登录后联系邀请人核查。
- 登录失败按 SDK 已知错误代码区分；通用失败不直接判断密码错误。注册成功但自动登录失败转入登录；登录成功但同步失败独立提示。
- 七项新单元测试覆盖邀请码、密码、并发、权限允许字段、存储失败、不确定结果、HTTP 守卫、认证结果。网页测试覆盖手机宽度、错误提示、重复提交、提交中禁止关闭、机密清理和注册成功后自动登录失败；外部网络完全阻断，不使用真实账号。
- 396 项单元测试、生产构建、Web 类型检查、39 个既有导入浏览器场景、新注册表单测试和本地访客/A/B/刷新/跨标签隔离验证全部通过；此前核心类型及平台边界检查也通过。安装依赖后的函数入口在无邀请码配置下拒绝注册。真实账户创建及同步未验证。

## 云端配置和验收门槛

部署见 cloudbase/README-registration.md。用户已手动创建并部署 star-ledger-register（普通事件函数、Node20.19、index.main、256MB、执行上限3秒）。注册 HTTP 路由尚未启用，邀请码尚未签发。原线上页面仍是此前独立部署版本。

腾讯云控制台的浏览器原生凭据保护阻止观察；已尝试导航到云函数页仍被阻止。不得探测或绕过，需用户接手后恢复操作。

真实验收需要：确认文档数据库可用及私有规则，函数普通运行身份能创建普通用户；关闭配置返回拒绝，再测试错误/过期邀请码、一次注册成功、重复拒绝、登录及身份隔离。当前体验套餐函数最长三秒，冷启动/事务/创建用户可能超过上限，须实际验证耗时；超时结果不能当作注册失败可安全重试。

该节点通过后才推进真实双设备同步、换设备和密码重置恢复。OCR 前先向用户索取真实截图；双人版先于安卓发布，具体双人规则另行确认。

## 云端实测与数据库探测（2026-10-05）

- 用户控制台测试 POST 同源、空 JSON，返回 503 / REGISTRATION_CLOSED；执行4ms、冷初始化1289ms。这证明函数在配置缺失时关闭注册，不证明真实注册或数据库可用。
- SQL 查询 pg_extension 中 pg_doc 得到0行，仅证明该扩展未安装，不能推断独立文档数据库不可用。不据此修改数据库架构或安装扩展。
- 新增独立 database-probe.js，仅接受控制台 document-readonly / transaction-readonly 事件；拒绝 HTTP 事件。固定读取 star_ledger_registration 的保留探测ID，不创建集合、不修改文档、不创建账号；结果只含状态、阶段、耗时和受限错误码。事务会由 SDK 开始/提交，但回调没有写操作。
- 每阶段单独调用，SDK 网络超时1800ms；云函数3秒总限制仍可能使事务阶段超时，此时不能推断文档数据库不存在。
- 操作：在现有注册函数添加 database-probe.js 并部署；临时将执行方法改为 database-probe.main；先测试 {"mode":"document-readonly"}，再测试 {"mode":"transaction-readonly"}；无论结果如何都恢复 index.main。不要开通探测HTTP路由。
- 本轮399项单元测试全部通过（含新增三项探测测试）；探测测试覆盖入口守卫、固定只读操作、不返回文档和异常机密。云端探测尚未运行；真实注册/同步继续待验收。

- 11:51用户截图：document-readonly 已实际执行，ok:false / PROBE_FAILED / elapsedMs1197，函数1204ms。该结果不证明数据库不存在。检查已安装数据库SDK源码发现错误使用 errCode/errMsg，原探测只读取 code，遗漏具体错误码；修正为优先 errCode、保留受限大写机器码，仍不返回 errMsg。新增对应回归测试，本轮400项测试通过；等待更新后云端重测。

- 11:59云端文档探测返回 INVALID_CREDENTIALS，817ms；凭据被拒绝，尚未验证数据库存在、集合或权限。12:02配置截图确认普通云函数、Node20.19、未显示执行角色/API Key；用户恢复入口时误填 index.js，已指导恢复 index.main，恢复结果尚待确认。
- 对照已安装SDK源码：支持环境变量临时密钥及入口 context.extendedContext.tmpSecret；签名依赖已在包内。当前探测未传入 context。新增控制台 credential-probe.main / {"mode":"credential-presence"}，仅返回环境变量和上下文凭据存在与否的布尔值，不返回密钥、Token、上下文、账户信息，不调用网络或数据库。先确认凭据来源，再决定初始化/权限修复，不臆测缺少角色或签发长期密钥。新增测试后401项单元测试通过；云端凭据存在检查尚未执行。

- 12:08凭据存在检查实际通过（3ms）：环境变量 secretId/secretKey/sessionToken 均true，apiKey false；context.extendedContext及其凭据全false。由此排除本次调用缺少三个凭据变量，但不证明凭据有效或执行角色权限足够。只读探测改为在入口调用期间显式传入三项运行时临时凭据，不使用长期密钥、不扩大授权；等待文档读取重测。既有401项单元测试和语法检查通过，不代表云端凭据修复成功。

- 12:12显式传入临时凭据后仍 INVALID_CREDENTIALS（1152ms），因此未修复。下一项为同一只读操作的服务端SDK对照：仅探测改用官方云资源调用文档推荐的 @cloudbase/node-sdk@3.18.3（已通过npm元数据确认版本），不修改注册生产入口，不开匿名认证、不扩大权限、不配置长期密钥。待云端对照结果决定存储适配是否需要切换；文档/事务/真实账户仍未验收。

## 2026-10-05 CloudBase MCP 接手：数据库模式已核实，注册数据库修复

范围 R14 / C05 / C06 / M6；读取基线为 feature/account-onboarding 的 b0e9a57，PR #17 保持草稿。先读根/app AGENTS、职责契约、执行计划与本进度，再核对真实云配置。

### 只读诊断

- 上海环境 xingzhang-dev-d0g4a950c6f1204d1 为 NORMAL，PostgreSQL 实例 postgres-45ay1vm6 已存在；Databases=null，RuntimeBackends={postgresql:true,nosql:false,mysql:false}。public 初始没有表，pg_extension 只有 plpgsql。
- ListTables 明确返回：此环境没有文档数据库实例，已配置 PostgreSQL，文档数据库动作不可用。请求 819f71e3-6303-4dc0-9c16-11ebc46b9b87；star_ledger_registration 文档集合不存在。由此确认 app.database() 的目标实例缺失，而非仅凭 pg_doc 缺失推断。
- 函数初始入口 database-probe.main；普通 Event / Nodejs20.19 / 256MB / 3秒，实际上海命名空间，角色 TCB_QcsRole，Active。
- CLS 请求 1d1f322f-ffdd-4dfe-acf1-c2ced892f2e5 确认服务端 SDK 文档读取 RESOURCE_NOT_FOUND，1101ms。旧探针主动舍弃 errMsg，历史日志不能还原原始完整异常正文；上述资源枚举提供可核实的完整根因。此前 js-sdk INVALID_CREDENTIALS 不证明临时凭据缺失，也不证明文档资源存在。
- 原日志查询工具底层接口已下线，改用 queryLogs 的 CLS 搜索。输出没有密钥、SessionToken、密码或邀请码原文。

### 实现与持久化边界

- 正式入口改用已锁定 @cloudbase/manager-node@5.9.0 的 database.executePGSql，在调用期间显式使用平台注入的短期凭据，固定环境/上海地域；不配置长期密钥或 API Key。
- 迁移 20261005051200_registration_claims 与 20261005052500_registration_claim_privileges 均经异步任务 Succeed、远端迁移历史及 schema 复查确认已应用。
- public.star_ledger_registration 以邀请摘要为主键，用户名和 UID 唯一，额外 lower(username) 唯一索引匹配云认证用户名归一化。claimed_at 使用数据库时钟；密码/邀请码原文不入库。
- 固定 INSERT ... ON CONFLICT DO NOTHING 是一条原子数据库事务，唯一索引处理跨请求/跨实例竞争。只接受服务端明确 AffectedRows=1 才创建用户，0 为已占用；缺失/异常结果或网络失败均关闭注册，不释放邀请。创建用户结果不确定仍不释放、不重置密码。
- 实测 ExecutePGSql 对 INSERT 即使带 RETURNING 仍返回 Columns/Rows=null，AffectedRows 为0/1；已据此修正适配层并增加本地回归。不得把中间探针报错写成最终通过。
- RLS 开启且 FORCE，anon/authenticated 没有表权限或放行策略；service_role 仅 SELECT/INSERT。平台建表默认曾授 service_role 全权限，已撤销其 UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER，并用后续迁移固定最小表权限。未改变全局鉴权或开启匿名登录。
- 没有安装 pg_doc、创建替代环境、扩展到同步数据库或改变前端页面。

### 云端验收（不等于页面全部完成）

| 验收项 | 实际结果 | 证据 |
| --- | --- | --- |
| 函数身份连接 PostgreSQL | 成功，读取真实注册表 | 92a84457-5647-4540-ad3c-580f27d7337b，208ms |
| 并发邀请原子占用 | 成功，两个并发请求只有一个成功、只有一条记录 | 0850b1c9-5781-4412-9158-a5783501839f，216ms |
| 故意异常回滚 | 成功，嵌套事务插入被回滚、复查无记录 | 4b0b6a68-1c83-4b96-a84a-cc04cd5d08fc，65ms |
| 无邀请码配置 | 503 / REGISTRATION_CLOSED | 7e4ca7a1-3ffd-4c2a-b958-97dbb81ad1b7，7ms |
| 错误邀请码 | 400 / INVITATION_INVALID，没有创建账号 | 64cd2db8-6bbb-4dfa-a52a-6e82fbd7a9cc，4ms |
| 真实受邀注册（正式函数直接调用） | 成功，201；auth.users 中确有对应 sub、external 普通账号和激活状态，邀请记录1条 | 8c008457-9dc5-4ddb-b87b-7674cd56a29d，947ms |
| 重复注册 | 400 / INVITATION_USED，没有重复账号 | 37410a33-dfe5-4b54-82fe-f23e84e834cf，78ms |
| 真实密码登录、邀请表访问隔离 | 成功，登录返回正确UID；真实用户读取邀请表403 | 831b09e3-8d8d-41e4-8cf3-6e8729b059f6，901ms |
| HTTP注册路由 / 浏览器真实流程 | 未验收；云端目前没有 /api/account/register 路由，未部署本PR网页 | 只读网关路由核对 |
| 双设备同步 / 恢复 | 未验收 | 后续门槛保持 |

随机24位用户名、随机密码和邀请码仅存本机仓库外文件，NTFS ACL仅当前用户；云配置只有摘要、指定用户名和到期时间。用户已明确授权生成随机密码并自动验收。保留真实新账号与其已占用邀请记录；探针临时记录已删除，回滚探针不留数据。

正式 Handler 必须最后复查为 index.main / Active。更新配置工具对 handler 字段没有实际效果；需 updateFunctionCode 顶层 handler，并等待 Active 后再运行，Updating 期间可能执行旧代码。本地三项新增存储适配测试通过；完整测试、类型检查及生产构建由 PR Verify 验证，不沿用此前401测试作为本轮证据。
