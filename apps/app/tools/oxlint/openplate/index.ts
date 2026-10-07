import { eslintCompatPlugin } from '@oxlint/plugins';

import { noTrailingSlashLinkRule } from './rules/no-trailing-slash-link.ts';

/** Oxlint rules written for openplate itself. `anti-slop` is vendored verbatim, so nothing of ours goes in it. */
const openplatePlugin = eslintCompatPlugin({
  meta: { name: 'openplate' },
  rules: {
    'no-trailing-slash-link': noTrailingSlashLinkRule,
  },
});

export default openplatePlugin;
