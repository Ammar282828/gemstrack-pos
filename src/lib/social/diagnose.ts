/**
 * Turning an error into what to do about it.
 *
 * Post a Piece talks to five outside systems (taheri.shop's upload endpoint,
 * Green API for WhatsApp, Instagram, Vertex AI, Firestore/Secret Manager) and
 * each fails in its own vocabulary. The counter should never have to read
 * "Error validating verification code" and guess; every failure is matched here
 * to a plain title, the fix in a sentence, and — where there is one — the
 * button or command that does it. The patterns come from what these systems
 * actually said while this was being set up (2026-09-24) and from their docs.
 *
 * Pure: the page uses it on errors it sees, the server on errors it logs, and
 * the tests pin the matches.
 */

export type Where = 'website' | 'featured' | 'whatsapp' | 'instagram' | 'instagram-connect' | 'ai' | 'caption' | 'network' | 'page';

export interface Action { label: string; href?: string; command?: string }
export interface Diagnosis { title: string; fix: string; action?: Action; retry: boolean }

/** Links and ids the fixes point at; the server fills them from configuration. */
export interface DiagnoseContext {
  site?: string;               // "taheri.shop"
  aiProject?: string;          // "jewelgen-mm-e3d43ecb"
  posProject?: string;         // "gemstrack-pos"
  metaAppId?: string;          // the Meta app (dashboard id), not the Instagram app id
  waLine?: string;             // "+92 326 2275554"
  igUsername?: string;         // "collectionstaheri"
  wahaUrl?: string;            // "https://35-184-20-165.sslip.io" — the WAHA server, when WhatsApp goes through it
}

const GREEN_CONSOLE = 'https://console.green-api.com';
const meta = (c: DiagnoseContext, path = '') => c.metaAppId ? `https://developers.facebook.com/apps/${c.metaAppId}/${path}` : 'https://developers.facebook.com/apps/';
const secretUrl = (c: DiagnoseContext, name: string) => `https://console.cloud.google.com/security/secret-manager/secret/${name}/versions?project=${c.posProject || 'gemstrack-pos'}`;

export function diagnose(where: Where, err: { status?: number; message?: string } | string, c: DiagnoseContext = {}): Diagnosis {
  const status = typeof err === 'string' ? undefined : err.status;
  const msg = (typeof err === 'string' ? err : err.message) || '';
  const m = msg.toLowerCase();
  const site = c.site || 'the website';
  const line = c.waLine || 'the shop’s WhatsApp line';
  const ig = c.igUsername ? `@${c.igUsername}` : 'the shop’s Instagram';

  // ── Anywhere: the phone or laptop itself ─────────────────────────────────
  if (/failed to fetch|networkerror|network request failed|load failed|err_internet_disconnected/.test(m)) {
    return { title: 'No internet connection', fix: 'This device lost its connection. Check the Wi-Fi or mobile data, then press Retry.', retry: true };
  }
  // A name that can't be found at all: the domain's DNS. On 2026-09-24 this was the whole
  // .shop registry going dark for every .shop domain at once — nothing to fix on our side.
  if (/enotfound|nxdomain|eai_again/.test(m) && where !== 'page') {
    const host = msg.match(/(?:ENOTFOUND|EAI_AGAIN)\s+([\w.-]+)/i)?.[1] ?? (where.startsWith('instagram') ? 'the POS’s address' : site);
    return {
      title: `${host} can’t be found by name`,
      fix: `The address ${host} isn’t resolving (DNS). If other sites on the same ending (like .shop) are also down, it’s the registry and it will come back by itself — meanwhile use the POS at its backup address, studio--gemstrack-pos.us-central1.hosted.app. If only this domain is down, check it with the registrar (Hostinger).`,
      retry: true,
    };
  }
  // The server's own "couldn't reach it" (Node's fetch), as opposed to the browser's above.
  if (/fetch failed|enotfound|econnrefused|econnreset|etimedout|getaddrinfo|socket hang up|timed out/.test(m) && where !== 'page') {
    const who = where === 'website' || where === 'featured' ? site
      : where === 'whatsapp' ? 'Green API (the WhatsApp line)'
        : where.startsWith('instagram') ? 'Instagram'
          : 'Google’s AI service';
    return {
      title: `${who.charAt(0).toUpperCase()}${who.slice(1)} can’t be reached`,
      fix: where === 'website' || where === 'featured'
        ? `The POS couldn’t reach ${site}. Open it in a browser: if it doesn’t load, the host (Hostinger) is down or slow — wait and try again. If it loads, press Retry.`
        : `The POS couldn’t reach ${who} just now. That’s usually brief — wait a minute and press Retry.`,
      retry: true,
    };
  }

  switch (where) {
    case 'website':
    case 'featured': {
      if (status === 401 || /unauthori[sz]ed/.test(m) || /upload refused \(401\)/.test(m)) {
        return { title: `${site} refused the upload key`, fix: `The upload key on the POS and on ${site} don’t match. Ask for them to be set to the same value (WEBSITE_UPLOAD_SECRET here, .website-upload-secret on the server).`, retry: false };
      }
      if (status === 503 || /not configured|no website_upload_secret/.test(m)) {
        return { title: 'Website uploads are switched off', fix: `Neither side has an upload key set up yet. Until it is, photos can’t go to ${site} from here.`, retry: false };
      }
      if (status === 413 || /over \d+ ?mb|too large/.test(m)) {
        return { title: 'Photo too large', fix: 'That photo is over the size limit. Retake it at a lower resolution or send a smaller copy.', retry: false };
      }
      if (status === 504 || /did not answer in time|timeout|timed out/.test(m)) {
        return { title: `${site} is slow right now`, fix: `The upload may still have arrived. Open the collection on ${site} to check before pressing Retry, or you may get a duplicate.`, retry: true };
      }
      if (status === 415 || /heic|not a jpeg/.test(m)) {
        return { title: 'Photo format not accepted', fix: 'Export the photo as a JPEG (on iPhone: share → Save as JPEG, or set Camera → Formats → Most Compatible) and add it again.', retry: false };
      }
      if (/choose a collection/.test(m)) return { title: 'No collection chosen', fix: 'Pick which collection on the website this piece goes into.', retry: false };
      if (where === 'featured') return { title: 'Could not set the set of the day', fix: 'The photo is on the website, but it isn’t the set of the day yet. Press Retry, or set it later from Photo Weights.', retry: true };
      break;
    }

    case 'whatsapp': {
      // WAHA (the shop's own gateway on the `waha` VM) — its errors carry "WAHA".
      if (/waha 401|waha.*(unauthori[sz]ed|api key)/.test(m)) {
        return { title: 'WAHA refused the key', fix: 'WAHA_API_KEY in this shop’s settings doesn’t match the key the WAHA server holds (secret waha-api-key in gemstrack-pos). They must be the same version of that secret; after changing it, reset the waha VM so it picks the new one up.', action: { label: 'Open the secret', href: secretUrl(c, 'waha-api-key') }, retry: false };
      }
      if (/scan_qr_code|not linked to waha|waha.*(failed|stopped|starting)|(failed|stopped).*waha/.test(m)) {
        return { title: 'The WhatsApp line is unlinked from WAHA', fix: `${line} needs linking to WAHA again. Open the WAHA dashboard, open the session “default”, and scan the QR code with the phone that has ${line} (WhatsApp → Linked devices → Link a device).`, action: c.wahaUrl ? { label: 'Open WAHA', href: `${c.wahaUrl}/dashboard` } : undefined, retry: true };
      }
      if (/waha (50[234])|waha.*(fetch failed|econnrefused|timed? ?out|aborted)|(fetch failed|econnrefused).*waha/.test(m)) {
        return { title: 'The WAHA server isn’t answering', fix: 'The waha VM in Google Cloud (gemstrack-pos, us-central1-a) may be stopped or restarting. Start or reset it in Compute Engine → VM instances; WAHA and the linked line come back by themselves within a couple of minutes.', action: { label: 'Open VM instances', href: `https://console.cloud.google.com/compute/instances?project=${c.posProject || 'gemstrack-pos'}` }, retry: true };
      }
      if (/channel not found|newsletter.*not found/.test(m)) {
        return { title: 'The channel could not be found', fix: `The WhatsApp channel set for this shop (WHATSAPP_CHANNEL_ID) isn’t visible to ${line}. Check the id, and that ${line} still follows the channel as an admin.`, retry: false };
      }
      if (/channel not admin|green api cannot post to a whatsapp channel/.test(m)) {
        return { title: /green api/.test(m) ? 'Channels need WAHA' : 'The line is not an admin of the channel', fix: /green api/.test(m) ? 'Green API can’t post to WhatsApp channels. Set WAHA_URL and WAHA_API_KEY for this shop.' : `Only the channel’s owner and admins can post. In WhatsApp, open the channel → Channel info → Admins → invite ${line}, and accept the invite on that phone.`, retry: false };
      }
      if (/notauthorized|not authorized|not_authorized|rescan|qr/.test(m) || status === 401) {
        return { title: 'The WhatsApp line is signed out', fix: `${line} has been logged out of Green API. Open the Green API console, open the instance, and scan the QR code with the phone that has ${line} (WhatsApp → Linked devices → Link a device).`, action: { label: 'Open Green API', href: GREEN_CONSOLE }, retry: true };
      }
      if (status === 466 || /exceed|limitation on plan|quota/.test(m)) {
        return { title: 'Green API plan limit reached', fix: 'The Green API plan has hit its sending limit (the free Developer plan only allows a few chats). Upgrade the instance to a Business plan in the Green API console.', action: { label: 'Open Green API', href: GREEN_CONSOLE }, retry: false };
      }
      if (/yellowcard|blocked|banned/.test(m)) {
        return { title: 'WhatsApp has restricted the line', fix: `WhatsApp has flagged ${line}. Stop sending from it for a day, open WhatsApp on that phone and follow any prompt, then try again.`, retry: false };
      }
      if (/chat id|chatid|not a group|invalid number|not found/.test(m)) {
        return { title: 'The community could not be found', fix: `The community's announcements group isn't reachable from ${line}. Check that number is still in the community and still an admin.`, retry: false };
      }
      if (/admin|not allowed|forbidden/.test(m) || status === 403) {
        return { title: 'The line is not an admin of the community', fix: `Only admins can post in the announcements. In WhatsApp, open the community → Announcements → Group info → make ${line} an admin.`, retry: false };
      }
      if (/no whatsapp community is set|whatsapp_community_chat_id/.test(m)) {
        return { title: 'No community is set for this shop', fix: 'WHATSAPP_COMMUNITY_CHAT_ID isn’t set in this shop’s settings, so there’s nowhere to post.', retry: false };
      }
      if (/is not configured|greenapi_id_instance|waha_url/.test(m) || status === 503) {
        return { title: 'The WhatsApp line isn’t set up', fix: 'This shop has no WhatsApp gateway: WAHA_URL and WAHA_API_KEY (or Green API’s GREENAPI_ID_INSTANCE and GREENAPI_API_TOKEN) are missing from its settings.', retry: false };
      }
      if (status === 429 || /too many/.test(m)) return { title: 'Sending too fast', fix: 'Green API asked us to slow down. Wait a minute and press Retry.', retry: true };
      break;
    }

    case 'instagram-connect':
    case 'instagram': {
      if (/redirect_uri|error validating verification code|client_secret|invalid client/.test(m)) {
        return { title: 'Instagram rejected the app secret', fix: 'The secret saved for Instagram is wrong — usually the Meta app secret (App settings → Basic) was saved instead of the Instagram one. On the Meta dashboard open Instagram → API setup with Instagram login, press Show next to “Instagram app secret”, and add it as a new version of the secret. Then redeploy and connect again.', action: { label: 'Add the secret', href: secretUrl(c, 'instagram-app-secret') }, retry: false };
      }
      if (/authorization code has been used|code has expired|invalid authorization code/.test(m)) {
        return { title: 'The Instagram sign-in expired', fix: 'That approval can only be used once. Press Connect Instagram again and approve once more.', retry: false };
      }
      if (/only @|that was @/.test(m)) {
        return { title: 'Wrong Instagram account', fix: `Instagram was signed in as someone else. Log out of Instagram in this browser, press Connect Instagram, and sign in as ${ig}.`, retry: false };
      }
      if (/not connected yet|expired\. connect|error validating access token|session has expired|access token|oauthexception.*190|code":190/.test(m) || /\b190\b/.test(m)) {
        return { title: 'Instagram needs connecting again', fix: `The link to ${ig} has lapsed. Press Connect Instagram on this page and approve as ${ig}.`, retry: false };
      }
      if (/insufficient|permission|scope|\(#10\)|\(#200\)/.test(m)) {
        return { title: 'Instagram posting permission is missing', fix: 'The Meta app needs instagram_business_content_publish. On the Meta dashboard add it under Permissions and features, then press Connect Instagram again.', action: { label: 'Open the Meta app', href: meta(c, 'use_cases/') }, retry: false };
      }
      if (/tester|not.*(allowed|authorized) to use|app not active|not available/.test(m)) {
        return { title: 'The account isn’t a tester of the app', fix: `On the Meta dashboard → App roles → Roles, add ${ig} as an Instagram Tester, then accept the invite in Instagram (Settings → Website permissions → Apps and websites → Tester invites).`, action: { label: 'Open App roles', href: meta(c, 'roles/roles/') }, retry: false };
      }
      if (/only photo or video can be accepted|media download|could not be fetched|failed to download|9004|image_url/.test(m)) {
        return { title: 'Instagram couldn’t fetch the image', fix: 'Instagram couldn’t download the story from the POS. Press Retry; if it keeps happening, the POS’s public address is unreachable — open the checks below.', retry: true };
      }
      if (/aspect ratio|36003|unsupported|2207026|2207004|format/.test(m)) {
        return { title: 'Instagram didn’t accept the image', fix: 'Instagram rejected the image’s size or format. Save the story and post it from your phone, and tell the developer the exact message.', retry: false };
      }
      if (/publishing limit|content_publishing_limit|application request limit|rate limit|\(#4\)|\(#17\)|\(#32\)|\(#613\)/.test(m) || status === 429) {
        return { title: 'Instagram’s daily limit reached', fix: 'Instagram allows 100 API posts a day and a burst limit per hour. Wait and try later, or share the story from your phone now.', retry: true };
      }
      if (/could not save the instagram connection|could not read the instagram connection/.test(m)) {
        return { title: 'The POS can’t store the Instagram login', fix: 'The POS lacks access to its instagram-token secret. It needs Secret Accessor and Secret Version Adder on it for the App Hosting account.', action: { label: 'Open the secret', href: secretUrl(c, 'instagram-token') }, retry: false };
      }
      if (/not set up for this shop|instagram_app_id/.test(m)) {
        return { title: 'Instagram isn’t set up', fix: 'INSTAGRAM_APP_ID or INSTAGRAM_APP_SECRET is missing from this shop’s settings.', retry: false };
      }
      break;
    }

    case 'ai':
    case 'caption': {
      if (status === 403 || /permission_denied|aiplatform\.endpoints\.predict|permission .* denied/.test(m)) {
        const cmd = c.aiProject ? `gcloud projects add-iam-policy-binding ${c.aiProject} --member=serviceAccount:firebase-app-hosting-compute@${c.posProject || 'gemstrack-pos'}.iam.gserviceaccount.com --role=roles/aiplatform.user` : undefined;
        return { title: 'The POS isn’t allowed to use the AI', fix: `The AI project${c.aiProject ? ` (${c.aiProject})` : ''} doesn’t let the POS in. Its owner has to grant the POS “Vertex AI User”.`, action: cmd ? { label: 'Copy the fix command', command: cmd } : undefined, retry: false };
      }
      if (status === 404 || /not found or your project does not have access|publisher model/.test(m)) {
        return { title: 'The AI model has been renamed or retired', fix: 'Google no longer serves the model by that name. Set IMAGE_AI_MODEL (or IMAGE_AI_TEXT_MODEL) to the current one — for Nano Banana Pro that was gemini-3-pro-image in Sept 2026.', retry: false };
      }
      if (status === 429 || /resource_exhausted|quota|out of quota|credit/.test(m)) {
        return { title: 'AI is busy or out of credit', fix: 'Google is limiting requests or the Jewel Gen project is out of credit. Wait a minute and try again; if it keeps happening, check billing on that project.', action: c.aiProject ? { label: 'Open billing', href: `https://console.cloud.google.com/billing/linkedaccount?project=${c.aiProject}` } : undefined, retry: true };
      }
      if (/ai limit for now is reached/.test(m)) {
        return { title: 'Today’s AI allowance is used up', fix: 'The shop-wide cap protects against runaway spending. Wait for it to reset, or raise IMAGE_AI_DAILY_CAP.', retry: true };
      }
      if (/did not make an image|safety|blocked|prohibited|finishreason/.test(m)) {
        return { title: 'The AI declined that one', fix: 'The model wouldn’t make this image. Try a different setting, describe it differently, or use Enhance instead.', retry: true };
      }
      if (/not set up for this shop|image_ai_project/.test(m)) {
        return { title: 'AI isn’t set up for this shop', fix: 'IMAGE_AI_PROJECT is missing from this shop’s settings.', retry: false };
      }
      if (status === 504 || status === 502 || /timeout|deadline|aborted/.test(m)) {
        return { title: 'The AI took too long', fix: 'Big images can take a minute. Press it again; if it keeps timing out, try a smaller photo.', retry: true };
      }
      break;
    }
  }

  return {
    title: 'Something went wrong',
    fix: `${msg ? `“${msg.slice(0, 160)}”. ` : ''}Press Retry. If it happens again, open the checks at the top of this page — they test every connection and say what to fix.`,
    retry: true,
  };
}
