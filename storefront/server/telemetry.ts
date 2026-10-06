import { randomUUID } from 'node:crypto';

/** Metadata only. This module never reads or rewrites response bytes. */
export class RequestTelemetry {
  readonly requestId: string;
  private readonly start = performance.now();
  readonly phases: Record<string, number> = {};
  readonly counts = { events: 0, toolStarts: 0, toolEnds: 0, guardEvents: 0 };
  briefFailure: { category: string } | null = null;
  firstUsefulOutputMs: number | null = null;
  constructor(requestId?: unknown) {
    this.requestId =
      typeof requestId === 'string' && /^[0-9a-f-]{36}$/i.test(requestId)
        ? requestId
        : randomUUID();
  }
  async measure<T>(phase: string, work: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await work();
    } finally {
      this.phases[phase] = Math.round(performance.now() - start);
    }
  }
  timing() {
    return Object.entries(this.phases)
      .map(([name, duration]) => `${name};dur=${duration}`)
      .join(', ');
  }
  recordBriefFailure(error: unknown) {
    this.briefFailure = { category: error instanceof Error ? error.name : 'processing' };
  }
  observe(event: Record<string, unknown>) {
    const type = String(event.type ?? '');
    this.counts.events++;
    if (
      (type === 'text-delta' || type === 'tool-output-available') &&
      this.firstUsefulOutputMs === null
    )
      this.firstUsefulOutputMs = Math.round(performance.now() - this.start);
    if (type === 'tool-input-start') this.counts.toolStarts++;
    if (type === 'tool-output-available' || type === 'tool-output-error') this.counts.toolEnds++;
    if (type.includes('guard')) this.counts.guardEvents++;
  }
  snapshot(
    turnId?: string,
    snapshotAt:
      'finish_event' | 'done_event' | 'stream_end' | 'request_end' | 'incomplete' = 'request_end',
  ) {
    const elapsedMs = Math.round(performance.now() - this.start);
    return {
      snapshotAt,
      elapsedMs,
      briefFailure: this.briefFailure,
      requestId: this.requestId,
      turnId,
      phases: { ...this.phases },
      counts: { ...this.counts },
      firstUsefulOutputMs: this.firstUsefulOutputMs,
      streamCompletionMs:
        snapshotAt === 'stream_end' || snapshotAt === 'request_end' ? elapsedMs : null,
      providerExecution: 'not_exposed',
      providerUsage: 'not_exposed',
      toolTiming: 'not_exposed',
    };
  }
}

/** Compatibility identity: callers receive the exact stream object unchanged. */
type LegacyStreamOptions = {
  transformEvent?: (
    event: Record<string, unknown>,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  [key: string]: unknown;
};
export function instrumentStream(
  body: ReadableStream<Uint8Array>,
  _telemetry: RequestTelemetry,
  _briefEvent?: unknown,
  _turnId?: string,
  _options?: LegacyStreamOptions,
): any {
  return body;
}
export type RequestLog = ReturnType<RequestTelemetry['snapshot']> & {
  event: 'jtv_request';
  statusCode: number;
  aborted: boolean;
  completed: boolean;
};
export type TelemetryLogger = (entry: RequestLog) => void;
export const productionTelemetryLogger: TelemetryLogger = (entry) =>
  console.info(JSON.stringify(entry));
