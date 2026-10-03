import {describe,it,expect} from 'vitest';
import {createBriefState,applyBriefOperations,undoBrief} from '../shared/briefState';
import type {BriefFactInput} from '../shared/briefSchema';
export const fact=(id:string):BriefFactInput=>({id,field:'exclusion',value:{kind:'text',text:id},scope:{kind:'mission'},strength:'requirement',status:'active',origin:'ui',evidence:{messageId:'ui',quote:id,explicit:true,verified:true}});
describe('brief v2 transactions',()=>{
 it('replaces exact IDs and preserves independent exclusions',()=>{let s=createBriefState('m');s=applyBriefOperations(s,{missionId:'m',expectedRevision:0,turnId:'1',operations:[{type:'add',fact:fact('hearts')},{type:'add',fact:fact('gold')}]});s=applyBriefOperations(s,{missionId:'m',expectedRevision:1,turnId:'2',operations:[{type:'replace',factIds:['gold'],fact:fact('yellow')}]});expect(s.facts.filter(f=>f.status==='active').map(f=>f.id)).toEqual(['hearts','yellow']);});
 it('is atomic, revision guarded and idempotent',()=>{const s=createBriefState('m');const p={missionId:'m',expectedRevision:0,turnId:'1',operations:[{type:'add' as const,fact:fact('a')}]};const n=applyBriefOperations(s,p);expect(applyBriefOperations(n,p)).toEqual(n);expect(()=>applyBriefOperations(n,{...p,turnId:'2'})).toThrow();expect(()=>applyBriefOperations(s,{...p,operations:[...p.operations,{type:'retract',factIds:['absent']}]})).toThrow();expect(s.facts).toEqual([]);});
 it('does not activate inference; removal and undo use new revisions',()=>{let s=applyBriefOperations(createBriefState('m'),{missionId:'m',expectedRevision:0,turnId:'1',operations:[{type:'add',fact:{...fact('a'),origin:'spoken',evidence:{messageId:'1',quote:'a',explicit:false,verified:false}}}]});expect(s.facts[0].status).toBe('tentative');s=applyBriefOperations(s,{missionId:'m',expectedRevision:1,turnId:'2',operations:[{type:'retract',factIds:['a']}]});expect(s.tombstones).toHaveLength(1);s=undoBrief(s,2);expect(s.revision).toBe(3);expect(s.facts[0].status).toBe('tentative');});
});
it('retains material and per-item styles when lowering a total budget',()=>{
 const original={...fact('budget'),field:'budget' as const,value:{kind:'money' as const,cents:30000,currency:'USD' as const,operator:'lte' as const,basis:'total' as const}};
 let s=applyBriefOperations(createBriefState('m'),{missionId:'m',expectedRevision:0,turnId:'1',operations:[original,{...fact('silver'),field:'material' as const},{...fact('bold'),field:'style' as const,scope:{kind:'item' as const,key:'Necklace'}},{...fact('small'),field:'style' as const,scope:{kind:'item' as const,key:'Earrings'}}].map(fact=>({type:'add' as const,fact}))});
 s=applyBriefOperations(s,{missionId:'m',expectedRevision:1,turnId:'2',operations:[{type:'replace',factIds:['budget'],fact:{...original,id:'budget2',value:{...original.value,cents:20000,operator:'lt'},evidence:{...original.evidence,quote:'under 200'}}}]});
 expect(s.facts.filter(f=>f.status==='active').map(f=>f.id)).toEqual(['silver','bold','small','budget2']);
});
it('rejects cross-mission and replayed removed evidence without changing state',()=>{
 let s=applyBriefOperations(createBriefState('m'),{missionId:'m',expectedRevision:0,turnId:'1',operations:[{type:'add',fact:fact('a')}]});
 s=applyBriefOperations(s,{missionId:'m',expectedRevision:1,turnId:'2',operations:[{type:'retract',factIds:['a']}]});
 expect(()=>applyBriefOperations(s,{missionId:'m',expectedRevision:2,turnId:'3',operations:[{type:'add',fact:{...fact('a'),id:'new-id'}}]})).toThrow(/removed/);
 expect(()=>applyBriefOperations(s,{missionId:'old',expectedRevision:2,turnId:'4',operations:[]})).toThrow(/mission/);
});
it('cannot supersede explicit UI choices with tentative inference',()=>{
 const s=applyBriefOperations(createBriefState('m'),{missionId:'m',expectedRevision:0,turnId:'1',operations:[{type:'add',fact:fact('a')}]});
 expect(()=>applyBriefOperations(s,{missionId:'m',expectedRevision:1,turnId:'2',operations:[{type:'replace',factIds:['a'],fact:{...fact('b'),origin:'spoken',evidence:{messageId:'2',quote:'perhaps',explicit:false,verified:false}}}]})).toThrow(/Unverified/);
 expect(s.facts[0].status).toBe('active');
});
it('bounds undo history and advances revisions on undo',()=>{
 let s=createBriefState('m');for(let i=0;i<25;i++)s=applyBriefOperations(s,{missionId:'m',expectedRevision:s.revision,turnId:String(i),operations:[{type:'add',fact:fact(`fact-${i}`)}]});expect(s.events).toHaveLength(20);const next=undoBrief(s,25);expect(next.revision).toBe(26);expect(next.processedTurns).toContain('24');expect(()=>undoBrief(next,25)).toThrow(/revision/);
});
it('undoing an addition prevents extraction resurrecting its older source',()=>{
 let s=applyBriefOperations(createBriefState('m'),{missionId:'m',expectedRevision:0,turnId:'1',operations:[{type:'add',fact:fact('a')}]});s=undoBrief(s,1);expect(s.facts).toEqual([]);expect(()=>applyBriefOperations(s,{missionId:'m',expectedRevision:2,turnId:'2',operations:[{type:'add',fact:{...fact('a'),id:'different'}}]})).toThrow(/removed/);
});
it('resets old constraints atomically before adding a new recipient and explicit carryover',()=>{
 const oldBudget={...fact('budget'),field:'budget' as const,value:{kind:'money' as const,cents:20000,currency:'USD' as const,operator:'lt' as const,basis:'total' as const}};
 const before=applyBriefOperations(createBriefState('m'),{missionId:'m',expectedRevision:0,turnId:'1',operations:[oldBudget,fact('no-hearts'),{...fact('old-recipient'),field:'recipient' as const},{...fact('maybe'),status:'tentative' as const}].map(fact=>({type:'add' as const,fact}))});
 const patch={missionId:'m',expectedRevision:1,turnId:'2',operations:[{type:'reset-brief' as const},{type:'add' as const,fact:{...fact('new-recipient'),field:'recipient' as const}},{type:'add' as const,fact:{...fact('carryover'),field:'material' as const,evidence:{messageId:'2',quote:'keep silver for her too',explicit:true,verified:true}}}]};
 const next=applyBriefOperations(before,patch);
 expect(next.missionId).toBe('m');expect(next.revision).toBe(2);expect(next.facts.filter(f=>f.status==='active').map(f=>f.id)).toEqual(['new-recipient','carryover']);expect(next.facts.filter(f=>f.status==='retracted')).toHaveLength(4);expect(next.tombstones).toHaveLength(4);expect(next.processedTurns).toEqual(['1','2']);expect(applyBriefOperations(next,patch)).toEqual(next);
 const restored=undoBrief(next,2);expect(restored.revision).toBe(3);expect(restored.facts).toEqual(before.facts);expect(restored.tombstones.map(t=>t.factId)).toEqual(['new-recipient','carryover']);
});
it('rolls back an entire reset if a later addition is invalid',()=>{
 const before=applyBriefOperations(createBriefState('m'),{missionId:'m',expectedRevision:0,turnId:'1',operations:[{type:'add',fact:fact('a')}]});
 expect(()=>applyBriefOperations(before,{missionId:'m',expectedRevision:1,turnId:'2',operations:[{type:'reset-brief'},{type:'add',fact:fact('a')}]})).toThrow();expect(before.facts[0].status).toBe('active');expect(before.tombstones).toEqual([]);
});
it('requires explicit verified spoken reset evidence and retains provenance in history',()=>{
 const s=applyBriefOperations(createBriefState('m'),{missionId:'m',expectedRevision:0,turnId:'1',operations:[{type:'add',fact:fact('a')}]});
 const evidence={messageId:'message-2',quote:'Now a separate gift for my mother',explicit:true,verified:false};
 expect(()=>applyBriefOperations(s,{missionId:'m',expectedRevision:1,turnId:'2',operations:[{type:'reset-brief',evidence}]})).toThrow(/verified explicit/);
 const next=applyBriefOperations(s,{missionId:'m',expectedRevision:1,turnId:'2',operations:[{type:'reset-brief',evidence:{...evidence,verified:true}}]});expect(next.events.at(-1)?.resetEvidence).toEqual({...evidence,verified:true});expect(next.facts[0].status).toBe('retracted');
});
it('keeps conversational no-ops out of undo history while recording processed turns',()=>{
 let s=applyBriefOperations(createBriefState('m'),{missionId:'m',expectedRevision:0,turnId:'edit',operations:[{type:'add',fact:fact('silver')}]});
 for(let i=0;i<25;i++)s=applyBriefOperations(s,{missionId:'m',expectedRevision:s.revision,turnId:`chat-${i}`,operations:[]});
 expect(s.revision).toBe(26);expect(s.processedTurns).toContain('chat-24');expect(s.events).toHaveLength(1);
 const undone=undoBrief(s,26);expect(undone.revision).toBe(27);expect(undone.facts).toEqual([]);expect(undone.events).toEqual([]);
 expect(applyBriefOperations(s,{missionId:'m',expectedRevision:25,turnId:'chat-24',operations:[]})).toEqual(s);
});
it.each(['ui','spoken'] as const)('keeps unresolved money tentative even when %s evidence is explicit and verified',origin=>{
 const unresolved={...fact('budget'),field:'budget' as const,origin,value:{kind:'money' as const,cents:20000,currency:'USD' as const,operator:'lt' as const,basis:'unresolved' as const}};
 let s=applyBriefOperations(createBriefState('m'),{missionId:'m',expectedRevision:0,turnId:'1',operations:[{type:'add',fact:unresolved}]});expect(s.facts[0].status).toBe('tentative');
 s=applyBriefOperations(s,{missionId:'m',expectedRevision:1,turnId:'2',operations:[{type:'confirm',factIds:['budget']}]});expect(s.facts[0].status).toBe('tentative');
});
it('preserves a previous resolved budget while a replacement scope remains unresolved',()=>{
 const resolved={...fact('old-budget'),field:'budget' as const,value:{kind:'money' as const,cents:10000,currency:'USD' as const,operator:'lt' as const,basis:'total' as const}};
 const s=applyBriefOperations(createBriefState('m'),{missionId:'m',expectedRevision:0,turnId:'1',operations:[{type:'add',fact:resolved}]});
 const next=applyBriefOperations(s,{missionId:'m',expectedRevision:1,turnId:'2',operations:[{type:'replace',factIds:['old-budget'],fact:{...resolved,id:'unclear-budget',value:{...resolved.value,cents:20000,basis:'unresolved'},evidence:{...resolved.evidence,quote:'200'}}}]});
 expect(next.facts.map(f=>f.status)).toEqual(['active','tentative']);expect(next.tombstones).toEqual([]);
});
it('normalizes previously persisted active unresolved budgets before processed-turn reuse',()=>{
 const s=createBriefState('m');const raw={...s,processedTurns:['old-turn'],facts:[{...fact('budget'),field:'budget',value:{kind:'money',cents:20000,currency:'USD',operator:'lt',basis:'unresolved'},revision:0,createdAt:'2026-10-02'}]};
 const next=applyBriefOperations(raw as typeof s,{missionId:'m',expectedRevision:0,turnId:'old-turn',operations:[]});expect(next.facts[0].status).toBe('tentative');
});
