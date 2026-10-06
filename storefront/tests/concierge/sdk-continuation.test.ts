import { describe, expect, it, vi } from 'vitest';
import { Chat } from 'instantsearch.js/es/lib/chat';
import type { ChatTransport, UIMessage, UIMessageChunk } from 'instantsearch.js/es/lib/ai-lite';

type ClientTools = {
  client_lookup: {
    input: { query: string };
    output: { status: 'ok'; call: string };
  };
};

type FixtureMessage = UIMessage<unknown, Record<string, never>, ClientTools>;
type FixtureChunk = UIMessageChunk<unknown, Record<string, never>, ClientTools>;

const assistantOne = 'assistant-turn-one';
const assistantTwo = 'assistant-turn-two';
const conversationId = 'conversation-fixed';

function stream(chunks: FixtureChunk[]): ReadableStream<FixtureChunk> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function textResponse(messageId: string, text: string): FixtureChunk[] {
  return [
    { type: 'start', messageId },
    { type: 'text-start', id: `text-${messageId}` },
    { type: 'text-delta', id: `text-${messageId}`, delta: text },
    { type: 'text-end', id: `text-${messageId}` },
    { type: 'finish' },
  ];
}

function toolResponse(messageId: string, call: string, query: string, text = ''): FixtureChunk[] {
  return [
    { type: 'start', messageId },
    ...(text
      ? [
          { type: 'text-start' as const, id: `text-${call}` },
          { type: 'text-delta' as const, id: `text-${call}`, delta: text },
          { type: 'text-end' as const, id: `text-${call}` },
        ]
      : []),
    {
      type: 'tool-input-available',
      toolName: 'client_lookup',
      toolCallId: call,
      input: { query },
    },
    { type: 'finish' },
  ];
}

describe('installed InstantSearch Chat SDK continuation', () => {
  it('merges same-ID tool rounds, preserves exact results, and resets the cap for a new shopper turn', async () => {
    const requests: Array<{
      chatId: string;
      messages: FixtureMessage[];
    }> = [];
    const toolCalls: Array<{
      tool: string;
      toolCallId: string;
      input: unknown;
    }> = [];
    const plans: FixtureChunk[][] = [
      toolResponse(assistantOne, 'call-1', 'round one', 'Checking '),
      toolResponse(assistantOne, 'call-2', 'round two', 'matching '),
      toolResponse(assistantOne, 'call-3', 'round three', 'pieces. '),
      textResponse(assistantOne, 'Here are the results.'),
      toolResponse(assistantTwo, 'call-next', 'next turn', 'For the next turn: '),
      textResponse(assistantTwo, 'done.'),
    ];

    const transport: ChatTransport<FixtureMessage> = {
      async sendMessages({ chatId, messages }) {
        requests.push({ chatId, messages: structuredClone(messages) });
        const response = plans.shift();
        if (!response) throw new Error('fixture exhausted');
        return stream(response);
      },
      async reconnectToStream() {
        return null;
      },
    };

    let latestUserId: string | undefined;
    let continuationCount = 0;
    const chat = new Chat<FixtureMessage>({
      id: conversationId,
      persistence: false,
      transport,
      sendAutomaticallyWhen: ({ messages }) => {
        const user = [...messages].reverse().find((message) => message.role === 'user');
        if (user?.id !== latestUserId) {
          latestUserId = user?.id;
          continuationCount = 0;
        }
        continuationCount += 1;
        return continuationCount <= 3;
      },
      onToolCall: async ({ toolCall }, addToolResult) => {
        toolCalls.push({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          input: toolCall.input,
        });
        await addToolResult({
          tool: 'client_lookup',
          toolCallId: toolCall.toolCallId,
          output: { status: 'ok', call: toolCall.toolCallId },
        });
      },
    });

    await chat.sendMessage({ text: 'Find me something special.' });
    await chat.sendMessage({ text: 'Now do another search.' });

    expect(requests).toHaveLength(6);
    expect(requests.map(({ chatId }) => chatId)).toEqual(Array(6).fill(conversationId));
    expect(toolCalls).toEqual([
      { tool: 'client_lookup', toolCallId: 'call-1', input: { query: 'round one' } },
      { tool: 'client_lookup', toolCallId: 'call-2', input: { query: 'round two' } },
      { tool: 'client_lookup', toolCallId: 'call-3', input: { query: 'round three' } },
      { tool: 'client_lookup', toolCallId: 'call-next', input: { query: 'next turn' } },
    ]);

    const firstContinuation = requests[1].messages.find((message) => message.id === assistantOne);
    expect(firstContinuation?.parts).toContainEqual({
      type: 'tool-client_lookup',
      toolCallId: 'call-1',
      state: 'output-available',
      input: { query: 'round one' },
      output: { status: 'ok', call: 'call-1' },
    });
    expect(firstContinuation?.parts).toContainEqual({
      type: 'text',
      text: 'Checking ',
      state: 'done',
    });

    expect(chat.messages).toHaveLength(4);
    expect(chat.messages.filter((message) => message.role === 'assistant')).toHaveLength(2);
    expect(chat.messages.map((message) => message.id)).toEqual([
      expect.any(String),
      assistantOne,
      expect.any(String),
      assistantTwo,
    ]);

    const firstAssistant = chat.messages.find((message) => message.id === assistantOne)!;
    expect(
      firstAssistant.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join(''),
    ).toBe('Checking matching pieces. Here are the results.');
    expect(firstAssistant.parts.filter((part) => 'toolCallId' in part)).toHaveLength(3);
    expect(firstAssistant.parts.map((part) => part.type)).toEqual([
      'text',
      'tool-client_lookup',
      'text',
      'tool-client_lookup',
      'text',
      'tool-client_lookup',
      'text',
    ]);

    const secondAssistant = chat.messages.find((message) => message.id === assistantTwo)!;
    expect(
      secondAssistant.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join(''),
    ).toBe('For the next turn: done.');
    expect(plans).toHaveLength(0);
  });

  it('leaves a capped tool round without claiming a final text response', async () => {
    const onFinish = vi.fn();
    const requests: FixtureMessage[][] = [];
    const transport: ChatTransport<FixtureMessage> = {
      async sendMessages({ messages }) {
        requests.push(structuredClone(messages));
        return stream(toolResponse(assistantOne, 'capped-call', 'capped'));
      },
      async reconnectToStream() {
        return null;
      },
    };
    const chat = new Chat<FixtureMessage>({
      id: conversationId,
      persistence: false,
      transport,
      sendAutomaticallyWhen: () => false,
      onFinish,
      onToolCall: async ({ toolCall }, addToolResult) => {
        await addToolResult({
          tool: 'client_lookup',
          toolCallId: toolCall.toolCallId,
          output: { status: 'ok', call: toolCall.toolCallId },
        });
      },
    });

    await chat.sendMessage({ text: 'Stop after the cap.' });

    expect(requests).toHaveLength(1);
    expect(chat.status).toBe('ready');
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ isAbort: false, isError: false }),
    );
    expect(
      chat.messages
        .find((message) => message.id === assistantOne)
        ?.parts.some((part) => part.type === 'text'),
    ).toBe(false);
  });
});
