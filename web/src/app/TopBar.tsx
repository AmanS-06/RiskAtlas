import { useRef } from 'react';
import { MOCK_LABEL } from '../shared/constants';
import { useCssHeight } from '../shared/useCssHeight';
import type { Dashboard, ThemePref } from '../dashboard/useDashboard';

const NEXT: Record<ThemePref, ThemePref> = { dark: 'light', light: 'system', system: 'dark' };
const LABEL: Record<ThemePref, string> = { dark: 'Dark', light: 'Light', system: 'System' };

/** Brand, the mock-data flag, the colour-blind palette switch and the theme switch. */
export function TopBar({ d }: { d: Dashboard }) {
  const ref = useRef<HTMLElement>(null);
  useCssHeight(ref, '--header-h');
  return (
    <header ref={ref} className="topbar">
      <div className="brandmark">
        <h1>
          <a href="#/">RiskAtlas</a>
        </h1>
        <span>Coronary risk map</span>
      </div>
      <div className="topbar-tools">
        {d.mock && (
          <span className="mock-chip" role="status" data-testid="mock-chip">
            {MOCK_LABEL}
            <button type="button" className="link-button" onClick={() => d.useMock(false)}>
              Use live API
            </button>
          </span>
        )}
        <button
          type="button"
          className="btn"
          aria-pressed={d.paletteMode === 'safe'}
          onClick={() => d.setPalette(d.paletteMode === 'safe' ? 'config' : 'safe')}
          title="Swap the risk colours for a palette that stays distinguishable in colour-blind vision"
        >
          Colour-blind palette: {d.paletteMode === 'safe' ? 'on' : 'off'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => d.setTheme(NEXT[d.theme])}
          aria-label={`Theme: ${LABEL[d.theme]}. Activate to switch to ${LABEL[NEXT[d.theme]]}.`}
        >
          Theme: {LABEL[d.theme]}
        </button>
      </div>
    </header>
  );
}
