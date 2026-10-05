import { describe, expect, it } from 'vitest';
import { routeOf } from './App';

describe('routes', () => {
  it('shows the landing page by default and for in-page anchors', () => {
    expect(routeOf('')).toBe('landing');
    expect(routeOf('#/')).toBe('landing');
    expect(routeOf('#numbers')).toBe('landing');
    expect(routeOf('#safety')).toBe('landing');
  });
  it('shows the workspace for #/app', () => {
    expect(routeOf('#/app')).toBe('app');
    expect(routeOf('#/app/')).toBe('app');
  });
});
