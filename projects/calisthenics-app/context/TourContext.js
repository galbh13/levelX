import { createContext, useCallback, useContext, useMemo, useState } from 'react';

// ── Guided-tour ownership ────────────────────────────────────────────────────
// The tour used to live INSIDE HomeScreen. That looked fine on web and broke on
// the APK: Home is one page of the material-top-tab pager, and the tour's whole
// job is to navigate AWAY from it. The moment it jumped to another tab, React
// Navigation deactivated the Home scene (`detachInactiveScreens`, on by default)
// — and a <Modal> rendered inside a detached native screen goes with it. The
// overlay vanished mid-tutorial and the player was dumped on the Skills tab with
// no way to continue.
//
// So the tour is hoisted to the app root (see `PlayerTour` in App.js), OUTSIDE
// the pager, and this context is the remaining link: HomeScreen opens it (the
// TUTORIAL pill) and reads `tourOpen` to show its tutorial-only demo mission.
//
// The default value is a working no-op, so a screen rendered outside the
// provider (e.g. under the admin navigator) just sees "no tour running".
// `stepId` is how a SCREEN reacts to a particular step. Only steps that carry an
// `id` in GuidedTour publish one — currently the check-up feedback step, which
// asks CheckupScreen to show an example of the coach reply the player has not
// received yet. Everything else leaves it null.
const TourContext = createContext({
  tourOpen: false,
  stepId: null,
  openTour:  () => {},
  closeTour: () => {},
  setStepId: () => {},
});

export function TourProvider({ children }) {
  const [tourOpen, setTourOpen] = useState(false);
  const [stepId, setStepId] = useState(null);
  const openTour  = useCallback(() => setTourOpen(true), []);
  const closeTour = useCallback(() => { setTourOpen(false); setStepId(null); }, []);
  const value = useMemo(
    () => ({ tourOpen, stepId, openTour, closeTour, setStepId }),
    [tourOpen, stepId, openTour, closeTour],
  );
  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTour() {
  return useContext(TourContext);
}
