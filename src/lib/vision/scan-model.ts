/**
 * Which model reads a parchi or a written bill (owner, 2026-09-29: "scan a parchi feature should
 * also use ai" — the strong models Post a Piece uses, which the Vertex AI key opened).
 *
 * The scanners were pinned to voice's gemini-2.5-flash: the only model Taheri's own project was
 * served in us-central1 when they were built. Handwriting in three scripts, with figures that
 * become money, is where a stronger model earns its few extra seconds. SCAN_AI_MODEL changes it
 * without a deploy; one Google doesn't serve falls back to voice's model (voice/gemini.ts).
 */
export const DEFAULT_SCAN_MODEL = 'gemini-3.1-pro-preview';
export const scanModel = () => process.env.SCAN_AI_MODEL?.trim() || DEFAULT_SCAN_MODEL;
