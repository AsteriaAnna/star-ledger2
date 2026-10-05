export const cloudAccountMessages:Record<string,string>={
 CLOUDBASE_AUTH_FAILED:'云账户未能完成登录，请稍后重试；持续失败时请联系邀请人',
 CLOUDBASE_CREDENTIALS_INVALID:'用户名或密码不正确，请重新输入',
 CLOUDBASE_AUTH_RATE_LIMITED:'登录尝试过于频繁，请稍后再试',
 CLOUDBASE_LOGIN_DISABLED:'云端暂未启用此登录方式，请联系邀请人',
 CLOUDBASE_NETWORK_ERROR:'暂时连接不到云账户，本地账本已保留，请稍后重试',
 REGISTRATION_CLOSED:'受邀注册尚未开放，请联系邀请人',
 REGISTRATION_INPUT_INVALID:'请按说明填写用户名和密码',
 INVITATION_INVALID:'邀请码无效、已过期或与用户名不匹配，请向邀请人核对',
 INVITATION_USED:'邀请码已使用。如果刚才已注册，请直接登录；否则联系邀请人',
 REGISTRATION_UNAVAILABLE:'注册服务暂不可用，请稍后再试',
 REGISTRATION_RESULT_UNKNOWN:'注册结果暂未确认，请先尝试登录；仍无法登录时请联系邀请人'
};
