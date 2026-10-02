"""Bounded Agent Studio diagnostic. Saves observable SSE, never private reasoning or credentials."""
import json
import subprocess
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[3]
from client import ENV, APP

AGENT = 'ba2bb723-0459-4df6-ba8b-812088f39f0f'
OMIT = object()

def sanitize(value):
    if isinstance(value, dict):
        if 'reasoning' in str(value.get('type', '')).lower():
            return OMIT
        out = {}
        for key, item in value.items():
            if key.lower() in {'reasoning', 'thoughts', 'chainofthought', 'apikey', 'api_key', 'authorization', 'accesstoken', 'access_token'}:
                continue
            clean = sanitize(item)
            if clean is not OMIT:
                out[key] = clean
        return out
    if isinstance(value, list):
        return [clean for item in value if (clean := sanitize(item)) is not OMIT]
    return value

def selftest():
    assert sanitize({'type': 'reasoning-delta', 'delta': 'private'}) is OMIT
    assert sanitize({'type': 'tool-output-available', 'output': {'hits': [{'objectID': 'A', 'Catalog_Brand': 'B'}]}})['output']['hits'][0]['Catalog_Brand'] == 'B'
    assert sanitize({'apiKey': 'secret', 'type': 'text-delta', 'delta': 'visible'}) == {'type': 'text-delta', 'delta': 'visible'}
    assert sanitize({'type': 'data-guardrail-violation', 'data': {'category': 'ungrounded_claim'}})['data']['category'] == 'ungrounded_claim'
    assert sanitize([{'type': 'reasoning', 'text': 'private'}, {'type': 'text', 'text': 'public'}]) == [{'type': 'text', 'text': 'public'}]

def main():
    selftest()
    label = sys.argv[1]
    request_file = Path(sys.argv[2])
    body = json.loads(request_file.read_text())
    body['id'] = 'jtv-watch-debug-' + uuid.uuid4().hex
    memory_enabled = '--with-memory' in sys.argv[4:]
    query_params = {'compatibilityMode': 'ai-sdk-5', 'stream': 'true', 'cache': 'false', 'analytics': 'false'}
    if not memory_enabled:
        query_params['memory'] = 'false'
    params = urlencode(query_params)
    url = 'https://' + APP + '.algolia.net/agent-studio/1/agents/' + AGENT + '/completions?' + params
    config = [
        'url = ' + json.dumps(url),
        'header = ' + json.dumps('X-Algolia-Application-Id: ' + APP),
        'header = ' + json.dumps('X-Algolia-API-Key: ' + ENV['ALGOLIA_SEARCH_API_KEY']),
        'header = "Content-Type: application/json"',
        'header = "Accept: text/event-stream"',
        'data = ' + json.dumps(json.dumps(body)),
    ]
    output_root = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(__file__).resolve().parents[1] / 'runs'
    out = output_root / label
    out.mkdir(parents=True, exist_ok=False)
    (out / 'request.json').write_text(json.dumps(body, indent=2) + '\n')
    started = time.monotonic()
    proc = subprocess.Popen(['curl', '--silent', '--show-error', '--no-buffer', '--max-time', '180', '--config', '-', '--write-out', '\nHTTP_STATUS:%{http_code}\n'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    proc.stdin.write('\n'.join(config)); proc.stdin.close()
    events = []; texts = []; http = None; non_sse = []
    with (out / 'events.jsonl').open('w') as f:
        for line in proc.stdout:
            line = line.strip()
            if line.startswith('HTTP_STATUS:'):
                http = line.split(':', 1)[1]; continue
            if not line.startswith('data:'):
                if line: non_sse.append(line)
                continue
            payload = line[5:].strip()
            if payload == '[DONE]': continue
            try: event = json.loads(payload)
            except json.JSONDecodeError: continue
            event = sanitize(event)
            if event is OMIT: continue
            events.append(event); f.write(json.dumps(event) + '\n'); f.flush()
            kind = event.get('type', '')
            if kind == 'text-delta': texts.append(event.get('delta', event.get('textDelta', '')))
            if kind in {'tool-input-available', 'tool-output-available', 'error'} or 'guardrail' in kind:
                print(json.dumps({'elapsed_seconds': round(time.monotonic()-started, 1), 'type': kind, 'tool': event.get('toolName'), 'event_keys': list(event)}), flush=True)
    proc.wait()
    summary = {'http': http, 'curl_exit': proc.returncode, 'elapsed_seconds': round(time.monotonic()-started, 2), 'event_count': len(events), 'event_types': sorted({e.get('type', '') for e in events}), 'visible_pre_replacement_text': ''.join(texts), 'guardrail_events': [e for e in events if 'guardrail' in e.get('type', '')], 'execution_scope': 'One diagnostic completion; cache and analytics disabled; memory=' + str(memory_enabled).lower() + '; published agent configuration unchanged.'}
    if non_sse:
        try:
            clean = sanitize(json.loads(''.join(non_sse)))
            if clean is not OMIT: summary['non_sse_response'] = clean
        except json.JSONDecodeError: summary['non_sse_lines'] = len(non_sse)
    summary['transport_error'] = proc.stderr.read()[:1000]
    (out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary), flush=True)

if __name__ == '__main__':
    main()
