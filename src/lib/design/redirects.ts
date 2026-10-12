/**
 * Where the old addresses went when Design took over (docs/features/design.md, "URLs and redirects"). Pure: the
 * redirect pages (`/website/post`, `/ads/studio`, `/website/from-site`) read their query, ask `redirectFor`, and
 * redirect. Every parameter that is not part of the move itself (`?draft=`, `?site=`, `?new=1`, `?dev=1`…) is
 * carried along unchanged, in its order, after the ones the move writes.
 *
 * Only addresses that moved are here; `/website/edit`, `/website/photos`, `/posts`, `/ads/new`… did not.
 */

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

const asParams = (p: Params): URLSearchParams => {
  if (p instanceof URLSearchParams) return new URLSearchParams(p);
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, one);
  return q;
};

/** `path?a=1&b=2` from the move's own parameters, then the rest as they came. */
function build(path: string, own: [string, string][], rest: URLSearchParams): string {
  const q = new URLSearchParams();
  for (const [k, v] of own) q.set(k, v);
  rest.forEach((v, k) => q.append(k, v));
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

const PLAN_PARTS = ['plays', 'guide', 'rivals'];
const PHOTO_PARTS = ['picks', 'library'];

/** The new address for an old one, or null when the address did not move. */
export function redirectFor(pathname: string, params: Params): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const q = asParams(params);

  // Post a piece: Design's Make. ?draft=, ?site= and ?new=1 ride along; Design reads them.
  if (path === '/website/post') return build('/design', [['v', 'make']], q);

  // From the website was the Posts hub's before it was Design's: unchanged since 2026-10-04.
  if (path === '/website/from-site') return build('/posts', [], q);

  if (path === '/ads/studio') {
    const v = q.get('v') ?? '';
    const s = q.get('s') ?? '';
    q.delete('v'); q.delete('s');
    if (v === 'make') return build('/design', [['v', 'make'], ['kind', 'ad']], q);
    if (v === 'board' || v === 'saved') return build('/design', [['v', v]], q);
    if (v === 'photos' || v === 'picks' || v === 'library') {
      const part = v === 'photos' ? (PHOTO_PARTS.includes(s) ? s : 'picks') : v;
      return build('/design', [['v', 'photos'], ['s', part]], q);
    }
    if (v === 'guide' || v === 'rivals') return build('/ads/plan', [['s', v]], q);
    // 'plan', nothing, or anything unknown: the Studio opened on its Plan.
    return build('/ads/plan', PLAN_PARTS.includes(s) ? [['s', s]] : [], q);
  }

  return null;
}

/** Every old address the table above answers, for the test and the docs. */
export const MOVED_PATHS = ['/website/post', '/website/from-site', '/ads/studio'] as const;
