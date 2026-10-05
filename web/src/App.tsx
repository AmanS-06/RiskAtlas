import { useEffect, useState } from 'react';
import './shared/theme.css';
import './shared/layout.css';
import './dashboard/dashboard.css';
import { Workspace } from './app/Workspace';

/** Two pages for now: the workspace (default). Routes are hash based so a static host needs no rewrite rules. */
function useRoute(): string {
  const read = () => (typeof location === 'undefined' ? '/' : location.hash.replace(/^#/, '') || '/');
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export default function App() {
  const route = useRoute();
  void route;
  return <Workspace />;
}
