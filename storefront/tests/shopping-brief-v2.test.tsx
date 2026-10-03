import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {newShoppingState,restoreShoppingState,pinRecord,uiFact,withBrief} from '../src/ShoppingProvider';
import {applyBriefOperations,undoBrief} from '../shared/briefState';
import {ShoppingProvider} from '../src/ShoppingProvider';
import {ShoppingBrief,editorFact,editorOperations,initialBriefEditor,briefAnnouncement,briefFactFieldLabel} from '../src/ShoppingBrief';
import {ShoppingWorkspace} from '../src/ShoppingWorkspace';
const record={objectID:'saved',Catalog_TitleDescription:'Saved piece',Pricing_ActivePrice:200,Media_Images:[]};
describe('chat-side brief and independent selections',()=>{
 it('migrates legacy numeric budget and retains independently saved records',()=>{
  const state=pinRecord(newShoppingState(),record);const legacy={...state,budgetCents:20000,budgetScope:'total'};delete (legacy as any).brief;
  const restored=restoreShoppingState(JSON.stringify(legacy));
  expect(restored.products[0].product.id).toBe('saved');expect(restored.brief.facts[0].value).toMatchObject({kind:'money',cents:20000,basis:'total'});
 });
 it('targeted retraction and undo preserve unrelated exclusions and saved products',()=>{
  let state=pinRecord(newShoppingState(),record);const heart=uiFact('exclusion','no hearts'),gold=uiFact('exclusion','no yellow gold');
  state=withBrief(state,applyBriefOperations(state.brief,{missionId:state.missionId,expectedRevision:0,turnId:'add',operations:[{type:'add',fact:heart},{type:'add',fact:gold}]}));
  state=withBrief(state,applyBriefOperations(state.brief,{missionId:state.missionId,expectedRevision:1,turnId:'remove',operations:[{type:'retract',factIds:[heart.id]}]}));
  expect(state.facts.map(f=>f.value)).toEqual(['no yellow gold']);expect(state.products[0].product.id).toBe('saved');
  state=withBrief(state,undoBrief(state.brief,2));expect(state.facts.map(f=>f.value)).toEqual(['no hearts','no yellow gold']);expect(state.brief.revision).toBe(3);
 });
 it('starts the chat brief without an intake form and keeps preferences out of product work',()=>{
  const chat=renderToStaticMarkup(<ShoppingProvider><ShoppingBrief/></ShoppingProvider>);
  expect(chat).toContain('Your brief');expect(chat).toContain('Add preference');expect(chat).not.toContain('<input');
  const products=renderToStaticMarkup(<ShoppingProvider><ShoppingWorkspace/></ShoppingProvider>);
  expect(products).not.toContain('Edit preferences');expect(products).not.toContain('Budget (USD)');expect(products).not.toContain('Your brief');
 });
 it('restores a valid v2 brief without reverting its strict numeric operator',()=>{
  let state=newShoppingState();const fact=uiFact('budget','under 200');fact.value={kind:'money',cents:20000,currency:'USD',operator:'lt',basis:'total'};fact.strength='requirement';
  state=withBrief(state,applyBriefOperations(state.brief,{missionId:state.missionId,expectedRevision:0,turnId:'under',operations:[{type:'add',fact}]}));
  expect(restoreShoppingState(JSON.stringify(state)).brief.facts[0].value).toMatchObject({operator:'lt'});
 });
});

it('allows explicit edits of strength and scope without changing the preference text',()=>{
 let state=newShoppingState();const original=uiFact('style','delicate');state=withBrief(state,applyBriefOperations(state.brief,{missionId:state.missionId,expectedRevision:0,turnId:'one',operations:[{type:'add',fact:original}]}));
 const changed={...uiFact('style','delicate'),strength:'requirement' as const,scope:{kind:'item' as const,key:'necklace'}};
 state=withBrief(state,applyBriefOperations(state.brief,{missionId:state.missionId,expectedRevision:1,turnId:'two',operations:[{type:'replace',factIds:[original.id],fact:changed}]}));
 expect(state.brief.facts.filter(f=>f.status==='active')).toMatchObject([{strength:'requirement',scope:{kind:'item',key:'necklace'}}]);
});

import {compileBriefConstraints} from '../shared/briefConstraints';
it('compiles an explicit required catalogue material and keeps other wording as context',()=>{
 const state=newShoppingState();const exact=editorFact('material','',undefined,'Catalog_JewelryMaterialNavigationName',['Silver']);exact.strength='requirement';
 const brief=applyBriefOperations(state.brief,{missionId:state.missionId,expectedRevision:0,turnId:'silver',operations:[{type:'add',fact:exact}]});
 expect(compileBriefConstraints(brief).filters).toBe('Catalog_JewelryMaterialNavigationName:"Silver"');
 expect(editorFact('material','silver colour',undefined,'',[]).value).toEqual({kind:'text',text:'silver colour'});
});
it('preserves facet attribute, exclusion operator and item scope while replacing only the edited fact',()=>{
 const state=newShoppingState();const gold=editorFact('exclusion','',undefined,'Catalog_JewelryMaterialNavigationName',['Gold']);gold.value={...gold.value as any,operator:'none'};gold.scope={kind:'item',key:'earrings'};gold.strength='requirement';
 const hearts=uiFact('exclusion','no hearts');const brief=applyBriefOperations(state.brief,{missionId:state.missionId,expectedRevision:0,turnId:'add',operations:[{type:'add',fact:gold},{type:'add',fact:hearts}]});
 const previous=brief.facts.find(f=>f.id===gold.id)!;const edited=editorFact('exclusion','',previous,'Catalog_JewelryMaterialNavigationName',['Gold','Gold Filled']);
 const next=applyBriefOperations(brief,{missionId:state.missionId,expectedRevision:1,turnId:'edit',operations:[{type:'replace',factIds:[gold.id],fact:edited}]});
 expect(next.facts.find(f=>f.id===hearts.id)?.status).toBe('active');expect(edited.value).toMatchObject({attribute:'Catalog_JewelryMaterialNavigationName',operator:'none',values:['Gold','Gold Filled']});expect(edited.scope).toEqual({kind:'item',key:'earrings'});expect(edited.strength).toBe('requirement');
 expect(()=>editorFact('exclusion','gold',previous,'',[])).toThrow();
});
it('keeps a purity facet typed and rejects unverified catalogue choices',()=>{
 const state=newShoppingState();const purity=editorFact('material','',undefined,'Catalog_JewelryMaterialNavigationPurity',['Sterling']);purity.strength='requirement';const brief=applyBriefOperations(state.brief,{missionId:state.missionId,expectedRevision:0,turnId:'purity',operations:[{type:'add',fact:purity}]});
 const edited=editorFact('material','',brief.facts[0],'Catalog_JewelryMaterialNavigationPurity',['950']);expect(edited.value).toMatchObject({kind:'facet',attribute:'Catalog_JewelryMaterialNavigationPurity',values:['950']});
 expect(()=>editorFact('material','',undefined,'Catalog_JewelryMaterialNavigationName',['Sterling silver'])).toThrow();
});

it('edits a product-type other facet as its original field rather than a monetary budget',()=>{
 const state=newShoppingState();const ring=editorFact('other','',undefined,'Catalog_ProductType',['Ring']);ring.strength='requirement';
 const brief=applyBriefOperations(state.brief,{missionId:state.missionId,expectedRevision:0,turnId:'ring',operations:[{type:'add',fact:ring}]});
 const initial=initialBriefEditor(brief.facts[0]);expect(initial.field).toBe('other');expect(initial.draft).toBe('Ring');
 const edited=editorFact(initial.field,initial.draft,brief.facts[0],'Catalog_ProductType',['Necklace']);
 expect(edited.field).toBe('other');expect(edited.value).toEqual({kind:'facet',attribute:'Catalog_ProductType',values:['Necklace'],operator:'any'});
});

it('replaces an old undo announcement when a later automatic brief arrives',()=>{
 const state=newShoppingState();const fact=uiFact('style','delicate');const brief=applyBriefOperations(state.brief,{missionId:state.missionId,expectedRevision:0,turnId:'spoken',operations:[{type:'add',fact}]});
 expect(briefAnnouncement(1,brief.facts,{text:'Your last brief change was undone.',revision:0})).toBe('Your brief was updated: delicate.');
 expect(briefAnnouncement(1,brief.facts,{text:'Your last brief change was undone.',revision:1})).toBe('Your last brief change was undone.');
});

it('distinguishes material purity from material and occasion in compact chip labels',()=>{
 const state=newShoppingState();const facts=[editorFact('material','',undefined,'Catalog_JewelryMaterialNavigationName',['Silver']),editorFact('material','',undefined,'Catalog_JewelryMaterialNavigationPurity',['Sterling']),uiFact('occasion','Anniversary')];
 const brief=applyBriefOperations(state.brief,{missionId:state.missionId,expectedRevision:0,turnId:'labels',operations:facts.map(fact=>({type:'add',fact}))});
 expect(brief.facts.map(briefFactFieldLabel)).toEqual(['Material','Purity','Occasion']);expect(brief.facts).toHaveLength(3);
});

function budget(cents:number,basis:'total'|'per-item'|'unresolved',scope:{kind:'mission'|'item';key?:string}={kind:'mission'}){return {...uiFact('budget',`${cents} ${basis}`),strength:'requirement' as const,scope,value:{kind:'money' as const,cents,currency:'USD' as const,operator:'lte' as const,basis}}}
it('resolves a pending per-item budget without retaining the old bound or losing the total limit',()=>{
 const state=newShoppingState();const old=budget(10000,'per-item'),pending=budget(18000,'unresolved'),total=budget(20000,'total'),item=budget(7000,'per-item',{kind:'item',key:'necklace'});
 let brief=applyBriefOperations(state.brief,{missionId:state.missionId,expectedRevision:0,turnId:'setup',operations:[old,pending,total,item].map(fact=>({type:'add',fact}))});
 const selected=brief.facts.find(f=>f.id===pending.id)!;const next=budget(18000,'per-item');
 brief=applyBriefOperations(brief,{missionId:state.missionId,expectedRevision:1,turnId:'resolve',operations:editorOperations(brief.facts,next,selected)});
 expect(brief.facts.filter(f=>f.status==='active').map(f=>f.id)).toEqual([total.id,item.id,next.id]);expect(brief.facts.find(f=>f.id===pending.id)?.status).toBe('superseded');
});
it('adding a same-basis budget replaces that limit while an unresolved entry retains it',()=>{
 const state=newShoppingState();const old=budget(10000,'per-item'),total=budget(20000,'total');let brief=applyBriefOperations(state.brief,{missionId:state.missionId,expectedRevision:0,turnId:'setup',operations:[old,total].map(fact=>({type:'add',fact}))});
 const unresolved=budget(18000,'unresolved');brief=applyBriefOperations(brief,{missionId:state.missionId,expectedRevision:1,turnId:'pending',operations:editorOperations(brief.facts,unresolved)});expect(brief.facts.find(f=>f.id===old.id)?.status).toBe('active');
 const next=budget(15000,'per-item');brief=applyBriefOperations(brief,{missionId:state.missionId,expectedRevision:2,turnId:'add',operations:editorOperations(brief.facts,next)});
 expect(brief.facts.filter(f=>f.status==='active').map(f=>f.id)).toEqual([total.id,next.id]);expect(brief.facts.find(f=>f.id===unresolved.id)?.status).toBe('tentative');
});
