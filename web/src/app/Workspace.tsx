import { useCallback, useEffect, useState } from 'react';
import type { Counterfactual, FastPrediction } from '../api';
import { errorTitle } from '../api';
import type { AtlasStyle } from '../atlas/AtlasViewer';
import { AboutPanel, ExplanationPanel, PhysiologyPanel, WhatIfPanel } from '../dashboard/analysis';
import { ResultsPanel } from '../dashboard/ResultsPanel';
import { Tabs } from '../dashboard/Tabs';
import { useDashboard } from '../dashboard/useDashboard';
import { DisclaimerBanner } from '../shared/Disclaimer';
import { TopBar } from './TopBar';
import { readPref, writePref } from '../shared/storage';
import { Intake } from './Intake';
import { Stage } from './Stage';
import assetsText from '../../../ASSETS_AND_LICENSES.md?raw';
import './app.css';

const TABS = [
  { id: 'explain', label: 'Explanation' },
  { id: 'physiology', label: 'Physiology' },
  { id: 'whatif', label: 'What-if' },
  { id: 'about', label: 'About' },
];

function initialLook(): AtlasStyle {
  return readPref('look') === 'real' ? 'real' : 'holo';
}

export function Workspace() {
  const d = useDashboard();
  const [tab, setTab] = useState('explain');
  const [region, setRegion] = useState<string | null>(null);
  const [look, setLook] = useState<AtlasStyle>(initialLook);
  const [territory, setTerritory] = useState(true);
  const [focus, setFocus] = useState(false);
  const [rails, setRails] = useState<{ left: boolean; right: boolean }>(() => {
    const saved = readPref('rails');
    return saved === null ? { left: true, right: true } : { left: saved.includes('l'), right: saved.includes('r') };
  });
  const toggleRail = useCallback((side: 'left' | 'right') => {
    setRails((r) => {
      const next = { ...r, [side]: !r[side] };
      writePref('rails', `${next.left ? 'l' : ''}${next.right ? 'r' : ''}`);
      return next;
    });
  }, []);
  const [ghostState, setGhost] = useState<{ changes: Counterfactual['changes']; pred: FastPrediction | null; key: string } | null>(null);
  const rawKey = JSON.stringify(d.raw);
  const ghost = ghostState && ghostState.key === rawKey ? ghostState : null; // any edit of the patient ends the preview
  const { meta } = d;

  const changeLook = useCallback((s: AtlasStyle) => {
    setLook(s);
    writePref('look', s);
  }, []);

  // a region touched on the heart selects the target it explains; a target picked in the results selects its region
  const onRegion = useCallback(
    (id: string | null) => {
      setRegion(id);
      if (!meta) return;
      const vessel = id ? d.vessels.find((v) => v.mesh === id) : undefined;
      const target = vessel ?? d.overall;
      if (target) d.select(target.id);
    },
    [meta, d],
  );
  const onTarget = useCallback(
    (targetId: string) => {
      d.select(targetId);
      const t = meta?.targets.find((x) => x.id === targetId);
      setRegion(t?.mesh ?? null);
    },
    [d, meta],
  );

  // what-if on the heart: the same patient with the suggested changes, predicted by the fast model, drawn instead of the current one
  const previewChanges = useCallback(
    (changes: Counterfactual['changes'] | null) => {
      if (!changes) {
        setGhost(null);
        return;
      }
      setGhost({ changes, pred: null, key: rawKey });
      const inputs = { ...d.parsed.inputs };
      for (const c of changes) inputs[c.feature] = c.to;
      d.provider
        .predict('fast', inputs)
        .then((pred) => setGhost((g) => (g && g.changes === changes ? { ...g, pred } : g)))
        .catch(() => setGhost(null));
    },
    [d.provider, d.parsed.inputs, rawKey],
  );

  const applyChanges = useCallback(
    (changes: Counterfactual['changes']) => {
      changes.forEach((c, i) => d.setField(c.feature, String(c.to), i === changes.length - 1 ? 'commit' : 'none'));
    },
    [d],
  );

  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocus(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [focus]);

  // [ folds the patient panel, ] the results panel (not while typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '[') toggleRail('left');
      if (e.key === ']') toggleRail('right');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggleRail]);

  const analysis = d.meta && {
    meta: d.meta,
    bands: d.bands,
    prediction: d.prediction,
    full: d.full,
    stale: d.explanationStale,
    selected: d.selected,
    onSelect: onTarget,
    specs: d.fieldSpecs,
    raw: d.raw,
  };

  return (
    <div className="app">
      <DisclaimerBanner />
      <TopBar d={d} />
      {d.metaState.status === 'loading' && (
        <main className="boot" aria-busy="true">
          <p role="status">Loading model configuration…</p>
        </main>
      )}
      {d.metaState.status === 'error' && (
        <main className="boot">
          <div className="notice notice-error" role="alert" data-testid="meta-error">
            <h2>{errorTitle(d.metaState.error)}</h2>
            <p>{d.metaState.error.message}</p>
            <p>The workspace builds itself from the API (GET /meta), so it cannot start without it.</p>
            <div className="form-actions">
              <button type="button" className="btn btn-primary" onClick={d.retryMeta}>
                Retry
              </button>
              <button type="button" className="btn" onClick={() => d.useMock(true)} data-testid="use-mock">
                Use mock data instead
              </button>
            </div>
            <p className="hint">Mock data is a fixed example payload, flagged on every screen. It is never a real prediction.</p>
          </div>
        </main>
      )}
      {meta && analysis && (
        <main className={`ws${focus ? ' is-focus' : ''}${rails.left ? '' : ' no-left'}${rails.right ? '' : ' no-right'}`} id="main">
          <aside className="rail rail-left" aria-label="Patient" inert={!rails.left}>
            <Intake d={d} />
          </aside>
          <Stage
            d={d}
            ghost={ghost?.pred ?? null}
            onGhostClear={() => setGhost(null)}
            region={region}
            onRegion={onRegion}
            style={look}
            onStyle={changeLook}
            territory={territory}
            onTerritory={setTerritory}
            enlarged={focus}
            leftOpen={rails.left}
            rightOpen={rails.right}
            onToggleLeft={() => toggleRail('left')}
            onToggleRight={() => toggleRail('right')}
            onEnlarge={() => setFocus((v) => !v)}
          />
          <aside className="rail rail-right" aria-label="Results" inert={!rails.right}>
            <ResultsPanel
              meta={meta}
              bands={d.bands}
              overall={d.overall}
              vessels={d.vessels}
              prediction={d.prediction}
              full={d.full}
              kind={d.predictionKind}
              stale={d.explanationStale}
              busy={d.busy}
              error={d.error}
              selected={d.selected}
              onSelect={onTarget}
              paused={Object.keys(d.parsed.errors).length > 0}
              onRetry={() => d.commit(true)}
            />
            <Tabs
              label="Analysis"
              tabs={TABS}
              active={tab}
              onChange={setTab}
              keepMounted
              panels={{
                explain: <ExplanationPanel {...analysis} />,
                physiology: <PhysiologyPanel {...analysis} />,
                whatif: <WhatIfPanel {...analysis} onApply={applyChanges} onPreview={previewChanges} previewing={!!ghost} />,
                about: <AboutPanel meta={meta} bands={d.bands} assets={assetsText} />,
              }}
            />
          </aside>
        </main>
      )}
    </div>
  );
}
