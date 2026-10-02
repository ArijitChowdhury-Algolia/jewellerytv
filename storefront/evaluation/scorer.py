"""Evidence-only checks. Unknowns are not passes; prose/personality needs human review."""
from decimal import Decimal, InvalidOperation

def cents(value):
    if isinstance(value, bool) or value is None:
        raise ValueError('Missing numeric price')
    try:
        number = Decimal(str(value))
        if not number.is_finite() or number < 0 or number * 100 != (number * 100).to_integral_value():
            raise ValueError('Invalid currency value')
        return int(number * 100)
    except InvalidOperation as exc:
        raise ValueError('Invalid currency value') from exc

def score(events, request=None, checks=None):
    checks = checks or {}
    records = {}
    def collect(value):
        if isinstance(value, dict):
            for hit in value.get('hits', []):
                if isinstance(hit, dict) and hit.get('objectID'):
                    records[str(hit['objectID'])] = hit
            for key, child in value.items():
                if key != 'hits': collect(child)
        elif isinstance(value, list):
            for child in value: collect(child)
    collect(request or {})
    for event in events:
        if event.get('type') == 'tool-output-available': collect(event.get('output'))
    selected = []
    for event in events:
        if event.get('type') == 'tool-input-available' and event.get('toolName') == 'algolia_grouped_results':
            selected.extend(str(item['objectID']) for group in event.get('input', {}).get('groups', []) for item in group.get('results', []) if item.get('objectID'))
    findings = []
    def add(name, status, detail): findings.append(dict(check=name, status=status, detail=detail))
    errors = [e.get('type') for e in events if e.get('type') in ('error', 'tool-output-error', 'data-guardrail-violation')]
    add('runtime', 'fail' if errors else 'pass' if events else 'not_observed', errors)
    missing = sorted(set(selected) - records.keys())
    add('selected_ids_retrieved', 'fail' if missing else 'pass' if selected else 'not_observed', missing)
    if 'each_below_cents' in checks:
        prices = {}
        for item in set(selected):
            try: prices[item] = cents(records.get(item, {}).get('Pricing_ActivePrice'))
            except ValueError: prices[item] = None
        status = 'fail' if any(p is not None and p >= checks['each_below_cents'] for p in prices.values()) else 'not_observed' if not prices or None in prices.values() else 'pass'
        add('each_strictly_below_budget', status, prices)
    # Pair membership must be explicitly supplied by the reviewer/application. Never sum a group of alternatives.
    if 'pair_ids' in checks:
        ids = checks['pair_ids']
        try:
            if len(ids) < 2 or len(set(ids)) != len(ids): raise ValueError('Pair must identify distinct products')
            total = sum(cents(records.get(i, {}).get('Pricing_ActivePrice')) for i in ids)
            add('explicit_pair_total', 'pass' if total <= checks['combined_limit_cents'] else 'fail', {'ids': ids, 'total_cents': total})
        except ValueError as exc: add('explicit_pair_total', 'not_observed', str(exc))
    for field, expected in checks.get('exact_record_fields', {}).items():
        values = {i: records.get(i, {}).get(field) for i in set(selected)}
        add('record_field:' + field, 'fail' if any(v is not None and v != expected for v in values.values()) else 'not_observed' if not values or None in values.values() else 'pass', values)
    return {'findings': findings, 'selected_ids': selected, 'human_review_required': True,
            'scope': 'Only observed tool IDs, explicit price checks, field equality and runtime events. No automatic claim-grounding, personality, state-reset or rendered-UI certification.'}
