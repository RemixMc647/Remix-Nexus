/*==============================
REMIXMC — SIGNUP LOGIC
==============================*/

(function () {
  const form = document.getElementById('signup-form');
  const usernameInput = document.getElementById('signupUsername');
  const emailInput = document.getElementById('signupEmail');
  const passwordInput = document.getElementById('signupPassword');
  const message = document.getElementById('signup-message');
  const submitBtn = document.getElementById('signup-submit-btn');

  if (!form) return;

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

    const username = usernameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (username.length < 3) {
      showMessage('Username must be at least 3 characters.', true);
      return;
    }

    if (password.length < 6) {
      showMessage('Password must be at least 6 characters.', true);
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account…';
    showMessage('', false);

    try {
      const res = await fetch(BACKEND_URL + '/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
      });

      const data = await res.json();

      if (!res.ok) {
        showMessage(data.error || 'Signup failed. Please try again.', true);
        return;
      }

      AUTH.saveSession(data.token, data.user);
      showMessage('Account created! Redirecting to your profile…', false);

      setTimeout(() => {
        window.location.href = './Profile.html';
      }, 700);

    } catch (err) {
      console.error('Signup error:', err);
      showMessage('Could not reach the server. Please try again in a moment.', true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create account';
    }
  });
})();
