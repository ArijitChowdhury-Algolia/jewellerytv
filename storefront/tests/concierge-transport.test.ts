// Protocol tests: same-turn state adoption, duplicate continuation identity, stale edits, privacy metadata.
import {it,expect,vi} from 'vitest';
import {createConciergeTransport} from '../src/conciergeTransport';
import {createBriefState} from '../shared/briefState';
import {clientTraces} from '../src/telemetry';
const enc=new TextEncoder();
const request=(state:unknown)=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'chat',messages:[{id:'turn-1',role:'user',parts:[{type:'text',text:'Private shopping words'}]}]})});
it('attaches a revisioned brief and adopts the server state before consuming text',async()=>{
 let state=createBriefState('mission');const next={...state,revision:1,processedTurns:['turn-1']};let sent:any;const binding=vi.fn();
 const fetcher=vi.fn(async(_url,init)=>{sent=JSON.parse(init!.body as string);return new Response(`data: ${JSON.stringify({type:'data-shopping-brief',data:{state:next,missionId:'mission',baseRevision:0,revision:1,turnId:'turn-1'}})}\n\ndata: {"type":"text-delta","delta":"Reply"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n`)});
 const transport=createConciergeTransport(()=>({enabled:true,getBrief:()=>state,accept:(n)=>{state=n;return true},onBinding:binding}),fetcher as typeof fetch);
 const response=await transport.fetch('/api/chat',request(state));await response.text();
 expect(sent.shoppingBrief.state.revision).toBe(0);expect(sent.shoppingBrief.turnId).toBe('turn-1');expect(state.revision).toBe(1);expect(binding).toHaveBeenLastCalledWith({missionId:'mission',revision:1,turnId:'turn-1'});
 expect(JSON.stringify(clientTraces.at(-1))).not.toContain('Private shopping words');expect(clientTraces.at(-1)?.termination).toBe('finished');
});
it('refuses stale stream content after a manual revision change',async()=>{
 let state=createBriefState('mission');let controller:ReadableStreamDefaultController<Uint8Array>;
 const fetcher=vi.fn(async()=>new Response(new ReadableStream({start(c){controller=c}})));
 const transport=createConciergeTransport(()=>({enabled:true,getBrief:()=>state,accept:()=>false,onBinding:()=>{}}),fetcher as typeof fetch);
 const response=await transport.fetch('/api/chat',request(state));state={...state,revision:1};controller!.enqueue(enc.encode('data: {"type":"text-delta","delta":"stale"}\n\n'));controller!.close();
 await expect(response.text()).rejects.toThrow(/preferences changed/);
});

it('does not replay older spoken preferences over a manual edit when retrying an unprocessed turn',async()=>{
 let state=createBriefState('mission');const fetcher=vi.fn(async()=>new Response(JSON.stringify({code:'BRIEF_RETRY'}),{status:503}));
 const transport=createConciergeTransport(()=>({enabled:true,getBrief:()=>state,accept:()=>false,onBinding:()=>{}}),fetcher as typeof fetch);
 await expect(transport.fetch('/api/chat',request(state))).rejects.toThrow(/not been applied/);
 state={...state,revision:1};
 await expect(transport.fetch('/api/chat',request(state))).rejects.toThrow(/Send a new message/);
 expect(fetcher).toHaveBeenCalledTimes(1);
});
