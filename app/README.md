# 星账 · 当前开发入口

先读 [当前状态](docs/project-status.md)、[唯一计划](docs/m1-m7-execution-plan.md)、[需求对照](docs/plan-reconciliation.md) 和 [职责契约](docs/responsibility-contract.md)。当前仅文档整理，功能开发等待用户逐项讨论与案例。

## 代码与产品范围

网页为当前主要客户端；Web本地数据使用IndexedDB。Node/SQLite用于核心存储验证；Tauri原生目录只是探针，不是已完成Windows/Android应用。电脑文件导入和手机截图捕获共用账务语义，截图准确率、退款、多图和真机交互仍未验收。

GitHub仅源码；CloudBase上海环境承载目标网站、认证与数据，实际只有PostgreSQL。受邀注册产品代码2d25e15在feature/account-onboarding；main产品代码6bf4a99未包含该功能。云端注册已通过函数直接调用与密码登录验收；HTTP网页注册和真实同步恢复尚未完成。

## 开发命令

需要Node.js24或以上，在本目录执行：

```sh
npm ci
npm run dev:web
npm test
npm run typecheck
npm run typecheck:web
npm run check:platform
npm run build:web
npm run test:web:imports
```

构建生成本目录web-dist，用于CloudBase；不提交产物。test:web是旧界面历史脚本，当前浏览器入口是test:web:imports；可用CHROMIUM_EXECUTABLE指定浏览器。实际OCR资源验证入口test:web:ocr:offline，仅既有合成图片证据不能代替用户截图。

## 模块职责

| 目录 | 职责 |
| --- | --- |
| packages/domain、accounting | 金额、不变量、资金和消费、业务命令 |
| packages/application、importing | 用户任务、来源、去重、解释和回答 |
| packages/analytics | 消费贡献、余额与期间查询 |
| packages/storage、sync、platform | 存储、同步、加密与平台接口 |
| apps/web | UI、捕获/文件适配、IndexedDB |
| cloudbase | 云函数、SQL迁移、权限和操作说明 |
| tests、scripts | 规则回归、浏览器与构建 |
| apps/native-probe | Tauri/SQLite能力探针 |
| apps/windows、android | 待实现的平台说明 |
| docs | 当前入口、技术基线和历史证据 |

部署前阅读 [CloudBase状态与约束](cloudbase/README.md)。旧GitHub账本迁移取消，备份恢复和换设备保留。旧发布路径不再作为当前体验入口；根Pages自动发布工作流尚待后续单独处理。

早期G0–G2原型README已移至 [历史记录](docs/archive/early-core-readme.md)。其中测试数量、未安装依赖和未做界面等描述仅属于当时。
