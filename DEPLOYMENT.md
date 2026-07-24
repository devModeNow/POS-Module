# Deployment Guide

## Target Setup
- Frontend: Vercel (proxies `/api/*` to the backend to avoid browser CORS issues)
- Backend: Render free tier (recommended) or any Node host (DigitalOcean, Railway, etc.)

## 1. Backend Deployment (Render — free tier)

Render’s free web service includes **750 hours/month** (enough for one app 24/7), **no credit card**, and services sleep after **15 minutes** of inactivity (first request may take ~30–60s to wake up).

### 1.1 Connect GitHub to Render
1. Open [Render Account Settings → Git Providers](https://dashboard.render.com/u/settings#integrations).
2. Connect your GitHub account and grant access to `devModeNow/POS-Module`.

### 1.2 Deploy with Blueprint
1. In Render Dashboard, click **New +** → **Blueprint**.
2. Connect repo `devModeNow/POS-Module` (branch `master`).
3. Render reads `render.yaml` at the repo root and creates `cbis-backend`.
4. When prompted, set these secret env vars (copy from `backend/.env`):
   - `DATABASE_URL` — Supabase pooler URL
   - `JWT_SECRET`
   - `CORS_ORIGINS` — include your Vercel URL, e.g. `https://frontend-xi-beige-65.vercel.app,http://localhost:4200`
5. Deploy. Note the service URL, e.g. `https://cbis-backend.onrender.com`.

### 1.3 Alternative: manual Web Service
If you prefer not to use Blueprint:
- Root Directory: `backend`
- Runtime: Node
- Build Command: `npm install && npm run build`
- Start Command: `npm run start:prod`
- Health Check Path: `/health`
- Instance type: **Free**

Production env example:

```env
DATABASE_URL=postgresql://postgres.<project>:<password>@aws-1-ap-south-1.pooler.supabase.com:6543/postgres
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=false
JWT_SECRET=use-a-strong-secret
JWT_EXPIRES_IN=1h
CORS_ORIGINS=https://frontend-xi-beige-65.vercel.app,http://localhost:4200
```

### 1.4 Point Vercel at your Render backend (optional)
Once Render is live, update `frontend/vercel.json` rewrite destination to your Render URL, or set `NG_APP_API_BASE_URL` in Vercel to the Render URL and remove the `/api` proxy.

Backend will be available at your Render URL, for example `https://cbis-backend.onrender.com`.

## 2. Frontend Deployment (Vercel)

### 2.1 Vercel project settings
- Root directory: `frontend`
- `frontend/vercel.json` is already configured.

### 2.2 Set environment variable in Vercel (required)
In Vercel → Project Settings → Environment Variables (Production):

- `NG_APP_API_BASE_URL` = your backend public URL  
  Example: `https://cbis-backend-production.up.railway.app`

Angular cannot read `.env` in the browser. `@ngx-env/builder` injects `NG_APP_*` **at build time**.  
After changing the variable, click **Redeploy**.

Alternatively, `frontend/.env.production` is committed with the Railway URL as a default.

Also ensure backend `CORS_ORIGINS` includes your Vercel domain.

### 2.3 SPA routing
`frontend/vercel.json` includes rewrite to `index.html`, so Angular routes work.

## 3. Post-deploy checklist
- Frontend loads successfully from Vercel URL.
- Login works (validates API base URL + CORS).
- Dashboard data loads from `/dashboard/overview`.
- API endpoints respond from browser without CORS errors.
- Inventory reports (including Land Costing exports) still work.
