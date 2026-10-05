# 仓库与云部署清单

2026-10-05文档审查。GitHub分支/PR/Issue本轮已读取；云端依据最近用户转述和仓库证据，**不是本轮实时资源复查**。下列基线是产品/历史提交，后续文档提交另行记录在Git历史。

## 远端分支

| 分支 | 审查头 | 用途/处理 |
| --- | --- | --- |
| main | 6bf4a99 | 当前已合并产品基线；文档整理不会增加注册代码 |
| feature/account-onboarding | 8a5d6d3 | 产品2d25e15+反馈文档，PR #17草稿；暂停继续开发，保持 |
| wip/cloud-recovery-20261005 | a546bea | 未验证恢复实现，不能直接整包合入，保持 |
| m5-core-flows | 4453883 | 已是main祖先，历史开发入口，不再续写 |
| maintenance/personal-baseline-20261005 | 7dfd666 | 与main应用文件无差异的历史维护分支 |
| m4-v2-architecture | 9d46511 | main祖先，历史架构 |
| feat/wechat-refund-annotation | f08a09b | main祖先，旧退款工作 |
| perf-purge-reset | dcb25c3 | main祖先，旧性能/清理工作 |
| preview/m5-20261004 | 1219cc9 | 历史体验快照，不作当前入口 |
| preview/m5-clean-20261004 | b4b12bc | 历史清理快照 |
| preview/m5-20261005 | 475be02 | 历史同源OCR体验快照 |
| publish/m5-preview-20261004 | 13355be | 旧预览发布分支，main祖先 |
| publish/m5-clean-20261004 | fea890e | 旧发布分支，main祖先 |
| publish/m5-20261005 | f095bd2 | 非main祖先的历史发布快照；需核对独有发布文件，不按名字直接删除 |

本轮不删除分支：历史发布、WIP与源代码快照分开标记已足以消除接手入口混乱，之后如需删除，先确认合并/独有内容和可恢复引用。只有main/feature注册/WIP恢复需要当前接手者关注。

PR #16已合并、#9已被维护基线替代关闭；本轮开放PR只有#17，保持草稿。Issue #6来源身份/#8依赖/#11逐条结果/#12导入验收仍开放。新文档对#11/#12后续实现作状态校准，不关闭未完成验收。

## 云端资源与实际验收

| 资源 | 最近可追溯事实 | 当前缺口/下次只读复查 |
| --- | --- | --- |
| 环境 | xingzhang-dev-d0g4a950c6f1204d1 / ap-shanghai，体验版；最近NORMAL | 复读状态/套餐/地域，不能沿用模板猜30秒 |
| 数据库 | postgres-45ay1vm6；postgresql=true、nosql=false，只有plpgsql，未装pg_doc | 核对表/迁移/权限历史；不新建文档库或装扩展 |
| 注册表 | public.star_ledger_registration；两份迁移Succeed；主键邀请摘要、UID/用户名唯一及lower(username)索引 | RLS FORCE，客户端拒绝，service_role SELECT/INSERT；复读权限与迁移终态 |
| 注册函数 | 普通Event、Node20.19、index.main/Active、256MB、3秒、运行角色TCB_QcsRole；产品2d25e15 | 复读实际代码/Handler/状态，诊断不得留probe.main；负载和冷启动尚缺 |
| 注册真实任务 | 连接208ms、并发一胜、回滚成功、注册201/947ms、重复拒绝、登录成功/表403 | 仅函数直接调用和认证API，非完整网页任务；凭据仅在用户本机私密文件 |
| HTTP注册路由 | 最近报告没有/api/account/register | 待阶段2配置与浏览器验收；不放通其他函数/数据库 |
| 同步函数 | 先前普通Event/Node20.19/index.main/256MB，未认证拒绝9ms | 源码仍用js-sdk文档集合star_ledger_private；PG同步和真实认证调用未通过 |
| 网站 | 最近旧个人版已渲染，构建含同源OCR；__auth/及cloud-admin/保留 | PR #17新网页未部署；当前线上提交/资产哈希需复读，不能仅按main推定 |
| 认证 | 用户名密码启用、匿名关闭的部署记录；普通账号密码实测 | 允许域名/当前登录配置/会话与SDK真网页复核；短信/微信未实施 |
| OCR | 本地Tesseract及同源缓存，合成离线测试；没有云OCR开通证据 | 真支付案例、手机性能、图片处理包不是OCR额度；不自动付费开通 |
| 存储与其他资源 | 用户提供CBS/COS/CI/DDoS产品与图片处理包截图 | 不假定当前余额/可抵扣/续费，未实时查计费；不另建CVM或长期原图库 |

网站：[CloudBase测试地址](https://xingzhang-dev-d0g4a950c6f1204d1-1428502724.tcloudbaseapp.com/)。默认域名是开发测试入口，正式发布域名/访问体验列入M7讨论，不给未经核对的旧Pages链接。

## 部署证据和模板差异

[注册实测报告](2026-10-05-account-onboarding-progress.md)保存请求ID、迁移和权限复核；[04:13部署记录](2026-10-05-deployment-progress.md)说明旧网站与同步函数部署，旧记录中的文档库疑问已被注册阶段资源枚举解决。

cloudbaserc.json中同步timeout=30，实际体验函数记录3秒；database.rules.json只适用于文档存储，不能保护PG表。用户侧js-sdk2.32.0、注册函数manager5.9.0和诊断SDK版本不同，应按实际接口验证，不能按名称统一升级。本轮不改这些配置或依赖，避免把文档整理变成部署修改。

根deploy.yml仍push main触发GitHub Pages；verify.yml对main PR运行。文档整理提交使用[skip ci]避免触发旧Pages发布，不改workflow；应用代码验收仍引用2d25e15已通过CI。下一次真实功能提交需要对应CI，不能沿用跳过标记或把文档检查当应用测试。

## 可交给已连接MCP的Codex的只读复查任务

```text
只读检查星账上海环境xingzhang-dev-d0g4a950c6f1204d1。
读取环境/套餐/数据库模式；两函数实际代码版本、Handler、状态、角色、超时；
注册迁移/表结构/RLS与授权；HTTP路由；登录方式与允许域名；
静态托管根目录、index.html引用的资产哈希，并确认__auth/和cloud-admin/仍存在。
不发送短信、不调用注册、不写数据库、不部署、不输出凭据/Token/账号密码。
按事实、时间和请求/任务ID报告，与仓库repository-and-cloud-state.md逐项对比。
```

在取得该复读结果前，后续AI应保留“最近已验收/当前未实时复查”的表述，不反复要求重新授权或绕过凭据保护。
