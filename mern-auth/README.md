# MERN Auth — Access + Refresh Token System

## Architecture

**Stack:** MongoDB (Mongoose) · Express · React (Vite) · Node.js

```
frontend (React, :5173)  <-- credentials: include -->  backend (Express, :5000)  <-->  MongoDB
```

### Token design
- **Access token** — JWT, 15 min expiry, signed with `ACCESS_TOKEN_SECRET`. Kept in **memory only** on the frontend (a module-level variable in `src/api/axios.js`), never in localStorage/sessionStorage. Sent on every API call as `Authorization: Bearer <token>`. Not persisted to disk, which limits the damage an XSS payload could do (it can't just read it out of storage).
- **Refresh token** — JWT, 7 day expiry, signed with a *separate* `REFRESH_TOKEN_SECRET`. Stored as an **httpOnly, sameSite, secure (in prod) cookie**, scoped to the `/api/auth` path only, so it isn't attached to unrelated requests and isn't reachable from JS at all (mitigates XSS token theft).
- **Server-side tracking**: the backend stores a **SHA-256 hash** of each valid refresh token per user (`User.refreshTokens[]`), not the raw token. This lets the server revoke sessions (logout) and detect **refresh token reuse**: if a refresh token that isn't in the stored set is ever presented, all sessions for that user are invalidated immediately (protects against a stolen, replayed refresh token).
- **Rotation**: every call to `/api/auth/refresh` invalidates the old refresh token and issues a new one (single-use refresh tokens).
- **Silent re-auth**: on frontend load, the app calls `/api/auth/refresh` once to try to re-establish a session from the cookie (so a page reload doesn't force re-login within the 7-day window).
- **Auto-refresh on 401**: an axios response interceptor catches `TOKEN_EXPIRED` responses, calls `/refresh` once, and retries the original request transparently. Concurrent 401s are de-duped into a single in-flight refresh call.

### Why not just localStorage for everything?
Storing the access token in memory + refresh token in an httpOnly cookie is a deliberate tradeoff: it's more resistant to XSS (JS can't read either token) at the cost of losing the access token on hard refresh — which is fine since it's silently reissued from the refresh cookie.

## Deployment
- **Frontend:** Vercel (static Vite build) — fast, free tier, trivial GitHub integration.
- **Backend:** Render (Node web service) — free tier supports long-lived Express processes (unlike serverless platforms, which complicate cookie/session handling).
- **Database:** MongoDB Atlas (free M0 cluster) — managed, no ops burden, easy IP allowlisting.

> Fill in your actual deployed URLs here once live:
> - Frontend: `https://<your-app>.vercel.app`
> - Backend: `https://<your-app>.onrender.com`
> - Repo: `https://github.com/<you>/mern-auth`

## Running locally

```bash
# backend
cd backend
cp .env.example .env   # fill in MONGO_URI and secrets
npm install
npm run dev             # http://localhost:5000

# frontend
cd frontend
cp .env.example .env
npm install
npm run dev              # http://localhost:5173
```

## Environment variables
See `backend/.env.example` and `frontend/.env.example`. Generate strong secrets with:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
