// DEV-ONLY entry. Paired with `apps/app/playground.html`, which is not a build input: see that
// file's header and `tests/unit/playground-entry.test.ts`.
//
// No service worker, on purpose. Nothing here imports `#app/lib/service-worker`, so the
// playground can never register one and start precaching a page that does not ship.
import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/victor-mono/index.css';
import '#app/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import i18next from '#app/i18n/i18n';
import { PlaygroundApp } from './app';
import { readLanguageChoice } from './prefs';

// The saved language is in place before the first paint, so a German page never flashes English.
await i18next.changeLanguage(readLanguageChoice());

const root = document.getElementById('root');
if (root === null) throw new Error('playground.html has no #root');

createRoot(root).render(
  <StrictMode>
    <PlaygroundApp />
  </StrictMode>,
);
