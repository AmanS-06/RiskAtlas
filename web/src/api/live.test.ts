import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiProvider } from './client';
import { ApiError } from './errors';
import { LivePredictor } from './live';
import { mockPredict } from './mock';
import type { Inputs, PredictMode } from './types';

interface Call {
  mode: PredictMode;
  inputs: Inputs;
  signal: AbortSignal;
  resolve: () => void;
  reject: (e: unknown) => void;
}

/** A provider whose replies the test releases by hand, to control ordering. */
function manual() {
  const calls: Call[] = [];
  const provider: ApiProvider = {
    kind: 'mock',
    getMeta: () => Promise.reject(new Error('unused')),
    predict: (mode, inputs, signal) =>
      new Promise((res, rej) => {
        const call: Call = {
          mode,
          inputs,
          signal: signal!,
          resolve: () => res(mockPredict(mode, inputs) as never),
          reject: rej,
        };
        calls.push(call);
        signal?.addEventListener('abort', () => rej(new ApiError('aborted', 'cancelled')));
      }),
  };
  return { provider, calls };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('LivePredictor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(opts = {}) {
    const m = manual();
    const log = { fast: [] as number[], full: [] as number[], errors: [] as string[] };
    const live = new LivePredictor(
      m.provider,
      { onFast: (_p, v) => log.fast.push(v), onFull: (_p, v) => log.full.push(v), onError: (e, mode) => log.errors.push(`${mode}:${e.kind}`) },
      { debounceMs: 150, maxWaitMs: 300, ...opts },
    );
    return { ...m, log, live };
  }

  it('collapses a burst of 25 edits into one fast request carrying the final value', async () => {
    const { live, calls } = setup();
    for (let i = 0; i < 25; i++) {
      live.preview({ bp: 100 + i });
      await vi.advanceTimersByTimeAsync(30);
    }
    // 25 edits 30 ms apart span 750 ms, so the max-wait fires in between; the last request must carry bp 124
    await vi.advanceTimersByTimeAsync(200);
    expect(calls.length).toBeLessThanOrEqual(4);
    expect(calls.at(-1)?.inputs).toEqual({ bp: 124 });
    expect(calls.every((c) => c.mode === 'fast')).toBe(true);
  });

  it('a quiet burst sends exactly one request', async () => {
    const { live, calls } = setup();
    live.preview({ bp: 1 });
    live.preview({ bp: 2 });
    live.preview({ bp: 3 });
    await vi.advanceTimersByTimeAsync(149);
    expect(calls.length).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(calls.length).toBe(1);
    expect(calls[0]?.inputs).toEqual({ bp: 3 });
  });

  it('keeps sending previews during a continuous drag (max wait)', async () => {
    const { live, calls } = setup();
    for (let i = 0; i < 20; i++) {
      live.preview({ bp: i });
      await vi.advanceTimersByTimeAsync(50); // never quiet for 150 ms
    }
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('cancels a stale in-flight preview when a newer one is sent', async () => {
    const { live, calls } = setup();
    live.preview({ bp: 1 });
    await vi.advanceTimersByTimeAsync(160);
    live.preview({ bp: 2 });
    await vi.advanceTimersByTimeAsync(160);
    expect(calls.length).toBe(2);
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(calls[1]?.signal.aborted).toBe(false);
  });

  it('drops out-of-order replies: a slow older preview never overwrites a newer one', async () => {
    const { live, calls, log } = setup();
    live.preview({ bp: 1 });
    await vi.advanceTimersByTimeAsync(160);
    live.preview({ bp: 2 });
    await vi.advanceTimersByTimeAsync(160);
    calls[1]!.resolve(); // newer reply first
    await flush();
    calls[0]!.resolve(); // older reply after (it was aborted, and would be dropped even if not)
    await flush();
    expect(log.fast).toEqual([2]);
  });

  it('drops an older fast reply that arrives after a newer one was applied (no abort involved)', async () => {
    const { live, calls, log } = setup();
    live.preview({ bp: 1 });
    await vi.advanceTimersByTimeAsync(160);
    const first = calls[0]!;
    // simulate a transport that ignores abort: reply later anyway
    live.preview({ bp: 2 });
    await vi.advanceTimersByTimeAsync(160);
    calls[1]!.resolve();
    await flush();
    first.resolve();
    await flush();
    expect(log.fast).toEqual([2]);
  });

  it('commit sends the full request immediately and cancels pending and in-flight previews', async () => {
    const { live, calls } = setup();
    live.preview({ bp: 1 });
    await vi.advanceTimersByTimeAsync(160);
    live.preview({ bp: 2 }); // pending, not sent yet
    live.commit({ bp: 3 });
    expect(calls.map((c) => c.mode)).toEqual(['fast', 'full']);
    expect(calls[0]?.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.length).toBe(2); // the pending preview was cancelled, not sent
  });

  it('a full reply is shown only if nothing newer was entered since', async () => {
    const { live, calls, log } = setup();
    live.commit({ bp: 3 });
    live.preview({ bp: 4 }); // user moves a slider again while the full request runs
    expect(calls[0]?.signal.aborted).toBe(true); // a stale full is cancelled
    calls[0]!.resolve();
    await flush();
    expect(log.full).toEqual([]);
  });

  it('a late full reply for older inputs is dropped even if the transport ignores abort', async () => {
    const { live, calls, log } = setup();
    live.commit({ bp: 3 });
    const staleFull = calls[0]!;
    live.commit({ bp: 5 });
    calls[1]!.resolve();
    await flush();
    staleFull.resolve();
    await flush();
    expect(log.full).toEqual([2]);
  });

  it('does not apply a fast reply once a full reply for the same or newer inputs is shown', async () => {
    const { live, calls, log } = setup();
    live.preview({ bp: 1 });
    await vi.advanceTimersByTimeAsync(160);
    const fast = calls[0]!;
    live.commit({ bp: 1 });
    calls[1]!.resolve();
    await flush();
    fast.resolve();
    await flush();
    expect(log.full.length).toBe(1);
    expect(log.fast).toEqual([]);
  });

  it('reports real errors but not cancellations or errors for superseded requests', async () => {
    const { live, calls, log } = setup();
    live.commit({ bp: 1 });
    calls[0]!.reject(new ApiError('network', 'down'));
    await flush();
    expect(log.errors).toEqual(['full:network']);
    live.commit({ bp: 2 });
    live.commit({ bp: 3 }); // aborts the previous
    await flush();
    expect(log.errors).toEqual(['full:network']);
  });

  it('cancel() stops everything', async () => {
    const { live, calls } = setup();
    live.preview({ bp: 1 });
    live.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.length).toBe(0);
  });
});
