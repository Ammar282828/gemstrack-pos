/**
 * Partnership-level settings stored in Firestore at `app_settings/partnership`.
 *
 * Currently holds the working-capital floor (a single business-wide value)
 * plus a history of changes so we can see "what was the floor in April vs May".
 */
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface FloorHistoryEntry {
  value: number;
  date: string;            // ISO string of when it was set
  by?: string;             // display name / email of who set it
}

export interface PartnershipSettings {
  workingCapitalFloor: number;
  floorLastSetAt?: string; // ISO — latest entry in floorHistory
  floorHistory: FloorHistoryEntry[];
}

export const DEFAULT_WORKING_CAPITAL_FLOOR = 500_000;

const DOC_PATH = ['app_settings', 'partnership'] as const;

export async function loadPartnershipSettings(): Promise<PartnershipSettings> {
  try {
    const snap = await getDoc(doc(db, ...DOC_PATH));
    if (!snap.exists()) {
      return { workingCapitalFloor: DEFAULT_WORKING_CAPITAL_FLOOR, floorHistory: [] };
    }
    const data = snap.data();
    return {
      workingCapitalFloor: Number(data.workingCapitalFloor) || DEFAULT_WORKING_CAPITAL_FLOOR,
      floorLastSetAt: data.floorLastSetAt || undefined,
      floorHistory: Array.isArray(data.floorHistory) ? data.floorHistory : [],
    };
  } catch {
    return { workingCapitalFloor: DEFAULT_WORKING_CAPITAL_FLOOR, floorHistory: [] };
  }
}

export async function saveWorkingCapitalFloor(value: number, by?: string): Promise<PartnershipSettings> {
  const current = await loadPartnershipSettings();
  const nowIso = new Date().toISOString();
  const newEntry: FloorHistoryEntry = { value, date: nowIso, ...(by && { by }) };
  // Avoid logging a duplicate if value is unchanged AND last entry is same value
  const lastEntry = current.floorHistory[current.floorHistory.length - 1];
  const isDuplicate = !!lastEntry && lastEntry.value === value;
  const nextHistory = isDuplicate ? current.floorHistory : [...current.floorHistory, newEntry];
  const next: PartnershipSettings = {
    workingCapitalFloor: value,
    floorLastSetAt: nowIso,
    floorHistory: nextHistory,
  };
  await setDoc(doc(db, ...DOC_PATH), {
    ...next,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return next;
}

/** True when the floor hasn't been touched since the start of the current calendar month. */
export function isFloorStale(settings: PartnershipSettings, now: Date = new Date()): boolean {
  if (!settings.floorLastSetAt) return true;
  const last = new Date(settings.floorLastSetAt);
  if (isNaN(last.getTime())) return true;
  return (
    last.getFullYear() !== now.getFullYear() ||
    last.getMonth()    !== now.getMonth()
  );
}

/** True only during the first 5 days of the month — used for the "review me" banner. */
export function isMonthStart(now: Date = new Date()): boolean {
  return now.getDate() <= 5;
}
