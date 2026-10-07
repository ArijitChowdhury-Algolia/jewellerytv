type Part = { type?: unknown; text?: unknown };
type Message = { role?: unknown; parts?: readonly Part[] };

/** Detect a full answer repeated after an assistant tool continuation. */
export function repeatedExactTextAfterTool(message: Message): string | null {
  if (message.role !== 'assistant') return null;
  const earlier = new Set<string>();
  let afterTool = false;
  for (const part of message.parts ?? []) {
    if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
      afterTool = true;
      continue;
    }
    if (part.type !== 'text' || typeof part.text !== 'string') continue;
    const text = part.text.trim();
    if (text.length < 80) continue;
    if (afterTool && earlier.has(text)) return text;
    earlier.add(text);
  }
  return null;
}
