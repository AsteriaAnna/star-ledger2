# AI 协作约定

改动代码前先读这里。目标是：目录可定位、规则单一真相源、改动有测试兜底。

## 目录地图

- `app/` —— 单人版源码，**唯一当前维护对象**。
  - `app/packages/` —— 业务核心（domain / accounting / storage / sync / analytics / platform）。
  - `app/apps/web/` —— 网页前端（导入、OCR、界面、本地存储）。
  - `app/tests/`、`app/scripts/` —— 测试与脚本。
- `legacy-duo/` —— 双人版整包，**只读参考**（页面风格、历史设计）。不要修改、不要构建。
- `web-dist/` —— 构建产物，由 `npm run build:web` 生成，**不要手改、不要提交**（已 gitignore）。
- 原始账单数据在仓库外 `../原始账单数据/`，**不要提交**。

## 改动边界

- 只改 `app/`。
- 业务规则（金额、余额、消费、退款分配、亲情卡、负债符号）的唯一真相在 `app/packages/accounting/` 与 `app/packages/domain/invariants.ts`；界面只调用、不重新实现。
- 导入 / 入账核心流程在 `app/apps/web/src/`（importer、account-matcher、refund-matcher、import-workflow、store、channels、categories）。

## 验证

```sh
cd app
npm test                 # 底层账务 / 同步测试（离线）
npm run typecheck:web    # 类型检查
npm run build:web        # 构建
```

- 任何规则改动必须带测试；纯界面改动不得触碰 `app/packages/`。
- 冲突时不静默采用一端；存在未解决冲突时停止输出合计。

## 命名与规范

- 金额一律整数分（fen）；展示金额不参与余额 / 消费推导。
- 持久化实体字段用 snake_case（`display_amount`、`occurred_at`）；传输 / 内存 JSON 用 camelCase。
- 错误标识用英文机器码（如 `STALE_TRANSACTION`），中文文案集中映射到一处。
- `money()` = 解析字符串为分；校验器不要复用同名。

## 已知边界

- 同步采用手写 CRDT 投影（`app/packages/sync/projection.ts`），每次读取全量重放历史，暂不适合大量交易。
- 截图 OCR 使用 tesseract.js，首次需联网下载语言包。
