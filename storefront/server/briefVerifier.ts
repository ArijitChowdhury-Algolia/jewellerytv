import { z } from 'zod';
import { briefFactInputSchema, type BriefFactInput, type BriefOperation } from '../shared/briefSchema.js';
export type BriefModel=(input:unknown,signal:AbortSignal)=>Promise<unknown>;
export const verificationSchema=z.object({verdicts:z.array(z.object({operationIndex:z.number().int().min(0),entailed:z.boolean(),unambiguous:z.boolean(),factEntailed:z.boolean().optional(),factUnambiguous:z.boolean().optional()}).strict()).max(12)}).strict();
function sameScope(a:BriefFactInput,b:BriefFactInput){return a.scope.kind===b.scope.kind&&(a.scope.kind==='mission'||a.scope.key===b.scope.key);}
function blocksAddition(fact:BriefFactInput,current:BriefFactInput[],unauthorizedReplacement:boolean){
 return current.some(old=>{
  if(old.status!=='active'||!sameScope(old,fact))return false;
  const a=old.value,b=fact.value;
  if(unauthorizedReplacement&&a.kind==='money'&&b.kind==='money'&&a.basis===b.basis&&(a.cents!==b.cents||a.operator!==b.operator))return true;
  if(old.strength!=='requirement'||fact.strength!=='requirement'||a.kind!=='facet'||b.kind!=='facet'||a.attribute!==b.attribute)return false;
  // Positive ProductType alternatives union; multi-valued positive attributes may coexist.
  // Only an explicit any/none contradiction is deterministic across all facet types.
  if(a.operator==='none'&&b.operator==='any')return b.values.every(value=>a.values.includes(value));
  if(a.operator==='any'&&b.operator==='none')return a.values.every(value=>b.values.includes(value));
  return false;
 });
}
/** Independent semantic pass: matching a quote is only a provenance check. */
export async function verifyOperations(model:BriefModel,input:unknown,operations:BriefOperation[],signal:AbortSignal){
 const parsedFacts=briefFactInputSchema.array().safeParse((input as {currentBrief?:{facts?:unknown}}|null)?.currentBrief?.facts);const currentFacts=parsedFacts.success?parsedFacts.data:[];
 const result=verificationSchema.parse(await model({phase:'VERIFY',input,operations},signal));
 if(new Set(result.verdicts.map(v=>v.operationIndex)).size!==result.verdicts.length||result.verdicts.some(v=>v.operationIndex>=operations.length))throw new Error('Invalid verification coverage');
 return operations.map((operation,index):BriefOperation|null=>{const verdict=result.verdicts.find(v=>v.operationIndex===index);const verified=verdict?.entailed===true&&verdict.unambiguous===true;
 if(operation.type==='reset-brief')return verified&&operation.evidence?.explicit?{...operation,evidence:{...operation.evidence,verified:true}}:null;
 if('fact' in operation){const separate=verdict?.factEntailed!==undefined||verdict?.factUnambiguous!==undefined;const factVerified=separate?verdict?.factEntailed===true&&verdict.factUnambiguous===true:verified;const remaining=operation.type==='replace'&&verified?currentFacts.filter(f=>!operation.factIds.includes(f.id)):currentFacts;const blocked=operation.type==='replace'&&!verified&&blocksAddition(operation.fact,remaining,true);const active=factVerified&&!blocked&&operation.fact.evidence.explicit&&!(operation.fact.value.kind==='money'&&operation.fact.value.basis==='unresolved');return {...(operation.type==='replace'&&(!verified||!active)?{type:'add' as const}:operation),fact:{...operation.fact,origin:'spoken' as const,status:active?'active' as const:'tentative' as const,evidence:{...operation.fact.evidence,verified:factVerified}}};}
 // Retractions/confirmations cannot be represented safely as tentative mutations.
 return verified?operation:null;
 }).filter((operation):operation is BriefOperation=>operation!==null);
}
