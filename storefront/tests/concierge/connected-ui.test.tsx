import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'instantsearch.js/es/lib/ai-lite';
import {
  canSubmitConnectedTurn,
  connectedProgressLabel,
  getConnectedTurnSystemNotice,
  resetConnectedConversation,
} from '../../src/concierge/ConnectedConcierge';

describe('connected Concierge progress', () => {
  const user = { id: 'shopper-1', role: 'user', parts: [{ type: 'text', text: 'Find earrings' }] };
  const withPart = (part: Record<string, unknown>) =>
    [user, { id: 'assistant-1', role: 'assistant', parts: [part] }] as UIMessage[];

  it('uses the SDK state until the current turn reports a real event', () => {
    expect(connectedProgressLabel('submitted', [], 'shopper-1')).toBe('Sending to Concierge');
    expect(connectedProgressLabel('streaming', [user] as UIMessage[], 'shopper-1')).toBe(
      'Concierge is working',
    );
    expect(
      connectedProgressLabel(
        'streaming',
        withPart({ type: 'tool-retrieve_evidence', state: 'input-available' }),
        'another-shopper',
      ),
    ).toBe('Concierge is working');
    expect(
      connectedProgressLabel(
        'streaming',
        [...withPart({ type: 'tool-retrieve_evidence', state: 'input-available' }),
          { id: 'shopper-2', role: 'user', parts: [{ type: 'text', text: 'Now show rings' }] }] as UIMessage[],
        'shopper-2',
      ),
    ).toBe('Concierge is working');
  });

  it('changes wording for current-turn tool and reply events', () => {
    expect(
      connectedProgressLabel(
        'streaming',
        withPart({ type: 'tool-update_shopping_state', state: 'input-available' }),
        'shopper-1',
      ),
    ).toBe('Updating preferences');
    expect(
      connectedProgressLabel(
        'streaming',
        withPart({ type: 'tool-retrieve_evidence', state: 'input-available' }),
        'shopper-1',
      ),
    ).toBe('Checking JTV information');
    expect(
      connectedProgressLabel(
        'streaming',
        withPart({ type: 'tool-present_choices', state: 'input-available' }),
        'shopper-1',
      ),
    ).toBe('Preparing product choices');
    expect(
      connectedProgressLabel(
        'streaming',
        withPart({ type: 'text', state: 'streaming', text: 'A thought' }),
        'shopper-1',
      ),
    ).toBe('Concierge is replying');
    expect(
      connectedProgressLabel(
        'streaming',
        withPart({ type: 'tool-retrieve_evidence', state: 'output-available' }),
        'shopper-1',
      ),
    ).toBe('Continuing your request');
    expect(
      connectedProgressLabel(
        'streaming',
        [user, {
          id: 'assistant-1',
          role: 'assistant',
          parts: [
            { type: 'tool-update_shopping_state', state: 'output-available' },
            { type: 'tool-retrieve_evidence', state: 'input-available' },
          ],
        }] as UIMessage[],
        'shopper-1',
      ),
    ).toBe('Checking JTV information');
  });
});

describe('connected Concierge reset gate', () => {
  it('blocks an immediate send while New conversation persistence is settling', () => {
    expect(canSubmitConnectedTurn('Find a ring', false, true)).toBe(false);
    expect(canSubmitConnectedTurn('Find a ring', false, false)).toBe(true);
    expect(canSubmitConnectedTurn('', false, false)).toBe(false);
  });
  it('keeps the synchronous lock through deferred reset and transcript clearing', async () => {
    const resettingRef = { current: false };
    let release!: (value: { ok: true }) => void;
    const clearOrder: string[] = [];
    const reset = resetConnectedConversation(
      resettingRef,
      () => new Promise<{ ok: true }>((resolve) => (release = resolve)),
      () => clearOrder.push('clear'),
      () => clearOrder.push('input'),
      () => clearOrder.push('focus'),
    );
    expect(resettingRef.current).toBe(true);
    expect(canSubmitConnectedTurn('Send immediately', false, resettingRef.current)).toBe(false);
    release({ ok: true });
    await reset;
    expect(clearOrder).toEqual(['clear', 'input', 'focus']);
    expect(resettingRef.current).toBe(false);
  });
  it('labels tool failures as system UI without exposing tool details', () => {
    const notice = getConnectedTurnSystemNotice(
      [
        { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Find a necklace' }] },
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-retrieve_evidence',
              toolCallId: 'call-1',
              state: 'output-error',
              input: {},
              errorText: 'operations [] rejected',
            },
          ],
        },
      ] as unknown as UIMessage[],
      { isAbort: false, isError: true },
    );
    expect(notice).toContain('[System notice]');
    expect(notice).toContain('Existing product choices remain.');
    expect(notice).not.toContain('operations');
    expect(notice).not.toContain('retrieve_evidence');
  });
  it('labels an exhausted turn with no final assistant text and keeps prior choices visible', () => {
    const notice = getConnectedTurnSystemNotice(
      [
        { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Find a necklace' }] },
        { id: 'assistant-1', role: 'assistant', parts: [] },
      ] as unknown as UIMessage[],
      null,
    );
    expect(notice).toBe(
      '[System notice] This request did not produce a complete response. Existing product choices remain.',
    );
  });
  it('preserves an agent-provided system notice without duplicating it', () => {
    const notice = getConnectedTurnSystemNotice(
      [
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: '[System notice] Please refine the request.' }],
        },
      ] as unknown as UIMessage[],
      { isAbort: false, isError: true },
    );
    expect(notice).toBe('[System notice] Please refine the request.');
  });
});
