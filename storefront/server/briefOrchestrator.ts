import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { briefStateSchema, briefOperationSchema, type BriefState } from '../shared/briefSchema.js';
import { applyBriefOperations } from '../shared/briefState.js';
import { compileBriefConstraints, CATALOGUE_FACET_VALUES } from '../shared/briefConstraints.js';
import { verifyOperations, type BriefModel } from './briefVerifier.js';
import type { RequestTelemetry } from './telemetry.js';
export const shoppingBriefSchema=z.object({state:briefStateSchema,turnId:z.string().regex(/^[A-Za-z0-9_-]{1,150}$/)}).strict();
const interpretationSchema=z.object({operations:z.array(briefOperationSchema).max(12)}).strict();
type ChatMessage={id:string;role:'user'|'assistant';parts:({type:string}&Record<string,unknown>)[]};
function messageText(message:ChatMessage){
 const texts:string[]=[];
 for(const part of message.parts){
  if(part.type==='text'&&typeof part.text==='string')texts.push(part.text);
  const tool=part.type==='dynamic-tool'?part.toolName:part.type.startsWith('tool-')?part.type.slice(5):undefined;
  if(message.role==='assistant'&&part.state==='output-available'&&(tool==='algolia_grouped_results'||tool==='algolia_display_results')&&part.input&&typeof part.input==='object'){
   const intro=(part.input as {intro?:unknown}).intro;if(typeof intro==='string')texts.push(intro);
  }
 }
 return [...new Set(texts.filter(text=>text.trim().length>0))].join('\n');
}
export function compactBriefForModel(state:BriefState){return {missionId:state.missionId,revision:state.revision,facts:state.facts.filter(f=>f.status==='active'||f.status==='tentative').map(({id,field,value,scope,strength,status,origin,evidence})=>({id,field,value,scope,strength,status,origin,evidence})),tombstones:state.tombstones.map(t=>({factId:t.factId,messageId:t.messageId,scope:state.facts.find(f=>f.id===t.factId)?.scope??{kind:'mission'}}))};}
function boundedModelInput<T>(input:T):T{if(Buffer.byteLength(JSON.stringify(input))>96_000)throw new Error('Shopping brief exceeds model input bound');return input;}
function recentDialogue(messages:ChatMessage[]){return messages.slice(-12).map(message=>{const text=messageText(message);return text.length<=2000?{id:message.id,role:message.role,text}:{id:message.id,role:message.role,omitted:true,reason:'Whole message omitted because it exceeds the context limit. Do not resolve references or infer consent from missing text.'};});}

export async function orchestrateBrief(envelope:z.infer<typeof shoppingBriefSchema>,messages:ChatMessage[],model:BriefModel,signal:AbortSignal,telemetry:RequestTelemetry){
 signal.throwIfAborted();
 const {state,turnId}=envelope;let next=state;let clarification:string|undefined;let clarificationOutcome:'generated'|'fallback'|undefined;let unresolvedReset=false;
 // Continuations reuse the updated state and turn ID; extraction must not repeat.
 if(!state.processedTurns.includes(turnId)){
 const last=messages.filter(message=>message.role==='user').at(-1);if(!last)throw new Error('Missing shopper message');
 const text=messageText(last);if(!text||text.length>8000)throw new Error('Invalid shopper message');
 const input=boundedModelInput({catalogueVocabulary:CATALOGUE_FACET_VALUES,missionId:state.missionId,revision:state.revision,currentBrief:compactBriefForModel(state),latestMessage:{id:last.id,role:'user',text},recentDialogue:recentDialogue(messages)});
 const candidate=interpretationSchema.parse(await telemetry.measure('interpret',()=>model({phase:'INTERPRET',input},signal)));
 for(const operation of candidate.operations){
 if(operation.type==='reset-brief'&&(!operation.evidence||operation.evidence.messageId!==last.id||!text.includes(operation.evidence.quote)))throw new Error('Invalid reset provenance');
 if(operation.type==='confirm')throw new Error('Spoken confirmation requires new evidence');
 if('fact' in operation){const evidence=operation.fact.evidence;if(operation.fact.origin!=='spoken'||evidence.messageId!==last.id||!evidence.quote||!text.includes(evidence.quote))throw new Error('Invalid shopper provenance');}
 }
 const operations=candidate.operations.length?await telemetry.measure('verify',()=>verifyOperations(model,input,candidate.operations,signal)):[];
 signal.throwIfAborted();
 const hasReset=operations.some(operation=>operation.type==='reset-brief');
 unresolvedReset=candidate.operations.some(operation=>operation.type==='reset-brief')&&!hasReset;
 if(unresolvedReset)for(let i=0;i<operations.length;i++){const operation=operations[i];if('fact' in operation)operations[i]={type:'add',fact:{...operation.fact,status:'tentative'}};}
 const ambiguousMutation=candidate.operations.some(candidate=>(candidate.type==='retract'||candidate.type==='mark-tentative')&&!operations.some(operation=>JSON.stringify(operation)===JSON.stringify(candidate)));
 if(unresolvedReset||ambiguousMutation)operations.push({type:'add',fact:{id:'pending-'+randomUUID(),field:'unknown',value:{kind:'text',text:'Pending clarification of this requested change. Keep earlier facts until the shopper resolves it; then explicitly retract this marker along with the verified edit.'},scope:{kind:'mission'},strength:'requirement',status:'tentative',origin:'spoken',evidence:{messageId:last.id,quote:text.slice(0,2000),explicit:false,verified:false}}});
 if(hasReset&&(operations[0]?.type!=='reset-brief'||operations.filter(op=>op.type==='reset-brief').length!==1))throw new Error('Reset must precede new mission facts');
 if(!hasReset)for(let i=0;i<operations.length;i++){const operation=operations[i];if('fact' in operation&&operation.fact.field==='recipient'&&state.facts.some(f=>f.field==='recipient'&&f.status==='active'&&JSON.stringify(f.value)!==JSON.stringify(operation.fact.value)))operations[i]={type:'add',fact:{...operation.fact,status:'tentative'}};}
 next=applyBriefOperations(state,{missionId:state.missionId,expectedRevision:state.revision,turnId,operations});
 }
 const needsClarification=unresolvedReset||next.facts.some(f=>f.status==='tentative'&&(f.field==='budget'||f.field==='recipient'||f.strength==='requirement'));
 if(needsClarification){try{const output=await telemetry.measure('clarify',()=>model(boundedModelInput({phase:'CLARIFY',currentBrief:compactBriefForModel(next),latestMessage:(()=>{const last=messages.filter(m=>m.role==='user').at(-1)!;return {id:last.id,role:last.role,text:messageText(last)};})()}),signal));clarification=z.object({question:z.string().min(1).max(800)}).strict().parse(output).question;clarificationOutcome='generated';}catch{signal.throwIfAborted();clarification='I’m not sure how this changes your earlier preferences. Could you clarify what you’d like to change?';clarificationOutcome='fallback';}}
 const compiled=await telemetry.measure('compile',async()=>compileBriefConstraints(next));
 return {state:next,compiled,clarification,clarificationOutcome,event:{state:next,missionId:next.missionId,baseRevision:state.revision,revision:next.revision,turnId,requestId:telemetry.requestId,appliedFactIds:compiled.appliedFactIds}};
}
