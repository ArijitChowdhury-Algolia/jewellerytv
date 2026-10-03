/** Bounded metadata-only trace: never shopper text, tool payloads or private reasoning. */
export type ClientTrace={requestId:string;turnId:string;missionId?:string;startedAt:string;headersMs?:number;firstUsefulOutputMs?:number;streamCompletionMs?:number;termination?:'finished'|'cancelled'|'failed';status?:number;server?:unknown;events:{type:string;ms:number;toolCallId?:string;toolKind?:'search'|'display'|'other';revision?:number;count?:number;outcome?:'loaded'|'failed'}[]};
export const clientTraces:ClientTrace[]=[];
export function beginTrace(turnId:string,missionId?:string){const trace:ClientTrace={requestId:crypto.randomUUID(),turnId,missionId,startedAt:new Date().toISOString(),events:[]};traceStarts.set(trace,performance.now());clientTraces.push(trace);if(clientTraces.length>50)clientTraces.shift();return trace}
export function observeTrace(trace:ClientTrace,event:Record<string,unknown>,elapsed:number){
 const type=String(event.type??'');if(type.includes('reasoning'))return;
 if((type==='text-delta'||(type==='tool-input-available'&&event.toolName==='algolia_grouped_results'))&&trace.firstUsefulOutputMs===undefined)trace.firstUsefulOutputMs=Math.round(elapsed);
 if(type==='error')trace.termination='failed';
 if(type==='finish'){trace.streamCompletionMs=Math.round(elapsed);if(trace.termination!=='failed')trace.termination='finished'}
 if(['start','finish','error','tool-input-start','tool-input-available','tool-output-available','tool-output-error','data-guardrail-violation','data-shopping-brief'].includes(type)&&trace.events.length<100)trace.events.push({type,ms:Math.round(elapsed),...(typeof event.toolCallId==='string'?{toolCallId:event.toolCallId}:{}),...(typeof event.toolName==='string'?{toolKind:(event.toolName.startsWith('algolia_search_')?'search':event.toolName==='algolia_grouped_results'||event.toolName==='algolia_display_results'?'display':'other') as 'search'|'display'|'other'}:{})});
 if(type==='data-telemetry')trace.server=event.data;
}

export const responseBindings=new Map<string,{missionId:string;revision:number;turnId:string}>();

export type WorkspaceTraceBinding={requestId:string;turnId:string;missionId:string;revision:number};
const traceStarts=new WeakMap<ClientTrace,number>();
const workspaceMarks=new WeakMap<ClientTrace,Set<string>>();
const imageMarks=new WeakMap<ClientTrace,Set<string>>();
/** Match the tool's request, not just the latest request in a possibly continued turn. */
export function workspaceTraceForTool(turnId:string,toolCallId:string){return [...clientTraces].reverse().find(t=>t.turnId===turnId&&t.events.some(e=>e.toolCallId===toolCallId))}
function matchingWorkspaceTrace(binding:WorkspaceTraceBinding){return clientTraces.find(t=>t.requestId===binding.requestId&&t.turnId===binding.turnId&&t.missionId===binding.missionId)}
function recordWorkspaceEvent(binding:WorkspaceTraceBinding,type:string,metadata:{count?:number;outcome?:'loaded'|'failed'}={},now=performance.now()){
 const trace=matchingWorkspaceTrace(binding),start=trace&&traceStarts.get(trace);if(!trace||start===undefined||trace.events.length>=100)return;
 trace.events.push({type,ms:Math.max(0,Math.round(now-start)),revision:binding.revision,...metadata});
}
/** React commit and a subsequent animation frame are observations, not renderer internals. */
export function markWorkspace(binding:WorkspaceTraceBinding,phase:'commit'|'paint-observed',count:number,now=performance.now()){
 const trace=matchingWorkspaceTrace(binding);if(!trace||!Number.isSafeInteger(count)||count<1||count>100)return;
 const marks=workspaceMarks.get(trace)??new Set<string>();const key=`${binding.revision}:${phase}`;if(marks.has(key))return;marks.add(key);workspaceMarks.set(trace,marks);
 recordWorkspaceEvent(binding,`workspace_${phase}`,{count},now);
}
/** Identity is used only for per-request deduplication; image URLs never enter traces. */
export function markWorkspaceImage(binding:WorkspaceTraceBinding,identity:string,outcome:'loaded'|'failed',now=performance.now()){
 const trace=matchingWorkspaceTrace(binding);if(!trace)return;const marks=imageMarks.get(trace)??new Set<string>();if(marks.has(identity)||marks.size>=100)return;marks.add(identity);imageMarks.set(trace,marks);
 recordWorkspaceEvent(binding,'workspace_image',{outcome},now);
}

export function traceElapsed(trace:ClientTrace){const start=traceStarts.get(trace);return trace.streamCompletionMs??(start===undefined?0:Math.max(0,performance.now()-start))}
