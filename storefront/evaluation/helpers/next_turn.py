"""Extend a diagnostic conversation using observed public output/tool results."""
import json,sys,uuid
from pathlib import Path
previous=Path(sys.argv[1]); output=Path(sys.argv[2]); question=sys.argv[3]
body=json.loads((previous/'request.json').read_text())
events=[json.loads(x) for x in (previous/'events.jsonl').read_text().splitlines()]
violations=[e for e in events if e.get('type')=='data-guardrail-violation']
parts=[]
if violations:
 parts=[{'type':'text','text':violations[-1]['data']['fallbackResponse']}]
else:
 for e in events:
  if e.get('type')=='tool-input-available':
   tid=e['toolCallId']; outs=[v for v in events if v.get('toolCallId')==tid and v.get('type')=='tool-output-available']
   if outs:parts.append({'type':'tool-'+e['toolName'],'toolCallId':tid,'state':'output-available','input':e['input'],'output':outs[-1]['output']})
 text=''.join(e.get('delta','') for e in events if e.get('type')=='text-delta')
 if text:parts.append({'type':'text','text':text})
assert parts,'Previous completion has no usable response'
assert all('reasoning' not in p['type'] for p in parts)
body['messages'].append({'id':'assistant-'+uuid.uuid4().hex,'role':'assistant','parts':parts})
body['messages'].append({'id':'user-'+uuid.uuid4().hex,'role':'user','parts':[{'type':'text','text':question}]})
output.write_text(json.dumps(body,indent=2)+'\n')
print('Messages preserved:',len(body['messages']))
