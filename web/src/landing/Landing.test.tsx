import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DISCLAIMER } from '../shared/constants';
import reliability from '../app/reliability.json';
import { Landing } from './Landing';

describe('landing page', () => {
  it('shows the disclaimer, a way into the workspace and one h1', () => {
    render(<Landing />);
    expect(screen.getByTestId('disclaimer-banner')).toHaveTextContent(DISCLAIMER);
    const cta = screen.getByTestId('cta-open');
    expect(cta).toHaveAttribute('href', '#/app');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('reports the validation numbers from the generated data, weak vessels included and flagged', () => {
    render(<Landing />);
    const section = screen.getByRole('region', { name: /where it is strong/i });
    for (const k of ['CAD', 'LAD', 'LCX', 'RCA'] as const) {
      expect(within(section).getByText(reliability.overall[k].auc.toFixed(2))).toBeInTheDocument();
    }
    expect(within(section).getAllByText(/read the colour as coarse/i)).toHaveLength(2);
    expect(within(section).getByText(/per artery, not per lesion/i)).toBeInTheDocument();
    expect(section).toHaveTextContent(`${reliability.patients} angiography patients`);
  });

  it('says it is a research prototype, not a medical device', () => {
    render(<Landing />);
    expect(screen.getByRole('region', { name: /research prototype/i })).toHaveTextContent(/not a substitute for formal diagnostic imaging/i);
  });
});
