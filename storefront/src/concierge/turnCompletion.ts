type Message = { id?: string; role?: string; parts?: readonly unknown[] };
type Part = { type?: unknown; text?: unknown; state?: unknown };

function latestAssistant(messages: readonly Message[]) {
  let lastUser = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === 'user') {
      lastUser = index;
      break;
    }
  }
  if (lastUser < 0) return undefined;
  return [...messages]
    .slice(lastUser + 1)
    .reverse()
    .find((message) => message.role === 'assistant');
}

/** The SDK can report ready/onFinish after a capped tool round. Require a final text part. */
export function isCompletedAssistantTurn(messages: readonly Message[], status: string): boolean {
  if (status !== 'ready') return false;
  const assistant = latestAssistant(messages);
  if (!assistant?.parts?.length) return false;
  const parts = assistant.parts as Part[];
  let lastToolIndex = -1;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
      if (part.state !== 'output-available' && part.state !== 'output-error') return false;
      lastToolIndex = index;
    }
  }
  const finalText = parts
    .slice(lastToolIndex + 1)
    .filter((part) => part.type === 'text' && part.state === 'done')
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();
  return !!finalText && !finalText.startsWith('[System notice]');
}

export function hasFailedTool(messages: readonly Message[]): boolean {
  const assistant = latestAssistant(messages);
  return !!assistant?.parts?.some((part) => (part as Part).state === 'output-error');
}
