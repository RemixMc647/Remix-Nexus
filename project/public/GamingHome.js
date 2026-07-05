/*==============================
REMIXMC — HOME PAGE
Newsletter subscribe (Mailchimp)
==============================*/

(function () {
  const form = document.getElementById('newsletter-form');
  const emailInput = document.getElementById('newsletter-email');
  const message = document.getElementById('newsletter-message');

  if (!form || !emailInput || !message) return;

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  form.addEventListener('submit', function (e) {
    const email = emailInput.value.trim();

    if (!isValidEmail(email)) {
      e.preventDefault();
      message.textContent = 'Please enter a valid email address.';
      message.style.color = '#ff5b5b';
      return;
    }

    message.textContent = 'Thanks for subscribing! Check the new tab to confirm.';
    message.style.color = '#00e676';
    emailInput.value = '';
  });
})();
