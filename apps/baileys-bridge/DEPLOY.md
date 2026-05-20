# Baileys bridge — deployment runbook

End-to-end install of the in-house Baileys WhatsApp bridge on the Oracle VPS
(`92.5.97.190`) and the matching Vercel env-var changes for the CRM web app.

The CRM web app already has every endpoint the bridge needs
(`/api/v1/inbox/whatsapp/baileys-{accounts,creds,pairing,inbound,status}`) and
the operator-facing `/api/v1/integrations/baileys/{start,stop,qr}` routes
read `BAILEYS_BRIDGE_URL` + `BAILEYS_BRIDGE_SECRET` from process env. So the
work is: stand the bridge up on the VPS, point the CRM at it, scan a QR.

---

## 0. Prerequisites (one-time)

- SSH access to the VPS as `ubuntu` with sudo. Key already configured at
  `~/.ssh/oracle_oci` on the operator's laptop.
- DNS A-record for `bridge.kottke.info` pointed at `92.5.97.190`.
- Vercel access to the CRM project with permission to add env vars and trigger
  a redeploy.
- A CRM workspace API key (`oc_sk_…`). Mint one in
  **CRM → Settings → API keys**. Must be workspace-scoped to whichever
  workspace owns the Baileys accounts.

## 1. Rotate the leaked GitHub PAT (security — do this first)

The audit found a world-readable token at `/home/ubuntu/.crm-setup.` on the
VPS. Anything that file authorises can read the repo and could be used to
backdoor the bridge.

```bash
ssh -i ~/.ssh/oracle_oci ubuntu@92.5.97.190 'sudo cat /home/ubuntu/.crm-setup.'
# Note the ghp_… token, then revoke it in GitHub:
#   https://github.com/settings/tokens
# Delete the file:
ssh -i ~/.ssh/oracle_oci ubuntu@92.5.97.190 'shred -u /home/ubuntu/.crm-setup. || rm -f /home/ubuntu/.crm-setup.'
```

If you still need a PAT for repo access on the VPS, mint a new fine-scoped one
(read-only, single-repo) and store it in `~/.config/git/credentials` with
correct perms (`chmod 600`).

## 2. Get the code onto the VPS

```bash
ssh -i ~/.ssh/oracle_oci ubuntu@92.5.97.190
sudo mkdir -p /opt/baileys-bridge && sudo chown ubuntu:ubuntu /opt/baileys-bridge
cd /opt/baileys-bridge
# Clone the repo — use HTTPS + the new PAT, or a deploy key.
git clone https://github.com/hybriswohlig/openclaw-crm.git .
```

The bridge lives in `apps/baileys-bridge/`. The Dockerfile build context is
the repo root so it can pull in the pnpm workspace.

## 3. Write the bridge `.env`

```bash
cd /opt/baileys-bridge/apps/baileys-bridge
cat > .env <<'EOF'
# Where the CRM web app is hosted. Production Vercel URL or your custom domain.
CRM_BASE_URL=https://YOUR-CRM-DOMAIN.example

# Workspace-scoped API key from CRM → Settings → API keys.
CRM_API_KEY=oc_sk_REPLACE_ME

# Shared secret for the /accounts/* control endpoints. Must equal
# BAILEYS_BRIDGE_SECRET on the Vercel side. Generate with:
#   openssl rand -hex 32
BRIDGE_SECRET=REPLACE_WITH_64_HEX_CHARS

LOG_LEVEL=info
EOF
chmod 600 .env
```

## 4. Start the container

```bash
cd /opt/baileys-bridge/apps/baileys-bridge
sudo docker compose up -d --build
# Confirm health:
curl -s http://localhost:8787/healthz
# → {"ok":true,"sockets":[]}
sudo docker compose logs -f --tail 50
# → expect: "[bridge] http listening" and "[bridge] reconcile tick { count: 0 }"
```

If `count > 0` immediately, that means existing inhouse rows already exist in
the CRM workspace and the bridge is trying to start sockets for them.

## 5. nginx vhost + TLS

The container listens on `127.0.0.1:8787`. Front it with nginx so we get TLS
and can keep port 8787 firewalled.

```bash
sudo tee /etc/nginx/sites-available/bridge.kottke.info > /dev/null <<'EOF'
server {
    listen 80;
    server_name bridge.kottke.info;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name bridge.kottke.info;

    # certbot fills these in
    ssl_certificate     /etc/letsencrypt/live/bridge.kottke.info/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bridge.kottke.info/privkey.pem;

    # Bridge HTTP control plane
    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Send media base64 payloads are bigger than default 1MB.
        client_max_body_size 50m;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/bridge.kottke.info /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# TLS cert (certbot must already be installed — it is on this VPS, sibling
# vhosts already use Let's Encrypt).
sudo certbot --nginx -d bridge.kottke.info --non-interactive --agree-tos -m hello@kottke-umzuege.de
```

## 6. Firewall: close port 8787 to the world

The bridge listens on 0.0.0.0 inside the container by design, but Docker
publishes 8787 on the host. Now that nginx fronts it, drop direct exposure.

Option A — simplest, edit the compose file to bind to localhost only:

```bash
# apps/baileys-bridge/docker-compose.yml — change the ports line:
#   ports:
#     - "127.0.0.1:8787:8787"
# then:
sudo docker compose up -d
```

Option B — keep compose as-is and drop the iptables rule (existing rule on
this VPS already permits 8787 publicly; remove it):

```bash
sudo iptables -L INPUT -n --line-numbers | grep 8787
# Find the rule number, then:
sudo iptables -D INPUT <number>
# Persist the change:
sudo netfilter-persistent save
```

Verify from a remote machine:

```bash
nc -zv 92.5.97.190 8787   # should fail / time out
curl -i https://bridge.kottke.info/healthz   # should fail with 401 (no secret)
curl -i -H "X-Bridge-Secret: $BRIDGE_SECRET" https://bridge.kottke.info/healthz
# → 200 {"ok":true,"sockets":[…]}
```

## 7. Vercel env vars + redeploy

Add three env vars to the CRM project (Production + Preview):

```bash
# From a machine that has the Vercel CLI authenticated to your team:
vercel env add BAILEYS_BRIDGE_URL production
# value: https://bridge.kottke.info

vercel env add BAILEYS_BRIDGE_SECRET production
# value: same 64-hex string as the VPS .env BRIDGE_SECRET

# Optional but useful — same values for Preview so dev branches work too:
vercel env add BAILEYS_BRIDGE_URL preview
vercel env add BAILEYS_BRIDGE_SECRET preview

# Trigger a redeploy so the new vars take effect:
vercel deploy --prod
```

`/api/v1/integrations/baileys/start` and `/stop` return a 503 with
`code: "BAILEYS_BRIDGE_NOT_CONFIGURED"` if either var is missing, so the UI
will tell you clearly if you forgot one.

## 8. End-to-end smoke test

1. Open the CRM → **Integrationen** → scroll to "Kanal-Accounts" → **Hinzufügen**.
2. Choose **Typ: WhatsApp** → **WhatsApp-Anbindung: Persönliches WhatsApp (Baileys)**.
3. Enter a name (e.g. "Kottke Mobile Test"), a phone number label, optionally
   an operating company. Click **Weiter zum QR-Scan**.
4. The modal swaps to the QR panel. On your phone:
   **WhatsApp → Einstellungen → Verknüpfte Geräte → Gerät verknüpfen → Scan**.
5. Expect status to flip `awaiting_qr → connecting → connected` within ~5s.
   The "Eigene Nummer" line shows the JID once paired.
6. From a *different* phone, send a WhatsApp message to the paired number.
   Confirm it appears in the CRM **Posteingang** with the right operating
   company linked.
7. Reply from the inbox. Confirm delivery on the customer phone.
8. **Bridge restart test:** `sudo docker compose restart` on the VPS. The
   socket should re-bootstrap from CRM-stored auth state without a fresh QR.

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Modal shows "Bridge konnte nicht gestartet werden" | `BAILEYS_BRIDGE_URL` / `BAILEYS_BRIDGE_SECRET` missing on Vercel | Step 7. |
| 401 from `https://bridge.kottke.info/healthz` | Working as intended — health check needs the header | OK. Without secret, only `/healthz` returns 200 anyway. With wrong secret you'd see 401 on `/accounts/*`. |
| Bridge logs `[crm-client] non-OK response 401` | `CRM_API_KEY` wrong or unscoped | Re-mint key in CRM and update bridge `.env`. |
| `awaiting_qr` never flips after scan | QR expired, or wrong WhatsApp on the phone (Business vs Personal) | The bridge auto-refreshes QR every ~30s — wait or close+reopen the panel. |
| `logged_out` immediately after scan | Phone reported "this device is already linked" — old session lingering | The CRM auto-clears auth state on logout. Re-open the pairing panel and scan again. |
| Bridge OOM / restart loop | Too many concurrent media downloads | Lower load or raise Docker memory limit. |

## 10. Operational notes

- **Reconcile loop:** the bridge polls `/baileys-accounts` every 30s and
  starts sockets for any new `inhouse` rows. So even if Vercel webhooks fail,
  newly created accounts get picked up.
- **Auth state size:** ~tens of KB per account at cold start, grows to ~100KB
  per long-lived session. Persisted encrypted in `workspace_settings`.
- **24h window:** unlike WABA, Baileys has no 24h customer-service window —
  you can send free-form messages any time. The CRM's
  `WhatsAppSessionExpiredError` only triggers on WABA conversations.
- **Multi-account:** every `baileys_bridge_provider='inhouse'` row gets one
  Baileys socket. They share the bridge process but run independent sessions.
