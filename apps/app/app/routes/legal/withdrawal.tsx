/**
 * `/withdrawal`: the `withdrawal` page of the mounted content folder (M246 spec 01).
 *
 * The text is not in this repository. The loader reads
 * `<CONTENT_DIR>/<lang>/withdrawal.md` for this request's language (English when
 * that language has no file) and the page draws it; no file is a 404, a file
 * that breaks the format is a 503. See `docs/content.md`.
 */
import type { Route } from './+types/withdrawal';
import { ContentPageView } from '#app/components/content-article';
import { loadContentPageOrThrow } from '#app/lib/content/content-route.server';
import { contentPageTitle } from '#app/lib/content/content-page-title';
import '#app/i18n/i18n';

export async function loader({ request }: Route.LoaderArgs) {
  return { page: await loadContentPageOrThrow({ request, slug: 'withdrawal' }) };
}

export const meta: Route.MetaFunction = ({ loaderData }) => [{ title: contentPageTitle(loaderData?.page.title ?? null) }];

export default function Withdrawal({ loaderData }: Route.ComponentProps) {
  return <ContentPageView page={loaderData.page} />;
}
