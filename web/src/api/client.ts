import { ApiError, type ApiErrorDetail } from './errors';
import type { Inputs, Meta, Predict, PredictMode } from './types';

/** What the dashboard talks to. HttpProvider is the real API, MockProvider (./mock) works without a backend. */
export interface ApiProvider {
  readonly kind: 'http' | 'mock';
  getMeta(signal?: AbortSignal): Promise<Meta>;
  predict<M extends PredictMode>(mode: M, inputs: Inputs, signal?: AbortSignal): Promise<Predict<M>>;
}

export interface HttpOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: { meta: number; fast: number; full: number };
}

export const DEFAULT_TIMEOUTS = { meta: 8000, fast: 6000, full: 30000 };
const PATHS: Record<PredictMode, string> = { fast: '/predict/fast', full: '/predict' };

export class HttpProvider implements ApiProvider {
  readonly kind = 'http' as const;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeouts: { meta: number; fast: number; full: number };

  constructor(base: string, opts: HttpOptions = {}) {
    this.base = base.replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.timeouts = opts.timeoutMs ?? DEFAULT_TIMEOUTS;
  }

  getMeta(signal?: AbortSignal): Promise<Meta> {
    return this.request<Meta>('GET', '/meta', undefined, this.timeouts.meta, signal, checkMeta);
  }

  predict<M extends PredictMode>(mode: M, inputs: Inputs, signal?: AbortSignal): Promise<Predict<M>> {
    // The API takes a flat dict of canonical names to numbers (docs/ml_interface.md section 2); blank means absent.
    const body = Object.fromEntries(Object.entries(inputs).filter(([, v]) => v !== null && Number.isFinite(v)));
    return this.request<Predict<M>>('POST', PATHS[mode], body, this.timeouts[mode], signal, (j) => checkPrediction(j, mode));
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    timeoutMs: number,
    external: AbortSignal | undefined,
    check: (json: unknown) => void,
  ): Promise<T> {
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, timeoutMs);
    const onExternal = () => ctl.abort();
    if (external?.aborted) ctl.abort();
    else external?.addEventListener('abort', onExternal, { once: true });
    try {
      let res: Response;
      try {
        res = await this.fetchImpl(this.base + path, {
          method,
          headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: ctl.signal,
        });
      } catch (e) {
        if (timedOut) throw new ApiError('timeout', `No answer within ${Math.round(timeoutMs / 1000)} s.`);
        if (external?.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw new ApiError('aborted', 'Request cancelled.');
        throw new ApiError('network', 'The request did not reach the server. Check that the backend is running.');
      }
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        if (timedOut) throw new ApiError('timeout', `No answer within ${Math.round(timeoutMs / 1000)} s.`);
        if (external?.aborted) throw new ApiError('aborted', 'Request cancelled.');
        if (res.ok) throw new ApiError('bad_response', 'The server reply was not valid JSON.', { status: res.status });
      }
      if (!res.ok) throw mapHttpError(res.status, json);
      try {
        check(json);
      } catch (e) {
        throw new ApiError('bad_response', e instanceof Error ? e.message : 'Unexpected reply.', { status: res.status });
      }
      return json as T;
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternal);
    }
  }
}

/** Maps the API's error envelope {"error": {code, message, details}} (api/main.py) and HTTP status to an ApiError. */
export function mapHttpError(status: number, json: unknown): ApiError {
  const body = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const err = (body.error && typeof body.error === 'object' ? body.error : {}) as Record<string, unknown>;
  const code = typeof err.code === 'string' ? err.code : null;
  const detailList = Array.isArray(err.details) ? err.details : Array.isArray(body.detail) ? body.detail : [];
  const details: ApiErrorDetail[] = detailList.map((d: Record<string, unknown>) => ({
    field: typeof d?.field === 'string' ? d.field : null,
    message: typeof d?.message === 'string' ? d.message : typeof d?.msg === 'string' ? d.msg : 'invalid',
  }));
  const message = typeof err.message === 'string' ? err.message : typeof body.detail === 'string' ? body.detail : `The server answered HTTP ${status}.`;
  const opts = { status, code, details };
  if (status === 422) return new ApiError(code === 'leakage' ? 'leakage' : 'validation', message, opts);
  if (status === 503) return new ApiError('unavailable', message, opts);
  return new ApiError('server', message, opts);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function checkMeta(j: unknown): void {
  if (!isObj(j) || !Array.isArray(j.features) || !Array.isArray(j.targets) || !Array.isArray(j.risk_bands) || !Array.isArray(j.groups)) {
    throw new Error('/meta is missing features, groups, targets or risk_bands.');
  }
}

function checkPrediction(j: unknown, mode: PredictMode): void {
  if (!isObj(j) || !isObj(j.targets) || !isObj(j.physiology) || !isObj(j.input)) {
    throw new Error('The prediction is missing targets, physiology or input.');
  }
  for (const [id, t] of Object.entries(j.targets)) {
    if (!isObj(t) || typeof t.probability !== 'number' || typeof t.band !== 'string') throw new Error(`Target ${id} has no probability or band.`);
    if (mode === 'full' && (!isObj(t.shap) || !isObj(t.counterfactual) || !isObj(t.uncertainty))) {
      throw new Error(`Target ${id} is missing shap, uncertainty or counterfactual.`);
    }
  }
}
