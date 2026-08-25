import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchCheckupDueState } from '../lib/checkups';

// Tracks whether THIS WEEK's check-up is still owed — drives the small dot on the
// CHECKUP bottom-tab. `state` is 'none' | 'due' (the check-up day → ice dot) |
// 'late' (the grace day with nothing sent → RED dot). See `checkupDueState` in
// lib/checkups. Submitting clears it: CheckupScreen calls `refresh()` after a
// successful submit, and a gentle poll catches a day rolling over while the app
// is open.
const POLL_MS = 60000;

const Ctx = createContext({ state: 'none', refresh: () => {} });

export function CheckupNotifyProvider({ children }) {
  const [state, setState] = useState('none');
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const next = await fetchCheckupDueState(user?.id ?? null);
      if (mounted.current) setState(next);
    } catch (e) {
      console.error('[CheckupNotify] refresh:', e);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => { mounted.current = false; clearInterval(id); };
  }, [refresh]);

  return <Ctx.Provider value={{ state, refresh }}>{children}</Ctx.Provider>;
}

export const useCheckupNotify = () => useContext(Ctx);
