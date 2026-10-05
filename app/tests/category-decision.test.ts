import test from 'node:test';
import assert from 'node:assert/strict';
import {decideImportCategory,type CategoryDecisionInput} from '../packages/importing/category-decision.ts';
const base:CategoryDecisionInput={availableCategoryIds:['其他','餐饮','购物','交通'],fallbackCategoryId:'其他'};
test('user correction survives late Excel and AI, including retired category',()=>{
 const input={...base,userCategoryId:'校园开支',mappedSourceCategoryId:'购物',aiCategoryId:'餐饮'};
 assert.deepEqual(decideImportCategory(input),{categoryId:'校园开支',authority:'USER',userProtected:true});
 assert.equal(input.aiCategoryId,'餐饮'); // Suggestion evidence is not overwritten.
});
test('explicit mapped source outranks memory, rule and AI',()=>{
 assert.equal(decideImportCategory({...base,mappedSourceCategoryId:'购物',rememberedCategoryId:'交通',ruleCategoryId:'餐饮',aiCategoryId:'其他'}).authority,'SOURCE');
});
test('unavailable source category falls through to valid scoped memory',()=>{
 assert.deepEqual(decideImportCategory({...base,mappedSourceCategoryId:'不存在',rememberedCategoryId:'交通',aiCategoryId:'餐饮'}),{categoryId:'交通',authority:'MEMORY',userProtected:false});
});
test('deterministic rule outranks AI; AI is usable only from ledger catalog',()=>{
 assert.equal(decideImportCategory({...base,ruleCategoryId:'购物',aiCategoryId:'餐饮'}).authority,'RULE');
 assert.equal(decideImportCategory({...base,aiCategoryId:'餐饮'}).authority,'AI');
 for(const aiCategoryId of ['新建分类',' 餐饮','',null])assert.deepEqual(decideImportCategory({...base,aiCategoryId}),{categoryId:'其他',authority:'FALLBACK',userProtected:false});
});
test('missing classification remains nonblocking while broken user correction is an error',()=>{
 assert.equal(decideImportCategory(base).categoryId,'其他');
 assert.throws(()=>decideImportCategory({...base,userCategoryId:''}),/INVALID_USER_CATEGORY/);
 assert.throws(()=>decideImportCategory({...base,fallbackCategoryId:'不存在'}),/CATEGORY_FALLBACK_UNAVAILABLE/);
});
