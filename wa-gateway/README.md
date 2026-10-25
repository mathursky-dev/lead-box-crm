# LEAD BOX WhatsApp gateway (QR-scan numbers)

Links a normal WhatsApp / WhatsApp Business **app** number to LEAD BOX by scanning a QR code,
the same way WhatsApp Web works. Used by **Admin → Integrations → WhatsApp Business → Connect → Scan QR code**.

> ⚠️ This is **unofficial** (WhatsApp Web protocol via the open-source Baileys library).
> It is against WhatsApp's terms. Numbers that send bulk, cold or automated messages can be **banned**.
> Use it for normal 1-to-1 chats only. For campaigns, templates and chatbots, use **Connect with Facebook** (official API).

## Why a separate server

WhatsApp Web needs a socket that stays open 24×7. Vercel functions stop after each request, so this
runs on any always-on Node host **with a persistent disk** (login sessions are saved in `DATA_DIR`):
Railway / Render (with a disk) / Fly.io / a small VPS (Hostinger, DigitalOcean, AWS Lightsail).

## Environment

| Variable | Value |
|---|---|
| `WA_GATEWAY_KEY` | Long random secret (32+ chars). **Same value** goes in Vercel. |
| `CRM_WEBHOOK_URL` | `https://wacrm.leadboxs.in/api/whatsapp/gateway` |
| `PUBLIC_URL` | This server's public https URL, e.g. `https://wa-gw.leadboxs.in` |
| `DATA_DIR` | Folder on the persistent disk (Docker image uses `/data`) |
| `PORT` | Default `8080` |

In **Vercel → lead-box-crm → Environment Variables** add:

- `WA_GATEWAY_URL` = the gateway's `PUBLIC_URL`
- `WA_GATEWAY_KEY` = the same secret

Then redeploy. The "Scan QR code" button turns on once both are set.

## Run

```bash
docker build -t lb-wa-gateway .
docker run -d --restart=always -p 8080:8080 -v lbwa:/data \
  -e WA_GATEWAY_KEY=... -e CRM_WEBHOOK_URL=https://wacrm.leadboxs.in/api/whatsapp/gateway \
  -e PUBLIC_URL=https://wa-gw.example.com lb-wa-gateway
```

or without Docker: `npm install && npm start` (Node 20+). Put it behind https (Caddy / Nginx / the host's TLS).

## How it plugs into the CRM

- Inbound messages and delivery/read receipts are POSTed to the CRM in the **same JSON shape as Meta's
  webhook**, signed with `x-lb-signature: sha256=HMAC(body, WA_GATEWAY_KEY)`. The CRM stores them in
  `lb_webhook_events` and runs the normal pipeline (inbox, leads, bots, media).
- The CRM sends by calling `POST {WA_GATEWAY_URL}/v1/{session}/messages` with the Cloud API payload
  (text, image, video, audio, document, sticker, reaction). Templates are rejected.
- QR numbers are rows in `lb_wa_numbers` with `provider = 'qr'` and `phone_number_id = qr_<id>` (the session id).

## Limits

- Group chats, status updates and channels are ignored. Messages typed on the phone itself are not copied into the CRM.
- The phone must come online at least once every ~14 days or WhatsApp unlinks the device.
- Inbound media is kept in memory for the CRM to fetch right away; after a gateway restart, older media can't be re-downloaded.
