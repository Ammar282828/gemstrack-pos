/**
 * A photograph this browser can draw, from whatever a picker handed over.
 *
 * Every photo action offers the Photos library as well as the camera (the owner, 2026-09-25:
 * "allow me to add a pic from the Photos app … or any other action needing a photo"). An
 * iPhone's library gives a web page a JPEG, but Chrome on a Mac hands over the HEIC as it is,
 * and Chrome cannot decode HEIC (Safari can). Anything this browser cannot read goes to
 * /api/photo/convert and comes back a JPEG, under the same name.
 */

import { authedFetch } from '@/lib/voice/authed-fetch';

async function canDecode(file: Blob): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(file);
    bitmap.close();
    return true;
  } catch {
    return false;
  }
}

export async function readablePhoto(file: File): Promise<File> {
  if (await canDecode(file)) return file;
  const form = new FormData();
  form.set('file', file, file.name);
  const res = await authedFetch('/api/photo/convert', { method: 'POST', body: form });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `Could not read ${file.name}. Export it as a JPEG and try again.`);
  }
  return new File([await res.blob()], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}
