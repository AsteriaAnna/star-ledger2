# app/ 持续工作入口

继承根目录AGENTS.md。产品源码只维护本目录，legacy-duo只读参考。

2026-10-06晚间最新修订：下一项S1单图真实网页闭环，必要云服务与页面一起做，先实际可用再推进；详见docs/2026-10-06-usable-capture-delivery-plan.md。S1源码接通，待部署和真实网页/手机验收；见docs/2026-10-06-s1-capture-web-implementation.md。旧K顺序与停止点只作追溯。

23:54用户已授权按docs/2026-10-05-ai-capture-development-plan.md先开发AI截图公共基础再接页面；K01当前仅模块验证，真实云和页面按后续单元推进。开始时依次读：
1. `docs/project-status.md`
2. `docs/m1-m7-execution-plan.md`
3. `docs/plan-reconciliation.md`
4. `docs/responsibility-contract.md`

当前计划只有一份，其余日期报告/旧版本说明是证据或历史，不是平行待办。每个实现提交引用R/C/M节点，更新实际验证与未完成门槛；不能把服务已有、CI通过、云端实测、浏览器与真机完成混称完成。

先单人账务与文件/截图导入，再网页注册和共同登录/同步恢复，随后双人，再Windows/Android安装版。Android系统截图分享必须真机验收；iOS暂缓。扩大测试/短信按身份与恢复成熟度推进，双人具体权限和账务设定待讨论。

业务规则不写回main.ts。WIP恢复与PR #17不因整理自动合入main。每轮先检查分支与未提交修改，不覆盖别的执行环境的工作。
