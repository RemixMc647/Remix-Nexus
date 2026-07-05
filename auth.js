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
