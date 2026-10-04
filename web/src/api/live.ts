import type { ApiProvider } from './client';
import { ApiError, isAbort } from './errors';
import type { FastPrediction, FullPrediction, Inputs } from './types';

export interface LiveOptions {
  /** Quiet time after the last edit before a fast preview is sent. */
  debounceMs?: number;
  /** While edits keep arriving (a slider drag), a preview is still sent at least this often. */
  maxWaitMs?: number;
}

export interface LiveEvents {
  onFast?: (p: FastPrediction, version: number) => void;
  onFull?: (p: FullPrediction, version: number) => void;
  onError?: (e: ApiError, mode: 'fast' | 'full') => void;
  /** Called whenever the number of requests in flight or waiting changes. */
  onBusy?: (busy: { fast: boolean; full: boolean }) => void;
}

/**
 * Drives the two prediction paths from one stream of edits (docs/ml_interface.md section 4).
 *   preview(inputs)  while a control is dragged or typed into: debounced POST /predict/fast.
 *   commit(inputs)   on release, blur or submit: immediate POST /predict (full).
 * Every call takes a version number. A request is cancelled as soon as a newer one of the same kind starts, a
 * preview also cancels a full request that is now stale, and a reply is dropped unless it is newer than what is
 * already shown, so replies that arrive out of order never overwrite fresher data.
 */
export class LivePredictor {
  private version = 0;
  private appliedFast = 0;
  private appliedFull = 0;
  private fastCtl: AbortController | null = null;
  private fullCtl: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstPending = 0;
  private pending: Inputs | null = null;
  private disposed = false;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;

  constructor(
    private readonly provider: ApiProvider,
    private readonly events: LiveEvents,
    opts: LiveOptions = {},
  ) {
    this.debounceMs = opts.debounceMs ?? 150;
    this.maxWaitMs = opts.maxWaitMs ?? 300;
  }

  get latestVersion(): number {
    return this.version;
  }

  preview(inputs: Inputs): void {
    this.version += 1;
    this.pending = inputs;
    // A full reply for older inputs can no longer be shown: stop waiting for it.
    this.abortFull();
    const now = Date.now();
    if (this.timer === null) this.firstPending = now;
    else clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(this.debounceMs, this.firstPending + this.maxWaitMs - now));
    this.timer = setTimeout(() => this.flush(), wait);
    this.emitBusy();
  }

  commit(inputs: Inputs): void {
    this.version += 1;
    this.clearTimer();
    this.pending = null;
    this.abortFast();
    this.abortFull();
    this.run('full', inputs, this.version);
    this.emitBusy();
  }

  cancel(): void {
    this.version += 1;
    this.clearTimer();
    this.pending = null;
    this.abortFast();
    this.abortFull();
    this.emitBusy();
  }

  dispose(): void {
    this.cancel();
    this.disposed = true;
  }

  private flush(): void {
    this.timer = null;
    const inputs = this.pending;
    this.pending = null;
    if (!inputs) return;
    this.abortFast();
    this.run('fast', inputs, this.version);
    this.emitBusy();
  }

  private run(mode: 'fast' | 'full', inputs: Inputs, version: number): void {
    const ctl = new AbortController();
    if (mode === 'fast') this.fastCtl = ctl;
    else this.fullCtl = ctl;
    this.provider
      .predict(mode, inputs, ctl.signal)
      .then((p) => {
        if (this.disposed || ctl.signal.aborted) return;
        if (mode === 'fast') {
          if (version <= this.appliedFast || version <= this.appliedFull) return;
          this.appliedFast = version;
          this.events.onFast?.(p as FastPrediction, version);
        } else {
          // A full result describes exactly the inputs it was sent with: show it only if nothing newer was entered.
          if (version !== this.version || version <= this.appliedFull) return;
          this.appliedFull = version;
          this.events.onFull?.(p as FullPrediction, version);
        }
      })
      .catch((e: unknown) => {
        if (this.disposed || ctl.signal.aborted || isAbort(e)) return;
        if (mode === 'full' && version !== this.version) return;
        if (mode === 'fast' && version < this.appliedFast) return;
        this.events.onError?.(e instanceof ApiError ? e : new ApiError('server', String(e)), mode);
      })
      .finally(() => {
        if (mode === 'fast' && this.fastCtl === ctl) this.fastCtl = null;
        if (mode === 'full' && this.fullCtl === ctl) this.fullCtl = null;
        this.emitBusy();
      });
  }

  private abortFast(): void {
    this.fastCtl?.abort();
    this.fastCtl = null;
  }

  private abortFull(): void {
    this.fullCtl?.abort();
    this.fullCtl = null;
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private emitBusy(): void {
    this.events.onBusy?.({ fast: this.timer !== null || this.fastCtl !== null, full: this.fullCtl !== null });
  }
}
