import { useTranslation } from 'react-i18next';
import { Link } from '#app/components/link';

/** Which sentence a gate-exempt page shows a stranger. */
export type StrangerNoteVariant = 'device' | 'needs-sign-in';

/**
 * The two sentences, by variant.
 *
 * `satisfies` rather than an annotation: the `anti-slop/no-known-value-widening`
 * rule rejects annotating a known literal, and `satisfies` still fails when the
 * variant union grows a member.
 */
const SENTENCE_KEYS = {
  device: 'strangerNote.device',
  'needs-sign-in': 'strangerNote.needsSignIn',
} satisfies Record<StrangerNoteVariant, string>;

/**
 * Which sentence a gate-exempt path gets, as a pure function.
 *
 * `/settings/preferences` and `/settings/about` are USABLE by a stranger:
 * theme, language and a page of reading matter all work with an empty store,
 * so the sentence says what the controls apply to rather than asking for a
 * sign-in that is not needed. `/settings/account` and `/settings/sync` are the
 * door itself, and for somebody standing outside it the honest sentence is
 * that the page needs one.
 *
 * @param pathname - the request's pathname, with or without a trailing slash.
 * @returns the variant for that page.
 */
export function strangerNoteVariantForPath(pathname: string): StrangerNoteVariant {
  const path = pathname.replace(/\/+$/, '') || '/';
  return path === '/settings/account' || path === '/settings/sync' ? 'needs-sign-in' : 'device';
}

/**
 * ONE component for all of the gate-exempt pages (M204 spec 09).
 *
 * `_personal.tsx` renders it above the outlet when the gate answered `exempt`,
 * so it appears inside the public shell and nowhere else, and no settings page
 * carries a copy of it. Putting it on each page instead would be four places
 * to keep in step, and each one would have to learn the gate result to know
 * whether to draw itself, which is the branch this whole change removes from
 * the pages.
 *
 * The link row is the rest of the answer. A stranger inside the public chrome
 * has no sidebar, so the note carries the way home, the way in, and the two
 * legal pages German law wants reachable from a public page. `Anmelden` points
 * at `/sign-in` and not at `/welcome`: the visitor reading this already knows
 * they are not signed in, and `/welcome` would ask them to choose again.
 */
export function StrangerNote({ variant }: { variant: StrangerNoteVariant }) {
  const { t } = useTranslation();
  const links = [
    { to: '/', label: t('strangerNote.home') },
    { to: '/sign-in', label: t('chrome.signIn') },
    { to: '/imprint', label: t('chrome.imprint') },
    { to: '/privacy', label: t('chrome.privacy') },
  ];

  return (
    <div className="mb-6 rounded-lg border bg-muted/40 p-4 text-sm">
      <p className="text-muted-foreground">{t(SENTENCE_KEYS[variant])}</p>
      <nav className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="font-medium underline underline-offset-4 transition-colors hover:text-foreground"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
