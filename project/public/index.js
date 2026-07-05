/*==============================
REMIXMC — LOGIN LOGIC
==============================*/

(function () {
  const form = document.getElementById('login-form');
  const emailInput = document.getElementById('loginEmail');
  const passwordInput = document.getElementById('loginPassword');
  const message = document.getElementById('login-message');
  const submitBtn = document.getElementById('login-submit-btn');

  if (!form) return;

  // Already logged in? Skip straight to the profile.
  if (AUTH.isLoggedIn()) {
    window.location.href = './Profile.html';
    return;
  }

  function showMessage(text, isError) {
    message.textContent = text;
    message.style.color = isError ? '#ff5b5b' : '#00e676';
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      showMessage('Please fill in both fields.', true);
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Logging in…';
    showMessage('', false);

    try {
      const res = await fetch(BACKEND_URL + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();

      if (!res.ok) {
        showMessage(data.error || 'Login failed. Please try again.', true);
        return;
      }

      AUTH.saveSession(data.token, data.user);
      showMessage('Welcome back! Redirecting…', false);

      setTimeout(() => {
        window.location.href = './Profile.html';
      }, 600);

    } catch (err) {
      console.error('Login error:', err);
      showMessage('Could not reach the server. Please try again in a moment.', true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Log in';
    }
  });
})();
