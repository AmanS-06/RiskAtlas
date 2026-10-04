import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabDef {
  id: string;
  label: string;
  badge?: string;
}

interface Props {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
  label: string;
  children?: ReactNode;
  className?: string;
  /** Keep every panel mounted (hidden) so inputs and scroll positions survive tab switches. */
  keepMounted?: boolean;
  panels?: Record<string, ReactNode>;
}

/** WAI-ARIA tabs with arrow-key roving focus. */
export function Tabs({ tabs, active, onChange, label, children, className, keepMounted, panels }: Props) {
  const uid = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === active);
    let n = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = tabs.length - 1;
    else return;
    e.preventDefault();
    const t = tabs[n]!;
    onChange(t.id);
    refs.current[t.id]?.focus();
  };
  return (
    <div className={className}>
      <div className="tablist" role="tablist" aria-label={label} onKeyDown={onKey}>
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`${uid}-tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`${uid}-panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            className="tab"
            onClick={() => onChange(t.id)}
            data-testid={`tab-${t.id}`}
          >
            {t.label}
            {t.badge && <span className="tab-badge">{t.badge}</span>}
          </button>
        ))}
      </div>
      {panels ? (
        tabs.map((t) =>
          keepMounted || active === t.id ? (
            <div
              key={t.id}
              role="tabpanel"
              id={`${uid}-panel-${t.id}`}
              aria-labelledby={`${uid}-tab-${t.id}`}
              hidden={active !== t.id}
              className="tabpanel"
              tabIndex={-1}
            >
              {panels[t.id]}
            </div>
          ) : null,
        )
      ) : (
        <div role="tabpanel" id={`${uid}-panel-${active}`} aria-labelledby={`${uid}-tab-${active}`} className="tabpanel">
          {children}
        </div>
      )}
    </div>
  );
}
