import { describe, expect, it, vi } from 'vitest';
import { HttpProvider, mapHttpError } from './client';
import { ApiError } from './errors';
import { mockPredict } from './mock';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const full = () => JSON.parse(JSON.stringify(mockPredict('full', { age: 65 })));
const fast = () => JSON.parse(JSON.stringify(mockPredict('fast', { age: 65 })));

function provider(fetchImpl: typeof fetch, timeoutMs = { meta: 1000, fast: 1000, full: 1000 }) {
  return new HttpProvider('/api/', { fetchImpl, timeoutMs });
}

describe('HttpProvider requests', () => {
  it('posts a flat dict of canonical names, drops blanks, and uses the right path per mode', async () => {
    const f = vi.fn(async () => json(fast()));
    const p = provider(f as unknown as typeof fetch);
    await p.predict('fast', { age: 65, bmi: null, dm: 1 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/predict/fast');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ age: 65, dm: 1 });
    f.mockResolvedValueOnce(json(full()));
    await p.predict('full', { age: 65 });
    expect((f.mock.calls[1] as unknown as [string])[0]).toBe('/api/predict');
  });

  it('GETs /meta and rejects a reply that is not a meta document', async () => {
    const f = vi.fn(async () => json({ nope: true }));
    await expect(provider(f as unknown as typeof fetch).getMeta()).rejects.toMatchObject({ kind: 'bad_response' });
  });

  it('rejects a full prediction without shap', async () => {
    const p = fast(); // fast payload has no shap/uncertainty/counterfactual
    const f = vi.fn(async () => json(p));
    await expect(provider(f as unknown as typeof fetch).predict('full', { age: 1 })).rejects.toMatchObject({ kind: 'bad_response' });
  });

  it('accepts a fast prediction without shap', async () => {
    const f = vi.fn(async () => json(fast()));
    const out = await provider(f as unknown as typeof fetch).predict('fast', { age: 1 });
    expect(Object.keys(out.targets)).toContain('CAD');
  });
});

describe('error mapping', () => {
  const env = (code: string, message: string, details?: unknown) => ({ error: { code, message, details } });

  it('422 validation keeps the server message and per-field details', () => {
    const e = mapHttpError(422, env('validation_error', 'Invalid request. bp: must be a number', [{ field: 'bp', message: 'must be a number' }]));
    expect(e.kind).toBe('validation');
    expect(e.status).toBe(422);
    expect(e.message).toBe('Invalid request. bp: must be a number');
    expect(e.details).toEqual([{ field: 'bp', message: 'must be a number' }]);
    expect(e.transient).toBe(false);
  });

  it('422 leakage is its own kind', () => {
    expect(mapHttpError(422, env('leakage', 'Label columns cannot be used as inputs')).kind).toBe('leakage');
  });

  it('503 means models unavailable and is worth retrying', () => {
    const e = mapHttpError(503, env('models_unavailable', 'Models are not loaded'));
    expect(e.kind).toBe('unavailable');
    expect(e.code).toBe('models_unavailable');
    expect(e.transient).toBe(true);
  });

  it('500 and unknown statuses are server errors; non-JSON bodies still map', () => {
    expect(mapHttpError(500, env('internal_error', 'boom')).kind).toBe('server');
    expect(mapHttpError(502, null).message).toContain('502');
  });

  it('understands the stock FastAPI {detail} shape', () => {
    const e = mapHttpError(422, { detail: [{ msg: 'field required' }] });
    expect(e.details[0]?.message).toBe('field required');
  });

  it('maps HTTP errors end to end', async () => {
    const f = vi.fn(async () => json(env('models_unavailable', 'down'), 503));
    await expect(provider(f as unknown as typeof fetch).predict('full', { age: 1 })).rejects.toMatchObject({ kind: 'unavailable', status: 503 });
  });

  it('maps a rejected fetch to a network error', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(provider(f as unknown as typeof fetch).getMeta()).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('timeout and cancellation', () => {
  const hanging = (() =>
    vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))),
    )) as () => ReturnType<typeof vi.fn>;

  it('times out', async () => {
    const p = provider(hanging() as unknown as typeof fetch, { meta: 30, fast: 30, full: 30 });
    await expect(p.predict('fast', { age: 1 })).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('reports a cancelled request as aborted, not as a network failure', async () => {
    const p = provider(hanging() as unknown as typeof fetch);
    const ctl = new AbortController();
    const pending = p.predict('full', { age: 1 }, ctl.signal);
    ctl.abort();
    const err = await pending.catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe('aborted');
  });
});
