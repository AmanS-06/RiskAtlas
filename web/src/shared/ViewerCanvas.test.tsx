import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewerCanvas } from './ViewerCanvas';

// A fake viewer with the contract's interface, so the test holds whichever viewer viewerAdapter points at.
const fake = vi.hoisted(() => ({ instances: [] as unknown[] }));
vi.mock('./viewerAdapter', () => {
  class FakeViewer {
    vessels: Record<string, { color: string } | undefined> = {};
    overall: unknown = undefined;
    selected: string | null | undefined = undefined;
    cb: ((id: string | null) => void) | null = null;
    disposed = false;
    constructor(public opts: unknown) {
      fake.instances.push(this);
    }
    load = () => Promise.resolve();
    setVessels = (s: Record<string, { color: string } | undefined>) => void Object.assign(this.vessels, s);
    setOverall = (s: unknown) => void (this.overall = s);
    select = (id: string | null) => void (this.selected = id);
    onSelect = (cb: (id: string | null) => void) => {
      this.cb = cb;
      return () => void (this.cb = null);
    };
    resetView = () => {};
    resizes = 0;
    resize = () => void this.resizes++;
    getStatus = () => ({ loaded: true, usingFallback: 'none', webgl: true, triangles: 1000 });
    dispose = () => void (this.disposed = true);
  }
  return { HeartViewer: FakeViewer };
});

type Fake = {
  vessels: Record<string, { color: string } | undefined>;
  overall: unknown;
  selected: string | null | undefined;
  cb: ((id: string | null) => void) | null;
  disposed: boolean;
  resizes: number;
  opts: { modelUrl: string; liteModelUrl: string };
};
const latest = () => fake.instances.at(-1) as Fake;

const props = {
  meshNames: ['LAD', 'LCX', 'RCA'],
  vessels: { LAD: { probability: 0.7, band: 'high', color: '#d64545', uncertaintyWidth: 0.1 } },
  overall: { probability: 0.9, band: 'high', color: '#d64545' },
  selectedMesh: null,
  onSelectMesh: () => {},
};

beforeEach(() => {
  fake.instances.length = 0;
});

describe('ViewerCanvas', () => {
  it('creates the viewer with the model URLs and paints states: given colour where known, cleared (undefined) elsewhere', async () => {
    render(<ViewerCanvas {...props} />);
    await waitFor(() => expect(screen.getByTestId('viewer')).toHaveAttribute('data-ready', 'true'));
    expect(latest().opts.modelUrl).toMatch(/models3d\/heart\.glb$/);
    expect(latest().opts.liteModelUrl).toMatch(/models3d\/heart_lite\.glb$/);
    await waitFor(() => expect(latest().vessels.LAD?.color).toBe('#d64545')); // painted by an effect that runs right after data-ready flips
    expect('LCX' in latest().vessels && latest().vessels.LCX === undefined).toBe(true);
    expect('RCA' in latest().vessels && latest().vessels.RCA === undefined).toBe(true);
    expect(latest().overall).toEqual({ probability: 0.9, band: 'high', color: '#d64545' });
  });

  it("forwards the viewer's selection events to the app", async () => {
    const onSelectMesh = vi.fn();
    render(<ViewerCanvas {...props} onSelectMesh={onSelectMesh} />);
    await waitFor(() => expect(screen.getByTestId('viewer')).toHaveAttribute('data-ready', 'true'));
    latest().cb?.('LCX');
    expect(onSelectMesh).toHaveBeenLastCalledWith('LCX');
    latest().cb?.(null);
    expect(onSelectMesh).toHaveBeenLastCalledWith(null);
  });

  it("pushes the app's selection into the viewer", async () => {
    const { rerender } = render(<ViewerCanvas {...props} />);
    await waitFor(() => expect(screen.getByTestId('viewer')).toHaveAttribute('data-ready', 'true'));
    rerender(<ViewerCanvas {...props} selectedMesh="RCA" />);
    await waitFor(() => expect(latest().selected).toBe('RCA'));
  });

  it('disposes the viewer on unmount', async () => {
    const { unmount } = render(<ViewerCanvas {...props} />);
    await waitFor(() => expect(screen.getByTestId('viewer')).toHaveAttribute('data-ready', 'true'));
    const v = latest();
    unmount();
    expect(v.disposed).toBe(true);
  });

  describe('Enlarge button', () => {
    it('is absent unless the page provides a handler', async () => {
      render(<ViewerCanvas {...props} />);
      await waitFor(() => expect(screen.getByTestId('viewer')).toHaveAttribute('data-ready', 'true'));
      expect(screen.queryByTestId('viewer-enlarge')).toBeNull();
    });

    it('reflects the state in its label and aria-pressed, and asks the page to toggle on click and on Enter/Space (native button)', async () => {
      const onToggle = vi.fn();
      const { rerender } = render(<ViewerCanvas {...props} enlarged={false} onToggleEnlarged={onToggle} />);
      await waitFor(() => expect(screen.getByTestId('viewer')).toHaveAttribute('data-ready', 'true'));
      const btn = screen.getByTestId('viewer-enlarge');
      expect(btn.tagName).toBe('BUTTON');
      expect(btn).toHaveTextContent('Enlarge');
      expect(btn).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(btn);
      expect(onToggle).toHaveBeenCalledTimes(1);
      rerender(<ViewerCanvas {...props} enlarged onToggleEnlarged={onToggle} />);
      expect(screen.getByTestId('viewer-enlarge')).toHaveTextContent('Shrink');
      expect(screen.getByTestId('viewer-enlarge')).toHaveAttribute('aria-pressed', 'true');
    });

    it('Escape leaves the enlarged view and puts focus back on the button; it does nothing when not enlarged', async () => {
      const onToggle = vi.fn();
      const { rerender } = render(<ViewerCanvas {...props} enlarged={false} onToggleEnlarged={onToggle} />);
      await waitFor(() => expect(screen.getByTestId('viewer')).toHaveAttribute('data-ready', 'true'));
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(onToggle).not.toHaveBeenCalled();
      rerender(<ViewerCanvas {...props} enlarged onToggleEnlarged={onToggle} />);
      fireEvent.keyDown(document.body, { key: 'Enter' });
      expect(onToggle).not.toHaveBeenCalled();
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('viewer-enlarge')).toHaveFocus();
    });

    it('asks the viewer to re-measure and re-fit after the layout changed', async () => {
      const { rerender } = render(<ViewerCanvas {...props} enlarged={false} onToggleEnlarged={() => {}} />);
      await waitFor(() => expect(screen.getByTestId('viewer')).toHaveAttribute('data-ready', 'true'));
      await waitFor(() => expect(latest().resizes).toBeGreaterThanOrEqual(1));
      const before = latest().resizes;
      rerender(<ViewerCanvas {...props} enlarged onToggleEnlarged={() => {}} />);
      await waitFor(() => expect(latest().resizes).toBeGreaterThan(before));
    });
  });
});
