module.exports=async function verifyLateRefunds({browser,baseUrl,db,entities,ok,errors,upload,answerAccount}){
 const assert=require('assert/strict'),header='支付宝交易记录\n交易时间,交易分类,交易对方,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号\n';
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(baseUrl+'/#import');await page.locator('[data-action=import-file]').waitFor();
 const refund=header+'2026-10-04 12:00:00,餐饮美食,商户,退款-午餐,不计收支,5,余额,退款成功,late-order*REFUND_1\n';
 const original=header+'2026-09-30 12:00:00,餐饮美食,商户,午餐,支出,20,余额,交易成功,late-order\n';
 const seed=await upload(page,'similar-original.csv',original.replace(',20,余额',',5,余额').replace('late-order','other-order'));await answerAccount(page,seed,'余额','支付宝余额');
 const old=await upload(page,'refund-first.csv',refund);let s=await db(page);const refundId=s.importWorkspace.outcomes[old][0].transactionId;
 assert.equal(s.importWorkspace.attention[old].filter(a=>a.kind==='REFUND_RELATION').length,0);assert.ok(!entities(s,'transaction_links').some(l=>l.from_transaction_id===refundId&&!l.deleted_at));const refundSources=entities(s,'source_records').filter(e=>e.transaction_id===refundId),refundMovements=entities(s,'balance_movements').filter(e=>e.transaction_id===refundId);
 const newer=await upload(page,'original-later.csv',original);s=await db(page);const originalId=s.importWorkspace.outcomes[newer][0].transactionId;
 assert.ok(entities(s,'transaction_links').some(l=>l.from_transaction_id===refundId&&l.to_transaction_id===originalId&&!l.deleted_at));assert.equal(s.importWorkspace.attention[old].length,0);assert.equal(s.importWorkspace.sessions[old].nonBlockingAttentionCount,0);assert.equal(s.importWorkspace.outcomes[old][0].state,'COMMITTED');assert.deepEqual(entities(s,'source_records').filter(e=>e.transaction_id===refundId),refundSources);assert.deepEqual(entities(s,'balance_movements').filter(e=>e.transaction_id===refundId),refundMovements);
 await page.reload();await page.locator('[data-action=import-file]').waitFor();assert.equal((await db(page)).importWorkspace.attention[old].length,0);await upload(page,'original-again.csv',original);s=await db(page);assert.equal(entities(s,'transactions').length,3);
 ok('Refund-first cross-batch import automatically links a later original, clears the old question after reload and never reposts money');
 await upload(page,'weak-original.csv',original.replace('late-order','weak-order'));
 const kept=await upload(page,'kept-refund.csv',refund.replace('late-order','keep-order').replace(',5,余额',',20,余额'));s=await db(page);const keptId=s.importWorkspace.outcomes[kept][0].transactionId;
 await page.goto(baseUrl+'/#bills');await page.locator('#month').fill('2026-10');await page.locator('#month').dispatchEvent('change');await page.locator(`.bill-main[data-detail="${keptId}"]`).click();await page.locator(`[data-link-return="${keptId}"]`).click();await page.locator('#link-return-form [name=original]').selectOption('');await page.locator('#link-return-form [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});
 await page.goto(baseUrl+'/#import');await upload(page,'kept-original.csv',original.replace('late-order','keep-order'));s=await db(page);assert.ok(!entities(s,'transaction_links').some(l=>l.from_transaction_id===keptId&&!l.deleted_at));assert.equal(s.importWorkspace.attention[kept].filter(a=>a.kind==='REFUND_RELATION').length,0);assert.equal(entities(s,'balance_movements').filter(e=>e.transaction_id===keptId).reduce((n,m)=>n+m.amount,0),2000);
 ok('Refund detail offers a working relation answer and honors explicit keep-unlinked when the original arrives later');
 await context.close();
};
