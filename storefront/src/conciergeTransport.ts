import type {BriefState} from '../shared/briefSchema';
import {beginTrace,observeTrace} from './telemetry';
type BriefAccess={enabled:boolean;getBrief:()=>BriefState|undefined;accept:(next:BriefState,base:number,mission:string)=>boolean;onBinding:(binding:{missionId:string;revision:number;turnId:string})=>void};
/** One turn uses one brief revision; UI changes while streaming cancel stale work. */
export function createConciergeTransport(access:()=>BriefAccess,fetcher:typeof fetch=fetch){
 const submitted=new Map<string,{missionId:string;revision:number}>();
 return {api:'/api/chat',fetch:async(input:RequestInfo|URL,init?:RequestInit)=>{
  const start=performance.now();const a=access();const body=typeof init?.body==='string'?JSON.parse(init.body):null;
  const turnId=body?.messages?.filter((m:{role:string})=>m.role==='user').at(-1)?.id??crypto.randomUUID();
  const initial=a.getBrief();let expectedRevision=initial?.revision;const mission=initial?.missionId;
  const prior=submitted.get(turnId);
  if(a.enabled&&initial&&prior&&!initial.processedTurns.includes(turnId)&&(prior.missionId!==initial.missionId||prior.revision!==initial.revision))throw new Error('Your preferences changed after this message was sent. Send a new message to continue with your newer brief.');
  if(initial&&!prior){submitted.set(turnId,{missionId:initial.missionId,revision:initial.revision});if(submitted.size>200)submitted.delete(submitted.keys().next().value!)}
  const trace=beginTrace(turnId,mission);
  if(a.enabled&&initial&&body)body.shoppingBrief={state:initial,turnId};
  if(initial)a.onBinding({missionId:initial.missionId,revision:initial.revision,turnId});
  const abort=new AbortController();const signal=init?.signal?AbortSignal.any([init.signal,abort.signal]):abort.signal;
  const stale=()=>{const now=access().getBrief();return !!initial&&(now?.missionId!==mission||now?.revision!==expectedRevision)};
  const timer=setInterval(()=>{if(stale())abort.abort(new Error('Your preferences changed. Please send your next message using the updated brief.'))},100);
  let response:Response;try{response=await fetcher(input,{...init,body:body?JSON.stringify(body):init?.body,headers:{...Object.fromEntries(new Headers(init?.headers)),'x-jtv-turn-id':turnId,'x-jtv-request-id':trace.requestId},signal});}catch(e){clearInterval(timer);trace.termination='failed';trace.streamCompletionMs=Math.round(performance.now()-start);throw e}
  trace.headersMs=Math.round(performance.now()-start);trace.status=response.status;
  if(!response.body||!response.ok){clearInterval(timer);if(response.status===503){let data:{code?:string}={};try{data=await response.clone().json()}catch{}if(data.code==='BRIEF_RETRY')throw new Error('Your latest preference change has not been applied. Please retry before searching.')}return response}
  const decoder=new TextDecoder();let buffer='';
  const stream=new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){
   if(stale()){abort.abort();throw new Error('Your preferences changed while this reply was being prepared. Please try again.')}
   buffer+=decoder.decode(chunk,{stream:true});if(buffer.length>2_000_000)throw new Error('Response frame exceeded the supported size.');
   let boundary:RegExpExecArray|null;
   while((boundary=/\r?\n\r?\n/.exec(buffer))){const frame=buffer.slice(0,boundary.index);buffer=buffer.slice(boundary.index+boundary[0].length);const data=frame.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');
    if(data&&data!=='[DONE]'){let event:Record<string,unknown>;try{event=JSON.parse(data)}catch{continue}
     if(event.type==='data-shopping-brief'){
      const update=event.data as {state:BriefState;baseRevision:number;missionId:string;revision:number;turnId:string};
      if(update.turnId!==turnId||update.missionId!==mission||!access().accept(update.state,update.baseRevision,update.missionId)){abort.abort();throw new Error('This reply used an older shopping brief. Please try again.')}
      expectedRevision=update.revision;a.onBinding({missionId:update.missionId,revision:update.revision,turnId});
     }
     observeTrace(trace,event,performance.now()-start);
    }
   }
   controller.enqueue(chunk);
  },flush(){clearInterval(timer);trace.streamCompletionMs=Math.round(performance.now()-start);if(trace.termination!=='failed')trace.termination='finished'}});
  // Cancel interval for SDK finish/cancellation as well as network failure.
  const source=response.body.pipeThrough(stream,{signal});const reader=source.getReader();
  const observed=new ReadableStream<Uint8Array>({async pull(controller){try{const r=await reader.read();if(r.done){clearInterval(timer);controller.close()}else controller.enqueue(r.value)}catch(e){clearInterval(timer);trace.termination='failed';controller.error(e)}},async cancel(reason){clearInterval(timer);if(!trace.termination)trace.termination='cancelled';await reader.cancel(reason)}});
  return new Response(observed,{status:response.status,statusText:response.statusText,headers:response.headers});
 }};
}
