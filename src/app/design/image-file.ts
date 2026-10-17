/**
 * A photograph from this device that the canvas can draw. A file this browser cannot decode (an iPhone's HEIC in
 * Chrome or Firefox) goes to the ERP and comes back a JPEG — as Post a piece did for every photo it was given.
 */

import { loadImage } from '@/lib/social/story';
import { authHeaders } from '../ads/ads-kit';

export async function readImageFile(file: File): Promise<{ blob: Blob; name: string }> {
  const url = URL.createObjectURL(file);
  try {
    await loadImage(url);
    return { blob: file, name: file.name };
  } catch {
    const form = new FormData();
    form.set('file', file, file.name);
    const res = await fetch('/api/website/post/convert', { method: 'POST', headers: await authHeaders(), body: form });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `Could not read ${file.name}`);
    return { blob: await res.blob(), name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
  } finally { URL.revokeObjectURL(url); }
}
