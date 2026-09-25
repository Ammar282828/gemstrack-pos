# WAHA — the POS's WhatsApp gateway

Since 2026-09-25 both POS systems send WhatsApp through **WAHA** (WhatsApp HTTP API,
https://waha.devlike.pro), the shop's own gateway, instead of Green API. The owner's switch;
the reason it was possible then is that WAHA 2026.6 made every feature free, and WAHA can post
to **WhatsApp channels**, which Green API cannot.

| | |
|---|---|
| VM | `waha`, gemstrack-pos, us-central1-a, e2-micro (free tier), Debian 12, 30 GB standard disk |
| Address | static `waha-ip` = 35.184.20.165, reached as **https://35-184-20-165.sslip.io** (sslip.io resolves the name to the IP; Caddy gets the certificate) |
| Firewall | `waha-web`: tcp 80, 443 to the `waha` tag |
| Containers | `waha` (`devlikeapro/waha:gows`, the GOWS engine — no browser, fits 1 GB) and `caddy` (HTTPS) |
| Sessions | `default`: **+92 326 2275554**, Taheri's POS (admin of the community, owner of the channel). `mina`: **+92 316 1930960**, House of Mina's POS (`WAHA_SESSION=mina` in apphosting.mina.yaml) |
| Secrets | `waha-api-key` (in gemstrack-pos **and** hom-pos, same value; the VM holds it sha512-hashed), `waha-dashboard-password` (gemstrack-pos) |
| Setup | `startup.sh` here is the VM's startup script: it runs on every boot and can be re-run |

The POS reads `WAHA_URL` and `WAHA_API_KEY` (apphosting.yaml, both houses) and, for Taheri,
`WHATSAPP_CHANNEL_ID` (the "Taheri Collections" channel). `src/lib/whatsapp.ts` uses WAHA when
both are set and Green API otherwise; the Post a Piece checks say which, and whether the line is
linked, an admin of the community and owner/admin of the channel.

## Things you may need to do

**A line is unlinked** (checks say "unlinked from WAHA", or the session is `SCAN_QR_CODE` /
`FAILED`): restart the session and link with a code. For Mina's, use `mina` in place of `default`
and 923161930960 as the number.

```
K=$(gcloud secrets versions access latest --secret=waha-api-key --project gemstrack-pos)
curl -X POST https://35-184-20-165.sslip.io/api/sessions/default/restart -H "X-Api-Key: $K"
curl -X POST https://35-184-20-165.sslip.io/api/default/auth/request-code -H "X-Api-Key: $K" \
  -H 'Content-Type: application/json' -d '{"phoneNumber":"923262275554"}'
```

Then on that phone: WhatsApp → Settings → Linked devices → Link a device → *Link with phone
number instead* → the code. (Or open `/dashboard` — user `taheri`, password in
`waha-dashboard-password`, API key in `waha-api-key` — and scan the QR.) A code can only be asked
for while the session is `SCAN_QR_CODE`; it sits there only a few minutes before `FAILED`, so
restart first.

**The server isn't answering** (Caddy's 502, or nothing): reset the VM
(`gcloud compute instances reset waha --zone us-central1-a --project gemstrack-pos`). On a cold boot
the GOWS engine sometimes misses WAHA's fixed 10-second start window; Docker restarts it and the
second start takes. The linked session survives (it lives in `/srv/waha/sessions`).

**Update WAHA**: `gcloud compute ssh waha --zone us-central1-a --project gemstrack-pos --command
"sudo google_metadata_script_runner startup"` — pulls the latest `gows` image and restarts.

**Change the key**: add a version to `waha-api-key` in **both** projects, reset the VM, and roll
out both POS (they read it at startup).

**Use a proper hostname** (e.g. `wa.taheri.shop`): point an A record at 35.184.20.165, set the
instance metadata `waha-host` to it, re-run the startup script, and change `WAHA_URL`.

## Worth knowing

- Members of a community are listed by **LID** (`…@lid`, WhatsApp's private id), not by number;
  WAHA's `participants/v2` gives each one's phone as `pn`, which is what the admin check compares.
- `/api/sessions/default/me` shows WhatsApp's `messageCapping` quota for the line (300 messages a
  cycle to people who haven't messaged it), worth a look if customer messages start failing.
- Green API is still configured as the fallback. Cancel it only after WAHA has run cleanly for a
  while; then remove `GREENAPI_*` from apphosting.yaml.
