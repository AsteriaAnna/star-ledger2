# 受邀注册部署与操作

> 2026-10-05 当前状态：本页说明feature/account-onboarding产品代码2d25e15，main尚无注册代码。服务端注册已实测，HTTP/浏览器未验收；当前用户要求暂停功能开发与部署。先读 [状态](../docs/project-status.md) 与 [唯一计划](../docs/m1-m7-execution-plan.md)，下列操作只能在该单元重新获授权后执行。

R14 / C05 / C06 / M6。默认拒绝所有注册；没有 STAR_LEDGER_INVITES_JSON 或格式错误时不会创建用户。不得把邀请码、密码、运行身份凭据提交 Git 或写入日志。

1. 环境 xingzhang-dev-d0g4a950c6f1204d1（ap-shanghai）实际为 PostgreSQL，没有文档数据库。通过版本化迁移应用 cloudbase/migrations 中两份 registration_claim* SQL，复查任务终态、远端历史和表结构。不要创建文档集合或安装 pg_doc。
2. public.star_ledger_registration 开启 FORCE RLS，anon/authenticated 无表权限和放行策略，service_role 仅 SELECT/INSERT。邀请摘要、用户名（含忽略大小写索引）、UID 唯一；客户端不能直接占用或读取邀请。
3. 从 functions/star-ledger-register 部署普通 Event 函数，Nodejs20.19、index.main、256 MB；锁定依赖由 npm ci 安装。正式入口使用 Manager SDK executePGSql 与调用期间注入的临时凭据，不使用浏览器数据库 SDK、API Key 或长期密钥。体验套餐三秒，单次成功耗时不能代替冷启动/并发压力验收。
4. 核查函数运行角色实际具备该环境 SQL 和创建用户所需权限；当前 TCB_QcsRole 已实测。不为前端配置管理员密钥，不盲目新增全资源管理员权限。创建参数仅普通 externalUser / ACTIVE。
5. HTTP 用户路径仍须单独配置和验收：将同源 POST /api/account/register 映射到 star-ledger-register，使用 event.httpMethod/headers/body 与集成响应。尚未登录的受邀人通过邀请码授权；Origin 仅辅助。不得为此放通数据库或其他函数、切换全局鉴权。先验收关闭状态再启用邀请。
6. 本机执行 node scripts/create-cloud-invitation.mjs USERNAME /ABSOLUTE/PATH/OUTSIDE/REPOSITORY.json。生成七天有效的邀请码，禁止覆盖已有文件；在 Windows 另设置 NTFS ACL。用户名5–24位，字母/数字开头，可含点、下划线、短横线。首次签发先确认用户名。
7. 将生成文件 envEntry 放入函数环境变量 STAR_LEDGER_INVITES_JSON 数组，只配置摘要、指定用户名和到期时间。邀请码原文私下交给指定用户，不放 URL。更新环境变量须保留其他既有变量。
8. 占用使用单条 INSERT ... ON CONFLICT DO NOTHING；以 ExecutePGSql 明确的 AffectedRows=1 判断成功，0 判断已用。没有客户端先读后写窗口。超时/异常关闭注册；创建账号结果不确定时不释放、不重置现有密码，先尝试登录并核查账户/领取记录。
9. pg-probe.main 只接受控制台 connection-readonly / claim-concurrency / transaction-rollback；后两项仅使用固定探针记录，绝不创建账户。运行并发探针前确认其保留测试用户名没有旧记录，运行后只清理该记录。auth-probe.main 仅用于控制台真实密码登录和邀请表拒绝访问验收。两者均拒绝 HTTP 事件，不返回凭据/Token；结束必须通过代码更新恢复 index.main，再等待 Active 并复读配置。
10. 云端真实注册、重复拒绝、普通用户权限、登录及耗时验收后，再部署对应 web-dist；保留托管根 __auth/ 与 cloud-admin/。当前正式函数创建真实用户已通过，浏览器注册、同步和恢复仍未验收。证据见 docs/2026-10-05-account-onboarding-progress.md。

正式 SQL 接口：https://docs.cloudbase.net/api-reference/manager/node/postgresql
HTTP 服务：https://docs.cloudbase.net/service/access-cloud-function
集成响应：https://docs.cloudbase.net/cloud-function/how-coding
登录接口：https://docs.cloudbase.net/http-api/auth/auth-sign-in

前端不保存密码和邀请码；服务端不记录请求体。云平台日志也须确认没有额外记录完整请求体。探针成功、测试通过、真实账号创建和完整用户路径验收分别记录。
