import {expect,it} from 'vitest';
import {createBriefState,applyBriefOperations} from '../shared/briefState.js';
import {checkCombinationBudget} from '../shared/briefConstraints.js';
import type {BriefFactInput} from '../shared/briefSchema.js';
const budget:BriefFactInput={id:'limit',field:'budget',value:{kind:'money',cents:10000,currency:'USD',operator:'lt',basis:'per-item'},scope:{kind:'mission'},strength:'requirement',status:'active',origin:'ui',evidence:{messageId:'manual',quote:'Under $100 per item',explicit:true,verified:true}};
function stateWith(facts:BriefFactInput[]){const state=createBriefState('selection-boundaries');return applyBriefOperations(state,{missionId:state.missionId,expectedRevision:0,turnId:'manual',operations:facts.map(fact=>({type:'add',fact}))});}
it('rejects an exact strict per-item boundary in a selected combination',()=>{
 expect(checkCombinationBudget(stateWith([budget]),[{price:100},{price:20}]).status).toBe('conflict');
});
it('keeps an inclusive per-item boundary valid and does not confuse quantity with unit price',()=>{
 const inclusive={...budget,value:{...budget.value,operator:'lte'} as BriefFactInput['value']};
 expect(checkCombinationBudget(stateWith([inclusive]),[{price:100,quantity:2},{price:20}]).status).toBe('compliant');
});
it('reports a missing per-item price as unknown rather than compliant',()=>{
 expect(checkCombinationBudget(stateWith([budget]),[{price:null},{price:20}]).status).toBe('unknown');
 expect(checkCombinationBudget(stateWith([budget]),[]).status).toBe('unknown');
});
it('checks every current total and per-item bound together',()=>{
 const total={...budget,id:'total',value:{...budget.value,cents:20000,operator:'lte',basis:'total'} as BriefFactInput['value']};
 expect(checkCombinationBudget(stateWith([budget,total]),[{price:100},{price:20}]).status).toBe('conflict');
 expect(checkCombinationBudget(stateWith([budget,total]),[{price:80,quantity:3}]).status).toBe('conflict');
});
it('does not apply an unrelated scoped or foreign strict budget to an inclusive USD total',()=>{
 const total={...budget,id:'total',value:{...budget.value,cents:10000,operator:'lte',basis:'total'} as BriefFactInput['value']};
 for(const other of [{...budget,scope:{kind:'recipient' as const,key:'sister'}},{...budget,value:{...budget.value,currency:'GBP'} as BriefFactInput['value']}]){
  const result=checkCombinationBudget(stateWith([total,other]),[{price:50},{price:50}]);
  expect(result.status).toBe('unknown');expect(result.reasons.some(reason=>reason.startsWith('Combination conflicts'))).toBe(false);
 }
});
