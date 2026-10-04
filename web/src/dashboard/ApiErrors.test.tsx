import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from './Dashboard';

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

const opts = { timeout: 4000 };

describe('API failure states', () => {
  it('backend down at load: clear message, retry, and an explicit way to use mock data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const user = userEvent.setup();
    render(<Dashboard />);
    const err = await screen.findByTestId('meta-error', undefined, opts);
    expect(err).toHaveTextContent('Cannot reach the model server');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    await user.click(screen.getByTestId('use-mock'));
    await screen.findByTestId('patient-form', undefined, opts);
    expect(screen.getByTestId('mock-chip')).toBeInTheDocument();
  });

  it('503 at load shows the server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { code: 'models_unavailable', message: 'Models are not loaded' } }), { status: 503 })),
    );
    render(<Dashboard />);
    const err = await screen.findByTestId('meta-error', undefined, opts);
    expect(err).toHaveTextContent('Models are not available');
    expect(err).toHaveTextContent('Models are not loaded');
  });

  it('a 422 on predict shows the server details and keeps the form', async () => {
    window.history.replaceState({}, '', '/?mock=1');
    // mock mode never hits fetch, so drive the real HTTP path with a fake backend instead
    window.history.replaceState({}, '', '/');
    const metaBody = (await import('../api/mock/meta.json')).default;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/meta')
          ? new Response(JSON.stringify(metaBody), { status: 200 })
          : new Response(
              JSON.stringify({
                error: { code: 'validation_error', message: 'Invalid request. bp: must be a number', details: [{ field: 'bp', message: 'must be a number' }] },
              }),
              { status: 422 },
            ),
      ),
    );
    const user = userEvent.setup();
    render(<Dashboard />);
    await screen.findByTestId('patient-form', undefined, opts);
    await user.type(screen.getByTestId('field-age'), '60');
    await user.click(screen.getByTestId('predict-button'));
    const err = await screen.findByTestId('api-error', undefined, opts);
    expect(err).toHaveTextContent('Some inputs were rejected');
    expect(err).toHaveTextContent('must be a number');
    expect((screen.getByTestId('field-age') as HTMLInputElement).value).toBe('60');
  });

  it('a full prediction served from the API cache says so instead of "in 0 ms"; a fresh one shows its latency', async () => {
    const metaBody = (await import('../api/mock/meta.json')).default;
    const { mockPredict } = await import('../api/mock');
    const body = (total: number) => ({ ...JSON.parse(JSON.stringify(mockPredict('full', { age: 60 }))), mock: false, timing_ms: { total } });
    let hit = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/meta')
          ? new Response(JSON.stringify(metaBody), { status: 200 })
          : new Response(JSON.stringify(body(hit ? 0.04 : 3812.4)), { status: 200, headers: { 'X-Cache': hit ? 'HIT' : 'MISS' } }),
      ),
    );
    const user = userEvent.setup();
    render(<Dashboard />);
    await screen.findByTestId('patient-form', undefined, opts);
    await user.type(screen.getByTestId('field-age'), '60');
    await user.click(screen.getByTestId('predict-button'));
    await waitFor(() => expect(screen.getByTestId('status-line')).toHaveTextContent('Full prediction in 3812 ms.'), opts);
    expect(screen.getByTestId('status-line')).not.toHaveAttribute('data-cached');
    hit = true;
    await user.click(screen.getByTestId('predict-button'));
    await waitFor(() => expect(screen.getByTestId('status-line')).toHaveTextContent('Full prediction (cached answer, no new model run).'), opts);
    expect(screen.getByTestId('status-line')).toHaveAttribute('data-cached', 'true');
    expect(screen.getByTestId('status-line')).not.toHaveTextContent(/\b0 ms/);
  });
});
