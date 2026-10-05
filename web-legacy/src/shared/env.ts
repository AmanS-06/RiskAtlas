export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Ask the viewer to economise: ?lowpower=1, or a device that reports few cores or little memory. */
export function lowPowerDevice(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  const q = new URLSearchParams(search).get('lowpower');
  if (q !== null) return q === '1';
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2;
}
