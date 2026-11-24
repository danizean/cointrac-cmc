# CoinTrac web

Next.js 16 control plane for the CoinTrac site and dashboard. Run commands from `apps/web`.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. The app calls the intelligence API through `/api/cointrac/*`. Local development expects that API on `http://127.0.0.1:8000`.

Production settings belong in the host environment, not in this file. See `docs/deployment/COINTRAC_VERCEL_DEPLOYMENT_GUIDE.md`.
