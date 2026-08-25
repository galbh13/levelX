import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { fetchPendingCheckupCount, fetchUnreadChatCount } from '../lib/adminInbox';

// Drives the two notification dots on the ADMIN dashboard:
//   • checkups — players who submitted a check-up the coach hasn't replied to.
//   • unreadChats — messages from players the coach hasn't opened yet.
// Polled while the admin app is mounted; screens that change either state call
// `refresh()` so the dot clears immediately instead of waiting for the next tick.
const POLL_MS = 45000;

const Ctx = createContext({ checkups: 0, unreadChats: 0, refresh: () => {} });

export function AdminNotifyProvider({ children }) {
  const [checkups, setCheckups] = useState(0);
  const [unreadChats, setUnreadChats] = useState(0);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [c, u] = await Promise.all([fetchPendingCheckupCount(), fetchUnreadChatCount()]);
      if (!mounted.current) return;
      setCheckups(c);
      setUnreadChats(u);
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
    <Ctx.Provider value={{ checkups, unreadChats, refresh }}>{children}</Ctx.Provider>
  );
}

export const useAdminNotify = () => useContext(Ctx);
