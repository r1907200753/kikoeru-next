import type { ProbeResult, ProbeStatus } from './types.js';
import { redactText } from './http.js';

export interface ProbeOutcome {
  status: ProbeStatus;
  summary: string;
  details?: Record<string, unknown>;
  error?: string;
}

export class ProbeFailure extends Error {
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ProbeFailure';
    this.details = details;
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || /aborted due to timeout/i.test(error.message)) {
      return '请求超时（检查代理或网络连通性）';
    }
    if (error.cause instanceof Error) {
      return redactText(`${error.message}：${error.cause.message}`);
    }
    return redactText(error.message);
  }
  return redactText(String(error));
}

export async function captureProbe(
  name: string,
  fn: () => Promise<ProbeOutcome>,
): Promise<ProbeResult> {
  const startedAt = performance.now();
  try {
    const outcome = await fn();
    return {
      name,
      status: outcome.status,
      summary: outcome.summary,
      ms: Math.round(performance.now() - startedAt),
      error: outcome.error ?? '',
      details: outcome.details ?? {},
    };
  } catch (error) {
    const message = describeError(error);
    return {
      name,
      status: 'fail',
      summary: `探针异常：${message}`,
      ms: Math.round(performance.now() - startedAt),
      error: message,
      details: error instanceof ProbeFailure ? error.details : {},
    };
  }
}

export function skipped(name: string, summary: string): ProbeResult {
  return {
    name,
    status: 'skip',
    summary,
    ms: 0,
    error: '',
    details: {},
  };
}
