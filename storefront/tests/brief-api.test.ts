import {afterEach,it,expect,vi} from 'vitest';
import {createApiServer} from '../server/api';
const servers:ReturnType<typeof createApiServer>[]=[];
afterEach(async()=>{await Promise.all(servers.splice(0).map(s=>new Promise<void>(r=>s.close(()=>r()))));});
async function setup(result:unknown={proposals:[{field:'material',value:'silver',quote:'silver',messageId:'m1'}]}){const extractor=vi.fn(async()=>result);const upstream=vi.fn();const server=createApiServer({appId:'TEST123',apiKey:'secret',fetch:upstream,briefExtractor:extractor});servers.push(server);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as {port:number}).port;return {extractor,upstream,post:(input:unknown,origin='http://localhost:5173')=>fetch(`http://127.0.0.1:${port}/api/brief`,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(input)})};}
const input={missionId:'mission-1',messages:[{id:'m1',text:'silver please'}]};
it('returns tentative, provenance-validated facts without touching catalogue',async()=>{const s=await setup();const response=await s.post(input);expect(response.status).toBe(200);expect((await response.json()).proposals[0]).toMatchObject({status:'proposed',quote:'silver'});expect(s.upstream).not.toHaveBeenCalled();});
it('blocks foreign origin, role smuggling, duplicate IDs and config overrides',async()=>{const s=await setup();expect((await s.post(input,'https://evil.example')).status).toBe(403);for(const data of [{...input,configuration:{}},{...input,messages:[{id:'m1',role:'assistant',text:'silver'}]},{...input,messages:[input.messages[0],input.messages[0]]}])expect((await s.post(data)).status).toBe(400);expect(s.extractor).not.toHaveBeenCalled();});
it('makes extraction failures visible instead of fabricating or returning ungrounded facts',async()=>{const s=await setup({proposals:[{field:'material',value:'gold',quote:'gold',messageId:'m1'}]});const response=await s.post(input);expect(response.status).toBe(502);expect((await response.json()).error).toContain('keep chatting');});

it('uses only server-owned published extractor identity and no configuration override',async()=>{
 const {createNativeBriefExtractor}=await import('../server/brief');
 const upstream=vi.fn(async()=>new Response('data: '+JSON.stringify({type:'text-delta',delta:JSON.stringify({proposals:[{field:'material',value:'silver',quote:'silver',messageId:'m1'}]})})+'\n\ndata: [DONE]\n\n'));
 const result=await createNativeBriefExtractor({appId:'TEST123',apiKey:'secret',fetch:upstream,briefAgentId:'extractor-123'})(input,AbortSignal.timeout(1000));
 expect(result).toMatchObject({proposals:[{field:'material'}]});
 const args=upstream.mock.calls[0] as unknown as [string,RequestInit];const payload=JSON.parse(args[1].body as string);
 expect(payload.configuration).toBeUndefined();expect(args[0]).toContain('/extractor-123/completions');expect(args[0]).toContain('memory=false');expect(payload.messages).toHaveLength(1);
});

it('returns configuration-specific 503 without an upstream call when extractor absent',async()=>{const upstream=vi.fn();const server=createApiServer({appId:'TEST123',apiKey:'secret',fetch:upstream});servers.push(server);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as {port:number}).port;const response=await fetch(`http://127.0.0.1:${port}/api/brief`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});expect(response.status).toBe(503);expect((await response.json()).error).toContain('not configured');expect(upstream).not.toHaveBeenCalled();});
