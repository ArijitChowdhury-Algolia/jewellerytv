import {briefPatchSchema,briefStateSchema,type BriefState,type BriefPatch,type BriefFactInput} from './briefSchema.js';
import type {BriefFact,BriefProposal} from './shopping.js';
export function createBriefState(missionId:string):BriefState{return briefStateSchema.parse({version:2,missionId,revision:0,facts:[],processedTurns:[],tombstones:[],events:[]});}
export function applyBriefOperations(state:BriefState,input:BriefPatch,now=new Date().toISOString()):BriefState{
 const current=briefStateSchema.parse(state),patch=briefPatchSchema.parse(input);
 if(patch.missionId!==current.missionId)throw new Error('Stale brief mission');
 if(current.processedTurns.includes(patch.turnId))return current;
 if(patch.expectedRevision!==current.revision)throw new Error('Stale brief revision');
 const next=structuredClone(current),revision=current.revision+1;
 for(const op of patch.operations){
  const unresolvedMoney='fact' in op&&op.fact.value.kind==='money'&&op.fact.value.basis==='unresolved';
  if(op.type==='reset-brief'){
   if(op.evidence&&(!op.evidence.explicit||!op.evidence.verified))throw new Error('Brief reset requires verified explicit evidence');
   for(const f of next.facts.filter(f=>f.status==='active'||f.status==='tentative')){
    f.status='retracted';f.revision=revision;
    next.tombstones.push({factId:f.id,messageId:f.evidence.messageId,quote:f.evidence.quote,revision});
   }
  }
  const targets='factIds'in op?op.factIds.map(id=>{const f=next.facts.find(f=>f.id===id&&(f.status==='active'||f.status==='tentative'));if(!f)throw new Error('Missing active target fact');return f;}):[];
  if((op.type==='replace'&&!unresolvedMoney)||op.type==='retract')for(const f of targets){f.status=op.type==='replace'?'superseded':'retracted';f.revision=revision;next.tombstones.push({factId:f.id,messageId:f.evidence.messageId,quote:f.evidence.quote,revision});}
  if(op.type==='confirm'||op.type==='mark-tentative')for(const f of targets){f.status=op.type==='confirm'&&!(f.value.kind==='money'&&f.value.basis==='unresolved')?'active':'tentative';f.revision=revision;if(op.type==='confirm'){f.origin='ui';f.evidence={...f.evidence,explicit:true,verified:true};}}
  if(op.type==='add'||op.type==='replace'){
   const f=op.fact;
   if(next.facts.some(x=>x.id===f.id)||next.tombstones.some(x=>x.factId===f.id||(x.messageId===f.evidence.messageId&&x.quote===f.evidence.quote)))throw new Error('Previously recorded or removed evidence');
   const active=!unresolvedMoney&&f.status==='active'&&f.evidence.explicit&&(f.origin==='ui'||f.evidence.verified);
   if(op.type==='replace'&&!active&&!unresolvedMoney)throw new Error('Unverified replacement cannot supersede facts');
   next.facts.push({...f,status:active?'active':'tentative',revision,createdAt:now});
  }
 }
 next.revision=revision;next.processedTurns=[...next.processedTurns,patch.turnId].slice(-200);next.tombstones=next.tombstones.slice(-200);
 const resetEvidence=patch.operations.find(op=>op.type==='reset-brief')?.evidence;
 // A processed chat turn still advances revision, but only a changed brief consumes undo history.
 const changed=JSON.stringify(next.facts)!==JSON.stringify(current.facts)||JSON.stringify(next.tombstones)!==JSON.stringify(current.tombstones);
 next.events=changed?[...current.events,{...(resetEvidence?{resetEvidence}:{}),revision,turnId:patch.turnId,beforeFacts:current.facts,beforeTombstones:current.tombstones}].slice(-20):current.events;
 return briefStateSchema.parse(next);
}
export function undoBrief(state:BriefState,expectedRevision:number):BriefState{
 const s=briefStateSchema.parse(state);if(s.revision!==expectedRevision)throw new Error('Stale brief revision');const e=s.events.at(-1);if(!e)return s;
 // Undo consumes history instead of creating an undo-of-undo toggle. Revision remains monotonic.
 const undoneAdds=s.facts.filter(f=>!e.beforeFacts.some(old=>old.id===f.id)).map(f=>({factId:f.id,messageId:f.evidence.messageId,quote:f.evidence.quote,revision:s.revision+1}));
 return {...s,revision:s.revision+1,facts:structuredClone(e.beforeFacts),tombstones:[...structuredClone(e.beforeTombstones),...undoneAdds].slice(-200),events:s.events.slice(0,-1)};
}
export function migrateLegacyBrief(missionId:string,facts:readonly BriefFact[],proposals:readonly BriefProposal[]=[]):BriefState{
 const operations=[...facts,...proposals].slice(-100).map((f,index)=>({type:'add' as const,fact:{id:`legacy-${index}-${f.id}`.slice(0,300),field:f.field,value:{kind:'text' as const,text:f.value},scope:f.scope?{kind:'item' as const,key:f.scope}:{kind:'mission' as const},strength:'preference' as const,status:f.status==='confirmed'?'active' as const:'tentative' as const,origin:'ui' as const,evidence:{messageId:f.messageId,quote:f.quote||f.value,explicit:f.status==='confirmed',verified:f.status==='confirmed'}} satisfies BriefFactInput}));
 let s=createBriefState(missionId);for(let i=0;i<operations.length;i+=40)s=applyBriefOperations(s,{missionId,expectedRevision:s.revision,turnId:`migration-${i}`,operations:operations.slice(i,i+40)});return s;
}
