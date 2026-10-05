const {createHash,randomUUID} = require('node:crypto');
// Temporary console-only acceptance probe. Never logs credentials or tokens.
exports.main = async event => {
  if (!event || event.httpMethod || event.headers || event.mode !== 'password-login' ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{4,23}$/.test(event.username) ||
      typeof event.password !== 'string') return {ok:false,code:'CONSOLE_PROBE_ONLY'};
  const started=Date.now();
  const env='xingzhang-dev-d0g4a950c6f1204d1';
  const base='https://'+env+'.api.tcloudbasegateway.com';
  try {
    const response=await fetch(base+'/auth/v1/signin?client_id='+encodeURIComponent(env),{
      method:'POST', headers:{'Content-Type':'application/json','x-device-id':randomUUID(),Origin:'https://xingzhang-dev-d0g4a950c6f1204d1-1428502724.tcloudbaseapp.com'},
      body:JSON.stringify({username:event.username,password:event.password}),
      signal:AbortSignal.timeout(1800)
    });
    const result=await response.json();
    const expected='sl'+createHash('sha256').update('star-ledger:user:'+event.username).digest('hex').slice(0,62);
    if (!response.ok || typeof result.access_token!=='string' || result.sub!==expected) {
      const code=typeof result.error==='string' && /^[a-z_]{1,64}$/.test(result.error)?result.error:'LOGIN_PROBE_FAILED';
      return {ok:false,code,status:response.status,mentionsUser:/user/i.test(result.error_description || ''),mentionsClient:/client/i.test(result.error_description || ''),elapsedMs:Date.now()-started};
    }
    const denial=await fetch(base+'/v1/rdb/rest/star_ledger_registration?select=id&limit=1',{
      headers:{Authorization:'Bearer '+result.access_token},signal:AbortSignal.timeout(1000)
    });
    // Only report booleans/status. No token or private database result is returned.
    return {ok:true,authenticated:true,privateClaimsDenied:[401,403].includes(denial.status),
      privateClaimsStatus:denial.status,elapsedMs:Date.now()-started};
  } catch {
    return {ok:false,code:'LOGIN_PROBE_UNAVAILABLE',elapsedMs:Date.now()-started};
  }
};
