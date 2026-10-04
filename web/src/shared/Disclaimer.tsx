import { DISCLAIMER } from './constants';

/** The persistent banner. Not dismissible, always at the top of the viewport (see layout.css). */
export function DisclaimerBanner() {
  return (
    <aside className="disclaimer-banner" aria-label="Clinical safety disclaimer" data-testid="disclaimer-banner">
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
