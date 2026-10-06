import { describe, expect, it } from 'vitest';
import { isCompletedAssistantTurn } from '../../src/concierge/turnCompletion';

const user = { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Find a ring' }] };
const tool = {
  type: 'tool-retrieve_evidence',
  toolCallId: 'call-1',
  state: 'output-available',
  input: {},
  output: { status: 'ok' },
};
const text = (value: string) => ({ type: 'text', text: value, state: 'done' });

describe('final assistant turn gate', () => {
  it('accepts a complete answer after its tool results', () => {
    expect(
      isCompletedAssistantTurn(
        [
          user,
          {
            id: 'assistant-1',
            role: 'assistant',
            parts: [text('Checking '), tool, text('This one fits your request.')],
          },
        ],
        'ready',
      ),
    ).toBe(true);
  });
  it('rejects a capped tool round and partial text before the tool', () => {
    expect(
      isCompletedAssistantTurn(
        [user, { id: 'assistant-1', role: 'assistant', parts: [tool] }],
        'ready',
      ),
    ).toBe(false);
    expect(
      isCompletedAssistantTurn(
        [user, { id: 'assistant-1', role: 'assistant', parts: [text('Checking '), tool] }],
        'ready',
      ),
    ).toBe(false);
  });
  it('rejects pending tools, active streams and labelled system notices', () => {
    expect(
      isCompletedAssistantTurn(
        [
          user,
          {
            id: 'assistant-1',
            role: 'assistant',
            parts: [{ ...tool, state: 'input-available' }, text('Done')],
          },
        ],
        'ready',
      ),
    ).toBe(false);
    expect(
      isCompletedAssistantTurn(
        [user, { id: 'assistant-1', role: 'assistant', parts: [text('Done')] }],
        'streaming',
      ),
    ).toBe(false);
    expect(
      isCompletedAssistantTurn(
        [
          user,
          {
            id: 'assistant-1',
            role: 'assistant',
            parts: [text('[System notice] The answer was withheld.')],
          },
        ],
        'ready',
      ),
    ).toBe(false);
  });
});
