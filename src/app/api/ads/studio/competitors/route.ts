/**
 * The studio's competitors (research.ts).
 *
 * GET                                    the saved list, each with its last profile and reading
 * POST { action: 'find', brief? }        Google Search names competitors (not saved until added)
 * POST { action: 'add', username, name?, website?, city?, why?, source? }
 * POST { action: 'remove', username }
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate, noStore } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { addCompetitor, findCompetitors, listCompetitors, removeCompetitor } from '@/lib/ads/studio/research';
import { adLibraryUrl } from '@/lib/ads/studio/rivals';
import { studioAiGate, studioFail } from '@/lib/ads/studio/route-kit';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const withLinks = <T extends { name: string; username: string; adPageId?: string | null }>(c: T) => ({ ...c, adLibrary: adLibraryUrl(c.name || c.username, c.adPageId), instagram: `https://www.instagram.com/${c.username}/` });

export async function GET(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  try {
    return NextResponse.json({ competitors: (await listCompetitors()).map(withLinks) }, { headers: noStore });
  } catch (e) {
    return studioFail(e, 'competitors');
  }
}

export async function POST(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const s = (k: string, max = 300) => (typeof b[k] === 'string' ? (b[k] as string).trim().slice(0, max) : '');
    if (b.action === 'find') {
      const blocked = await studioAiGate(req);
      if (blocked) return blocked;
      const found = await findCompetitors(s('brief', 300));
      return NextResponse.json({ found: found.map(f => ({ ...f, adLibrary: adLibraryUrl(f.name) })) }, { headers: noStore });
    }
    if (b.action === 'add') {
      const c = await addCompetitor({ username: s('username', 120), name: s('name', 120), website: s('website', 200), city: s('city', 60), why: s('why', 300), source: b.source === 'search' ? 'search' : 'owner' });
      return NextResponse.json({ competitor: withLinks(c) }, { headers: noStore });
    }
    if (b.action === 'remove') {
      await removeCompetitor(s('username', 120));
      return NextResponse.json({ ok: true }, { headers: noStore });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return studioFail(e, 'competitors');
  }
}
