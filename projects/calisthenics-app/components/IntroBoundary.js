import { Component } from 'react';

/**
 * Error boundary around the cold-start title sequence.
 *
 * The intro is decoration; the app underneath is the product. Without this, a
 * throw anywhere in SystemIntro (a missing web API, an expo-video quirk on some
 * browser, a bad asset) unmounts the WHOLE React tree and the user gets a black
 * page with no way out. Catching here turns any such failure into "no intro,
 * app loads normally" — it calls onFail so the parent drops the overlay.
 */
export default class IntroBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    // Surface it for debugging without taking the app down with it.
    console.warn('[SystemIntro] skipped after error:', error?.message ?? error);
    this.props.onFail?.();
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}
