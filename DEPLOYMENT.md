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

## Future enhancements (not built, just noted)

- **CI/CD**: a GitHub Actions workflow could SSH in and run `deploy.sh`
  automatically on push to `main`. Deliberately not set up here - it needs a
  decision on where deploy secrets live (GitHub Actions secrets vs.
  droplet-local), which is worth its own conversation rather than assuming.
- **True zero-downtime deploys**: would need two app containers alternating
  behind nginx (blue/green) or a tool like `docker-rollout`. Real added
  infrastructure complexity for a single droplet - only worth it if a few
  seconds of downtime per deploy actually becomes a problem.
