/**
 * Draws a page from the mounted content folder (M246 spec 01).
 *
 * ── REACT ELEMENTS, NEVER HTML ──
 * The tree comes from `#app/lib/content/markdown`, which refuses raw HTML at
 * parse time, and it is drawn here as elements, one per node kind. There is no
 * `dangerouslySetInnerHTML` and no string of markup anywhere on this path, so
 * a `<script>` that got past the parser would still reach the page as text.
 *
 * ── LINKS ──
 * A path in the app goes through the router's `Link`, so it navigates without
 * a reload. `https:`, `mailto:` and `tel:` are plain anchors. A target outside
 * those four is drawn as its text with no link at all: the parser already
 * refused such a file, and this is the second check on the same rule, for a
 * tree that reached the client some other way.
 *
 * ── THE LEAD ──
 * Paragraphs of the body before its first heading are the page's lead and use
 * the lead size, as the hand-written pages did. That is how the statutory
 * button pages get their one-paragraph introduction above the form.
 */
import { Fragment, createElement, type ReactNode } from 'react';
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';

import PublicWrapper from '#app/components/public-wrapper';
import { H1, H2, H3, P } from '#app/components/typography';
import { isAllowedContentHref, isAppPath, type ContentBlock, type ContentInline } from '#app/lib/content/markdown';
import { formatContentDate } from '#app/lib/content/format-content-date';

const LINK_CLASS = 'underline underline-offset-4';

/** One link, by the kind of target it has. */
function ContentLink({ href, children }: { href: string; children: ReactNode }) {
  if (!isAllowedContentHref(href)) return <>{children}</>;
  if (isAppPath(href)) {
    return (
      <Link to={href} className={LINK_CLASS}>
        {children}
      </Link>
    );
  }
  const isExternal = href.startsWith('https://');
  return (
    <a
      href={href}
      className={LINK_CLASS}
      target={isExternal ? '_blank' : undefined}
      rel={isExternal ? 'noopener noreferrer' : undefined}
    >
      {children}
    </a>
  );
}

/**
 * Static children, passed POSITIONALLY rather than as one array.
 *
 * A file's blocks and runs never reorder, move or change identity between two
 * renders of the same page, so they need no keys, exactly as children written
 * out one after another in JSX need none. Spreading them into `createElement`
 * says that; an index key would say the same thing less honestly.
 */
function inOrder(type: 'ul' | 'ol' | 'dl' | 'div' | typeof Fragment, nodes: ReactNode[]): ReactNode {
  return createElement(type, null, ...nodes);
}

/** One inline node. */
function renderRun(run: ContentInline): ReactNode {
  switch (run.kind) {
    case 'text':
      return run.text;
    case 'break':
      return <br />;
    case 'strong':
      return <strong>{renderRuns(run.children)}</strong>;
    case 'emphasis':
      return <em>{renderRuns(run.children)}</em>;
    case 'link':
      return <ContentLink href={run.href}>{renderRuns(run.children)}</ContentLink>;
  }
}

/** A run of inline nodes. */
function renderRuns(runs: readonly ContentInline[]): ReactNode {
  return inOrder(Fragment, runs.map(renderRun));
}

/** A run of inline nodes, as a component. */
export function ContentInlines({ runs }: { runs: readonly ContentInline[] }) {
  return renderRuns(runs);
}

/** One block. */
function renderBlock(block: ContentBlock, isLead: boolean): ReactNode {
  switch (block.kind) {
    case 'heading':
      return block.level === 2 ?
          <H2 variant="default" className="mt-10">
            {renderRuns(block.children)}
          </H2>
        : <H3 variant="default" className="mt-8 text-xl sm:text-2xl">
            {renderRuns(block.children)}
          </H3>;
    case 'paragraph':
      return <P variant={isLead ? 'lead' : 'default'}>{renderRuns(block.children)}</P>;
    case 'list':
      return inOrder(
        block.isOrdered ? 'ol' : 'ul',
        block.items.map((item) => createElement('li', null, renderRuns(item))),
      );
    case 'definitions':
      return inOrder(
        'dl',
        block.entries.map((entry) =>
          inOrder('div', [
            createElement('dt', null, renderRuns(entry.term)),
            ...entry.definitions.map((definition) => createElement('dd', null, renderRuns(definition))),
          ]),
        ),
      );
  }
}

/**
 * A list of blocks.
 *
 * @param props.hasLead - draw paragraphs before the first heading at the lead size. The page body
 * has a lead; a named section placed around a form does not.
 */
export function ContentBlocks({ blocks, hasLead = false }: { blocks: readonly ContentBlock[]; hasLead?: boolean }) {
  const firstHeading = blocks.findIndex((block) => block.kind === 'heading');
  const leadEnd = firstHeading === -1 ? blocks.length : firstHeading;
  return inOrder(
    Fragment,
    blocks.map((block, position) => renderBlock(block, hasLead && position < leadEnd)),
  );
}

export interface ContentArticleProps {
  /** The page's h1, from the file's front matter. */
  title: string;
  /** `YYYY-MM-DD`, from front matter, drawn under the title in the reader's language. */
  updated: string;
  /** The language the file is written in, which may be English when the reader's language had no file. */
  language: string;
  /** The body. */
  blocks: readonly ContentBlock[];
  /** Hide the "Last updated" line. A receipt is not a document with a revision date. */
  hasUpdatedLine?: boolean;
  /** Drawn after the body: a form, a receipt, a named section. */
  children?: ReactNode;
}

/**
 * The whole page: the title, the date it last changed, the body, then
 * whatever the route draws in code.
 *
 * `lang` on the article names the FILE's language, so a German reader shown
 * the English fallback gets English hyphenation and an English voice from a
 * screen reader, while the chrome around it stays German.
 */
export function ContentArticle({
  title,
  updated,
  language,
  blocks,
  hasUpdatedLine = true,
  children,
}: ContentArticleProps) {
  const { t, i18n } = useTranslation();
  return (
    <article className="font-prose prose prose-zinc dark:prose-invert max-w-none" lang={language}>
      <H1 variant="default" className="mb-8">
        {title}
      </H1>
      {hasUpdatedLine && (
        <P variant="subtle" className="mb-8">
          {t('content.lastUpdated', { date: formatContentDate({ isoDate: updated, language: i18n.language }) })}
        </P>
      )}
      <ContentBlocks blocks={blocks} hasLead />
      {children}
    </article>
  );
}

/** What a plain content route hands its page: the loader's page, or any object with these fields. */
export interface ContentPageViewProps {
  page: { title: string; updated: string; language: string; body: readonly ContentBlock[] };
}

/** A plain content page inside the public chrome, for the routes that draw a file and nothing else. */
export function ContentPageView({ page }: ContentPageViewProps) {
  return (
    <PublicWrapper>
      <ContentArticle title={page.title} updated={page.updated} language={page.language} blocks={page.body} />
    </PublicWrapper>
  );
}
