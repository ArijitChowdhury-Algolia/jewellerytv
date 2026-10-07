type MessageParts = { role: string; parts: readonly unknown[] };

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function canonicalJtvUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      (host !== 'jtv.com' && !host.endsWith('.jtv.com')) ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443')
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Only client-tool results from the current transcript can authorize an article link. */
export function canonicalBlogUrlsFromMessages(
  messages: readonly MessageParts[],
): ReadonlySet<string> {
  const urls = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const rawPart of message.parts) {
      const part = object(rawPart);
      if (part?.type !== 'tool-retrieve_evidence' || part.state !== 'output-available') continue;
      const output = object(part.output);
      if (output?.status !== 'ok' || output.source !== 'blog' || !Array.isArray(output.records))
        continue;
      for (const rawRecord of output.records) {
        const evidence = object(rawRecord);
        if (
          evidence?.source !== 'blog' ||
          typeof evidence.objectID !== 'string' ||
          !evidence.objectID ||
          typeof evidence.contentHash !== 'string' ||
          !evidence.contentHash
        )
          continue;
        const url = canonicalJtvUrl(object(evidence.record)?.canonical_url);
        if (url) urls.add(url);
      }
    }
  }
  return urls;
}

export function verifiedBlogHref(
  href: string | undefined,
  canonicalUrls: ReadonlySet<string>,
): string | null {
  const url = canonicalJtvUrl(href);
  return url && canonicalUrls.has(url) ? url : null;
}
