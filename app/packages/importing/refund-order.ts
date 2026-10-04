/** Alipay suffixes identify a refund of the original order before the first separator.
 * A prefix is only a claim; callers still require a unique namespaced source and valid return amounts. */
export function refundOriginalOrder(platform:string,order:string|null|undefined,explicit?:string|null):string|null{
 if(explicit)return explicit;
 if(platform!=='支付宝'||!order)return null;
 const at=order.search(/[*_]/);
 return at>0&&at<order.length-1?order.slice(0,at):null;
}
