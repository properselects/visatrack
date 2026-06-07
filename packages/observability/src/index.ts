// Observability: Sentry (errors), Axiom (structured logs), OpenTelemetry (traces).
//
// Every integration is guarded by its env var and lazily loaded via dynamic
// import, so this module is safe to import everywhere (web + workers) and is a
// pure stdout fallback in dev where none of the env vars are set.
import { trace, type Span, type Tracer } from '@opentelemetry/api';

// ---------------------------------------------------------------------------
// Sentry — error + message capture
// ---------------------------------------------------------------------------

type SentryModule = typeof import('@sentry/node');
let sentryPromise: Promise<SentryModule | null> | null = null;

function loadSentry(): Promise<SentryModule | null> {
  if (sentryPromise) return sentryPromise;
  if (!process.env.SENTRY_DSN) {
    sentryPromise = Promise.resolve(null);
    return sentryPromise;
  }
  sentryPromise = import('@sentry/node')
    .then((Sentry) => {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV ?? 'development',
        tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
      });
      return Sentry;
    })
    .catch((err) => {
      console.error('[observability] Sentry init failed', err);
      return null;
    });
  return sentryPromise;
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!process.env.SENTRY_DSN) {
    console.error('[error]', err, context ?? '');
    return;
  }
  void loadSentry().then((Sentry) => {
    if (Sentry) {
      Sentry.captureException(err, context ? { extra: context } : undefined);
    } else {
      console.error('[error]', err, context ?? '');
    }
  });
}

export function captureMessage(message: string, context?: Record<string, unknown>): void {
  if (!process.env.SENTRY_DSN) {
    console.log('[message]', message, context ?? '');
    return;
  }
  void loadSentry().then((Sentry) => {
    if (Sentry) {
      Sentry.captureMessage(message, context ? { level: 'info', extra: context } : undefined);
    } else {
      console.log('[message]', message, context ?? '');
    }
  });
}

/** Back-compat alias for the previous error-capture API. */
export const captureError = captureException;

// ---------------------------------------------------------------------------
// Axiom — structured logging
// ---------------------------------------------------------------------------

type AxiomClient = import('@axiomhq/js').Axiom;
let axiomPromise: Promise<AxiomClient | null> | null = null;

function loadAxiom(): Promise<AxiomClient | null> {
  if (axiomPromise) return axiomPromise;
  if (!process.env.AXIOM_TOKEN || !process.env.AXIOM_DATASET) {
    axiomPromise = Promise.resolve(null);
    return axiomPromise;
  }
  axiomPromise = import('@axiomhq/js')
    .then(({ Axiom }) => new Axiom({ token: process.env.AXIOM_TOKEN! }))
    .catch((err) => {
      console.error('[observability] Axiom init failed', err);
      return null;
    });
  return axiomPromise;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Send a structured log event to Axiom (when configured) and mirror to stdout. */
export function log(
  level: LogLevel,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const dataset = process.env.AXIOM_DATASET;
  if (dataset) {
    void loadAxiom().then((client) => {
      if (client) {
        client.ingest(dataset, [{ level, message, ...fields, _time: new Date().toISOString() }]);
      }
    });
  }
  // Always mirror to stdout for local visibility / log drains.
  const line = JSON.stringify({ level, message, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}

/** Back-compat: previous event-logging API, mapped onto `log('info', …)`. */
export function logEvent(name: string, payload: Record<string, unknown> = {}): void {
  log('info', name, payload);
}

/** Flush buffered Axiom events (call before a worker/process exits). */
export async function flush(): Promise<void> {
  const client = await loadAxiom();
  if (client) await client.flush();
}

// ---------------------------------------------------------------------------
// OpenTelemetry — tracing
// ---------------------------------------------------------------------------

let otelStarting = false;

// Lazily start a NodeSDK tracer. Uses the OTLP exporter when
// OTEL_EXPORTER_OTLP_ENDPOINT is set, otherwise a console exporter.
async function ensureOtel(): Promise<void> {
  if (otelStarting) return;
  otelStarting = true;
  try {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    let traceExporter;
    if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
      // Honors OTEL_EXPORTER_OTLP_ENDPOINT from the environment.
      traceExporter = new OTLPTraceExporter();
    } else {
      const { ConsoleSpanExporter } = await import('@opentelemetry/sdk-trace-base');
      traceExporter = new ConsoleSpanExporter();
    }
    const sdk = new NodeSDK({ traceExporter });
    sdk.start();
  } catch (err) {
    console.error('[observability] OpenTelemetry init failed', err);
  }
}

/** Get a tracer, lazily starting the OTel SDK on first use. */
export function getTracer(name = 'visa-track'): Tracer {
  void ensureOtel();
  return trace.getTracer(name, '0.1.0');
}

/** Default tracer (no-op until the SDK is started via getTracer/startSpan). */
export const tracer: Tracer = trace.getTracer('visa-track', '0.1.0');

/** Run `fn` inside a span; records exceptions and ends the span automatically. */
export async function startSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> {
  const span = getTracer().startSpan(name);
  try {
    return await fn(span);
  } catch (err) {
    span.recordException(err as Error);
    span.setStatus({ code: 2, message: (err as Error).message });
    captureException(err);
    throw err;
  } finally {
    span.end();
  }
}

/** Back-compat: span wrapper that also applies attributes up front. */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean | undefined>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = getTracer().startSpan(name);
  for (const [k, v] of Object.entries(attributes)) {
    if (v !== undefined) span.setAttribute(k, v);
  }
  try {
    return await fn(span);
  } catch (err) {
    span.recordException(err as Error);
    span.setStatus({ code: 2, message: (err as Error).message });
    throw err;
  } finally {
    span.end();
  }
}
