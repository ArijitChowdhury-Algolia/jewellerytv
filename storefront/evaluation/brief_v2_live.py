#!/usr/bin/env python3
"""Bounded synthetic live journeys. No index writes, invented tool results, or quality scores.
Outputs stay in private analysis/brief-v2. SSE is reconstructed as AI SDK v5 history.
"""
import argparse, concurrent.futures, hashlib, json, os, ssl, time, urllib.request, urllib.error, uuid
try:
 import certifi
 SSL_CONTEXT=ssl.create_default_context(cafile=certifi.where())
except ImportError:
 SSL_CONTEXT=ssl.create_default_context()
from pathlib import Path
from decimal import Decimal, InvalidOperation
ROOT=Path(__file__).resolve().parents[2]
# Copied from InstantSearch.js 4.119.0 AbstractChat's defaultGuardrailFallbackResponse.
# Source: storefront/node_modules/instantsearch.js/cjs/lib/ai-lite/abstract-chat.js:27.
SDK_DEFAULT_GUARDRAIL_FALLBACK='Sorry, we are not able to generate a response at the moment.'
SCENARIOS={
 'uncertain':['I need a birthday gift for my partner, but I have no idea what jewellery they would like.','They wear small everyday pieces, nothing flashy. I can spend up to $120 per item.','Maybe simple stud earrings in sterling silver. Please show a few.','Thanks, I will think about these. No more searching for now.'],
 'budget_correction':['Find sterling silver earrings strictly under $200 per item.','Actually make that strictly under $75 per item, but keep sterling silver.','I would prefer studs. Keep that $75 limit.','Do any of those sit exactly at the limit? I only want prices below it.'],
 'ambiguous_total':['I want a necklace and earrings together under $180.','That is $180 total for both pieces together, not per item.','Simple sterling silver would be good for both pieces.','Could you suggest one pair and explain the combined price?'],
 'exclusions':['Find earrings under $150 per item, no yellow gold and no heart shapes.','Sterling silver only please, and keep both exclusions.','Show me a different style but still no hearts or yellow gold.','Which of my requirements could you actually check in the catalogue?'],
 'recipient_change':['I need a gift for my wife, sterling silver earrings under $90 per item.','Now a separate gift for my brother. He prefers yellow gold rings.','His budget is up to $250 per item. Do not carry over her silver preference.','Show a couple for him and remind me of his brief.'],
 'scope':['I want a simple necklace and bold earrings, under $200 total for both.','The necklace must be sterling silver; the earrings can be yellow gold.','Keep the necklace simple, but make the earrings hoops.','Can you suggest a combination and add the prices accurately?'],
 'evidence':['I want a sterling silver necklace under $100 per item, and absolutely no plating.','Do not treat sterling silver as proof that there is no plating.','If the catalogue cannot prove that, just say so.','Please stop searching. I do not need more suggestions.'],
 'humor_stop':['I need birthday earrings for myself, under $80 per item. My taste is apparently expensive.','Small sterling silver studs, please. A little sparkle is fine.','Those are helpful. I am all shopped out for today.','Goodbye, and no more product suggestions please.'],
}
def exact_cents(value):
 try:
  amount=Decimal(str(value))*100
  return int(amount) if amount.is_finite() and amount>=0 and amount==amount.to_integral_value() else None
 except (InvalidOperation,ValueError,TypeError):return None

def source_hash(path):
 return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else 'not_available'

def sanitize(value):
 if isinstance(value,dict):return {k:sanitize(v) for k,v in value.items() if not any(x in k.lower() for x in ['reasoning','apikey','api_key','authorization','secret','tokenusage_raw'])}
 if isinstance(value,list):return [sanitize(v) for v in value]
 return value
def guardrail_fallback_text(data):
 supplied=data.get('fallbackResponse') if isinstance(data,dict) else None
 return supplied if isinstance(supplied,str) and supplied else SDK_DEFAULT_GUARDRAIL_FALLBACK
def sdk_message(events):
 message={'id':'eval-assistant-'+uuid.uuid4().hex,'role':'assistant','parts':[]};tools={};texts={}
 for e in events:
  t=e.get('type','')
  if t=='start':
   message['id']=e.get('messageId',message['id'])
   if 'messageMetadata' in e:message['metadata']=e['messageMetadata']
  elif t=='text-delta':
   key=e.get('id','text');part=texts.get(key)
   if part is None:part={'type':'text','text':''};texts[key]=part;message['parts'].append(part)
   part['text']+=e.get('delta',e.get('textDelta',''))
  elif t=='tool-input-available':
   part={'type':'tool-'+e['toolName'],'toolCallId':e['toolCallId'],'state':'input-available','input':e.get('input',{})}
   if 'providerExecuted'in e:part['providerExecuted']=e['providerExecuted']
   tools[e['toolCallId']]=part;message['parts'].append(part)
  elif t in ('tool-output-available','tool-output-error') and e.get('toolCallId')in tools:
   part=tools[e['toolCallId']];part['state']='output-available' if t=='tool-output-available' else 'output-error'
   part['output' if t=='tool-output-available' else 'errorText']=e.get('output',e.get('errorText','Tool failed'))
  elif t=='data-guardrail-violation':
   data=e.get('data') if isinstance(e.get('data'),dict) else {}
   fallback=guardrail_fallback_text(data)
   # InstantSearch 4.119.0's installed AbstractChat replaces currentMessage
   # parts with data.fallbackResponse, or this exact default when it is absent.
   message['parts']=[{'type':'text','text':fallback,'state':'done'}]
   tools.clear();texts.clear()
 return message

def request(url,body,headers):
 started=time.monotonic();events=[];timeline=[];response_headers={};status=0
 try:
  req=urllib.request.Request(url,data=json.dumps(body).encode(),headers={'Content-Type':'application/json',**headers},method='POST')
  with urllib.request.urlopen(req,timeout=180,context=SSL_CONTEXT)as response:
   status=response.status;response_headers={k.lower():v for k,v in response.headers.items() if k.lower()in ['server-timing','x-request-id','x-brief-outcome','x-jtv-evaluation-mode']}
   for line in response:
    if not line.startswith(b'data:'):continue
    try:event=json.loads(line[5:])
    except (ValueError,UnicodeDecodeError):continue
    if 'reasoning'in str(event.get('type','')):continue
    events.append(sanitize(event));timeline.append({'type':event.get('type'),'ms':round((time.monotonic()-started)*1000),'tool':event.get('toolName')})
 except urllib.error.HTTPError as error:status=error.code;events.append({'type':'http-error','status':status,'message':error.read().decode()[:1000]})
 except Exception as error:events.append({'type':'transport-error','errorClass':type(error).__name__})
 return {'status':status,'elapsedMs':round((time.monotonic()-started)*1000),'headers':response_headers,'events':events,'timeline':timeline}

def journey(name,turns,mode,out,config):
 dest=out/(mode+'-'+name);dest.mkdir(parents=True,exist_ok=config.get('RESUME',False));history=[];state={'version':2,'missionId':'eval-'+uuid.uuid4().hex,'revision':0,'facts':[],'processedTurns':[],'tombstones':[],'events':[]};conversation=uuid.uuid4().hex;known={};summaries=[]
 url=config.get('CANDIDATE_URL','http://localhost:5173/api/chat');headers={}
 if mode=='baseline' and config.get('BASELINE_URL'):url=config['BASELINE_URL']
 elif mode=='baseline':url=f"https://{config['ALGOLIA_APP_ID']}.algolia.net/agent-studio/1/agents/ba2bb723-0459-4df6-ba8b-812088f39f0f/completions?stream=true&compatibilityMode=ai-sdk-5&memory=false&analytics=false&cache=false";headers={'x-algolia-application-id':config['ALGOLIA_APP_ID'],'x-algolia-api-key':config['ALGOLIA_SEARCH_API_KEY']}
 for i,text in enumerate(turns,1):
  if (out/'STOP').exists():break
  saved=dest/f'turn-{i}.json'
  previous=json.loads(saved.read_text()) if config.get('RESUME') and saved.exists() else None
  if previous:conversation=previous['request']['id']
  user={'id':'eval-'+uuid.uuid4().hex,'role':'user','parts':[{'type':'text','text':text}]};user=previous['request']['messages'][-1] if previous else user;history.append(user);body={'id':conversation,'messages':history,'trigger':'submit-message'}
  if mode=='candidate':body['shoppingBrief']={'state':state,'turnId':user['id']}
  result=previous['response'] if previous else request(url,body,headers);events=result['events'];assistant=sdk_message(events);issues=[];grouped=[];tool_inputs=[];filters=[]
  for event in events:
   if event.get('type')=='data-shopping-brief':state=event['data']['state']
   if event.get('type')=='data-tool-output-metadata':
    resolved=event.get('data',{}).get('metadata',{}).get('com.algolia/resolved-search-params',[])
    if isinstance(resolved,list):filters.extend(resolved)
   if event.get('type')=='tool-output-available':
    output=event.get('output',{})
    if isinstance(output,dict):
     for hit in output.get('hits',[]):known[str(hit.get('objectID'))]=hit
     if 'params'in output:filters.append(output['params'])
   if event.get('type')=='tool-input-available':
    tool_inputs.append(event.get('toolName'))
    for group in event.get('input',{}).get('groups',[]):grouped.extend(str(item.get('objectID'))for item in group.get('results',[]))
  for object_id in grouped:
   if object_id not in known:issues.append({'kind':'ungrounded_grouped_id','objectID':object_id})
  for fact in state['facts']:
   value=fact['value']
   if fact['status']=='active'and value['kind']=='money'and fact['scope']['kind']=='mission':
    for object_id in grouped:
     hit=known.get(object_id,{});price=hit.get('Pricing_ActivePrice')
     cents=exact_cents(price)
     if cents is None:issues.append({'kind':'grouped_price_unknown','objectID':object_id})
     elif (cents>=value['cents'] if value['operator']=='lt'else cents>value['cents']):issues.append({'kind':'grouped_price_exceeds_item_bound','objectID':object_id,'price':price,'budgetCents':value['cents']})
  errors=[e for e in events if e.get('type')in ['error','http-error','transport-error']]
  if errors:issues.extend({'kind':'request_error','detail':e}for e in errors)
  unresolved=[p['toolCallId']for p in assistant['parts']if p.get('state')=='input-available']
  if unresolved:issues.append({'kind':'unresolved_tool_no_invented_continuation','toolCallIds':unresolved})
  summary={'reusedHistoricalTurn':previous is not None,'turn':i,'utterance':text,'status':result['status'],'elapsedMs':result['elapsedMs'],'response':''.join(p.get('text','')for p in assistant['parts']),'groupedIntros':[e.get('input',{}).get('intro','')for e in events if e.get('type')=='tool-input-available'and e.get('toolName')=='algolia_grouped_results'],'revision':state['revision'],'activeFacts':[f for f in state['facts']if f['status']=='active'],'tentativeFacts':[f for f in state['facts']if f['status']=='tentative'],'tools':tool_inputs,'groupedIds':grouped,'resolvedSearchParameters':filters or 'not exposed in SSE','issues':issues}
  summaries.append(summary);(dest/f'turn-{i}.json').write_text(json.dumps(sanitize({'request':previous['request'] if previous else body,'response':result,'summary':summary}),indent=2));(dest/'summary.json').write_text(json.dumps(summaries,indent=2))
  print(json.dumps({'journey':name,'mode':mode,'turn':i,'status':result['status'],'ms':result['elapsedMs'],'issues':issues,'facts':len(summary['activeFacts']),'tentative':len(summary['tentativeFacts']),'tools':tool_inputs}),flush=True)
  if errors or unresolved:break
  history.append(assistant)
 return {'journey':name,'mode':mode,'turns':summaries}

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--mode',choices=['candidate','baseline','both'],default='candidate');parser.add_argument('--scenarios',default=','.join(SCENARIOS));parser.add_argument('--repeat-critical',action='store_true');parser.add_argument('--workers',type=int,default=2);parser.add_argument('--baseline-url');parser.add_argument('--candidate-url');parser.add_argument('--resume',action='store_true');parser.add_argument('--out',required=True);args=parser.parse_args();out=ROOT/args.out;out.mkdir(parents=True,exist_ok=args.resume)
 config={'RESUME':args.resume}
 for line in ((ROOT/'.env.local').read_text().splitlines() if (ROOT/'.env.local').is_file() else []):
  if '='in line and not line.lstrip().startswith('#'):
   key,value=line.split('=',1)
   if key.strip() in ['ALGOLIA_APP_ID','ALGOLIA_SEARCH_API_KEY']:config[key.strip()]=value.strip().strip('\"\'')
 for key in ['ALGOLIA_APP_ID','ALGOLIA_SEARCH_API_KEY']:
  if os.environ.get(key):config[key]=os.environ[key]
 if args.baseline_url:config['BASELINE_URL']=args.baseline_url
 if args.candidate_url:config['CANDIDATE_URL']=args.candidate_url
 if args.mode in ['baseline','both'] and not args.baseline_url and not all(config.get(key)for key in ['ALGOLIA_APP_ID','ALGOLIA_SEARCH_API_KEY']):parser.error('Direct baseline mode requires ALGOLIA_APP_ID and ALGOLIA_SEARCH_API_KEY, or use --baseline-url with a configured local proxy.')
 jobs=[(name,SCENARIOS[name])for name in args.scenarios.split(',')]
 if args.repeat_critical:jobs.extend((name+'-repeat',SCENARIOS[name])for name in ['budget_correction','recipient_change','scope'])
 metadata={'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'sourceHashes':{str(path.relative_to(ROOT)):source_hash(path)for path in [ROOT/'storefront/server/api.ts',ROOT/'storefront/server/briefOrchestrator.ts',ROOT/'storefront/server/brief.ts',ROOT/'storefront/server/briefVerifier.ts',ROOT/'storefront/server/telemetry.ts',ROOT/'storefront/shared/briefState.ts',ROOT/'storefront/shared/briefSchema.ts',ROOT/'storefront/shared/briefConstraints.ts',ROOT/'agent/config/brief-extractor.spec.json']},'qualityScoring':'Human review required; no synthetic score','resolvedFilterProof':'Only if exposed in actual SSE output; request intent is not execution proof'};(out/('resume-metadata.json'if args.resume else 'metadata.json')).write_text(json.dumps(metadata,indent=2))
 with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,min(3,args.workers)))as pool:
  futures=[pool.submit(journey,name,turns,mode,out,config)for mode in (['baseline','candidate']if args.mode=='both'else[args.mode])for name,turns in jobs]
  results=[future.result()for future in concurrent.futures.as_completed(futures)]
 (out/'results.json').write_text(json.dumps(results,indent=2))
if __name__=='__main__':main()
