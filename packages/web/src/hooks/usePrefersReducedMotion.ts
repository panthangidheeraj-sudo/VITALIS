import { useEffect, useState } from 'react';

/** One shared read of `prefers-reduced-motion`, live-updated if the user
 * changes the OS setting mid-session — every new gesture/transition added in
 * the motion pass checks this instead of reading `matchMedia` inline. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
