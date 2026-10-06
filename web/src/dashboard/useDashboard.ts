import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  LivePredictor,
  createProvider,
  mockRequested,
  type ApiProvider,
  type FastPrediction,
  type FullPrediction,
  type Meta,
  type TargetMeta,
} from '../api';
import { bandInfos, type PaletteMode } from '../shared/palette';
import { readPref, writePref } from '../shared/storage';
import { byGroup, parseForm, rawFrom, specs, type FieldSpec, type Raw } from './form';
import presetsFile from './presets.json';

export interface Preset {
  id: string;
  label: string;
  summary: string;
  values: Record<string, number>;
}

export const PRESETS = presetsFile as Preset[];

type MetaState = { status: 'loading' } | { status: 'ready'; meta: Meta } | { status: 'error'; error: ApiError };
type MetaResult = { key: string; state: MetaState };

export interface Shown {
  fast: { prediction: FastPrediction; version: number } | null;
  full: { prediction: FullPrediction; version: number } | null;
}

export type ThemePref = 'system' | 'light' | 'dark';

function initialPalette(): PaletteMode {
  return readPref('palette') === 'safe' ? 'safe' : 'config';
}

function initialTheme(): ThemePref {
  const t = readPref('theme');
  return t === 'light' || t === 'system' ? t : 'dark';
}

export function applyTheme(t: ThemePref): void {
  if (typeof document === 'undefined') return;
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

export function useDashboard() {
  const [mock, setMock] = useState(() => mockRequested());
  const provider: ApiProvider = useMemo(() => createProvider(mock), [mock]);
  const [metaResult, setMetaResult] = useState<MetaResult | null>(null);
  const [raw, setRaw] = useState<Raw>({});
  const rawRef = useRef<Raw>({});
  const [presetId, setPresetId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown>({ fast: null, full: null });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState({ fast: false, full: false });
  const [dirty, setDirty] = useState(false);
  const [paletteMode, setPaletteModeState] = useState<PaletteMode>(initialPalette);
  const [theme, setThemeState] = useState<ThemePref>(initialTheme);
  const predictor = useRef<LivePredictor | null>(null);
  const [metaTry, setMetaTry] = useState(0);
  const metaKey = `${mock ? 'mock' : 'http'}-${metaTry}`;
  const metaState: MetaState = metaResult?.key === metaKey ? metaResult.state : { status: 'loading' };

  useEffect(() => applyTheme(theme), [theme]);

  // Meta: the whole UI is built from it.
  useEffect(() => {
    const ctl = new AbortController();
    provider
      .getMeta(ctl.signal)
      .then((meta) => {
        setMetaResult({ key: metaKey, state: { status: 'ready', meta } });
        setSelected((cur) => cur ?? (meta.targets.find((t) => t.kind === 'overall') ?? meta.targets[0])?.id ?? null);
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        setMetaResult({ key: metaKey, state: { status: 'error', error: e instanceof ApiError ? e : new ApiError('server', String(e)) } });
      });
    return () => ctl.abort();
  }, [provider, metaKey]);

  const meta = metaState.status === 'ready' ? metaState.meta : null;
  const fieldSpecs: FieldSpec[] = useMemo(() => (meta ? specs(meta) : []), [meta]);
  const fieldSpecsRef = useRef(fieldSpecs);
  useEffect(() => {
    fieldSpecsRef.current = fieldSpecs;
  }, [fieldSpecs]);
  const lastCommitted = useRef('');
  const groups = useMemo(() => (meta ? byGroup(fieldSpecs, meta.groups) : []), [meta, fieldSpecs]);
  const parsed = useMemo(() => parseForm(fieldSpecs, raw), [fieldSpecs, raw]);

  // One predictor per provider.
  useEffect(() => {
    const p = new LivePredictor(provider, {
      onFast: (prediction, version) => {
        setShown((s) => ({ ...s, fast: { prediction, version } }));
        setError(null);
      },
      onFull: (prediction, version) => {
        setShown({ fast: null, full: { prediction, version } });
        setDirty(false);
        setError(null);
      },
      onError: (e) => setError(e),
      onBusy: setBusy,
    });
    predictor.current = p;
    return () => {
      p.dispose();
      predictor.current = null;
    };
  }, [provider]);

  const clearResults = useCallback(() => {
    predictor.current?.cancel();
    setShown({ fast: null, full: null });
    setDirty(false);
    setError(null);
  }, []);

  const run = useCallback(
    (next: Raw, mode: 'preview' | 'commit', force = true) => {
      const p = parseForm(fieldSpecsRef.current, next);
      if (Object.keys(p.errors).length > 0) {
        predictor.current?.cancel(); // never send a half-valid record
        lastCommitted.current = '';
        return;
      }
      if (p.filled === 0) {
        lastCommitted.current = '';
        clearResults();
        return;
      }
      if (mode === 'preview') {
        setDirty(true);
        predictor.current?.preview(p.inputs);
        return;
      }
      // Tabbing through fields must not re-run the full model when nothing changed since the last full request.
      const key = JSON.stringify(p.inputs);
      if (!force && key === lastCommitted.current) return;
      lastCommitted.current = key;
      setDirty(true);
      predictor.current?.commitWithPreview(p.inputs);
    },
    [clearResults],
  );

  const setField = useCallback(
    (name: string, value: string, mode: 'preview' | 'commit' | 'none' = 'commit') => {
      const next = { ...rawRef.current };
      if (value === '') delete next[name];
      else next[name] = value;
      rawRef.current = next;
      setRaw(next);
      setPresetId(null);
      if (mode !== 'none') run(next, mode);
    },
    [run],
  );

  /** force: the Predict button. Without it, a blur that changed nothing sends nothing. */
  const commit = useCallback((force = false) => run(rawRef.current, 'commit', force), [run]);

  const loadPreset = useCallback(
    (id: string) => {
      const preset = PRESETS.find((p) => p.id === id);
      if (!preset) return;
      // Only features the API knows; anything else would be reported as ignored.
      const known = new Set(fieldSpecsRef.current.map((s) => s.feature.name));
      const values = Object.fromEntries(Object.entries(preset.values).filter(([k]) => known.has(k)));
      const next = rawFrom(values, fieldSpecsRef.current);
      rawRef.current = next;
      setRaw(next);
      setPresetId(id);
      run(next, 'commit');
    },
    [run],
  );

  const reset = useCallback(() => {
    rawRef.current = {};
    lastCommitted.current = '';
    setRaw({});
    setPresetId(null);
    clearResults();
  }, [clearResults]);

  const setPalette = useCallback((m: PaletteMode) => {
    setPaletteModeState(m);
    writePref('palette', m);
  }, []);

  const setTheme = useCallback((t: ThemePref) => {
    setThemeState(t);
    writePref('theme', t);
  }, []);

  const useMock = useCallback((on: boolean) => {
    predictor.current?.cancel();
    setShown({ fast: null, full: null });
    setError(null);
    setMock(on);
  }, []);

  // What is on screen: the newest of the two replies.
  const latest = useMemo(() => {
    const { fast, full } = shown;
    if (fast && (!full || fast.version > full.version)) return { prediction: fast.prediction as FastPrediction | FullPrediction, kind: 'preview' as const };
    if (full) return { prediction: full.prediction as FastPrediction | FullPrediction, kind: 'full' as const };
    return null;
  }, [shown]);
  const full = shown.full?.prediction ?? null;
  const explanationStale = !!full && dirty;

  const bands = useMemo(() => (meta ? bandInfos(meta, paletteMode) : []), [meta, paletteMode]);
  const vessels: TargetMeta[] = useMemo(() => meta?.targets.filter((t) => t.mesh) ?? [], [meta]);
  const overall: TargetMeta | null = useMemo(() => meta?.targets.find((t) => !t.mesh) ?? null, [meta]);

  return {
    mock,
    useMock,
    provider,
    metaState,
    retryMeta: () => setMetaTry((n) => n + 1),
    meta,
    fieldSpecs,
    groups,
    raw,
    parsed,
    presetId,
    setField,
    commit,
    loadPreset,
    reset,
    selected,
    select: setSelected,
    prediction: latest?.prediction ?? null,
    predictionKind: latest?.kind ?? null,
    full,
    explanationStale,
    error,
    busy,
    bands,
    vessels,
    overall,
    paletteMode,
    setPalette,
    theme,
    setTheme,
  };
}

export type Dashboard = ReturnType<typeof useDashboard>;
