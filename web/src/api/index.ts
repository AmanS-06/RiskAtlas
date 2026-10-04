import { HttpProvider, type ApiProvider } from './client';
import { MockProvider } from './mock';

export * from './types';
export * from './errors';
export { HttpProvider, DEFAULT_TIMEOUTS, type ApiProvider } from './client';
export { MockProvider, mockMeta, mockPredict } from './mock';
export { LivePredictor, type LiveEvents, type LiveOptions } from './live';

/** VITE_API_BASE overrides the API location. The default goes through the dev/preview proxy in vite.config.ts. */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api';
/** VITE_API_MOCK=1 starts in mock mode. So does ?mock=1 in the page URL. */
export function mockRequested(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  return import.meta.env.VITE_API_MOCK === '1' || new URLSearchParams(search).get('mock') === '1';
}

export function createProvider(mock: boolean): ApiProvider {
  return mock ? new MockProvider() : new HttpProvider(API_BASE);
}
