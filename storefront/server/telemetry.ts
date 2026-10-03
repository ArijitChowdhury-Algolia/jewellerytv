import { randomUUID } from 'node:crypto';
import { z } from 'zod';
/** Metadata only. Never accept shopper text, provider payloads or reasoning. */
export class RequestTelemetry {
 readonly requestId:string;
 constructor(requestId?:unknown){this.requestId=typeof requestId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)?requestId:randomUUID();}
 private readonly start=performance.now();
 briefFailure:{category:string;issues?:Array<{code:string;path:string}>}|null=null;
 recordBriefFailure(error:unknown){
  if(error instanceof z.ZodError){const keys=new Set(['operations','fact','factIds','type','id','field','value','kind','text','cents','currency','operator','basis','attribute','values','scope','key','strength','status','origin','evidence','messageId','quote','explicit','verified','verdicts','operationIndex','entailed','unambiguous','question']);this.briefFailure={category:'schema_validation',issues:error.issues.slice(0,10).map(issue=>({code:issue.code,path:issue.path.map(part=>typeof part==='number'?String(part):keys.has(String(part))?String(part):'[key]').join('.')}))};}
  else if(error instanceof SyntaxError)this.briefFailure={category:'json_syntax'};
  else if(error instanceof Error&&['AbortError','TimeoutError'].includes(error.name))this.briefFailure={category:'cancelled_or_timeout'};
  else if(error instanceof Error&&['Invalid shopper provenance','Invalid reset provenance','Spoken confirmation requires new evidence'].includes(error.message))this.briefFailure={category:'provenance_validation'};
  else this.briefFailure={category:'brief_processing'};
 }
 readonly phases:Record<string,number>={};
 readonly counts={events:0,toolStarts:0,toolEnds:0,guardEvents:0};
 readonly formatRetries:Array<{phase:string;durationMs:number;success:boolean;firstFailure:'json_syntax'}>=[];
 readonly tools:Array<{toolCallId:string;startedMs:number;endedMs?:number}>=[];
 firstUsefulOutputMs:number|null=null;
 async measure<T>(phase:string,work:()=>Promise<T>):Promise<T>{const start=performance.now();try{return await work();}finally{this.phases[phase]=Math.round(performance.now()-start);}}
 timing(){return Object.entries(this.phases).map(([name,duration])=>`${name};dur=${duration}`).join(', ');}
 snapshot(turnId?:string,snapshotAt:'finish_event'|'done_event'|'stream_end'|'request_end'|'incomplete'='request_end'){const elapsedMs=Math.round(performance.now()-this.start);return {snapshotAt,elapsedMs,briefFailure:this.briefFailure,requestId:this.requestId,turnId,phases:{...this.phases},counts:{...this.counts},formatRetryCount:this.formatRetries.length,formatRetries:this.formatRetries.map(retry=>({...retry})),tools:this.tools.map(tool=>({...tool})),firstUsefulOutputMs:this.firstUsefulOutputMs,streamCompletionMs:snapshotAt==='stream_end'||snapshotAt==='request_end'?elapsedMs:null,providerExecution:'not_exposed',providerUsage:'not_exposed',toolTiming:'stream_observed_only'};}
 observe(event:Record<string,unknown>){this.counts.events++;const type=String(event.type??'');if((type==='text-delta'||type==='tool-output-available')&&this.firstUsefulOutputMs===null)this.firstUsefulOutputMs=Math.round(performance.now()-this.start);if(type==='tool-input-start'){this.counts.toolStarts++;if(typeof event.toolCallId==='string'&&this.tools.length<100)this.tools.push({toolCallId:event.toolCallId.slice(0,150),startedMs:Math.round(performance.now()-this.start)});}if(type==='tool-output-available'||type==='tool-output-error'){this.counts.toolEnds++;const tool=this.tools.find(tool=>tool.toolCallId===event.toolCallId);if(tool)tool.endedMs=Math.round(performance.now()-this.start);}if(type.includes('guard'))this.counts.guardEvents++;}
}
const encoder=new TextEncoder();
export function sseData(type:string,data:unknown){return encoder.encode(`data: ${JSON.stringify({type,data,transient:true})}\n\n`);}
/** SDK consumers may stop on finish, so metadata must precede that event. */
export async function* instrumentStream(body:ReadableStream<Uint8Array>,telemetry:RequestTelemetry,briefEvent?:unknown,turnId?:string){
 const reader=body.getReader();const decoder=new TextDecoder();let buffer='';let sentTelemetry=false;
 function* frames(frame:string){
  const data=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n');
  let event:Record<string,unknown>|undefined;
  if(data&&data!=='[DONE]'){try{event=JSON.parse(data);if(event)telemetry.observe(event);}catch{/* Forward non-JSON upstream frames unchanged. */}}
  if(!sentTelemetry&&(data==='[DONE]'||event?.type==='finish')){yield sseData('data-telemetry',telemetry.snapshot(turnId,event?.type==='finish'?'finish_event':'done_event'));sentTelemetry=true;}
  yield encoder.encode(frame+'\n\n');
 }
 if(briefEvent)yield sseData('data-shopping-brief',briefEvent);
 try{
  while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});if(buffer.length>2_000_000)throw new Error('Stream frame too large');let match:RegExpExecArray|null;while((match=/\r?\n\r?\n/.exec(buffer))){const frame=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);yield* frames(frame);}}
  buffer+=decoder.decode();if(buffer.trim())yield* frames(buffer);if(!sentTelemetry)yield sseData('data-telemetry',telemetry.snapshot(turnId,'stream_end'));
 }finally{await reader.cancel().catch(()=>{});}
}

export type RequestLog=ReturnType<RequestTelemetry['snapshot']>&{event:'jtv_request';statusCode:number;aborted:boolean;completed:boolean};
export type TelemetryLogger=(entry:RequestLog)=>void;
export const productionTelemetryLogger:TelemetryLogger=entry=>console.info(JSON.stringify(entry));
