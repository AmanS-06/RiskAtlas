import type { PaletteMode } from './palette';
import { MOCK_LABEL } from './constants';

interface Props {
  mock: boolean;
  onLive?: () => void;
  palette: PaletteMode;
  onPalette: (m: PaletteMode) => void;
  theme: 'system' | 'light' | 'dark';
  onTheme: (t: 'system' | 'light' | 'dark') => void;
}

const NEXT = { system: 'light', light: 'dark', dark: 'system' } as const;
const THEME_LABEL = { system: 'System', light: 'Light', dark: 'Dark' } as const;

export function SiteHeader({ mock, onLive, palette, onPalette, theme, onTheme }: Props) {
  return (
    <header className="site-header">
      <div className="brand">
        <h1>RiskAtlas</h1>
        <p>Coronary risk map and explainable dashboard</p>
      </div>
      <div className="header-tools">
        {mock && (
          <span className="mock-chip" role="status" data-testid="mock-chip">
            {MOCK_LABEL}
            {onLive && (
              <button type="button" className="link-button" onClick={onLive}>
                Use live API
              </button>
            )}
          </span>
        )}
        <button
          type="button"
          className="tool-button"
          aria-pressed={palette === 'safe'}
          onClick={() => onPalette(palette === 'safe' ? 'config' : 'safe')}
          title="Swap the risk colours for a palette that stays distinguishable in colour-blind vision"
        >
          Colour-blind safe palette: {palette === 'safe' ? 'on' : 'off'}
        </button>
        <button
          type="button"
          className="tool-button"
          onClick={() => onTheme(NEXT[theme])}
          aria-label={`Theme: ${THEME_LABEL[theme]}. Activate to switch to ${THEME_LABEL[NEXT[theme]]}.`}
        >
          Theme: {THEME_LABEL[theme]}
        </button>
      </div>
    </header>
  );
}
