import { describe, expect, it } from 'vitest';
import { repeatedExactTextAfterTool } from './assistantTextIntegrity';

const answer = 'That is a thoughtful gift. Tell me about the watch your father reaches for most, and when he wears it.';

describe('assistant text integrity', () => {
  it('flags a complete answer repeated after a tool continuation', () => {
    expect(
      repeatedExactTextAfterTool({
        role: 'assistant',
        parts: [
          { type: 'text', text: answer },
          { type: 'tool-update_shopping_state' },
          { type: 'text', text: answer },
        ],
      }),
    ).toBe(answer);
  });

  it('keeps distinct pre-tool and final language', () => {
    expect(
      repeatedExactTextAfterTool({
        role: 'assistant',
        parts: [
          { type: 'text', text: answer },
          { type: 'tool-update_shopping_state' },
          { type: 'text', text: 'I have saved what you told me about Dad.' },
        ],
      }),
    ).toBeNull();
  });

  it('does not mistake a short repeated word or a user message for the defect', () => {
    const parts = [
      { type: 'text', text: 'Thanks' },
      { type: 'tool-update_shopping_state' },
      { type: 'text', text: 'Thanks' },
    ];
    expect(repeatedExactTextAfterTool({ role: 'assistant', parts })).toBeNull();
    expect(repeatedExactTextAfterTool({ role: 'user', parts })).toBeNull();
  });
});
