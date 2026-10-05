<!-- @format -->

# Deploying to a DigitalOcean Droplet

This backend runs as a persistent Node process (via `tsx app.ts`, same as
`npm start`) rather than a serverless function, because Socket.IO needs a
long-lived HTTP server to hold WebSocket connections open (see the comment
in `app.ts`'s `startServer()`). That's why this is a Droplet, not App
Platform or Vercel.

The existing Vercel deployment (`vercel.json`, `api/index.ts`) is untouched
by any of this and can keep running in parallel until you're ready to fully
cut over.

## One-time setup on a fresh Droplet

1. Create an Ubuntu 22.04/24.04 Droplet. Point your domain's A record at its
   IP.
2. Copy this repo (or just `scripts/setup-droplet.sh`) to the droplet and
   run:
   ```bash
   sudo bash scripts/setup-droplet.sh
   ```
   This installs Docker + Compose, nginx, certbot, configures `ufw` (allows
   SSH + nginx only - the app port is never exposed to the internet
   directly), and creates `/opt/the-other-wife-backend`.
3. Clone the repo into that directory:
   ```bash
   cd /opt/the-other-wife-backend
   git clone <your-repo-url> .
   ```
4. Create your production env file:
   ```bash
   cp .env.example .env.prod
   ```
   Fill in real values. **Never commit `.env.prod`** - it's already
   gitignored. `JWT_SECRET` and `JWT_REFRESH_SECRET` are the only two the
   app refuses to start without; everything else has a default or degrades
   gracefully.
5. Install the nginx config:
   ```bash
   sudo cp deploy/nginx/the-other-wife-backend.conf /etc/nginx/sites-available/the-other-wife-backend
   sudo ln -s /etc/nginx/sites-available/the-other-wife-backend /etc/nginx/sites-enabled/
   sudo sed -i 's/your.domain.com/YOUR_ACTUAL_DOMAIN/' /etc/nginx/sites-available/the-other-wife-backend
   sudo nginx -t && sudo systemctl reload nginx
   ```
6. Get a TLS certificate (this also rewrites the nginx config for HTTPS +
   redirect, and sets up auto-renewal via certbot's own systemd timer - no
   custom renewal script needed):
   ```bash
   sudo certbot --nginx -d your.domain.com
   ```
7. First deploy:
   ```bash
   bash scripts/deploy.sh
   ```

## Every deploy after that

```bash
cd /opt/the-other-wife-backend
bash scripts/deploy.sh
```

This pulls the latest code, builds the new image while the old container
keeps serving traffic, then swaps it in and confirms the app responds
before finishing. A few seconds of downtime during the swap - not true
zero-downtime blue/green, which would need two containers alternating
behind nginx and wasn't asked for here.

## Verifying it worked

- `curl https://your.domain.com/` should return `Welcome to The Other Wife API`.
- `docker compose logs -f api` - look for `Server is running on ...` with no
  missing-module errors.
- Connect a Socket.IO client through the HTTPS domain (not directly to
  `:8000`) and confirm the handshake succeeds. This is the step most likely
  to silently fail if the nginx WebSocket-upgrade headers are misconfigured
  - a broken config usually still serves plain HTTP fine, so don't skip this
  check.

## Two things worth knowing

**`package-lock.json` is gitignored in this repo.** The Dockerfile handles
this today (falls back to `npm install` when no lockfile is present), but
for fully reproducible builds you should remove the `package-lock.json`
line from `.gitignore` and commit it - the Dockerfile will automatically
start using `npm ci` instead, no changes needed.

**The two Vercel cron jobs in `vercel.json` won't run against the
droplet.** They only fire on Vercel's own infrastructure. Once this droplet
becomes the primary deployment, add droplet-side cron entries instead:

```cron
0 4 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your.domain.com/api/v1/internal/cron/meal-plans/process-due
0 6 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your.domain.com/api/v1/internal/cron/ledger/checkpoint
0 3 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your.domain.com/api/v1/internal/cron/accounts/hard-delete-due
```

(`$CRON_SECRET` must match the value in `.env.prod`.)

**Partner webhooks job (every 5 minutes).** Install the ready-made cron file
instead of editing a crontab by hand:

```bash
sudo cp deploy/cron/the-other-wife-backend /etc/cron.d/the-other-wife-backend
sudo chmod 644 /etc/cron.d/the-other-wife-backend
```

It runs `scripts/cron-call.sh`, which reads `CRON_SECRET` from `.env.prod`
on every run (rotating the secret needs no cron change), passes it to curl on
stdin rather than the command line, and calls the container directly on
`127.0.0.1:8000`. Only failures are logged, to `/var/log/tow-cron.log`. The
job drives partner status tracking and webhooks
(`src/services/partner-webhook.service.ts`); runs are safe to overlap and stop
after about 45 seconds. Partner `updatedSince` polling and webhooks both
depend on it. Check it is running with:

```bash
sudo bash scripts/cron-call.sh .env.prod http://127.0.0.1:8000 /api/v1/internal/cron/partner-webhooks/run && echo ok
```

Partner webhooks and partner request signing also need `PARTNER_SECRETS_KEY`
in `.env.prod`: 32 random bytes, base64, generated once and kept. Changing it
later makes every stored webhook and signing secret unreadable, and they would
have to be re-issued.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Staging (partner sandbox)

Staging is a separate container with its own env file and its own database,
for partners (e.g. FoodClime) to test against before going live. It can run
on the same droplet as production.

1. Clone a second checkout and switch it to the branch you want on staging:
   ```bash
   sudo mkdir -p /opt/the-other-wife-backend-staging && sudo chown $USER /opt/the-other-wife-backend-staging
   cd /opt/the-other-wife-backend-staging && git clone <your-repo-url> . && git checkout <branch>
   ```
2. Create `.env.staging` from `.env.example`. Use **staging-only** values:
   - `MONGODB_URI` must name a dedicated database, e.g.
     `...mongodb.net/tow_staging?retryWrites=true&w=majority`. **Never the
     cluster default (`/` or `/test`)**, which holds production data.
     `scripts/deploy-staging.sh` refuses to deploy if it does.
   - `NODE_ENV=production` (same behaviour as production; docs stay locked).
   - New `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CRON_SECRET`, `DOCS_USERNAME`,
     `DOCS_PASSWORD` and `PARTNER_SECRETS_KEY` (never copy production's).
   - Paystack **test** keys. Leave `EXPO_ACCESS_TOKEN` empty.
3. nginx + TLS:
   ```bash
   sudo cp deploy/nginx/the-other-wife-backend-staging.conf /etc/nginx/sites-available/the-other-wife-backend-staging
   sudo ln -s /etc/nginx/sites-available/the-other-wife-backend-staging /etc/nginx/sites-enabled/
   sudo sed -i 's/staging.your.domain.com/staging-api.theotherwife.com/' /etc/nginx/sites-available/the-other-wife-backend-staging
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d staging-api.theotherwife.com
   ```
4. Deploy (and every deploy after): `bash scripts/deploy-staging.sh`.
   Staging listens on `127.0.0.1:8001` behind nginx.
5. Add the same cron entries pointed at `https://staging-api.theotherwife.com`
   with the staging `CRON_SECRET` (at least the partner-webhooks one).
6. Before locking a partner key to IP addresses, call the staging API once
   from a known address and confirm the IP the app sees. If anything other
   than this nginx (e.g. a CDN) sits in front, `req.ip` will be that proxy's
   address and the allow-list would block everyone.

## Future enhancements (not built, just noted)

- **CI/CD**: a GitHub Actions workflow could SSH in and run `deploy.sh`
  automatically on push to `main`. Deliberately not set up here - it needs a
  decision on where deploy secrets live (GitHub Actions secrets vs.
  droplet-local), which is worth its own conversation rather than assuming.
- **True zero-downtime deploys**: would need two app containers alternating
  behind nginx (blue/green) or a tool like `docker-rollout`. Real added
  infrastructure complexity for a single droplet - only worth it if a few
  seconds of downtime per deploy actually becomes a problem.

## Release runbook: referral/attribution + FoodClime partnership

Follow these steps in order for the release that adds referral tracking, the
partner API, webhooks, settlements and the admin Partnerships screens. Do
staging first, then production.

**What this release changes in the database:** it adds new collections only
(`partners`, `referralcampaigns`, `referralcodes`, `attributions`,
`partnersubmissions`, `partnercredentials`, `partneridempotencykeys`,
`partnerwebhookdeliveries`, `platformcosts`, `partnersettlements`). Their
indexes are built automatically when the app starts. No existing collection,
field or index is changed, and there is no migration to run.

**What it changes in behaviour:**
- Sign-up now also accepts Nigerian university addresses (`*.edu.ng`).
- Sign-up without a phone number no longer fails with "phone number already
  exists" (a bug fix).
- The full API docs moved to `/tow` and need a login in production. Partner docs
  are at `/attribution/docs`.

### 1. Before you start

- Take an Atlas snapshot (or confirm continuous backup is on) for the
  production cluster.
- Make sure the commit you deploy is the reviewed release commit.

### 2. Environment (`.env.prod` on the droplet; `.env.staging` for staging)

| Variable | Needed for | Notes |
|---|---|---|
| `PARTNER_SECRETS_KEY` | partner webhooks + request signing | **New.** 32 random bytes, base64. Generate once, keep it, never change it (see above). |
| `DOCS_USERNAME`, `DOCS_PASSWORD` | `/tow` full API docs | **New.** Without both, `/tow` is disabled in production. |
| `CRON_SECRET` | the 5-minute partner job | Must be set (already used by other cron jobs). |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | everything | Unchanged. |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # PARTNER_SECRETS_KEY
```

### 3. Deploy

```bash
cd /opt/the-other-wife-backend
git fetch && git checkout <release-commit-or-branch>
bash scripts/deploy.sh                 # staging: bash scripts/deploy-staging.sh
```

### 4. Pre-flight check (read-only)

```bash
docker compose exec api npx tsx src/scripts/preflight.ts
# staging:
docker compose -f docker-compose.staging.yml -p tow-staging exec api npx tsx src/scripts/preflight.ts
```

It must end with `READY`. It never writes anything and never prints secret
values. WARN lines are informational, e.g. a Paystack test key on staging.

### 5. Install the cron job (once per server)

```bash
sudo cp deploy/cron/the-other-wife-backend /etc/cron.d/the-other-wife-backend
sudo chmod 644 /etc/cron.d/the-other-wife-backend
sudo bash scripts/cron-call.sh .env.prod http://127.0.0.1:8000 /api/v1/internal/cron/partner-webhooks/run && echo ok
```

For staging, uncomment the staging line in that file. It runs every 5 minutes
and handles successful-HomeChef qualification, partner status tracking and
webhooks.

### 6. Smoke tests (replace the domain)

```bash
D=https://api.theotherwife.com
curl -s -o /dev/null -w "%{http_code}\n" $D/                          # 200
curl -s -o /dev/null -w "%{http_code}\n" $D/attribution/docs.json     # 200 (partner docs, public)
curl -s -o /dev/null -w "%{http_code}\n" $D/tow                       # 401 (needs DOCS login)
curl -s -o /dev/null -w "%{http_code}\n" -u "$DOCS_USERNAME:$DOCS_PASSWORD" $D/tow   # 200
curl -s -o /dev/null -w "%{http_code}\n" $D/api/v1/partner/me         # 401 (needs partner key)
```

### 7. Set up FoodClime (production and staging separately)

1. Create the partner, the campaign with the agreed rules, and the codes. The script is idempotent and safe to re-run; add `--dry-run` first if you like.
   ```bash
   docker compose exec api npx tsx src/scripts/setup-partner-campaign.ts \
     --admin-email <super-admin-email> \
     --partner-name "FoodClime / Peace Sustainability" --slug foodclime \
     --campaign-name "FoodClime 2026" --starts-at 2026-09-26 --ends-at 2026-11-24 \
     --homechef-code FOODCLIME-CHEF --customer-code FOODCLIME
   ```
   It prints the partner id used in the next steps.
2. Log in as a super_admin and issue FoodClime's API key. The `apiKey` and `signingSecret` are shown **once**. Send them to FoodClime through a secure channel, never chat or email.
   ```bash
   curl -s -c jar.txt -H "Content-Type: application/json" \
     -d '{"email":"<super-admin-email>","password":"<password>"}' $D/api/v1/auth/login > /dev/null
   curl -s -b jar.txt -H "Content-Type: application/json" \
     -d '{"scopes":["partner:read","homechef:submit","homechef:read","customer:submit","customer:read"],"label":"FoodClime production"}' \
     $D/api/v1/admin/referrals/partners/<partnerId>/credentials
   ```
3. **Production only:** confirm the client IP the app sees (see step 6 of the Staging section above), then lock the key and require signatures from the agreed date.
   ```bash
   curl -s -b jar.txt -X PATCH -H "Content-Type: application/json" \
     -d '{"ipAllowlist":["57.131.129.32","2001:41d0:701:1100::e31a"],"requireSignature":true}' \
     $D/api/v1/admin/referrals/partners/<partnerId>/credentials/<keyId>
   ```
4. When FoodClime sends its webhook URL, configure it. Its `signingSecret` (`whsec_…`) is shown once; send it securely. Then test it.
   ```bash
   curl -s -b jar.txt -X PUT -H "Content-Type: application/json" \
     -d '{"url":"https://<foodclime-endpoint>","enabled":true}' $D/api/v1/admin/referrals/partners/<partnerId>/webhook
   curl -s -b jar.txt -X POST $D/api/v1/admin/referrals/partners/<partnerId>/webhook/test
   ```
5. Delete `jar.txt` afterwards: `shred -u jar.txt` (or `rm jar.txt`).

### 8. Every month

Enter the month's infrastructure cost before finalizing that month's weekly
statements (finalizing is blocked until it is set; 0 is allowed):

```bash
curl -s -b jar.txt -X PUT -H "Content-Type: application/json" -d '{"amount":64000}' \
  $D/api/v1/admin/referrals/platform-costs/2026-10
```

### Rollback

Redeploy the previous commit: `git checkout <previous-commit> && bash scripts/deploy.sh`.
The new collections are left in place and are inert for the old code, and no
existing data was modified. Remove `/etc/cron.d/the-other-wife-backend` if you
roll back. The partner job endpoint won't exist in the old code, so the cron
would just log 404s.
