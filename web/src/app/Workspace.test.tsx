import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workspace } from './Workspace';
import { DISCLAIMER, MOCK_LABEL } from '../shared/constants';
import example from '../api/mock/example_prediction.json';

beforeEach(() => {
  window.history.replaceState({}, '', '/?mock=1');
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

const waitOpts = { timeout: 4000 };

async function loaded() {
  render(<Workspace />);
  await screen.findByTestId('patient-form', undefined, waitOpts);
}

/** The patient form shows one feature group at a time. */
async function openGroup(user: ReturnType<typeof userEvent.setup>, group: string) {
  await user.click(screen.getByRole('tab', { name: new RegExp(`^${group}`, 'i') }));
}

describe('page chrome', () => {
  it('shows the exact disclaimer at the top, not dismissible', async () => {
    await loaded();
    const banner = screen.getByTestId('disclaimer-banner');
    expect(banner).toHaveTextContent(DISCLAIMER);
    expect(within(banner).queryByRole('button')).toBeNull();
    expect(screen.getByRole('complementary', { name: /clinical safety disclaimer/i })).toBe(banner);
  });

  it('publishes the banner and header heights as CSS variables for the sticky layout, and removes them on unmount', async () => {
    const { unmount } = render(<Workspace />);
    await screen.findByTestId('patient-form', undefined, waitOpts);
    const root = document.documentElement.style;
    expect(root.getPropertyValue('--banner-h')).toMatch(/^\d+px$/);
    expect(root.getPropertyValue('--header-h')).toMatch(/^\d+px$/);
    unmount();
    expect(root.getPropertyValue('--banner-h')).toBe('');
  });

  it('flags mock data visibly and offers the way back to the live API', async () => {
    await loaded();
    expect(screen.getByTestId('mock-chip')).toHaveTextContent(MOCK_LABEL);
    expect(screen.getByRole('button', { name: /use live api/i })).toBeInTheDocument();
  });

  it('has the landmarks: banner, complementary disclaimer, main, one h1', async () => {
    await loaded();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('focus mode', () => {
  it('Focus gives the 3D view the whole width, Show panels and Escape go back; the form stays mounted', async () => {
    const user = userEvent.setup();
    await loaded();
    const main = screen.getByRole('main');
    const btn = await screen.findByTestId('viewer-enlarge', undefined, waitOpts);
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(main).not.toHaveClass('is-focus');
    await user.click(btn);
    expect(main).toHaveClass('is-focus');
    expect(screen.getByTestId('viewer-enlarge')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('patient-form')).toBeInTheDocument(); // hidden by CSS only: nothing typed is lost
    await user.keyboard('{Escape}');
    expect(main).not.toHaveClass('is-focus');
    await user.click(screen.getByTestId('viewer-enlarge'));
    await user.click(screen.getByTestId('viewer-enlarge'));
    expect(main).not.toHaveClass('is-focus');
  });
});

describe('folding the side panels', () => {
  it('each panel folds away on its edge tab, gives the room back, and the choice is remembered', async () => {
    const user = userEvent.setup();
    await loaded();
    const main = screen.getByRole('main');
    expect(main).not.toHaveClass('no-left');
    await user.click(await screen.findByTestId('toggle-left', undefined, waitOpts));
    expect(main).toHaveClass('no-left');
    expect(main).not.toHaveClass('no-right');
    expect(screen.getByTestId('toggle-left')).toHaveAttribute('aria-expanded', 'false');
    expect(localStorage.getItem('riskatlas:rails')).toBe('r');
    await user.click(screen.getByTestId('toggle-right'));
    expect(main).toHaveClass('no-left', 'no-right');
    expect(localStorage.getItem('riskatlas:rails')).toBe('');
    await user.click(screen.getByTestId('toggle-left'));
    await user.click(screen.getByTestId('toggle-right'));
    expect(main).not.toHaveClass('no-left');
    expect(main).not.toHaveClass('no-right');
  });

  it('[ and ] fold them from the keyboard, but not while typing in a field', async () => {
    const user = userEvent.setup();
    await loaded();
    const main = screen.getByRole('main');
    await user.click(document.body);
    await user.keyboard('[['); // user-event: [[ types a single [
    expect(main).toHaveClass('no-left');
    await user.keyboard(']');
    expect(main).toHaveClass('no-right');
    await user.keyboard('[[]');
    expect(main).not.toHaveClass('no-left');
    await user.click(screen.getByTestId('field-age'));
    await user.keyboard('[[');
    expect(main).not.toHaveClass('no-left');
  });

  it('starts with the panels the reader left folded last time', async () => {
    localStorage.setItem('riskatlas:rails', 'l');
    await loaded();
    expect(screen.getByRole('main')).toHaveClass('no-right');
    expect(screen.getByRole('main')).not.toHaveClass('no-left');
  });
});

describe('input form is built from /meta', () => {
  it('groups, controls and units come from config', async () => {
    await loaded();
    const user = userEvent.setup();
    const form = screen.getByTestId('patient-form');
    expect(within(form).getByRole('tab', { name: /^Demographics/ })).toBeInTheDocument();
    expect(within(form).getByRole('tab', { name: /^ECG/ })).toBeInTheDocument();
    expect(within(form).getByTestId('field-dm-yes')).toHaveAttribute('type', 'radio');
    await openGroup(user, 'Vitals');
    expect(within(form).getByRole('textbox', { name: /^Blood pressure/ })).toHaveAttribute('inputmode');
    expect(within(form).getAllByText(/Reference 90 to 120 mmHg/).length).toBeGreaterThan(0);
    await openGroup(user, 'ECG');
    expect(within(form).getByTestId('field-bbb').tagName).toBe('SELECT');
  });

  it('sliders exist only for modifiable numeric features', async () => {
    const user = userEvent.setup();
    await loaded();
    await openGroup(user, 'Vitals');
    expect(screen.getByTestId('slider-bp')).toBeInTheDocument();
    expect(screen.queryByTestId('slider-age')).toBeNull();
  });

  it('shows a validation error, marks the field invalid and pauses predictions', async () => {
    const user = userEvent.setup();
    await loaded();
    await openGroup(user, 'Vitals');
    await user.type(screen.getByTestId('field-bp'), '9999');
    expect(screen.getByTestId('field-bp')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('form-errors')).toHaveTextContent('Blood pressure');
    expect(screen.getByTestId('paused-note')).toBeInTheDocument();
    expect(screen.queryByTestId('prob-CAD')).toBeNull();
  });

  it('leaving fields blank is allowed and reported as estimated', async () => {
    const user = userEvent.setup();
    await loaded();
    await user.type(screen.getByTestId('field-age'), '58');
    await user.click(screen.getByTestId('predict-button'));
    await screen.findByTestId('prob-CAD', undefined, waitOpts);
    expect(screen.getByTestId('missing-note')).toHaveTextContent(/Estimated without 51 of 52 inputs/);
  });
});

describe('results', () => {
  it('a preset fills the form and shows overall and per-vessel probabilities with band labels', async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByTestId('preset-illustrative-high'));
    await screen.findByTestId('prob-CAD', undefined, waitOpts);
    const cad = example.output.targets.CAD.probability;
    expect(screen.getByTestId('prob-CAD')).toHaveTextContent(`${Math.round(cad * 100)}%`);
    for (const v of ['LAD', 'LCX', 'RCA']) {
      expect(screen.getByTestId(`prob-${v}`)).toBeInTheDocument();
      expect(within(screen.getByTestId(`target-${v}`)).getByText(/risk$/)).toBeInTheDocument(); // band text, not colour alone
    }
    expect(screen.getByTestId('mock-flag')).toHaveTextContent(MOCK_LABEL);
    expect(screen.getByTestId('entered-count')).toHaveTextContent('52 of 52');
  });

  it("the legend uses the selected target's own cut points and changes with the target", async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByTestId('preset-illustrative-high'));
    await screen.findByTestId('legend', undefined, waitOpts);
    expect(screen.getByTestId('legend')).toHaveTextContent('below 40%'); // CAD rule-out 0.400
    await user.click(screen.getByTestId('target-RCA'));
    expect(screen.getByTestId('legend')).toHaveTextContent(/below 24%/); // RCA rule-out 0.236
    expect(screen.getByTestId('legend')).toHaveTextContent(/from 54%/);
  });

  it('selecting a vessel row focuses the dashboard on that target and back', async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByTestId('preset-illustrative-high'));
    await screen.findByTestId('prob-LAD', undefined, waitOpts);
    await user.click(screen.getByTestId('target-LAD'));
    expect(screen.getByTestId('target-LAD')).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByTestId('tab-explain'));
    const panel = screen.getByTestId('explanation-panel');
    expect(within(panel).getByRole('tab', { name: 'LAD', selected: true })).toBeInTheDocument();
    await user.click(within(panel).getByRole('tab', { name: 'RCA' }));
    expect(screen.getByTestId('target-RCA')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('target-LAD')).toHaveAttribute('aria-pressed', 'false');
  });

  it('compact results card: overall plus all three vessel rows are real buttons, each with probability, band text and interval', async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByTestId('preset-illustrative-high'));
    await screen.findByTestId('prob-CAD', undefined, waitOpts);
    await waitFor(() => expect(screen.getByTestId('status-line')).toHaveTextContent(/Full prediction/), waitOpts);
    const card = screen.getByTestId('results-panel');
    const rows = within(card)
      .getAllByRole('button')
      .filter((b) => b.getAttribute('data-testid')?.startsWith('target-'));
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(['target-CAD', 'target-LAD', 'target-LCX', 'target-RCA']);
    for (const r of rows) {
      expect(r).toHaveTextContent(/\d+%/);
      expect(r).toHaveTextContent(/(Low|Moderate|High) risk/);
      expect(r).toHaveTextContent(/Interval \d+% to \d+%/);
    }
    // the notes that used to make the card tall sit in one collapsed block, but stay in the document
    const notes = card.querySelector('details.foot-more') as HTMLDetailsElement;
    expect(notes.open).toBe(false);
    expect(within(notes).getByTestId('cutpoint-note')).toHaveTextContent(/Decision threshold/);
    expect(within(notes).getByTestId('disclaimer-note')).toHaveTextContent(DISCLAIMER);
    expect(card).toHaveTextContent(/schematic risk map/); // the vessel-colouring caveat stays visible next to the numbers
  });

  it('shows the consistency check and the repeated disclaimer in the results footer', async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByTestId('preset-illustrative-high'));
    await screen.findByTestId('coherence-note', undefined, waitOpts);
    expect(screen.getByTestId('coherence-note')).toHaveTextContent(/no vessel exceeds/i);
    expect(screen.getByTestId('disclaimer-note')).toHaveTextContent(DISCLAIMER);
    expect(screen.getByTestId('results-panel')).toHaveTextContent(/does not locate lesions within a vessel/);
  });
});

describe('explanation, physiology, what-if', () => {
  async function withResult() {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByTestId('preset-illustrative-high'));
    await screen.findByTestId('prob-CAD', undefined, waitOpts);
    await waitFor(() => expect(screen.getByTestId('status-line')).toHaveTextContent(/Full prediction/), waitOpts);
    return user;
  }

  it('SHAP table has direction glyphs and text, base value and additivity', async () => {
    const user = await withResult();
    await user.click(screen.getByTestId('tab-explain'));
    const table = screen.getByTestId('shap-table');
    expect(table.textContent).toContain('▲');
    expect(table.textContent).toContain('▼');
    expect(within(table).getAllByText(/raises risk|lowers risk/).length).toBeGreaterThan(3);
    expect(screen.getByTestId('additivity')).toHaveAttribute('data-ok', 'true');
    expect(screen.getByTestId('additivity')).toHaveTextContent(/Base value 76\.9%/);
    expect(within(table).getByText('Typical chest pain')).toBeInTheDocument();
  });

  it('physiology rows carry value, unit, reference range, status text and contribution share', async () => {
    const user = await withResult();
    await user.click(screen.getByTestId('tab-physiology'));
    const row = within(screen.getByTestId('physio-table')).getByText('Blood pressure').closest('tr')!;
    expect(row).toHaveAttribute('data-status', 'high');
    expect(row).toHaveTextContent('160 mmHg');
    expect(row).toHaveTextContent('90 to 120 mmHg');
    expect(row).toHaveTextContent('High');
    expect(row).toHaveTextContent(/\d+\.\d%/);
    const low = within(screen.getByTestId('physio-table')).getByText('HDL cholesterol').closest('tr')!;
    expect(low).toHaveTextContent('Low');
  });

  it('what-if lists the changes and always displays the counterfactual note', async () => {
    const user = await withResult();
    await user.click(screen.getByTestId('tab-whatif'));
    await user.click(within(screen.getByTestId('whatif-panel')).getByRole('tab', { name: 'LAD' }));
    const note = example.output.targets.LAD.counterfactual.note;
    expect(screen.getByTestId('cf-note')).toHaveTextContent(note);
    expect(screen.getByTestId('cf-changes')).toHaveTextContent('LDL cholesterol');
    expect(screen.getByTestId('cf-changes')).toHaveTextContent('160 mg/dL');
    expect(screen.getByTestId('cf-changes')).toHaveTextContent('100 mg/dL');
  });

  it('about shows model details from /meta and the licence file', async () => {
    const user = await withResult();
    await user.click(screen.getByTestId('tab-about'));
    expect(screen.getByTestId('about-panel')).toHaveTextContent('https://doi.org/10.24432/C5461K');
    expect(screen.getByTestId('about-panel')).toHaveTextContent(/ASSETS_AND_LICENSES\.md/);
    expect(screen.getByTestId('assets-text').textContent).toContain('CC BY 4.0');
  });
});

describe('reset and palette', () => {
  it('reset clears inputs and results', async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByTestId('preset-illustrative-high'));
    await screen.findByTestId('prob-CAD', undefined, waitOpts);
    await user.click(screen.getByTestId('reset-button'));
    expect(screen.getByTestId('empty-results')).toBeInTheDocument();
    expect(screen.getByTestId('entered-count')).toHaveTextContent('0 of 52');
    await openGroup(user, 'Vitals');
    expect((screen.getByTestId('field-bp') as HTMLInputElement).value).toBe('');
  });

  it('palette toggle is a labelled switch and the choice is remembered', async () => {
    const user = userEvent.setup();
    await loaded();
    const b = screen.getByRole('button', { name: /colour-blind palette/i });
    expect(b).toHaveAttribute('aria-pressed', 'false');
    await user.click(b);
    expect(b).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('riskatlas:palette')).toBe('safe');
  });

  it('starts dark, and the theme button cycles dark, light, system and sets data-theme', async () => {
    const user = userEvent.setup();
    await loaded();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    await user.click(screen.getByRole('button', { name: /theme: dark/i }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    await user.click(screen.getByRole('button', { name: /theme: light/i }));
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });
});
