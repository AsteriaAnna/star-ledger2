/** R03/R07, C01: classification suggestions cannot mutate accounting facts. */
export type CategoryAuthority='USER'|'SOURCE'|'MEMORY'|'RULE'|'AI'|'FALLBACK';
export type CategoryDecisionInput={
 availableCategoryIds:readonly string[];
 fallbackCategoryId:string;
 userCategoryId?:string|null;
 mappedSourceCategoryId?:string|null;
 rememberedCategoryId?:string|null;
 ruleCategoryId?:string|null;
 aiCategoryId?:string|null;
};
export type CategoryDecision={categoryId:string;authority:CategoryAuthority;userProtected:boolean};
/** Inputs are already mapped IDs; raw source text must never be treated as an ID. */
export function decideImportCategory(input:CategoryDecisionInput):CategoryDecision{
 const valid=(id:unknown):id is string=>typeof id==='string'&&id.length>0&&id.length<=100&&id.trim()===id;
 // Preserve an explicit user correction even if its category was subsequently retired.
 if(input.userCategoryId!==undefined&&input.userCategoryId!==null){
  if(!valid(input.userCategoryId))throw Error('INVALID_USER_CATEGORY');
  return {categoryId:input.userCategoryId,authority:'USER',userProtected:true};
 }
 const available=new Set(input.availableCategoryIds.filter(valid));
 if(!valid(input.fallbackCategoryId)||!available.has(input.fallbackCategoryId))throw Error('CATEGORY_FALLBACK_UNAVAILABLE');
 const candidates:readonly [CategoryAuthority,string|null|undefined][]=[
  ['SOURCE',input.mappedSourceCategoryId],['MEMORY',input.rememberedCategoryId],
  ['RULE',input.ruleCategoryId],['AI',input.aiCategoryId]
 ];
 for(const [authority,id] of candidates)if(valid(id)&&available.has(id))return {categoryId:id,authority,userProtected:false};
 return {categoryId:input.fallbackCategoryId,authority:'FALLBACK',userProtected:false};
}
