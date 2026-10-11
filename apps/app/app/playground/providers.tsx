/**
 * The providers every card on the playground sits inside.
 *
 * Two, and both are the app's own:
 *
 * - The app's one i18next instance (`#app/i18n/i18n`), through react-i18next's
 *   provider. The playground builds no instance of its own and copies no
 *   catalog. The language control calls `i18next.changeLanguage`, and every
 *   `useTranslation` below re-renders. It does NOT use the app's
 *   `I18nProvider`: that one changes the language during render, which is fine
 *   for the root (a language change reloads the document) and a React warning
 *   here, where the language changes live under mounted components.
 * - A data router. Components draw `Link` from `#app/components/link` and read
 *   router hooks, so they need a router above them. The playground keeps its
 *   own sections in the URL hash, so the router is a memory router with one
 *   catch-all route. It never touches `window.location`, and a click on a
 *   row link moves the memory location only.
 *
 * `app.tsx` and `tests/unit/playground-sections.test.tsx` both use this, so the
 * test renders a section in the providers the page really uses.
 */
import { createContext, useContext, useState, type ReactElement, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { RouterProvider, createMemoryRouter } from 'react-router';

import i18next from '#app/i18n/i18n';

/** What the router's one route draws. Carried by context so the router can be made once. */
const SlotContext = createContext<ReactNode>(null);

/** The catch-all route's element: whatever the providers were given. */
function Slot(): ReactElement {
  return <>{useContext(SlotContext)}</>;
}

/**
 * @param children - the page, or one section of it.
 */
export function PlaygroundProviders({ children }: { children: ReactNode }): ReactElement {
  const [router] = useState(() => createMemoryRouter([{ path: '*', element: <Slot /> }]));
  return (
    <I18nextProvider i18n={i18next}>
      <SlotContext.Provider value={children}>
        <RouterProvider router={router} />
      </SlotContext.Provider>
    </I18nextProvider>
  );
}
