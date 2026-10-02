#!/usr/bin/env python3
"""Dry-run by default. Explicit bounded published-agent replay; no index writes."""
import argparse, hashlib, json, subprocess, sys, uuid
from datetime import datetime, timezone
from pathlib import Path
from scorer import score
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
AGENT='ba2bb723-0459-4df6-ba8b-812088f39f0f'
def digest(value): return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def configuration_hash(value):
    return digest({key: item for key, item in value.items() if key not in {'lastUsedAt', 'createdAt', 'updatedAt'}})

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scenario', required=True)
    parser.add_argument('--live',action='store_true')
    parser.add_argument('--repeat',type=int,choices=(1,2,3),default=1)
    parser.add_argument('--max-turns',type=int,default=6)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    if not 1<=args.max_turns<=6: parser.error('--max-turns must be 1..6')
    suite=json.loads((HERE/'scenarios.v1.json').read_text())
    scenario=next((s for s in suite['scenarios'] if s['id']==args.scenario),None)
    if scenario is None: parser.error('Choose: '+', '.join(s['id'] for s in suite['scenarios']))
    plan={'live':args.live,'scenario':scenario,'repetitions':args.repeat,'turn_cap':args.max_turns,'suite_hash':digest(suite)}
    if not args.live:
        print(json.dumps(plan,indent=2)); return
    # Import credentials only after explicit --live. GET agent configuration only.
    sys.path.insert(0,str(HERE/'helpers'))
    from client import call
    before=call('/agent-studio/1/agents/'+AGENT)
    if before['status']!=200: raise SystemExit('Cannot snapshot live configuration')
    config=before['data']
    out=args.output or HERE/'runs'/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8])
    out.mkdir(parents=True,exist_ok=False)
    (out/'manifest.json').write_text(json.dumps({**plan,'agent_config_hash':configuration_hash(config),'model':config.get('model'),'agent_id':AGENT,'started_at':datetime.now(timezone.utc).isoformat(),'transport':'published API; memory disabled; full observed history; not browser rendering proof'},indent=2)+'\n')
    # Snapshot is private local evidence. Harness strips credentials and private reasoning from events.
    (out/'agent-config.json').write_text(json.dumps(config,indent=2)+'\n')
    for repetition in range(args.repeat):
        previous=None; selected=None
        for index,turn in enumerate(scenario['turns'][:args.max_turns]):
            label=f'r{repetition+1}-t{index+1}'
            question=turn['say']
            if '{selected_id}' in question: question=question.replace('{selected_id}',selected) if selected else turn['without_selection']
            request_file=out/(label+'-input.json')
            if previous:
                subprocess.run([sys.executable,str(HERE/'helpers/next_turn.py'),str(previous),str(request_file),question],check=True,capture_output=True)
            else: request_file.write_text(json.dumps({'messages':[{'id':uuid.uuid4().hex,'role':'user','parts':[{'type':'text','text':question}]}]}))
            subprocess.run([sys.executable,str(HERE/'helpers/capture_replay.py'),label,str(request_file),str(out)],check=True,stdout=subprocess.DEVNULL)
            previous=out/label
            events=[json.loads(line) for line in (previous/'events.jsonl').read_text().splitlines()]
            summary=json.loads((previous/'summary.json').read_text())
            result=score(events,json.loads((previous/'request.json').read_text()),turn.get('checks'))
            result['human_review_prompt']=turn['review']
            (previous/'checks.json').write_text(json.dumps(result,indent=2)+'\n')
            if result['selected_ids']: selected=result['selected_ids'][0]
            print(label, 'captured',len(events),'events; human review required',flush=True)
            if summary.get('http')!='200' or summary.get('curl_exit') or any(e.get('type')=='error' for e in events): break
    after=call('/agent-studio/1/agents/'+AGENT)
    unchanged=after['status']==200 and configuration_hash(after['data'])==configuration_hash(config)
    (out/'configuration-check.json').write_text(json.dumps({'unchanged':unchanged,'comparison_valid':unchanged})+'\n')
    if not unchanged: raise SystemExit('Configuration changed during replay; comparison invalid')
if __name__=='__main__': main()
