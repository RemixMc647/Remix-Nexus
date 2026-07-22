/*==============================
REMIX-NEXUS — RESET PASSWORD LOGIC
Reads the reset token from the URL (?token=...) and lets the
person set a new password via /api/reset-password.
==============================*/

(function () {
  const form = document.getElementById('reset-password-form');
  const newPasswordInput = document.getElementById('newPassword');
  const message = document.getElementById('reset-message');
  const submitBtn = document.getElementById('reset-submit-btn');

  if (!form) return;

  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  function showMessage(text, isError) {
    message.textContent = text;
    message.style.color = isError ? '#ff5b5b' : '#00e676';
  }

  if (!token) {
    showMessage('This reset link is missing or invalid. Please request a new one from the login page.', true);
    submitBtn.disabled = true;
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    if (!token) return;

    const newPassword = newPasswordInput.value;

    if (newPassword.length < 6) {
      showMessage('Password must be at least 6 characters.', true);
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Resetting…';
    showMessage('', false);

    try {
      const res = await fetch('https://remix-nexus-bgz9.onrender.com/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword })
      });

      const data = await res.json();

      if (!res.ok) {
        showMessage(data.error || 'Could not reset password. The link may have expired.', true);
        return;
      }

      showMessage('Password updated! Redirecting to log in…', false);
      setTimeout(() => { window.location.href = './index.html'; }, 1200);

    } catch (err) {
      console.error('Reset password error:', err);
      showMessage('Could not reach the server. Please try again in a moment.', true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Reset Password';
    }
  });
})();
