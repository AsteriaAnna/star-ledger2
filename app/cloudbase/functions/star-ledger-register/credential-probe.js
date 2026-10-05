// Console-only presence check. Never return credential values or context contents.
exports.main = async (event, context) => {
  if (!event || event.httpMethod || event.headers || event.mode !== 'credential-presence') {
    return { ok: false, code: 'CONSOLE_PROBE_ONLY' };
  }
  const temporary = context?.extendedContext?.tmpSecret;
  return {
    ok: true,
    environment: {
      secretId: !!process.env.TENCENTCLOUD_SECRETID,
      secretKey: !!process.env.TENCENTCLOUD_SECRETKEY,
      sessionToken: !!process.env.TENCENTCLOUD_SESSIONTOKEN,
      apiKey: !!process.env.CLOUDBASE_APIKEY
    },
    context: {
      extendedContext: !!context?.extendedContext,
      secretId: !!temporary?.secretId,
      secretKey: !!temporary?.secretKey,
      sessionToken: !!temporary?.token
    }
  };
};
