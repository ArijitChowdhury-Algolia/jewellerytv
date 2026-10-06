import {resetShoppingMission,newShoppingState} from '../src/ShoppingProvider';
import {describe,it,expect} from 'vitest';
import {validateProposals,confirmProposal,pairTotal} from '../shared/shopping';
const messages=[{id:'m1',text:'For my wife. $200 total, silver please.'}];
const proposal={field:'budget',value:'$200',quote:'$200 total',messageId:'m1',scope:'whole pairing'};
describe('current-mission brief',()=>{
 it('keeps verified quotes tentative until the shopper confirms',()=>{const [p]=validateProposals([proposal],messages);expect(p.status).toBe('proposed');expect(confirmProposal(p)).toMatchObject({status:'confirmed',source:'user-confirmed',quote:'$200 total'});expect(confirmProposal(p,'$150 total').source).toBe('user-edited');});
 it('rejects unavailable message identity, paraphrased provenance and unknown fields',()=>{for(const invalid of [{...proposal,messageId:'old-mission'},{...proposal,quote:'200 dollar limit'},{...proposal,field:'productId'}])expect(()=>validateProposals([invalid],messages)).toThrow();});
 it('rejects duplicate and oversized proposals',()=>{expect(()=>validateProposals([proposal,proposal],messages)).toThrow();expect(()=>validateProposals([{...proposal,value:'x'.repeat(301)}],messages)).toThrow();});
 it('keeps identity stable across model ordering but distinct for changed scope',()=>{const other={field:'material',value:'silver',quote:'silver',messageId:'m1'};const a=validateProposals([proposal,other],messages);const b=validateProposals([other,proposal],messages);expect(a[0].id).toBe(b[1].id);expect(validateProposals([{...proposal,scope:'per item'}],messages)[0].id).not.toBe(a[0].id);});
 it('calculates cents without binary decimal drift and refuses unknown affordability',()=>{expect(pairTotal([{price:90.24},{price:57.99}]).totalCents).toBe(14823);expect(pairTotal([{price:0.1},{price:0.2}]).totalCents).toBe(30);expect(pairTotal([{price:5,quantity:2},{price:null}])).toEqual({totalCents:null,knownSubtotalCents:1000,unknownCount:1});expect(()=>pairTotal([{price:5,quantity:-1}])).toThrow();});
});

import {briefEvidenceWindow} from '../shared/shopping';
describe('bounded extraction evidence',()=>{
 it('keeps latest 20 complete turns without changing quotes and reports omissions',()=>{const messages=Array.from({length:25},(_,i)=>({id:`m${i}`,text:`Preference ${i}`}));const w=briefEvidenceWindow(messages);expect(w.omittedCount).toBe(5);expect(w.messages).toEqual(messages.slice(5));});
 it('never truncates an oversized correction into a different meaning or retries old facts',()=>{const w=briefEvidenceWindow([{id:'old',text:'$200 total'},{id:'correction',text:'x'.repeat(2001)}]);expect(w.messages).toEqual([]);expect(w.error).toContain('too long');});
 it('bounds Unicode evidence in bytes and never stitches across omitted messages',()=>{const messages=Array.from({length:20},(_,i)=>({id:`m${i}`,text:'💎'.repeat(900)}));const w=briefEvidenceWindow(messages);expect(new TextEncoder().encode(JSON.stringify(w.messages)).length).toBeLessThanOrEqual(14000);expect(w.messages.at(-1)?.id).toBe('m19');expect(w.omittedCount).toBeGreaterThan(0);});
});

it('new conversation retains saved pieces but clears the previous mission and working selections',()=>{
 const state=newShoppingState();
 const previous={...state,products:[{product:{id:'kept'} as any,quantity:1,observedAt:'today'}],compareIds:['kept'],combinationIds:['kept'],combinationQuantities:{kept:2},activeView:'saved' as const,selectionRecords:[{id:'kept'} as any],budgetCents:20000};
 const reset=resetShoppingMission(previous);
 expect(reset.products).toEqual(previous.products);expect(reset.missionId).not.toBe(previous.missionId);
 expect(reset.compareIds).toEqual([]);expect(reset.combinationIds).toEqual([]);expect(reset.combinationQuantities).toEqual({});expect(reset.selectionRecords).toEqual([]);
 expect(reset.brief.facts).toEqual([]);expect(reset.budgetCents).toBeNull();expect(reset.activeView).toBe('discover');
 expect(previous.compareIds).toEqual(['kept']);
});
