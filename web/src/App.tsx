import { Suspense, lazy, useEffect, useState } from 'react';
import './shared/theme.css';
import './shared/layout.css';
import './dashboard/dashboard.css';
import { Landing } from './landing/Landing';

// The workspace carries three.js, so it is its own chunk: the landing page paints without it.
const Workspace = lazy(() => import('./app/Workspace').then((m) => ({ default: m.Workspace })));

/** Hash routes, so a static host needs no rewrite rules: `#/` is the landing page, `#/app` the workspace. Anchors like `#numbers` stay on the landing page. */
export function routeOf(hash: string): 'landing' | 'app' {
  return hash.replace(/^#/, '').startsWith('/app') ? 'app' : 'landing';
}

function useRoute(): 'landing' | 'app' {
  const read = () => (typeof location === 'undefined' ? 'landing' : routeOf(location.hash));
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () =>
      setRoute((prev) => {
        const next = read();
        if (next !== prev) window.scrollTo(0, 0);
        return next;
      });
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export default function App() {
  const route = useRoute();
  if (route === 'app') {
    return (
      <Suspense
        fallback={
          <p role="status" style={{ padding: 32 }}>
            Loading the workspace…
          </p>
        }
      >
        <Workspace />
      </Suspense>
    );
  }
  return <DarkLanding />;
}

/** The landing page is a night scene whatever the theme preference: it is dark, and the workspace restores the chosen theme when it opens. */
function DarkLanding() {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  }, []);
  return <Landing />;
}
