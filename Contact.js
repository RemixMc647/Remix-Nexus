/*==============================
REMIX-NEXUS — CONTACT PAGE LOGIC
Sends the contact form to the backend, which emails it to the
team via the existing Nodemailer setup (same transporter used
for password reset emails).
==============================*/

const contactForm = document.getElementById('contactForm');
const contactSubmitBtn = document.getElementById('contactSubmitBtn');
const contactStatus = document.getElementById('contactStatus');

contactForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = document.getElementById('contactName').value.trim();
  const email = document.getElementById('contactEmail').value.trim();
  const reason = document.getElementById('contactReason').value;
  const message = document.getElementById('contactMessage').value.trim();

  if (name.length < 2 || message.length < 10) {
    contactStatus.textContent = 'Please fill out all fields.';
    contactStatus.style.color = '#ff5b5b';
    return;
  }

  contactSubmitBtn.disabled = true;
  contactStatus.textContent = 'Sending…';
  contactStatus.style.color = '#bdbdbd';

  try {
    const res = await fetch('https://remix-nexus-bgz9.onrender.com/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, reason, message })
    });

    const data = await res.json();

    if (!res.ok) {
      contactStatus.textContent = data.error || 'Something went wrong. Please try again.';
      contactStatus.style.color = '#ff5b5b';
      return;
    }

    contactForm.reset();
    contactStatus.textContent = "Message sent! We'll get back to you soon.";
    contactStatus.style.color = '#00e676';
  } catch (err) {
    contactStatus.textContent = 'Could not reach the server. Please try again later.';
    contactStatus.style.color = '#ff5b5b';
  } finally {
    contactSubmitBtn.disabled = false;
  }
});
