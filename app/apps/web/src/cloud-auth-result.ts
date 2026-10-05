import type {CloudIdentity} from './cloudbase.ts';
/** Whitelisted codes only: provider descriptions may contain account details. */
export function cloudAuthError(value:unknown):Error{
 const e=value as {code?:unknown;error?:unknown;status?:unknown}|null;
 const code=String(e?.code||e?.error||'').toLowerCase();
 if(['invalid_credentials','invalid_grant','invalid_password','invalid_username_or_password'].includes(code))return Error('CLOUDBASE_CREDENTIALS_INVALID');
 if(['too_many_requests','over_request_rate_limit','rate_limit_exceeded'].includes(code)||e?.status===429)return Error('CLOUDBASE_AUTH_RATE_LIMITED');
 if(['provider_disabled','login_disabled','operation_not_allowed'].includes(code))return Error('CLOUDBASE_LOGIN_DISABLED');
 return Error('CLOUDBASE_AUTH_FAILED');
}
export function cloudIdentityFrom(result:any,username=''):CloudIdentity|null{
 if(result?.error)throw cloudAuthError(result.error);
 const data=result?.data,uid=data?.session?.sub||data?.user?.id||data?.user?.ID||data?.user?.uid||data?.session?.user?.id;
 if(typeof uid!=='string'||!uid)return null;
 return {uid,username:username||String(data?.user?.username||data?.user?.user_metadata?.username||data?.user?.Username||'我的账户')};
}
