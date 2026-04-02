/**
 * Gold Rate Update — Investments by Taheri
 *
 * Fetches live gold spot + USD/PKR, then uses Gemini (with Google Search grounding)
 * to produce a WhatsApp-formatted market update (A1 routine / A2 deep-dive).
 *
 * Also provides a breaking-news checker that only fires when something significant
 * happened in the last 60 minutes.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// ── Live data helpers ────────────────────────────────────────────────────────

async function fetchJson(url: string, timeout = 8000): Promise<any> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal,
    });
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

async function getGoldSpot(): Promise<number | null> {
  try {
    const data = await fetchJson('https://api.metals.live/v1/spot/gold');
    if (Array.isArray(data) && data.length > 0) return data[0].gold;
  } catch {}
  try {
    const data = await fetchJson(
      'https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD',
    );
    if (Array.isArray(data) && data.length > 0)
      return data[0]?.spreadProfilePrices?.[0]?.ask ?? null;
  } catch {}
  return null;
}

async function getUsdPkr(): Promise<number | null> {
  try {
    const data = await fetchJson('https://open.er-api.com/v6/latest/USD');
    return data?.rates?.PKR ?? null;
  } catch {}
  return null;
}

// ── Gemini helpers ───────────────────────────────────────────────────────────

function getGemini() {
  const key = process.env.GOOGLE_GENAI_API_KEY;
  if (!key) throw new Error('GOOGLE_GENAI_API_KEY not set');
  return new GoogleGenerativeAI(key);
}

function cleanGeminiOutput(raw: string, todayStr: string): string {
  let text = raw.trim();

  // Strip code fences
  if (text.startsWith('```')) text = text.split('\n').slice(1).join('\n');
  if (text.endsWith('```')) text = text.split('\n').slice(0, -1).join('\n');
  text = text.trim();

  // Strip leaked search preamble — find the actual message start
  for (const marker of ['📊', '💰', '🚨']) {
    const idx = text.indexOf(marker);
    if (idx > 0) {
      text = text.substring(idx);
      break;
    }
  }

  // Convert markdown links [text](url) → bare URL
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$2');
  // [https://...] → bare
  text = text.replace(/\[(https?:\/\/[^\]]+)\]/g, '$1');

  // If headline 📊 is missing, inject a generic one
  if (!text.startsWith('📊')) {
    text = `📊 *GOLD RATE UPDATE — ${todayStr}*\n_Investments by Taheri | ${todayStr}_\n━━━━━━━━━━━━━━━\n\n${text}`;
  }

  return text.trim();
}

// ── Daily update ─────────────────────────────────────────────────────────────

export async function generateGoldDailyUpdate(): Promise<string> {
  const todayStr = new Date()
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();

  const [spotUsd, usdPkr] = await Promise.all([getGoldSpot(), getUsdPkr()]);
  const pkrTola =
    spotUsd && usdPkr ? Math.round((spotUsd / 2.6667) * usdPkr / 100) * 100 : null;

  let dataBlock = '';
  dataBlock += spotUsd
    ? `- Gold spot price: $${spotUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })} per troy oz (fetched live)\n`
    : '- Gold spot price: COULD NOT FETCH — use your search to get current Kitco price\n';
  dataBlock += usdPkr
    ? `- USD/PKR rate: ${usdPkr.toFixed(2)}\n`
    : '- USD/PKR rate: COULD NOT FETCH — search for current rate\n';
  dataBlock += pkrTola
    ? `- Calculated PKR per tola: PKR ${pkrTola.toLocaleString('en-PK')}\n`
    : '- PKR per tola: calculate from above once you have both figures\n';

  const prompt = `
You are the analyst behind "Investments by Taheri", a WhatsApp investment education channel for Pakistani investors focused on gold.

Today's date: ${todayStr}

LIVE DATA I'VE FETCHED FOR YOU:
${dataBlock}

YOUR TASK:
1. Use Google Search to find:
   - Whether today's gold move was >=2% (look for the day's % change)
   - The previous close price so you can calculate exact PKR day change
   - The 1-2 dominant market drivers today (Fed, geopolitics, dollar, CPI, etc.)
   - Any forward-looking events relevant to gold this week
   - The Pakistan local gold price from gold.pk or any Pakistani source if available

2. Decide the format:
   - Gold moved >=2% OR major macro event (Fed decision, geopolitical shock, major weekly move) -> USE A2
   - Routine day, no major event -> USE A1

3. Write ONLY the final WhatsApp-formatted message. No preamble. No explanation.

A1 FORMAT (routine day):

📊 *GOLD RATE UPDATE — ${todayStr}*
━━━━━━━━━━━━━━━

💰 *TODAY'S PRICES*
• International: $[X,XXX] per oz _(source: Kitco)_
• Pakistan: PKR [XXX,XXX] per tola _(source: Gold.pk)_

━━━━━━━━━━━━━━━

*WHAT'S MOVING IT*
[2-3 sentences. Name the 1-2 dominant drivers. Plain English. Specific.]

━━━━━━━━━━━━━━━

*OUTLOOK*
[1-2 sentences. One near-term directional read. Honest about uncertainty.]

━━━━━━━━━━━━━━━
⚠️ Educational content only. Not investment advice.
_— Investments by Taheri_

A2 FORMAT (>=2% move or major event):

📊 *[ONE-LINE HEADLINE CAPTURING TODAY'S STORY]*
_Investments by Taheri | ${todayStr}_
━━━━━━━━━━━━━━━

💰 *CURRENT PRICES*
• International: $[X,XXX] per oz _(source: Kitco)_
• Pakistan: PKR [XXX,XXX] per tola _(source: Gold.pk)_
• Day change: [+/-PKR X,XXX vs yesterday]

━━━━━━━━━━━━━━━

*WHAT'S HAPPENING*
[3-5 sentences. What moved, by how much, since when. Be specific with numbers.]

━━━━━━━━━━━━━━━

*WHY IT'S MOVING*
*1️⃣ [Driver name]*
[1-2 sentences: cause -> effect -> impact on gold]

*2️⃣ [Driver name]*
[1-2 sentences]

━━━━━━━━━━━━━━━

🇵🇰 *PAKISTAN CONTEXT*
[Only include if PKR moved or there is something genuinely Pakistan-specific. Trace the chain to the buyer's pocket. Skip if nothing relevant.]

━━━━━━━━━━━━━━━

*WHAT TO WATCH*
• [Event] — [when] — [what it means for gold and why]
• [Event] — [when] — [what it means for gold and why]

━━━━━━━━━━━━━━━

*OUTLOOK*
[3-5 sentences. State the falling chain. State the recovery chain. Name the key trigger explicitly.]

━━━━━━━━━━━━━━━

📚 *SOURCES*
[Source name] — [brief description] — [URL]
[Source name] — [brief description] — [URL]

━━━━━━━━━━━━━━━
⚠️ Educational content only. Not investment advice.
_— Investments by Taheri_

STRICT RULES:
- WhatsApp formatting only: *bold*, _italics_. No markdown headers (## / **).
- No ALL CAPS section headers.
- Numbers must be specific. Never say "gold rose" without giving the actual price and move.
- The headline, prices, day change, and "What's Happening" must be internally consistent.
- If you cannot verify a figure, say "approx." rather than guessing with false precision.
- PKR per tola = (USD spot / 2.6667) x USD/PKR rate. Double-check your arithmetic.
- A1: readable in under 30 seconds. A2: readable in under 2 minutes. Cut ruthlessly.
- Sources: use the actual domain URLs (e.g. https://kitco.com, https://gold.pk). Never use Google redirect URLs. Write bare URLs, not markdown links.
- The very first line of your output must ALWAYS be the 📊 emoji line.
- Output ONLY the final message. Nothing before it. Nothing after it.
`;

  const genAI = getGemini();
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    // google_search tool (not googleSearchRetrieval) for gemini-2.0-flash
    tools: [{ googleSearch: {} } as any],
    generationConfig: { temperature: 0.4 },
  });

  const result = await model.generateContent(prompt);
  const raw = result.response.text();
  return cleanGeminiOutput(raw, todayStr);
}

// ── Breaking news checker ────────────────────────────────────────────────────

export async function checkGoldBreakingNews(): Promise<string | null> {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();

  const prompt = `
You are the analyst behind "Investments by Taheri", a WhatsApp investment education channel.

Current time: ${timeStr} PKT, ${dateStr}

YOUR TASK:
Use Google Search to check if ANY of the following happened in the LAST 60 MINUTES:
1. Gold price moved 1.5%+ in a single hour
2. Surprise central bank decision (Fed, ECB, BOJ, PBOC) affecting gold
3. Major geopolitical shock (war escalation, ceasefire, sanctions) affecting gold
4. Surprise economic data release (CPI, NFP, GDP) that significantly moved markets
5. Any breaking news that caused a sharp gold move

If NONE of these qualify, respond with exactly: NO_ALERT

If something DOES qualify, write a WhatsApp-formatted breaking alert:

🚨 *BREAKING: [HEADLINE]*
_Investments by Taheri | ${timeStr} PKT_
━━━━━━━━━━━━━━━
[2-3 sentences: what happened, the numbers, what it means for gold. Be specific.]
━━━━━━━━━━━━━━━
⚠️ Educational content only. Not investment advice.

STRICT RULES:
- Only alert for genuinely significant events. Routine 0.5% moves are NOT alerts.
- If unsure, respond NO_ALERT. False alarms destroy credibility.
- WhatsApp formatting: *bold*, _italics_. No markdown.
- Include specific numbers (price, % change).
- Output ONLY the alert message or NO_ALERT. Nothing else.
`;

  const genAI = getGemini();
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    tools: [{ googleSearch: {} } as any],
    generationConfig: { temperature: 0.2 },
  });

  const result = await model.generateContent(prompt);
  const raw = result.response.text().trim();

  if (raw.includes('NO_ALERT') || !raw.includes('🚨')) {
    return null; // No breaking news
  }

  return cleanGeminiOutput(raw, dateStr);
}
