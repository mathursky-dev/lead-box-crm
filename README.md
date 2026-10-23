# LEAD BOX

WhatsApp CRM for Essential Soul Lifestyle Pvt Ltd. Built with Next.js 16, Supabase (Postgres, Auth, Storage, Realtime) and the WhatsApp Cloud API. It deploys on Vercel.

## Setup

1. Apply `supabase/migrations/*.sql` in order. They are already applied to project `trlgqlkdpwnqszmogcuz`; every object uses the `lb_` prefix.
2. Copy `.env.example` to `.env.local` and fill it in:
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `LB_SECRETS_KEY`: run `openssl rand -base64 32`
   - `CRON_SECRET`
   - `WHATSAPP_VERIFY_TOKEN`
   - `WHATSAPP_APP_SECRET`
   - `APP_URL`
3. Create the first admin:
   `node --env-file=.env.local scripts/bootstrap.mjs --company "Essential Soul Lifestyle Pvt Ltd" --email you@company.com --name "Your Name"`
4. Run `npm install`, then `npm run dev`. Sign in, then go to **Admin** and set up the organisation, users and WhatsApp numbers.

## WhatsApp

1. In your Meta App, open **WhatsApp → Configuration**:
   - Callback URL: `APP_URL/api/whatsapp/webhook`
   - Verify token: the value of `WHATSAPP_VERIFY_TOKEN`
   - Subscribe the `messages` field.
2. In **Admin → WhatsApp numbers**, enter the phone number ID, the WABA ID and a permanent System User token, which needs `whatsapp_business_messaging` and `whatsapp_business_management`.
3. Click **Subscribe webhook**, then **Sync templates**.

## Background jobs

Durable retries, webhook replay and reminders all run through `/api/jobs/run` with `Authorization: Bearer CRON_SECRET`. Follow-up reminders also run every minute through `pg_cron`. Schedule the job route every minute with pg_cron + pg_net, after enabling `pg_net`:

```sql
select cron.schedule('lb-jobs', '* * * * *', $$select net.http_post(url := 'https://YOUR-APP/api/jobs/run', headers := jsonb_build_object('Authorization','Bearer YOUR_CRON_SECRET'))$$);
```

## Email

Password-reset and invite emails need custom SMTP (**Supabase → Auth → SMTP**). The built-in mailer only delivers to project team members.
