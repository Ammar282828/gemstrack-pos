"use client";

/**
 * Send an order's pieces to a karigar on WhatsApp, from the shop's line (/api/app/orders/send-to-karigar):
 * the piece photos, then the slip's words (lib/karigar-message.ts). No prices, ever.
 *
 * `SendToKarigarDialog` is the dialog (the order page opens it from its menu); `SendToKarigarButton` is a
 * button that carries its own (the Workshop's job rows, which hold one piece each).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { useAppStore, type Order } from '@/lib/store';
import { authedFetch } from '@/lib/voice/authed-fetch';
import { buildKarigarMessage, chooseKarigarPieces } from '@/lib/karigar-message';
import { toWhatsAppNumber } from '@/lib/whatsapp';
import { STORE_CONFIG } from '@/lib/store-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { categorySingular } from '@/lib/categories';

export const SendToKarigarDialog: React.FC<{
  order: Order;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pieces ticked at the start; the ones assigned to the karigar when left out. */
  pieces?: number[];
  karigarId?: string;
}> = ({ order, open, onOpenChange, pieces, karigarId: startKarigar }) => {
  const karigars = useAppStore(s => s.karigars);
  const loadKarigars = useAppStore(s => s.loadKarigars);
  const { toast } = useToast();
  const [karigarId, setKarigarId] = useState('');
  const [ticked, setTicked] = useState<number[]>([]);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open && !karigars.length) void loadKarigars?.(); }, [open, karigars.length, loadKarigars]);

  // Reset each time it opens: the asked karigar, else the first piece's.
  useEffect(() => {
    if (!open) return;
    const first = startKarigar || (pieces?.length ? order.items[pieces[0]]?.karigarId : undefined) || order.items.find(i => i.karigarId)?.karigarId || '';
    setKarigarId(first || '');
    setPhone('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const mine = order.items.map((it, i) => (it.karigarId && it.karigarId === karigarId ? i : -1)).filter(i => i >= 0);
    setTicked(pieces?.length ? chooseKarigarPieces(order, pieces) : mine.length ? mine : order.items.map((_, i) => i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, karigarId]);

  const karigar = karigars.find(k => k.id === karigarId);
  const onFile = karigar?.contact || karigar?.altPhone || '';
  const number = toWhatsAppNumber(phone || onFile);
  const numberOk = number.length >= 11 && number.length <= 15;
  const preview = useMemo(
    () => (ticked.length ? buildKarigarMessage(order, ticked, { karigarName: karigar?.name, shopName: STORE_CONFIG.name }) : ''),
    [order, ticked, karigar?.name],
  );
  const photos = ticked.reduce((n, i) => {
    const it = order.items[i];
    return n + (it?.sampleImageDataUri || it?.samplePhotoId ? 1 : 0) + (it?.extraPhotos?.length || 0);
  }, 0);

  const toggle = (i: number) => setTicked(t => (t.includes(i) ? t.filter(x => x !== i) : [...t, i].sort((a, b) => a - b)));

  const send = async () => {
    if (!karigarId) return toast({ variant: 'destructive', title: 'Pick a karigar first' });
    if (!ticked.length) return toast({ variant: 'destructive', title: 'Pick at least one piece' });
    if (!numberOk) return toast({ variant: 'destructive', title: `Add a phone number for ${karigar?.name || 'the karigar'} first` });
    setBusy(true);
    try {
      const res = await authedFetch('/api/app/orders/send-to-karigar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, pieceIndexes: ticked, karigarId, ...(phone.trim() ? { phone: phone.trim() } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not send.');
      toast({
        title: `Sent to ${karigar?.name || 'the karigar'}`,
        description: `${data.sent} message${data.sent === 1 ? '' : 's'} to ${data.to}${data.photosFailed ? ` · ${data.photosFailed} photo(s) did not go` : ''}`,
      });
      onOpenChange(false);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Not sent', description: e instanceof Error ? e.message : 'Try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send to karigar</DialogTitle>
          <DialogDescription>{order.id} · photos, weight and instructions on WhatsApp. No prices go.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Karigar</Label>
            <Select value={karigarId} onValueChange={setKarigarId}>
              <SelectTrigger><SelectValue placeholder="Pick a karigar" /></SelectTrigger>
              <SelectContent>
                {karigars.filter(k => !k.deletedAt).map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {karigarId && (onFile
              ? <p className="text-xs text-muted-foreground">{onFile}</p>
              : <p className="text-xs text-tone-late-ink">No number on file for {karigar?.name}. Add one below or on his profile.</p>)}
          </div>

          {(!onFile || phone) && karigarId && (
            <div className="space-y-1.5">
              <Label htmlFor="stk-phone">WhatsApp number</Label>
              <Input id="stk-phone" inputMode="tel" placeholder="03xx xxxxxxx" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Pieces</Label>
            <div className="space-y-1">
              {order.items.map((it, i) => (
                <label key={i} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={ticked.includes(i)} onCheckedChange={() => toggle(i)} />
                  <span>{i + 1}. {categorySingular(it.itemCategory) || it.description || 'Piece'}{it.description && categorySingular(it.itemCategory) ? ` · ${it.description}` : ''}</span>
                </label>
              ))}
            </div>
            {photos > 0 && <p className="text-xs text-muted-foreground">{photos} reference photo{photos === 1 ? '' : 's'} will go first.</p>}
          </div>

          {preview && (
            <div className="space-y-1.5">
              <Label>Message</Label>
              <pre className="whitespace-pre-wrap rounded-control bg-muted/50 p-3 text-xs font-sans">{preview}</pre>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={send} disabled={busy || !karigarId || !ticked.length}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send on WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/** One piece's button, for the Workshop's rows: finds its order in the store. Nothing when it is not an order's piece. */
export const SendToKarigarButton: React.FC<{ orderId?: string; itemIndex?: number; karigarId?: string; className?: string }> = ({ orderId, itemIndex, karigarId, className }) => {
  const order = useAppStore(s => (orderId ? s.orders.find(o => o.id === orderId) : undefined));
  const [open, setOpen] = useState(false);
  if (!order || itemIndex === undefined || !order.items[itemIndex]) return null;
  return (
    <>
      <Button variant="outline" size="sm" className={className ?? 'h-7 text-xs'} onClick={() => setOpen(true)}>
        <Send className="h-3 w-3 mr-1.5" />Send
      </Button>
      <SendToKarigarDialog order={order} open={open} onOpenChange={setOpen} pieces={[itemIndex]} karigarId={karigarId} />
    </>
  );
};
