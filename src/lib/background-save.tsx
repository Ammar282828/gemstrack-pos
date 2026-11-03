import { toast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';

/**
 * Let the person leave the screen at once, and say how the save went when it is known.
 *
 * Firestore answers a write when the server has it, ~300 ms away from the shop, plus an activity-log write
 * behind it; waiting for that before leaving a form made every save feel like a hang, and offline it
 * never ended. For writes that are NOT money (a customer, a karigar: docs/decisions.md#saves-are-one-trip
 * keeps the money ones awaited) the form starts the save, navigates on the spot and this toasts the result
 * later. A failure keeps the data in a closure and offers Retry, so nothing typed is lost with the screen.
 *
 * `run` resolves to something falsy, or throws, when the save did not happen.
 */
export function saveInBackground(o: {
  run: () => Promise<unknown>;
  saved: { title: string; description?: string };
  failed: { title: string; description?: string };
}): void {
  const attempt = (): void => {
    let settled: Promise<unknown>;
    try { settled = o.run(); } catch (e) { settled = Promise.reject(e); }
    settled.then(
      (ok) => {
        if (ok === false || ok === null || ok === undefined) fail(); else toast(o.saved);
      },
      (e) => { console.error('[GemsTrack] background save failed', e); fail(); },
    );
  };
  const fail = () => {
    toast({
      ...o.failed,
      variant: 'destructive',
      duration: 15_000,   // long enough to read it and press Retry
      action: <ToastAction altText="Try saving again" onClick={attempt}>Retry</ToastAction>,
    });
  };
  attempt();
}
