# Deploy Update — DigitalOcean Web Console

## What changed
Fixed `getDb` import bug in `lib/advisor/product-update-log.js` that broke the App Dev Proposals API.
Commit: `bd8d02a`

## One-command deploy (paste in DigitalOcean Web Console)

```bash
cd ~/xsjprd55 && git fetch origin main && git reset --hard origin/main && pm2 restart ecosystem.config.cjs --update-env && pm2 save && sleep 2 && curl -sf http://localhost:3000/api/app-development-proposals?limit=1 && echo " DEPLOY_OK" || echo " DEPLOY_FAIL"
```

Wait ~10 seconds for output. You should see `DEPLOY_OK` if it worked.
