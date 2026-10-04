import { useCallback, useMemo, useState } from 'react';
import type { Counterfactual } from '../api';
import { errorTitle } from '../api';
import { DisclaimerBanner } from '../shared/Disclaimer';
import { SiteHeader } from '../shared/SiteHeader';
import { ViewerCanvas, type ViewerVessel } from '../shared/ViewerCanvas';
import { findBand } from '../shared/palette';
import { AboutPanel, ExplanationPanel, PhysiologyPanel, WhatIfPanel } from './analysis';
import { PatientForm } from './PatientForm';
import { ResultsPanel } from './ResultsPanel';
import { Tabs } from './Tabs';
import { useDashboard } from './useDashboard';
import assetsText from '../../../ASSETS_AND_LICENSES.md?raw';

const TABS = [
  { id: 'inputs', label: 'Inputs' },
  { id: 'explain', label: 'Explanation' },
  { id: 'physiology', label: 'Physiology' },
  { id: 'whatif', label: 'What-if' },
  { id: 'about', label: 'About' },
];

export function Dashboard() {
  const d = useDashboard();
  const [tab, setTab] = useState('inputs');
  const { meta } = d;

  const applyChanges = useCallback(
    (changes: Counterfactual['changes']) => {
      changes.forEach((c, i) => d.setField(c.feature, String(c.to), i === changes.length - 1 ? 'commit' : 'none'));
      setTab('inputs');
    },
    [d],
  );

  const viewerVessels = useMemo(() => {
    const out: Record<string, ViewerVessel> = {};
    if (!d.prediction) return out;
    for (const v of d.vessels) {
      const r = d.prediction.targets[v.id];
      const band = r && findBand(d.bands, r.band);
      if (!r || !band || !v.mesh) continue;
      const unc = d.full?.targets[v.id]?.uncertainty;
      out[v.mesh] = { probability: r.probability, band: r.band, color: band.color, uncertaintyWidth: unc ? Math.min(1, Math.max(0, unc.width)) : undefined };
    }
    return out;
  }, [d.prediction, d.full, d.vessels, d.bands]);

  const viewerOverall = useMemo(() => {
    const r = d.overall && d.prediction?.targets[d.overall.id];
    const band = r && findBand(d.bands, r.band);
    return r && band ? { probability: r.probability, band: r.band, color: band.color } : null;
  }, [d.overall, d.prediction, d.bands]);

  const meshNames = useMemo(() => d.vessels.map((v) => v.mesh!).filter(Boolean), [d.vessels]);
  const selectedMesh = d.vessels.find((v) => v.id === d.selected)?.mesh ?? null;
  const onSelectMesh = useCallback(
    (mesh: string | null) => {
      const target = mesh ? d.vessels.find((v) => v.mesh === mesh) : d.overall;
      if (target) d.select(target.id);
    },
    [d],
  );

  return (
    <div className="app">
      <DisclaimerBanner />
      <SiteHeader
        mock={d.mock}
        onLive={d.mock ? () => d.useMock(false) : undefined}
        palette={d.paletteMode}
        onPalette={d.setPalette}
        theme={d.theme}
        onTheme={d.setTheme}
      />
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
            <p>The dashboard builds itself from the API (GET /meta), so it cannot start without it.</p>
            <div className="form-actions">
              <button type="button" className="primary" onClick={d.retryMeta}>
                Retry
              </button>
              <button type="button" className="secondary" onClick={() => d.useMock(true)} data-testid="use-mock">
                Use mock data instead
              </button>
            </div>
            <p className="hint">Mock data is a fixed example payload, flagged on every screen. It is never a real prediction.</p>
          </div>
        </main>
      )}
      {meta && (
        <main className="workspace" id="main">
          <div className="stage">
            <section aria-label="3D risk map" className="panel stage-viewer">
              <ViewerCanvas vessels={viewerVessels} overall={viewerOverall} selectedMesh={selectedMesh} onSelectMesh={onSelectMesh} meshNames={meshNames} />
            </section>
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
              onSelect={d.select}
              paused={Object.keys(d.parsed.errors).length > 0}
              onRetry={() => d.commit(true)}
            />
          </div>
          <div className="workbench">
            <Tabs
              label="Dashboard sections"
              tabs={TABS}
              active={tab}
              onChange={setTab}
              keepMounted
              panels={{
                inputs: <PatientForm d={d} />,
                explain: <ExplanationPanel {...analysis(d)} />,
                physiology: <PhysiologyPanel {...analysis(d)} />,
                whatif: <WhatIfPanel {...analysis(d)} onApply={applyChanges} />,
                about: <AboutPanel meta={meta} bands={d.bands} assets={assetsText} />,
              }}
            />
          </div>
        </main>
      )}
    </div>
  );
}

function analysis(d: ReturnType<typeof useDashboard>) {
  return {
    meta: d.meta!,
    bands: d.bands,
    prediction: d.prediction,
    full: d.full,
    stale: d.explanationStale,
    selected: d.selected,
    onSelect: d.select,
    specs: d.fieldSpecs,
    raw: d.raw,
  };
}
