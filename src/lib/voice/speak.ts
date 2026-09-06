/**
 * The assistant's own voice.
 *
 * Uses the browser's built-in speech synthesis rather than a paid service: it costs
 * nothing, needs no key, and works with the shop computer offline. The replies are one or
 * two short sentences, which is well within what a local voice handles cleanly — the
 * quality gap against a paid API only really shows over long passages.
 *
 * Everything here resolves when speaking has actually FINISHED, because the microphone is
 * reopened straight afterwards and must never be listening while the app is talking.
 */

export const speechOutputSupported = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window

/**
 * Voices load asynchronously in Chrome — getVoices() is empty on the first call and fills
 * in later, so it is worth waiting once rather than falling back to the default forever.
 */
function voicesReady(): Promise<SpeechSynthesisVoice[]> {
  const have = window.speechSynthesis.getVoices()
  if (have.length) return Promise.resolve(have)
  return new Promise((resolve) => {
    const done = () => resolve(window.speechSynthesis.getVoices())
    window.speechSynthesis.addEventListener('voiceschanged', done, { once: true })
    // Some builds never fire the event; do not hang the reply waiting for it.
    setTimeout(done, 1000)
  })
}

/**
 * Indian and Pakistani English voices carry these names far better than an American one —
 * "Alifya Zainuddin" out of a US voice is barely recognisable as the same word the shop
 * just said. Ranked by how close each is to how the counter actually speaks.
 */
const PREFERRED = [/en[-_]IN/i, /en[-_]PK/i, /en[-_]GB/i, /hi[-_]IN/i, /^en/i]

let chosen: SpeechSynthesisVoice | null = null
let lookedUp = false

async function pickVoice(): Promise<SpeechSynthesisVoice | null> {
  if (lookedUp) return chosen
  const voices = await voicesReady()
  for (const want of PREFERRED) {
    const hit = voices.find((v) => want.test(v.lang))
    if (hit) { chosen = hit; break }
  }
  lookedUp = true
  return chosen
}

/** Let the shop pick a different one; '' means whatever the browser thinks is best. */
export async function listVoices() {
  const voices = await voicesReady()
  return voices.map((v) => ({ name: v.name, lang: v.lang }))
}

export async function setVoice(name: string) {
  if (!name) { chosen = null; lookedUp = true; return }
  const voices = await voicesReady()
  chosen = voices.find((v) => v.name === name) ?? null
  lookedUp = true
}

export function stopSpeaking() {
  try { window.speechSynthesis.cancel() } catch { /* nothing was speaking */ }
}

/**
 * Say it, and resolve once the last word is out.
 *
 * Never rejects. A voice that fails to start must not take the entry down with it — the
 * card on screen already says everything the speech does, so silence is a degraded
 * experience rather than a broken one.
 */
export function speak(text: string): Promise<void> {
  const words = String(text ?? '').trim()
  if (!words || !speechOutputSupported()) return Promise.resolve()

  return new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearInterval(keepAlive)
      clearTimeout(failsafe)
      resolve()
    }

    stopSpeaking()
    const u = new SpeechSynthesisUtterance(words)
    u.rate = 1.02
    u.pitch = 1
    u.volume = 1
    u.onend = finish
    u.onerror = finish

    /**
     * Chrome stops speaking after about fifteen seconds unless it is nudged, and a stalled
     * utterance never fires onend — which would leave the microphone closed and the shop
     * waiting. The nudge and the failsafe between them mean the loop always continues.
     */
    const keepAlive = setInterval(() => {
      if (!window.speechSynthesis.speaking) return finish()
      window.speechSynthesis.pause()
      window.speechSynthesis.resume()
    }, 5000)
    const failsafe = setTimeout(finish, Math.min(30000, 2500 + words.length * 90))

    pickVoice().then((voice) => {
      if (settled) return
      if (voice) { u.voice = voice; u.lang = voice.lang }
      try { window.speechSynthesis.speak(u) } catch { finish() }
    })
  })
}

/* ── Saying numbers the way a person reads them ──────────────────────────── */

const grouped = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 })

/**
 * Comma grouping is what tells a speech engine to say "twenty thousand" rather than
 * reading the digits out one at a time.
 */
export const sayMoney = (n: number, currency = 'Rs') =>
  `${grouped.format(Math.round((n + Number.EPSILON) * 100) / 100)} ${currency === 'Rs' ? 'rupees' : currency}`

export const sayWeight = (n: number) =>
  `${new Intl.NumberFormat('en-PK', { maximumFractionDigits: 3 }).format(n)} grams`
