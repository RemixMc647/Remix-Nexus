/*==============================
REMIX-NEXUS — SHARED AUTH HELPER
Loaded on every page. Keeps the logged-in
user's token/info in localStorage and gives
every page a simple, consistent way to read it.
==============================*/

const AUTH = {
  TOKEN_KEY: 'remix-nexusToken',
  USER_KEY: 'remix-nexusUser',

  saveSession(token, user) {
    localStorage.setItem(this.TOKEN_KEY, token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  },

  getToken() {
    return localStorage.getItem(this.TOKEN_KEY);
  },

  getUser() {
    try {
      const raw = localStorage.getItem(this.USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  isLoggedIn() {
    return !!this.getToken();
  },

  logout() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
  },

  // (see window.AUTH assignment at the bottom of this file — top-level
  // `const` declarations don't automatically attach to `window`, but
  // other scripts on the page check `window.AUTH` specifically.)

  // Re-checks with the server that the token is still valid and refreshes
  // the cached user info. Returns the user object, or null if logged out.
  async fetchMe() {
    const token = this.getToken();
    if (!token) return null;

    try {
      const res = await fetch('https://remix-nexus-production.up.railway.app/api/me', {
        headers: { Authorization: 'Bearer ' + token }
      });

      if (!res.ok) {
        this.logout();
        return null;
      }

      const data = await res.json();
      localStorage.setItem(this.USER_KEY, JSON.stringify(data.user));
      return data.user;
    } catch (err) {
      // Network hiccup — don't log the user out, just fall back to cached info
      return this.getUser();
    }
  }
};

// IMPORTANT: `const AUTH = {...}` above creates AUTH as a global variable,
// but top-level const/let declarations do NOT attach to `window` the way
// `var` or a function declaration would. Chat.js (and possibly other
// pages) specifically check `window.AUTH` before using it, so without
// this line, `window.AUTH` is always undefined — even though `AUTH` on
// its own works fine — and every one of those checks silently falls back
// to "logged out" behavior (guest username, no token, no delete/edit
// buttons) no matter how correctly the person is actually logged in.
window.AUTH = AUTH;

// ---- NAV BAR: swap the Profile icon's tooltip + reflect login state ----
document.addEventListener('DOMContentLoaded', () => {
  const profileLink = document.querySelector('a[href="./Profile.html"], a[href="Profile.html"]');
  if (!profileLink) return;

  const user = AUTH.getUser();
  const btn = profileLink.querySelector('button');
  if (user && btn) {
    btn.textContent = user.avatar || '👤';
    btn.title = user.username;
  }
});
