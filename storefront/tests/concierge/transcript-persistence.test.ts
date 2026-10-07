import { describe, expect, it, vi } from 'vitest';
import { ChatState } from 'instantsearch.js/es/lib/chat';
import type { UIMessage } from 'instantsearch.js/es/lib/ai-lite';
import {
  clearCompletedAssistantMessages,
  getConnectedChatPersistenceOptions,
  isRestoredAssistantMessage,
  readCompletedAssistantMessageIds,
  recordCompletedAssistantMessage,
  visibleConnectedTranscript,
} from '../../src/concierge/ConnectedConcierge';

const assistant = (id: string, text: string): UIMessage => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', text, state: 'done' }],
});

describe('connected Concierge transcript continuity', () => {
  it('uses the mission id as the same-session transcript key and enables SDK persistence', () => {
    expect(getConnectedChatPersistenceOptions('mission-1')).toEqual({
      id: 'mission-1',
      persistence: true,
    });
    expect(getConnectedChatPersistenceOptions('mission-2')).not.toEqual(
      getConnectedChatPersistenceOptions('mission-1'),
    );
  });

  it('restores completed assistant turns but keeps cancelled and failed turns hidden', () => {
    expect(isRestoredAssistantMessage(assistant('complete', 'Here are the pieces.'))).toBe(true);
    expect(
      isRestoredAssistantMessage({
        id: 'cancelled',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Partial answer', state: 'streaming' }],
      } as UIMessage),
    ).toBe(false);
    expect(
      isRestoredAssistantMessage({
        id: 'failed',
        role: 'assistant',
        parts: [
          {
            type: 'tool-retrieve_evidence',
            toolCallId: 'call-1',
            state: 'output-error',
            input: {},
            errorText: 'failed',
          },
          { type: 'text', text: 'A fallback', state: 'done' },
        ],
      } as UIMessage),
    ).toBe(false);
  });

  it('does not restore a final-looking reply without an app completion receipt', () => {
    const values = new Map<string, string>();
    const storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    } satisfies Storage;
    const failedReply = assistant('failed-final-looking', 'The answer was replaced.');
    expect(isRestoredAssistantMessage(failedReply)).toBe(true);
    expect(readCompletedAssistantMessageIds(storage, 'mission-1').has(failedReply.id)).toBe(false);
    recordCompletedAssistantMessage(storage, 'mission-1', 'accepted-assistant');
    expect(readCompletedAssistantMessageIds(storage, 'mission-1')).toEqual(
      new Set(['accepted-assistant']),
    );
    expect(readCompletedAssistantMessageIds(storage, 'mission-1').has(failedReply.id)).toBe(false);
  });

  it('hides the old transcript during reset and restores it if reset fails', () => {
    const transcript = [
      { id: 'shopper-1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Hi' }] },
      assistant('assistant-1', 'A completed answer.'),
    ];
    expect(visibleConnectedTranscript(transcript, true)).toEqual([]);
    expect(visibleConnectedTranscript(transcript, false)).toEqual(transcript);
  });

  it('round-trips a ready transcript in session storage and clears it on reset', () => {
    const values = new Map<string, string>();
    const sessionStorage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    } satisfies Storage;
    vi.stubGlobal('window', { sessionStorage });
    vi.stubGlobal('sessionStorage', sessionStorage);
    const first = new ChatState<UIMessage>('mission-1', undefined, true);
    first.messages = [
      { id: 'shopper-1', role: 'user', parts: [{ type: 'text', text: 'Find a necklace' }] },
      assistant('assistant-1', 'Here is a grounded choice.'),
    ];
    const reloaded = new ChatState<UIMessage>('mission-1', undefined, true);
    expect(reloaded.messages).toEqual(first.messages);

    reloaded.messages = [];
    expect(new ChatState<UIMessage>('mission-1', undefined, true).messages).toEqual([]);
    expect(new ChatState<UIMessage>('mission-2', undefined, true).messages).toEqual([]);
    recordCompletedAssistantMessage(sessionStorage, 'mission-1', 'assistant-1');
    clearCompletedAssistantMessages(sessionStorage, 'mission-1');
    expect(readCompletedAssistantMessageIds(sessionStorage, 'mission-1')).toEqual(new Set());
    vi.unstubAllGlobals();
  });
});
