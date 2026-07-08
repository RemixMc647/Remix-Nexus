/*==============================
REMIX-NEXUS — LOGIN LOGIC
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
      const res = await fetch('https://remix-nexus-production.up.railway.app/api/login', {
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

  // ---- FORGOT PASSWORD ----
  const forgotPasswordLink = document.getElementById('forgotPasswordLink');
  const forgotPasswordBox = document.getElementById('forgotPasswordBox');
  const forgotEmailInput = document.getElementById('forgotEmail');
  const forgotSubmitBtn = document.getElementById('forgotSubmitBtn');
  const forgotMessage = document.getElementById('forgot-message');

  if (forgotPasswordLink && forgotPasswordBox) {
    forgotPasswordLink.addEventListener('click', (e) => {
      e.preventDefault();
      const isHidden = forgotPasswordBox.style.display === 'none';
      forgotPasswordBox.style.display = isHidden ? 'block' : 'none';
      if (isHidden) forgotEmailInput.focus();
    });
  }

  if (forgotSubmitBtn) {
    forgotSubmitBtn.addEventListener('click', async () => {
      const email = forgotEmailInput.value.trim();

      if (!email) {
        forgotMessage.textContent = 'Please enter your email address.';
        forgotMessage.style.color = '#ff5b5b';
        return;
      }

      forgotSubmitBtn.disabled = true;
      forgotSubmitBtn.textContent = 'Sending…';
      forgotMessage.textContent = '';

      try {
        const res = await fetch('https://remix-nexus-production.up.railway.app/api/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });

        const data = await res.json();

        forgotMessage.textContent = data.message || 'If an account with that email exists, a reset link has been sent.';
        forgotMessage.style.color = '#00e676';
        forgotEmailInput.value = '';

      } catch (err) {
        console.error('Forgot password error:', err);
        forgotMessage.textContent = 'Could not reach the server. Please try again in a moment.';
        forgotMessage.style.color = '#ff5b5b';
      } finally {
        forgotSubmitBtn.disabled = false;
        forgotSubmitBtn.textContent = 'Send reset link';
      }
    });
  }
})();
