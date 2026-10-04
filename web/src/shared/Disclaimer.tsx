import { useRef } from 'react';
import { DISCLAIMER } from './constants';
import { useCssHeight } from './useCssHeight';

/** The persistent banner. Not dismissible, always at the top of the viewport (see layout.css). */
export function DisclaimerBanner() {
  const ref = useRef<HTMLElement>(null);
  useCssHeight(ref, '--banner-h'); // sticky offsets elsewhere (viewer column, tab bar) start below the banner
  return (
    <aside ref={ref} className="disclaimer-banner" aria-label="Clinical safety disclaimer" data-testid="disclaimer-banner">
      <strong className="disclaimer-tag">Not for clinical use</strong>
      <p>{DISCLAIMER}</p>
    </aside>
  );
}

/** The repeat in the results panel footer. */
export function DisclaimerNote() {
  return (
    <p className="disclaimer-note" data-testid="disclaimer-note">
      <strong>Clinical safety:</strong> {DISCLAIMER}
    </p>
  );
}
