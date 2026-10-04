// localStorage for per-viewer conveniences only. It can be missing or throw (private windows, blocked storage).
export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(`riskatlas:${key}`);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(`riskatlas:${key}`, value);
  } catch {
    /* ignore */
  }
}
