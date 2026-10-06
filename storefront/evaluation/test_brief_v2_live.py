import unittest
from unittest.mock import patch
from pathlib import Path
from brief_v2_live import exact_cents, source_hash, sdk_message, sanitize
import brief_v2_live as live


class BriefLiveRunnerTests(unittest.TestCase):
    def test_exact_cents_never_rounds_unsupported_evidence(self):
        self.assertEqual(exact_cents(73.14), 7314)
        self.assertEqual(exact_cents('0.10'), 10)
        for value in ('73.141', None, 'NaN', 'Infinity', -1, True):
            self.assertIsNone(exact_cents(value))

    def test_missing_private_hash_is_explicit(self):
        self.assertEqual(source_hash(Path('/nonexistent/private/config.json')), 'not_available')

    def test_sdk_history_preserves_observed_completed_tools(self):
        message = sdk_message([
            {'type': 'start', 'messageId': 'assistant-1'},
            {'type': 'text-delta', 'id': 'text-1', 'delta': 'Hello'},
            {'type': 'tool-input-available', 'toolName': 'algolia_grouped_results', 'toolCallId': 'call-1', 'input': {'intro': 'Would you like hoops?'}},
            {'type': 'tool-output-available', 'toolCallId': 'call-1', 'output': {'status': 'success'}},
        ])
        self.assertEqual(message['id'], 'assistant-1')
        self.assertEqual(message['parts'][1]['state'], 'output-available')
        self.assertEqual(message['parts'][1]['input']['intro'], 'Would you like hoops?')
        unfinished = sdk_message([{'type': 'tool-input-available', 'toolName': 'client', 'toolCallId': 'call-2', 'input': {}}])
        self.assertEqual(unfinished['parts'][0]['state'], 'input-available')
        self.assertNotIn('output', unfinished['parts'][0])

    def test_guardrail_event_replaces_current_message_with_service_fallback(self):
        fallback = 'I can help with supported information.'
        message = sdk_message([
            {'type': 'start', 'messageId': 'assistant-guarded'},
            {'type': 'text-delta', 'id': 'text-1', 'delta': 'Partial answer'},
            {'type': 'tool-input-available', 'toolName': 'search', 'toolCallId': 'call-1', 'input': {}},
            {'type': 'data-guardrail-violation', 'data': {
                'category': 'instruction_override', 'guardrailType': 'input', 'fallbackResponse': fallback,
            }},
            {'type': 'tool-output-available', 'toolCallId': 'call-1', 'output': {'hits': []}},
            {'type': 'finish'},
        ])
        self.assertEqual(message['id'], 'assistant-guarded')
        self.assertEqual(message['parts'], [{'type': 'text', 'text': fallback, 'state': 'done'}])
        self.assertNotIn('metadata', message)

    def test_historical_guardrail_followed_by_separate_text_records_both_parts(self):
        fallback = 'Service fallback.'
        message = sdk_message([
            {'type': 'start', 'messageId': 'assistant-guarded'},
            {'type': 'data-guardrail-violation', 'data': {'fallbackResponse': fallback}},
            {'type': 'text-start', 'id': 'legacy-fallback'},
            {'type': 'text-delta', 'id': 'legacy-fallback', 'delta': fallback},
            {'type': 'finish'},
        ])
        self.assertEqual([part.get('text') for part in message['parts']], [fallback, fallback])

    def test_guardrail_fallback_preserves_only_sdk_message_metadata(self):
        message = sdk_message([
            {'type': 'start', 'messageId': 'assistant-guarded', 'messageMetadata': {'traceId': 'known'}},
            {'type': 'data-guardrail-violation', 'data': {'fallbackResponse': 'Blocked by service.'}},
        ])
        self.assertEqual(message['metadata'], {'traceId': 'known'})
        self.assertNotIn('serviceAuthoredFallback', message['metadata'])

    def test_guardrail_missing_or_empty_fallback_uses_installed_sdk_default(self):
        expected = 'Sorry, we are not able to generate a response at the moment.'
        for data in ({'category': 'instruction_override'}, {'fallbackResponse': ''}):
            with self.subTest(data=data):
                message = sdk_message([{'type': 'data-guardrail-violation', 'data': data}])
                self.assertEqual(message['parts'], [{'type': 'text', 'text': expected, 'state': 'done'}])
                self.assertNotIn('metadata', message)

    def test_evaluation_mode_response_header_is_captured(self):
        class Response:
            status = 200
            headers = {
                'server-timing': 'total;dur=1',
                'x-jtv-evaluation-mode': 'memory-cache-analytics-disabled',
                'set-cookie': 'ignored=secret',
            }
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def __iter__(self): return iter([b'data: {"type":"finish"}\n\n'])

        with patch.object(live.urllib.request, 'urlopen', return_value=Response()):
            result = live.request('http://localhost/api/chat', {}, {})
        self.assertEqual(result['headers'], {
            'server-timing': 'total;dur=1',
            'x-jtv-evaluation-mode': 'memory-cache-analytics-disabled',
        })

    def test_sanitization_excludes_credentials_and_reasoning_fields(self):
        self.assertEqual(sanitize({'apiKey': 'private', 'reasoning': 'private', 'data': {'authorization': 'private', 'count': 1}}), {'data': {'count': 1}})


if __name__ == '__main__':
    unittest.main()
