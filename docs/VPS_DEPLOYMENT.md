# Call Vani VPS deployment

The web application uses Cloudflare Worker APIs (`cloudflare:workers`, D1 and
R2). On a VPS it therefore runs inside Wrangler's local Worker runtime, behind
Nginx. The realtime media gateway runs as a separate Node service on the same
host. Persistent Worker/D1 state is stored under `/var/lib/callvani/runtime`.

## Layout

- repository: `/opt/callvani`
- non-committed secrets: `/etc/callvani/app.env`
- application: `127.0.0.1:3000`
- media gateway: `127.0.0.1:8787`
- public HTTPS: Nginx + Certbot for `callvani.com`

The two systemd units and the Nginx virtual host are in `deploy/vps/`.

## GitHub main auto-deploy

Install `deploy/vps/update-callvani.sh` as
`/usr/local/sbin/update-callvani`, and install the matching service and timer
from `deploy/vps/` under `/etc/systemd/system/`. The updater accepts only a
fast-forward from `origin/main`, builds before restarting either runtime, and
uses a lock to prevent overlapping deployments.

```bash
sudo install -m 755 deploy/vps/update-callvani.sh /usr/local/sbin/update-callvani
sudo install -m 644 deploy/vps/callvani-update.service /etc/systemd/system/callvani-update.service
sudo install -m 644 deploy/vps/callvani-update.timer /etc/systemd/system/callvani-update.timer
sudo systemctl daemon-reload
sudo systemctl enable --now callvani-update.timer
```

## Required before live calling

1. Point the `callvani.com` and `www` DNS records at the VPS.
2. Issue a TLS certificate and enable the two systemd services.
3. Save SMTP, Google OAuth, Stripe/Razorpay and voice-provider credentials in
   the super-admin provider screens. Provider secrets are encrypted at rest.
4. Configure the Google OAuth redirect URI as
   `https://callvani.com/api/auth/google/callback`.
5. Configure ElevenLabs webhook delivery to
   `https://callvani.com/api/webhooks/elevenlabs` with the same signing secret
   saved in the Call Vani ElevenLabs provider settings.
6. Connect Vobiz in the customer workspace. Vobiz/customer carrier credentials
   do not belong in the platform-admin account.

Do not put real provider keys in this repository or in this file.
