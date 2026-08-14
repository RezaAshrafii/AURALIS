import * as React from 'react';
import { createRoot } from 'react-dom/client';

import '../../../app/vendor/bootstrap.min.css';
import '../../../app/styles.css';

declare global {
  interface Window {
    AuralisUI?: Readonly<Record<string, unknown>>;
  }
}

// The shipped UI remains the product baseline while TypeScript is introduced at
// its runtime boundary. Dynamic imports are intentional: the legacy modules read
// these globals during evaluation, so the bridge must exist first.
Object.assign(window, {
  React,
  ReactDOM: Object.freeze({ createRoot }),
});

await import('../../../app/ui-kit.js');
if (!window.AuralisUI) {
  throw new Error('Auralis UI kit failed to initialize.');
}
await import('../../../app/app-react.js');
