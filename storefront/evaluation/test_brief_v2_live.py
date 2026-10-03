import unittest
from pathlib import Path
from brief_v2_live import exact_cents, source_hash, sdk_message, sanitize


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

    def test_sanitization_excludes_credentials_and_reasoning_fields(self):
        self.assertEqual(sanitize({'apiKey': 'private', 'reasoning': 'private', 'data': {'authorization': 'private', 'count': 1}}), {'data': {'count': 1}})


if __name__ == '__main__':
    unittest.main()
