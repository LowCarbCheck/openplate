import type { HTMLAttributes, PropsWithChildren } from 'react';
import { cn } from '#app/lib/utils';

// --- Common Base ---
const baseHeadingClasses = 'scroll-m-20 tracking-tight';

// --- H1 ---
type H1Variant =
  | 'default'
  | 'pageHeader'
  | 'pageHeaderBold'
  | 'subtlePageHeader'
  | 'loginHeader'
  | 'errorBoundary'
  | 'pageHeaderWithMargin';

const h1VariantClasses = {
  default: 'text-4xl font-extrabold lg:text-5xl',
  // Foreground comes from the semantic token (`text-foreground`), not a fixed
  // zinc shade, so this tracks the active theme like every other surface.
  pageHeader: 'text-2xl font-semibold text-foreground',
  pageHeaderBold: 'text-2xl font-bold',
  subtlePageHeader: 'text-2xl font-semibold', // No text color by default
  loginHeader: 'text-center text-xl font-bold',
  errorBoundary: 'text-xl font-bold',
  pageHeaderWithMargin: 'text-2xl font-semibold mb-6',
} satisfies Record<H1Variant, string>;

type H1Props = PropsWithChildren<
  HTMLAttributes<HTMLHeadingElement> & {
    variant?: H1Variant;
  }
>;

export function H1({ children, className, variant = 'default', ...props }: H1Props) {
  return (
    <h1 className={cn(baseHeadingClasses, h1VariantClasses[variant], className)} {...props}>
      {children}
    </h1>
  );
}

// --- H2 ---
type H2Variant = 'default' | 'sectionHeader' | 'subSectionHeader' | 'subSectionHeaderWithMargin' | 'keywordsHeader';

const h2VariantClasses = {
  default: 'border-b pb-2 text-3xl font-semibold first:mt-0',
  sectionHeader: 'text-xl font-semibold text-foreground',
  subSectionHeader: 'text-lg font-semibold',
  subSectionHeaderWithMargin: 'text-lg font-semibold mb-2',
  keywordsHeader: 'text-lg font-semibold text-foreground mb-4',
} satisfies Record<H2Variant, string>;

type H2Props = PropsWithChildren<
  HTMLAttributes<HTMLHeadingElement> & {
    variant?: H2Variant;
  }
>;

export function H2({ children, className, variant = 'default', ...props }: H2Props) {
  return (
    <h2 className={cn(baseHeadingClasses, h2VariantClasses[variant], className)} {...props}>
      {children}
    </h2>
  );
}

// --- H3 ---
type H3Variant = 'default' | 'cardHeader' | 'subSectionHeader' | 'websiteAttachmentHeader';

const h3VariantClasses = {
  default: 'text-2xl font-semibold',
  cardHeader: 'text-lg font-medium',
  subSectionHeader: 'text-lg font-semibold text-foreground mb-4',
  websiteAttachmentHeader: 'font-medium text-foreground', // Removed scroll-m-20 tracking-tight here as it was font-medium only before
} satisfies Record<H3Variant, string>;

type H3Props = PropsWithChildren<
  HTMLAttributes<HTMLHeadingElement> & {
    variant?: H3Variant;
  }
>;

export function H3({ children, className, variant = 'default', ...props }: H3Props) {
  // Apply base only if not websiteAttachmentHeader which has specific styling
  const base = variant === 'websiteAttachmentHeader' ? '' : baseHeadingClasses;
  return (
    <h3 className={cn(base, h3VariantClasses[variant], className)} {...props}>
      {children}
    </h3>
  );
}

// --- SectionEyebrow ---
/**
 * The app's small brand-teal section label (M129 soul pass) — uppercase,
 * letter-spaced, `text-primary`. One recipe, used everywhere a group of
 * content needs naming without a full heading: the diary's meal groups and
 * chip rows, the drill-down's internal blocks, the trends sections, the
 * settings card headers.
 *
 * Why a component and not a class string copied around: this is the single
 * most-repeated piece of the branded language, and the whole point of the soul
 * pass is that the same idea looks the same everywhere. It renders a `<p>` by
 * default (most uses label a group, they don't head a document section); pass
 * `as="h2"`/`"h3"` where the label really is the section's heading, so the
 * brand treatment never costs the page its outline.
 *
 * `trailingRule` draws a hairline from the end of the label to the right edge
 * — the diary's meal headers use it to tie the label to the subtotal sitting
 * at the far end of the row.
 */
type SectionEyebrowProps = PropsWithChildren<
  HTMLAttributes<HTMLElement> & {
    as?: 'p' | 'h2' | 'h3' | 'h4';
    trailingRule?: boolean;
  }
>;

export function SectionEyebrow({
  children,
  className,
  as: Tag = 'p',
  trailingRule = false,
  ...props
}: SectionEyebrowProps) {
  const label = (
    <Tag
      className={cn('text-[11px] font-semibold uppercase tracking-[0.11em] text-primary', !trailingRule && className)}
      {...props}
    >
      {children}
    </Tag>
  );
  if (!trailingRule) return label;
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      {label}
      <span className="h-px flex-1 bg-primary/20" aria-hidden="true" />
    </div>
  );
}

// --- P ---
// Three-tier scale (DESIGN.md §4): `default`/`lead` read as primary body copy,
// `subtle`/`small`/`muted` are secondary supporting text, `meta` is tertiary
// metadata (timestamps, attribution, field hints) — the smallest, quietest tier.
type PVariant = 'default' | 'lead' | 'subtle' | 'small' | 'muted' | 'meta';

const pVariantClasses = {
  default: 'leading-7',
  lead: 'text-xl text-muted-foreground',
  subtle: 'text-sm text-muted-foreground',
  small: 'text-sm font-medium leading-none',
  muted: 'text-sm text-muted-foreground',
  meta: 'text-xs text-muted-foreground',
} satisfies Record<PVariant, string>;

type PProps = PropsWithChildren<
  HTMLAttributes<HTMLParagraphElement> & {
    variant?: PVariant;
  }
>;

export function P({ children, className, variant = 'default', ...props }: PProps) {
  return (
    <p className={cn(pVariantClasses[variant], className)} {...props}>
      {children}
    </p>
  );
}
