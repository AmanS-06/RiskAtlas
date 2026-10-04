// Test hooks that main.ts puts on window.
import type { HeartViewer, ScreenAnchor } from '../../src/viewer';

declare global {
  interface Window {
    __viewer: HeartViewer;
    __HeartViewer: typeof HeartViewer;
    __anchors?: ScreenAnchor[];
    // installed by e2e/instrument.ts
    __clears: number;
    __rafCalls: number;
    __live: { target: EventTarget; type: string; fn: unknown; capture: boolean }[];
    __sel: (string | null)[];
  }
}
export {};
