"""Credential-safe read client for the explicitly requested live evaluation."""
import json, os, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
ENV={}
if (ROOT/'.env.local').exists():
    for line in (ROOT/'.env.local').read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k,v=line.split('=',1);ENV[k.strip()]=v.strip().strip('\"\'')
for key in ('ALGOLIA_APP_ID','ALGOLIA_SEARCH_API_KEY'):
    if os.environ.get(key):ENV[key]=os.environ[key]
if not all(ENV.get(k) for k in ('ALGOLIA_APP_ID','ALGOLIA_SEARCH_API_KEY')):
    raise RuntimeError('Live evaluation requires server-side Algolia app ID and search key')
APP=ENV['ALGOLIA_APP_ID']
def call(path):
    if not path.startswith('/agent-studio/1/agents/') or '?' in path:
        raise ValueError('Only agent configuration reads are supported')
    config=['url = '+json.dumps('https://'+APP+'.algolia.net'+path),'header = '+json.dumps('X-Algolia-Application-Id: '+APP),'header = '+json.dumps('X-Algolia-API-Key: '+ENV['ALGOLIA_SEARCH_API_KEY'])]
    p=subprocess.run(['curl','--silent','--show-error','--max-time','45','--config','-','--write-out','\n%{http_code}'],input='\n'.join(config),text=True,capture_output=True,check=True)
    raw,status=p.stdout.rsplit('\n',1)
    return {'status':int(status),'data':json.loads(raw)}
