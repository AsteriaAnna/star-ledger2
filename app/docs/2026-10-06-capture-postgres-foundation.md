# K05a：CloudBase识别任务与持久结果基础

2026-10-06；R03/C02/C05/C06/M5.1-O/F。当前授权继续AI截图服务开发。本轮不调用模型，不部署网页，不变更注册/同步资源。

## 已交付

- `cloudbase/migrations/003-capture-task-and-result.sql`：一个DO迁移创建任务/不可变提取结果两表，复合user/ledger/task主键，版本与JSON归属约束；开启FORCE RLS，拒绝PUBLIC/anon/authenticated，service_role获得任务SELECT/INSERT/UPDATE、结果SELECT/INSERT。
- `cloudbase/functions/star-ledger-capture/postgres.cjs`：注入官方Manager executePGSql，固定运行Role=service_role；所有字符串十六进制编码进入SQL，不插入用户SQL片段。每次请求一条SQL，Columns/Rows严格解码，传输错误不当成功。
- `packages/application/remote-capture.ts`：从调用方已验证身份构造任务，不从请求体取owner；重复ID/同指纹返回同任务，指纹变化拒绝。取消后旧worker拒绝。READY指针与完整提取证据在同一SQL提交，读取缺证据报技术错误。

任务和结果通过版本CAS及CTE一起发布。没有“先标完成、后补结果”的窗口。云保存结果不代表客户端已落账；远端适配拒绝直接COMPLETED/本机账本提交，客户端已有K04原子提交另用本机数据库。

## 验证和实际状态

新增5项回归：身份/幂等与不同指纹、取消/迟到/租约、缺持久结果、SQL注入与scope/Role、单语句CAS与错误响应。核心456项、核心/Web类型和平台检查通过。SQL传输为替身，**没有真实PostgreSQL并发或迁移验证**。未安装PG实例，不用SQLite冒充PG；未重跑本轮未改的Web构建/浏览器。

当前会话工具清单没有CloudBase MCP，本地无tcb/PostgreSQL客户端；不能复查当前云端资源或执行迁移。此前用户电脑Codex的MCP已连通属于另一执行环境，不要求用户重新授权。GitHub代码已具备交接条件，真实云端任务未完成。

只保存最小任务与必要提取证据，不保存整个导入工作区。私密图片上传、服务端模型凭证/预算、worker部署与触发、可靠结果领取回执、TTL清理尚未完成；新目录没有index.main，不能直接部署为产品函数。

## 官方接口核对

2026-10-06读取官方说明：executePGSql返回Columns及Rows，Rows每行是JSON字符串数组；不能跨请求用BEGIN/COMMIT模拟事务，每请求只支持一条SQL，故使用CTE和单DO迁移。

- https://docs.cloudbase.net/en/api-reference/manager/node/postgresql
- https://docs.cloudbase.net/database/postgresql/troubleshooting/common-errors
- https://docs.cloudbase.net/cloud-function/function-configuration/config

配置文档说明普通事件函数3秒是默认配置，支持更长超时。**历史报告将实际3秒推断成体验套餐上限，没有足够依据**；不改写历史测量，但后续必须实时检查本环境可配范围。worker不可照搬注册函数默认3秒；客户端快速接受任务与慢识别分开。不同FAQ存在60秒与配置页900秒差异，不能由文档直接断言该套餐上限或直接升级套餐。

## 交给已连接CloudBase MCP的Codex的指令

```text
星账K05a真实PostgreSQL验收。源码仓库AsteriaAnna/star-ledger2，
分支feature/capture-foundation-20261005。先读取AGENTS及
app/docs/project-status.md、m1-m7-execution-plan.md、当前K05a说明。

只在xingzhang-dev-d0g4a950c6f1204d1 / ap-shanghai操作。
先只读核对：环境/套餐、PostgreSQL实例、service_role权限/BYPASSRLS、
star_ledger_capture_task/result是否存在；实际云函数超时及可配置范围。
不改注册、登录配置、同步表、既有云函数Handler或静态托管。

若任务表尚不存在，应用且只应用
app/cloudbase/migrations/003-capture-task-and-result.sql，
按单条DO请求执行，不按分号拆开；保存迁移结果/RequestId，复读表结构、
主键/检查/FK、FORCE RLS与授权；若同名表已有不同结构先报告，不覆盖。
使用固定synthetic-k05a-probe用户/账本/任务测试，不创建真实账号、
不上传真实图、不调用模型、不输出任何凭据。

验证：create幂等；同版本两并发CAS只有一胜；取消后旧响应拒绝；
publish一次SQL使READY与完整证据共同出现；注入保存结果失败，
确认任务版本/状态和结果都回滚；不同用户和账本scope查不到对方；
调用anon/authenticated直接读写表均拒绝。

运行仓库当前代码的CapturePostgresRepository与RemoteCaptureService，
不是另写一套SQL逻辑来声称仓库通过。公共TS代码用Node24执行或按工程
方式编译；SQLSDK使用已有调用期间身份，不索取聊天明文密钥。
结束只清理synthetic-k05a-probe记录（先结果后任务，由管理角色），
保留业务表/迁移，不改任何正式函数入口，不部署未完成识别函数。

回报各项通过/失败、实际资源/权限/超时、请求ID、代码commit，
区分真实SQL验证与替身测试。不得宣称页面/真机或整个K05完成。
```

## 下一项

先取得真实PG存储验收；可并行准备K05b私密图片/worker受限调用及持久结果领取。没有云端权限事实前不建立替代数据库，不复用已停用试验Key。正式调用需真实UID与图片访问授权、调用预算、一次自动重试与不确定状态查询、清理机制验证，再K06接页面。
