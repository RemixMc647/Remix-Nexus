/*==============================
REMIXMC — BACKEND CONFIG
This is the ONLY place you need to edit once your Glitch
project is live. Every page loads this file first.

1. Deploy server.js + package.json to Glitch (see README).
2. Glitch gives you a URL like: https://your-project-name.glitch.me
3. Paste that exact URL below (no trailing slash).
==============================*/

// Backend used by all pages for /api calls and Socket.io
const BACKEND_URL = 'https://remix-nexus-production.up.railway.app';

// Frontend origin used by backend CORS (some deployments also embed this into static pages)
// If your backend reads FRONTEND_ORIGIN from environment variables, you may not need this value.
const FRONTEND_URL = 'https://atremix-nexus-194v.onrender.com';
