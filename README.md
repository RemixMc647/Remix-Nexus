# RemixMC Gaming Society

This project is split into two pieces that get deployed separately:

- **`public/`** — the static front end (HTML/CSS/JS). Deploy this to Render as a **Static Site**.
- **`server.js` + `package.json`** — the backend (signup/login/profile via MongoDB + JWT, and live chat via Socket.io). Deploy this to **Glitch**.

They talk to each other over the internet (CORS-enabled), so they don't need to be on the same host.

```
server.js               Backend: auth API + Socket.io chat  →  goes to Glitch
package.json
.env.example             Copy to .env / Glitch's env editor and fill in real values
public/                  Frontend  →  goes to Render Static Site
  config.js               ⚠️ THE ONE FILE YOU EDIT — put your Glitch URL here
  index.html / .js         Login page
  Signup.html / .js        Create account page
  MusicHome.html / .js     Home page
  Trending.html / .css / .js   "Live" page
  Chat.html / .css / .js       Live chat rooms (Socket.io, connects to Glitch)
  Search.html / .css / .js     Search / filter chat rooms
  Profile.html / .css / .js    Shows your real signup info + avatar picker
  Privacy.html
  auth.js                  Shared login-state helper
  rooms.js                 Shared room list (Chat + Search)
  auth-pages.css
```

---

## Part 1 — Deploy the backend to Glitch

1. Go to https://glitch.com and sign in (no credit card needed).
2. **New Project → Import from GitHub** (recommended) — or create a blank Node project
   and upload `server.js` and `package.json` yourself using Glitch's file panel.
   - If importing from GitHub: push this whole folder to a repo first, then paste the repo URL into Glitch's import screen. Glitch only needs `server.js` and `package.json` — it's fine if `public/` comes along too.
3. In Glitch, open the **.env** file (in the file list on the left — if you don't see one, create a file named exactly `.env`) and add:
   ```
   MONGODB_URI=your-real-mongodb-atlas-connection-string
   JWT_SECRET=a-long-random-string
   FRONTEND_ORIGIN=https://your-static-site.onrender.com
   ```
   (Generate a JWT secret with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
4. Glitch auto-installs `package.json` dependencies and runs `npm start`. Watch the logs
   panel — you should see `✅ Connected to MongoDB` and `🎮 RemixMC server running...`.
5. Click **Share** (or the project name) to find your live URL — it looks like:
   ```
   https://your-project-name.glitch.me
   ```
   Copy this exact URL.

### MongoDB Atlas setup (if you haven't already)
1. https://www.mongodb.com/cloud/atlas → create a free cluster.
2. **Database Access** → add a database user + password.
3. **Network Access** → add `0.0.0.0/0` (allow from anywhere — Glitch's IPs aren't static).
4. **Connect → Drivers** → copy the connection string into `MONGODB_URI` above.

---

## Part 2 — Point the frontend at your Glitch backend

Open **`public/config.js`** and replace the placeholder with your real Glitch URL:

```js
const BACKEND_URL = 'https://your-project-name.glitch.me';
```

This is the *only* file that needs editing — every page (login, signup, profile, chat)
reads `BACKEND_URL` from here.

---

## Part 3 — Deploy the frontend to Render (Static Site)

1. Push the project (including your edited `config.js`) to GitHub.
2. In Render: **New → Static Site** → connect your repo.
3. Settings:
   - **Build Command:** leave blank (nothing to build, it's plain HTML/CSS/JS)
   - **Publish Directory:** `public`
4. Click **Create Static Site**. Render gives you a live URL like
   `https://remixmc.onrender.com`.
5. Go back to Glitch's `.env` and make sure `FRONTEND_ORIGIN` matches this exact URL
   (this is what allows the browser to let your static site talk to your Glitch backend).

---

## Testing it end-to-end

1. Visit your Render static site URL.
2. Click **Create an account** → sign up. This calls your Glitch backend's
   `/api/signup`, which hashes your password and saves you in MongoDB.
3. You're redirected to **Profile.html**, which calls `/api/me` on Glitch and shows
   your real username, email, join date, and lets you pick an avatar
   (`PUT /api/me/avatar`).
4. **Chat.html** connects to Glitch over Socket.io for real-time messaging.
5. **Search.html** filters the shared room list client-side.

If something doesn't load, open your browser's DevTools → Network tab and check:
- Are requests going to your real Glitch URL (not `localhost` or a placeholder)?
- Any CORS errors in the console? → double-check `FRONTEND_ORIGIN` on Glitch matches
  your Render static site's URL exactly (including `https://`, no trailing slash).

## Notes

- Glitch's free tier puts projects to sleep after a few minutes of inactivity — the
  first request after a while may take a few seconds while it wakes up. This is
  normal and only affects the very first request in a while.
- Chat messages are stored in memory on the Glitch server (they reset if it restarts
  or redeploys). Swap in a database-backed history later if you want it to persist.
- The video list on the Live page (`Trending.js`) is a manual list you edit directly —
  add your YouTube video IDs there. No API key needed.
