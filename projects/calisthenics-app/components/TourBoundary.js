import { Component } from 'react';

/**
 * Error boundary around the guided tour. Same reasoning as IntroBoundary: the
 * tutorial is a helper, the app underneath is the product.
 *
 * The tour measures live views on five different screens and draws SVG on top of
 * them, so it has more ways to go wrong than anything else in the app — and it
 * renders at the ROOT now (see PlayerTour in App.js), which means a throw inside
 * it would unmount the entire React tree and drop the player out of the app.
 * Catching here turns any such failure into "the tutorial closes", which is
 * recoverable: the TUTORIAL pill on Home starts it again.
 *
 * `resetKey` (the step index) clears a caught error, so one bad step doesn't
 * poison the tour for the rest of the session.
 */
export default class TourBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(prev) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  componentDidCatch(error) {
    // Surface it for debugging without taking the app down with it.
    console.warn('[GuidedTour] closed after error:', error?.message ?? error);
    this.props.onFail?.();
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}
