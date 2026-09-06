# SanaNeke — Full-Stack Deployment Guide

## 📁 Project Structure

```
erlan/
├── frontend/              → Deploy to Vercel
│   ├── index.html         ← set API_BASE here after backend deploy
│   └── vercel.json
│
└── backend/               → Deploy to Render
    ├── server.js
    ├── package.json
    ├── render.yaml
    ├── .env.example
    └── db/
        └── schema.sql     ← auto-applied on first boot
```

---

## 🚀 Step 1 — Push to GitHub

Create **two separate repositories** (or two folders in one repo):

```bash
# From the erlan/ folder
git init
git add .
git commit -m "SanaNeke v3 initial commit"
git remote add origin https://github.com/YOUR_USERNAME/sananeke.git
git push -u origin main
```

---

## 🔧 Step 2 — Deploy Backend on Render

### Option A — Blueprint (automatic, recommended)

1. Go to [render.com](https://render.com) → **New → Blueprint**
2. Connect your GitHub repo
3. Render reads `backend/render.yaml` and auto-creates:
   - Web Service (Node.js)
   - PostgreSQL database
4. Set these **Environment Variables** in Render dashboard:
   - `FRONTEND_URL` → your Vercel URL (set after step 3)
   - `JWT_SECRET` → auto-generated or set your own (32+ chars)
5. Click **Deploy**

### Option B — Manual

1. **Create PostgreSQL** on Render:
   - New → PostgreSQL
   - Name: `sananeke-db`, Region: Oregon, Plan: Free
   - Copy the **Internal Database URL**

2. **Create Web Service** on Render:
   - New → Web Service
   - Connect GitHub repo, set Root Directory: `backend`
   - Runtime: Node, Build: `npm install`, Start: `node server.js`
   - Add env vars:
     ```
     DATABASE_URL = <paste Internal Database URL>
     JWT_SECRET   = <generate a 32+ char random string>
     FRONTEND_URL = https://your-app.vercel.app
     NODE_ENV     = production
     ```

3. After first deploy, the DB schema is applied automatically.

> ⚠️ **Note your Render URL**, e.g.: `https://sananeke-backend.onrender.com`

---

## 🌐 Step 3 — Deploy Frontend on Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project**
2. Import your GitHub repo
3. Set **Root Directory** to `frontend`
4. No build command needed (static HTML)
5. **Before deploying**, open `frontend/index.html` and update line ~18:

```js
// Change this to your actual Render URL:
const API_BASE = 'https://sananeke-backend.onrender.com';
```

6. Commit & push, then deploy on Vercel.
7. Copy your Vercel URL (e.g. `https://sananeke.vercel.app`)

---

## 🔄 Step 4 — Update CORS

Go back to Render dashboard → your backend service → Environment:

```
FRONTEND_URL = https://sananeke.vercel.app
```

Click **Save** → service redeploys automatically.

---

## ✅ Verification Checklist

- [ ] Backend health check: `GET https://sananeke-backend.onrender.com/` → `{"status":"ok"}`
- [ ] Register a new user via the frontend
- [ ] Register a psychologist account
- [ ] Take the 20-question test as a user
- [ ] Send a request to the psychologist
- [ ] Log in as psychologist, respond to the request
- [ ] Log back in as user, view the response

---

## 🔒 Security Notes

- Passwords are hashed with **bcrypt** (12 rounds) — never stored in plain text
- All protected routes require a **JWT Bearer token** (30-day expiry)
- CORS restricts API calls to your Vercel domain only
- `sslmode=require` enforced for all Render PostgreSQL connections

---

## 💡 Local Development

```bash
# Backend
cd backend
cp .env.example .env
# Fill in DATABASE_URL with a local Postgres or Render external URL
npm install
npm run dev      # nodemon auto-reload

# Frontend — just open in browser or use Live Server
# Set API_BASE to http://localhost:4000 in index.html
```

---

## 📋 API Reference

| Method | Endpoint              | Auth | Description                     |
|--------|-----------------------|------|---------------------------------|
| POST   | /api/auth/register    | ❌   | Register new user               |
| POST   | /api/auth/login       | ❌   | Login, returns JWT              |
| GET    | /api/auth/me          | ✅   | Get current user                |
| PUT    | /api/users/profile    | ✅   | Update psychologist profile     |
| GET    | /api/psychologists    | ✅   | List all psychologists          |
| POST   | /api/results          | ✅   | Save test result                |
| GET    | /api/results          | ✅   | Get my test results             |
| POST   | /api/requests         | ✅👤 | Send request to psychologist    |
| GET    | /api/requests         | ✅   | Get requests (role-based)       |
| POST   | /api/responses        | ✅🩺 | Submit psychologist response    |
| GET    | /api/responses        | ✅   | Get responses (role-based)      |
