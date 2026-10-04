# 受邀注册部署与操作

默认拒绝所有注册；没有 STAR_LEDGER_INVITES_JSON 或格式错误时不会创建用户。不得把邀请码、密码、运行身份凭据提交 Git 或写入日志。

1. 确认环境 xingzhang-dev-d0g4a950c6f1204d1 的文档数据库可用，建立 star_ledger_registration 集合，客户端读写均禁止（read:false / write:false）。服务端通过云函数身份访问。没有集合或权限时拒绝注册。
2. 从 functions/star-ledger-register 部署普通 Event 函数，Nodejs20.19、index.main、256 MB；锁定依赖由 npm ci 安装。体验套餐当前只能配置三秒，须实测冷启动和创建耗时。
3. 核查函数运行角色实际具备该环境创建用户所需权限；不为前端配置管理员密钥，不盲目新增全资源管理员权限。创建参数只允许普通 externalUser / ACTIVE。
4. 使用 CloudBase HTTP 访问服务，将同源 POST /api/account/register 映射到普通函数 star-ledger-register，使用 event.httpMethod/headers/body 和集成响应格式。此路由须允许尚未登录的受邀人访问；邀请码为实际授权，Origin 检查仅辅助。不得放通其他函数或数据库。先在无邀请码配置下验收关闭状态，再启用邀请。
5. 本机执行 node scripts/create-cloud-invitation.mjs USERNAME /ABSOLUTE/PATH/OUTSIDE/REPOSITORY.json。生成文件权限 0600，七天有效，禁止覆盖已有文件。用户名 5–24 位，以字母或数字开头，可含点、下划线、短横线。
6. 将生成文件的 envEntry 放入函数环境变量 STAR_LEDGER_INVITES_JSON 的 JSON 数组；只配置摘要、用户名和到期时间。邀请码原文由邀请人私下交给指定用户，不放 URL。首次签发前确认用户希望使用的用户名。
7. 创建结果不确定时先尝试登录，由邀请人检查账户和领取记录；只有确认未创建任何账户时才考虑签发新的邀请。不得根据网络错误释放已领取记录或重置现有密码。
8. 云端真实注册/重复拒绝/登录/身份隔离/耗时验收后，再部署对应 web-dist 文件。保留托管根目录 __auth/ 与 cloud-admin/，index.html 在根目录。

HTTP 服务官方契约：https://docs.cloudbase.net/service/access-cloud-function
集成响应：https://docs.cloudbase.net/cloud-function/how-coding
服务器 SDK：https://docs.cloudbase.net/api-reference/server/node-sdk/initialization

当前代码准备完毕不代表以上云端配置已完成。前端不保存密码和邀请码；服务端不记录请求体。云平台日志配置也须确认没有额外记录完整请求体。
