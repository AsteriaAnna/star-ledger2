import {channelKey,emptyChannel,paymentChannel,bankName,describeFundingChannel,needsSplitFunding,type FundingChannel} from '../../../packages/importing/channel.ts';
export {paymentChannel,bankName};
export type Channel=FundingChannel;
export const describeChannel=describeFundingChannel;
export function roleChannel(d:{kind:string;channel:string;raw:string;platform?:string},role:'account'|'to'){
 let raw:any;try{raw=JSON.parse(d.raw);}catch{}
 if(d.platform==='微信'&&role==='account'&&d.kind==='TRANSFER_IN'&&raw?.['当前状态']==='已存入零钱'&&emptyChannel(d.channel))return '零钱';
 if(d.platform==='微信'&&raw?.['交易类型']==='零钱充值'&&d.kind==='INTERNAL_TRANSFER')return role==='to'?'零钱':paymentChannel(d.channel).channel;
 if(d.platform==='微信'&&raw?.['交易类型']==='零钱提现'&&d.kind==='WITHDRAWAL')return role==='account'?'零钱':paymentChannel(d.channel).channel;
 return role==='to'&&d.kind==='REPAYMENT'&&/花呗/.test(d.raw)?'花呗':role==='account'?paymentChannel(d.channel).channel:'';
}


export const needsSplit=needsSplitFunding;
