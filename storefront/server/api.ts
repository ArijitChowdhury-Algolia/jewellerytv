import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { BriefUnavailableError, briefRequestSchema, createNativeBriefExtractor, extractBrief, type BriefExtractor, createNativeBriefModel } from './brief.js';

import { orchestrateBrief, shoppingBriefSchema } from './briefOrchestrator.js';
import { RequestTelemetry, instrumentStream, productionTelemetryLogger, type TelemetryLogger } from './telemetry.js';
import type { BriefModel } from './briefVerifier.js';

export const AGENT_ID = 'ba2bb723-0459-4df6-ba8b-812088f39f0f';
export const INDICES = ['prod_catalog','prod_catalog_featured','prod_catalog_newest','prod_catalog_top_rated','prod_catalog_price_asc','prod_catalog_price_desc'] as const;
export const SEARCHABLE_FACETS = ['Catalog_Brand','Catalog_ConsumerProductCategories','Catalog_ConsumerProductCategoryDisplayNames','Catalog_ConsumerProductCategoryHierarchyDisplayNames','Catalog_PrimaryGemstoneAndPearlColorGroups','Catalog_ProductType','hierarchialCategories.lvl0','hierarchialCategories.lvl1'] as const;
const short=z.string().max(4096);
const strings=z.array(short).max(150);
const filterList=z.array(z.union([short,strings])).max(100);
const paramsSchema=z.object({query:short.optional(),page:z.number().int().min(0).max(999).optional(),hitsPerPage:z.number().int().min(0).max(100).optional(),facets:z.union([short,strings]).optional(),filters:short.optional(),facetFilters:filterList.optional(),numericFilters:filterList.optional(),tagFilters:z.union([short,filterList]).optional(),maxValuesPerFacet:z.number().int().min(1).max(100).optional(),attributesToRetrieve:strings.optional(),attributesToHighlight:strings.optional(),attributesToSnippet:strings.optional(),highlightPreTag:z.string().max(100).optional(),highlightPostTag:z.string().max(100).optional(),distinct:z.union([z.boolean(),z.number().int().min(0).max(4)]).optional(),facetingAfterDistinct:z.boolean().optional(),analytics:z.boolean().optional(),clickAnalytics:z.boolean().optional(),enableABTest:z.boolean().optional(),getRankingInfo:z.boolean().optional(),responseFields:strings.optional(),ruleContexts:strings.optional(),optionalFilters:filterList.optional(),sumOrFiltersScores:z.boolean().optional()}).strict();
const indexSchema=z.enum(INDICES);
const searchSchema=z.object({requests:z.array(z.object({indexName:indexSchema,params:paramsSchema.default({})}).strict()).min(1).max(30)}).strict();
const facetSchema=z.object({indexName:indexSchema,facetName:z.enum(SEARCHABLE_FACETS),facetQuery:z.string().max(256),params:paramsSchema.default({})}).strict();
const contextSchema=z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),z.string().refine(value=>value.trim().length>0)).superRefine((value,ctx)=>{const entries=Object.entries(value);if(entries.length>32 || entries.some(([,v])=>Buffer.byteLength(v)>1024) || Buffer.byteLength(JSON.stringify(value))>4096)ctx.addIssue({code:'custom',message:'Context exceeds platform limits'});});
const partSchema=z.object({type:z.string().min(1).max(150)}).passthrough();
const messageSchema=z.object({id:z.string().min(1).max(150),role:z.enum(['user','assistant']),parts:z.array(partSchema).max(250),metadata:z.object({turnContext:contextSchema.optional()}).passthrough().optional()}).strict();
const chatSchema=z.object({id:z.string().min(1).max(150),messages:z.array(messageSchema).min(1).max(200),messageId:z.string().max(150).optional(),trigger:z.enum(['submit-message','regenerate-message']).optional(),shoppingBrief:shoppingBriefSchema.optional()}).strict();
export type ApiOptions={appId:string;apiKey:string;fetch?:typeof fetch;briefExtractor?:BriefExtractor;allowedHosts?:string[];briefAgentId?:string;briefV2Enabled?:boolean;conciergeAgentId?:string;briefModel?:BriefModel;telemetryLogger?:TelemetryLogger};
const allowedOrigins=new Set(['http://localhost:5173','http://127.0.0.1:5173']);
function reply(res:ServerResponse,status:number,data:unknown){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));}
async function body(req:IncomingMessage){if(!req.headers['content-type']?.startsWith('application/json'))throw new Error('MEDIA');const parsed=(req as IncomingMessage & {body?:unknown}).body;if(parsed!==undefined){const text=typeof parsed==='string'?parsed:JSON.stringify(parsed);if(Buffer.byteLength(text)>2*1024*1024)throw new Error('LARGE');return JSON.parse(text) as unknown;}let size=0;const parts:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('LARGE');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;}
function safeParams(params:z.infer<typeof paramsSchema>){return {...params,analytics:false,clickAnalytics:false,enableABTest:false};}
export function createApiHandler(options:ApiOptions){
 if(!/^[A-Za-z0-9]+$/.test(options.appId)||!options.apiKey)throw new Error('Valid server-side Algolia configuration is required');
 const upstream=options.fetch??fetch;const conciergeId=options.conciergeAgentId??AGENT_ID;if(!/^[A-Za-z0-9-]{1,100}$/.test(conciergeId))throw new Error('Invalid concierge agent ID');
 const briefExtractor=options.briefExtractor??createNativeBriefExtractor({...options,fetch:upstream});
 const cloudHosts=new Set(options.allowedHosts??[]);
 for(const host of cloudHosts)if(!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(host))throw new Error('Invalid deployment host');
 const origins=new Set([...allowedOrigins,...[...cloudHosts].map(host=>`https://${host}`)]);
 return async(req:IncomingMessage,res:ServerResponse)=>{
  const telemetry=new RequestTelemetry(req.headers['x-jtv-request-id']);const briefModel=options.briefModel??createNativeBriefModel({...options,fetch:upstream,onFormatRetry:metadata=>telemetry.formatRetries.push(metadata)});let briefEvent:unknown;let turnId:string|undefined;
  const abort=new AbortController();req.on('aborted',()=>abort.abort());res.on('close',()=>{if(!res.writableEnded)abort.abort();});
  const timeout=setTimeout(()=>abort.abort(),180_000);timeout.unref();
  try {
   const host=req.headers.host??'';if((!/^(localhost|127\.0\.0\.1):\d+$/.test(host)&&!cloudHosts.has(host))||(req.headers.origin&&!origins.has(req.headers.origin))||req.headers['sec-fetch-site']==='cross-site'){reply(res,403,{error:'Origin not allowed'});return;}
   const url=new URL(req.url??'/',`http://${host}`);if(url.search){reply(res,400,{error:'Query parameters are not supported'});return;}
   if(req.method==='GET'&&url.pathname==='/api/health'){reply(res,200,{ok:true,mode:'live',briefV2Enabled:options.briefV2Enabled===true});return;}
   if(req.method==='POST'&&url.pathname==='/api/brief'){
    const input=briefRequestSchema.parse(await body(req));
    try {const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(30_000)]);reply(res,200,{proposals:await extractBrief(input,briefExtractor,signal)});}
    catch(error) {if(!res.destroyed)reply(res,error instanceof BriefUnavailableError?503:502,{error:error instanceof BriefUnavailableError?error.message:'Shopping brief suggestions are temporarily unavailable. You can keep chatting and edit your brief manually.'});}
    return;
   }
   let path:string;let payload:unknown;let stream=false;let method='POST';
   if(req.method==='POST'&&url.pathname==='/api/search'){const input=searchSchema.parse(await body(req));payload={requests:input.requests.map(r=>({indexName:r.indexName,params:new URLSearchParams(Object.entries(safeParams(r.params)).map(([key,value])=>[key,typeof value==='string'?value:JSON.stringify(value)])).toString()}))};path='/1/indexes/*/queries';}
   else if(req.method==='POST'&&url.pathname==='/api/facets'){const input=facetSchema.parse(await body(req));payload={...safeParams(input.params),facetQuery:input.facetQuery,maxFacetHits:100};path=`/1/indexes/${input.indexName}/facets/${encodeURIComponent(input.facetName)}/query`;}
   else if(req.method==='GET'&&url.pathname.startsWith('/api/products/')){const id=decodeURIComponent(url.pathname.slice('/api/products/'.length));if(!/^[A-Za-z0-9_.-]{1,150}$/.test(id)){reply(res,400,{error:'Invalid product identity'});return;}path=`/1/indexes/prod_catalog/${encodeURIComponent(id)}`;method='GET';}
   else if(req.method==='POST'&&url.pathname==='/api/chat'){const input=await telemetry.measure('validate',async()=>chatSchema.parse(await body(req)));const {shoppingBrief,...chat}=input;payload=chat;if(options.briefV2Enabled){if(!shoppingBrief){reply(res,400,{error:'Shopping brief is required for this chat. Refresh and retry.'});return;}try{turnId=shoppingBrief.turnId;const result=await orchestrateBrief(shoppingBrief,input.messages,briefModel,AbortSignal.any([abort.signal,AbortSignal.timeout(30_000)]),telemetry);briefEvent=result.event;turnId=shoppingBrief.turnId;if(result.clarification){const textId='clarification-'+telemetry.requestId;const events=[{type:'start',messageId:textId},{type:'text-start',id:textId},{type:'text-delta',id:textId,delta:result.clarification},{type:'text-end',id:textId},{type:'finish'}];const local=new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join('')+'data: [DONE]\n\n');res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','x-vercel-ai-ui-message-stream':'v1','server-timing':telemetry.timing(),'x-request-id':telemetry.requestId,'x-brief-outcome':result.clarificationOutcome??'unknown'});await pipeline(Readable.from(instrumentStream(local.body!,telemetry,briefEvent,turnId)),res,{signal:abort.signal});return;}const latestUser=chat.messages.filter(m=>m.role==='user').at(-1)!;const consultation=result.compiled.consultationBrief||'No established preferences.';const briefContext:Record<string,string>={briefRevision:String(result.state.revision),missionId:result.state.missionId};let chunk='';let n=0;for(const char of consultation){if(Buffer.byteLength(chunk+char)>1000){briefContext['shoppingBrief'+n++]=chunk;chunk='';}chunk+=char;}if(chunk)briefContext['shoppingBrief'+n]=chunk;const turnContext=contextSchema.parse({...latestUser.metadata?.turnContext,...briefContext});payload={...chat,messages:chat.messages.map(m=>m===latestUser?{...m,metadata:{...m.metadata,turnContext}}:m),...(result.compiled.filters?{algolia:{searchParameters:{prod_catalog:{filters:result.compiled.filters}}}}:{})};}catch(error){telemetry.recordBriefFailure(error);reply(res,503,{error:'I could not update your shopping brief. Your saved choices are safe. Please retry before I search.',code:'BRIEF_RETRY',requestId:telemetry.requestId});return;}}path=`/agent-studio/1/agents/${conciergeId}/completions?stream=true&compatibilityMode=ai-sdk-5`;stream=true;}
   else {reply(res,404,{error:'Route not found'});return;}
   const response=await telemetry.measure('upstream_headers',()=>upstream(`https://${options.appId}.algolia.net${path}`,{method,headers:{'content-type':'application/json','x-algolia-application-id':options.appId,'x-algolia-api-key':options.apiKey},body:payload===undefined?undefined:JSON.stringify(payload),signal:abort.signal,redirect:'error'}));
   if(!response.ok){await response.body?.cancel();reply(res,[400,401,403,404,429].includes(response.status)?response.status:502,{error:stream?'Agent request failed':'Catalogue request failed',upstreamStatus:response.status});return;}
   if(stream){if(!response.body)throw new Error('EMPTY');res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','x-accel-buffering':'no','x-vercel-ai-ui-message-stream':'v1','server-timing':telemetry.timing(),'x-request-id':telemetry.requestId});await pipeline(Readable.from(instrumentStream(response.body,telemetry,briefEvent,turnId)),res,{signal:abort.signal});}
   else reply(res,200,await response.json());
  }catch(error){if(res.headersSent){res.destroy();return;}if(error instanceof z.ZodError||error instanceof SyntaxError||error instanceof URIError)reply(res,400,{error:'Invalid request'});else if(error instanceof Error&&error.message==='LARGE')reply(res,413,{error:'Request too large'});else if(error instanceof Error&&error.message==='MEDIA')reply(res,415,{error:'Expected application/json'});else if(!res.destroyed)reply(res,502,{error:'Upstream connection failed'});
  }finally{clearTimeout(timeout);const logger=options.telemetryLogger??(process.env.NODE_ENV==='production'?productionTelemetryLogger:undefined);try{logger?.({...telemetry.snapshot(turnId,res.writableEnded?'request_end':'incomplete'),event:'jtv_request',statusCode:res.statusCode,aborted:abort.signal.aborted,completed:res.writableEnded});}catch{/* Telemetry must never change request behavior. */}}
 };
}
export function createApiServer(options:ApiOptions){return createServer(createApiHandler(options));}
