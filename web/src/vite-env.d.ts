/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API location. Default /api (proxied to the backend). */
  readonly VITE_API_BASE?: string;
  /** "1" starts in mock mode (no backend). */
  readonly VITE_API_MOCK?: string;
}

declare module '*.md?raw' {
  const text: string;
  export default text;
}
