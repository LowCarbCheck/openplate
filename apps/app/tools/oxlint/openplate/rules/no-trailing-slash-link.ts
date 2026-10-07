import { defineRule } from '@oxlint/plugins';

import type { ESTree } from '@oxlint/plugins';

import { findTrailingSlash, isSiteExpressionName } from '../shared/own-site-url.ts';
import type { LinkScope } from '../shared/own-site-url.ts';

const LINK_ATTRIBUTES = new Set(['to', 'href']);
const LINK_DECLARATOR_NAME = /(?:_PATH|_URL|_HREF)$/u;

/** Calls that take a site path, and the index of that argument. */
const SITE_PATH_ARGUMENT_INDEX = new Map([
  ['projectSiteUrl', 1],
  ['useProjectSiteUrl', 0],
]);

/** Where a string is an import or export source, never a link. */
const MODULE_SOURCE_PARENTS = new Set([
  'ImportDeclaration',
  'ImportExpression',
  'ExportAllDeclaration',
  'ExportNamedDeclaration',
]);

type LinkNode = ESTree.StringLiteral | ESTree.TemplateLiteral;

/** Looks through `as`, `satisfies`, `!` and parentheses, so `'/x/' satisfies Path` is still a string. */
function unwrap(node: ESTree.Node | null | undefined): ESTree.Node | null {
  let current = node ?? null;
  while (
    current !== null &&
    (current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'ParenthesizedExpression')
  ) {
    current = current.expression;
  }
  return current;
}

function isStringLiteral(node: ESTree.Node): node is ESTree.StringLiteral {
  return node.type === 'Literal' && typeof node.value === 'string';
}

function asLinkNode(node: ESTree.Node | null | undefined): LinkNode | null {
  const inner = unwrap(node);
  if (inner === null) return null;
  if (inner.type === 'TemplateLiteral' || isStringLiteral(inner)) return inner;
  return null;
}

function staticPieces(node: LinkNode): string[] {
  if (node.type === 'Literal') return [node.value];
  return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw);
}

/** The name an expression goes by: `PROJECT_SITE_URL`, or `siteUrl` in `config.siteUrl`. */
function expressionName(node: ESTree.Node | undefined): string | null {
  const inner = unwrap(node);
  if (inner === null) return null;
  if (inner.type === 'Identifier') return inner.name;
  if (inner.type === 'MemberExpression' && !inner.computed && inner.property.type === 'Identifier') {
    return inner.property.name;
  }
  return null;
}

/** Reject a trailing slash in a link to our own sites. */
export const noTrailingSlashLinkRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow a trailing slash in the path of a link to openplate.de, www.openplate.de, app.openplate.de or api.openplate.de.',
    },
    messages: {
      trailingSlash:
        'The link `{{written}}` ends its path in a slash. Our sites name the slashless address and nginx answers the slash form with a 301, so the slash costs a redirect hop. Write `{{fixed}}`.',
    },
  },
  createOnce(context) {
    const reported = new WeakSet<ESTree.Node>();

    function check(node: ESTree.Node | null | undefined, scope: LinkScope): void {
      const link = asLinkNode(node);
      if (link === null || reported.has(link)) return;
      const finding = findTrailingSlash({
        quasis: staticPieces(link),
        scope,
        startsWithSiteExpression:
          link.type === 'TemplateLiteral' && isSiteExpressionName(expressionName(link.expressions[0])),
      });
      if (finding === null) return;
      reported.add(link);
      context.report({ node: link, messageId: 'trailingSlash', data: { ...finding } });
    }

    function checkAnyString(node: ESTree.Node): void {
      if (MODULE_SOURCE_PARENTS.has(node.parent?.type ?? '')) return;
      check(node, 'own-site-url');
    }

    return {
      // Position 1: any string or template that is an absolute URL on one of our hosts.
      Literal: checkAnyString,
      TemplateLiteral: checkAnyString,
      // Position 2: `to` and `href` on a JSX element. A wrapper stays out of the way, so a quoted
      // value and a `{...}` container are read the same.
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || !LINK_ATTRIBUTES.has(node.name.name)) return;
        const value = node.value;
        if (value === null) return;
        check(value.type === 'JSXExpressionContainer' ? value.expression : value, 'own-site-url-or-path');
      },
      // Position 3: the path argument of the site-link helpers.
      CallExpression(node) {
        if (node.callee.type !== 'Identifier') return;
        const index = SITE_PATH_ARGUMENT_INDEX.get(node.callee.name);
        if (index === undefined) return;
        check(node.arguments[index], 'own-site-url-or-path');
      },
      // Position 4: a `const` or `let` named like an address.
      VariableDeclaration(node) {
        if (node.kind !== 'const' && node.kind !== 'let') return;
        for (const declarator of node.declarations) {
          if (declarator.id.type !== 'Identifier' || !LINK_DECLARATOR_NAME.test(declarator.id.name)) continue;
          check(declarator.init, 'own-site-url-or-path');
        }
      },
    };
  },
});
