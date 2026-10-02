export type ReturnAllocationInput={
 originalAmount:number;
 originalConsumption:number;
 previousReturned:number;
 previousReduction:number;
 amount:number;
 requestedReduction?:number;
};

export type ReturnAllocationResult=
 |{state:'RESOLVED';reduction:number}
 |{state:'NEEDS_ALLOCATION';reason:string};

const safe=(value:number)=>Number.isSafeInteger(value)&&value>=0;
const add=(a:number,b:number)=>{const n=a+b;if(!Number.isSafeInteger(n))throw Error('MONEY_OVERFLOW');return n;};

export function resolveReturnAllocation(input:ReturnAllocationInput):ReturnAllocationResult{
 for(const value of [input.originalAmount,input.originalConsumption,input.previousReturned,input.previousReduction,input.amount])if(!safe(value))throw Error('INVALID_MONEY');
 if(input.originalAmount<=0||input.amount<=0)throw Error('INVALID_MONEY');
 if(input.originalConsumption>input.originalAmount||input.previousReduction>input.previousReturned||input.previousReturned>input.originalAmount)throw Error('INVALID_RETURN_ALLOCATION');
 if(add(input.previousReturned,input.amount)>input.originalAmount)throw Error('RETURN_EXCEEDS_ORIGINAL');

 let reduction=input.requestedReduction;
 if(reduction===undefined){
  if(input.originalConsumption===0)reduction=0;
  else if(input.originalConsumption===input.originalAmount)reduction=input.amount;
  else if(input.amount===input.originalAmount&&input.previousReturned===0)reduction=input.originalConsumption;
  else return {state:'NEEDS_ALLOCATION',reason:'原交易只有部分金额计入消费，需要确认本次退款冲减多少消费'};
 }
 if(!safe(reduction))throw Error('INVALID_MONEY');
 if(reduction>input.amount||add(input.previousReduction,reduction)>input.originalConsumption)throw Error('REFUND_CONSUMPTION_EXCEEDED');
 const nonConsumed=input.originalAmount-input.originalConsumption;
 if(add(input.previousReturned-input.previousReduction,input.amount-reduction)>nonConsumed)throw Error('REFUND_NONCONSUMPTION_EXCEEDED');
 return {state:'RESOLVED',reduction};
}
