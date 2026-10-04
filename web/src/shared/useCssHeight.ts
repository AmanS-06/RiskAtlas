import { useLayoutEffect, type RefObject } from 'react';

/**
 * Publishes an element's rendered height as a CSS custom property on <html> (for example --banner-h), so layout.css can offset
 * sticky elements and size the sticky viewer column without hardcoding the height of a banner whose text wraps differently
 * on every screen width (rounded down, so a sticky element tucks under the banner instead of leaving a sliver). Without ResizeObserver (old browsers, jsdom) the height is measured once.
 */
export function useCssHeight(ref: RefObject<HTMLElement | null>, name: string): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const apply = () => root.style.setProperty(name, `${Math.floor(el.getBoundingClientRect().height)}px`);
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty(name);
    };
  }, [ref, name]);
}
