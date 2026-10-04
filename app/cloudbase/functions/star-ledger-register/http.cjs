function createHandler({origin,register}){
 return async event=>{
  const headers=Object.fromEntries(Object.entries(event?.headers||{}).map(([key,value])=>[key.toLowerCase(),value]));
  const response=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(body)});
  if(event?.httpMethod!=='POST')return response(405,{ok:false,code:'REGISTRATION_METHOD_INVALID'});
  if(headers.origin!==origin)return response(403,{ok:false,code:'REGISTRATION_ORIGIN_INVALID'});
  if(!String(headers['content-type']||'').toLowerCase().startsWith('application/json'))return response(400,{ok:false,code:'REGISTRATION_INPUT_INVALID'});
  if(typeof event.body!=='string'||event.isBase64Encoded||Buffer.byteLength(event.body)>2048)return response(400,{ok:false,code:'REGISTRATION_INPUT_INVALID'});
  let input;try{input=JSON.parse(event.body);}catch{return response(400,{ok:false,code:'REGISTRATION_INPUT_INVALID'});}
  let result;try{result=await register(input);}catch{result={ok:false,code:'REGISTRATION_UNAVAILABLE'};}
  return response(result.ok?201:['REGISTRATION_CLOSED','REGISTRATION_UNAVAILABLE','REGISTRATION_RESULT_UNKNOWN'].includes(result.code)?503:400,result);
 };
}
module.exports={createHandler};
