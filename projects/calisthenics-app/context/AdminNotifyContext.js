import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { fetchPendingCheckupCount } from '../lib/adminInbox';

// Drives the CHECK-UP notification dot on the ADMIN dashboard: players who
// submitted a check-up the coach hasn't replied to. Polled while the admin app
// is mounted; screens that change that state call `refresh()` so the dot clears
// immediately instead of waiting for the next tick.
// (The 1-on-1 chat queue that used to live here was removed 2026-08-26 — coach
// and player talk on WhatsApp now.)
const POLL_MS = 45000;

const Ctx = createContext({ checkups: 0, refresh: () => {} });

export function AdminNotifyProvider({ children }) {
  const [checkups, setCheckups] = useState(0);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const c = await fetchPendingCheckupCount();
      if (!mounted.current) return;
      setCheckups(c);
    } catch (e) {
      console.error('[AdminNotify] refresh:', e);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => { mounted.current = false; clearInterval(id); };
  }, [refresh]);

  return (
    <Ctx.Provider value={{ checkups, refresh }}>{children}</Ctx.Provider>
  );
}

export const useAdminNotify = () => useContext(Ctx);
