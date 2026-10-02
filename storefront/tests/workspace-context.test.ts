/** Scenarios: user-only provenance, complete text parts, bounded context, no silent constraint loss. */
import {describe,it,expect} from 'vitest';
import {missionMessages,mergeShoppingContext} from '../src/workspaceContext';
describe('shopping workspace transport',()=>{
 it('uses only user text, never assistant or tool claims',()=>{
  expect(missionMessages([{id:'u1',role:'user',parts:[{type:'text',text:'Silver'},{type:'text',text:'under $100'}]},{id:'a1',role:'assistant',parts:[{type:'text',text:'No plating'}]}])).toEqual([{id:'u1',text:'Silver\nunder $100'}]);
 });
 it('preserves page context and separately names shopping facts',()=>{
  expect(mergeShoppingContext({route:'/search'},{shoppingBrief:'silver',missionId:'one'})).toEqual({route:'/search',shoppingBrief:'silver',missionId:'one'});
 });
 it('rejects collisions and oversized confirmed constraints rather than dropping them',()=>{
  expect(()=>mergeShoppingContext({route:'/search'},{route:'/other'})).toThrow();
  expect(()=>mergeShoppingContext({},{shoppingBrief:'x'.repeat(1025)})).toThrow();
 });
});
import {briefEvidenceWindow,encodeShoppingContext} from '../src/workspaceContext';
it('bounds proposal evidence using whole user messages and signals omissions',()=>{
 const messages=Array.from({length:25},(_,i)=>({id:`u${i}`,text:'silver'}));
 expect(briefEvidenceWindow(messages).messages[0].id).toBe('u5');expect(briefEvidenceWindow(messages).omittedCount).toBe(5);
 expect(briefEvidenceWindow([{id:'long',text:'x'.repeat(2001)}]).messages).toEqual([]);
});
it('chunks confirmed lists without losing fields',()=>{
 const encoded=encodeShoppingContext({confirmedBrief:Array.from({length:4},()=>({value:'x'.repeat(400)}))});
 expect(Object.values(encoded).flatMap(s=>JSON.parse(s))).toHaveLength(4);
});
