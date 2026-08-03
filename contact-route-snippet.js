/*==============================
REMIX-NEXUS — /api/contact ROUTE
Drop this into server.js near your other routes. It reuses
the same Nodemailer `transporter` you already set up for the
password reset flow — no new env vars needed if that's
already configured.

Sends the message to yourself (set CONTACT_INBOX_EMAIL in
Railway, or hardcode your address below).
==============================*/

app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, reason, message } = req.body;

    if (!name || !email || !message || message.trim().length < 10) {
      return res.status(400).json({ error: 'Please fill out all required fields.' });
    }

    const inbox = process.env.CONTACT_INBOX_EMAIL || 'youremail@example.com';

    await transporter.sendMail({
      from: `"Remix Nexus Contact Form" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to: inbox,
      replyTo: email,
      subject: `[Remix Nexus Contact] ${reason || 'General'} — ${name}`,
      text: `From: ${name} <${email}>\nReason: ${reason || 'General'}\n\n${message}`,
      html: `
        <p><strong>From:</strong> ${name} &lt;${email}&gt;</p>
        <p><strong>Reason:</strong> ${reason || 'General'}</p>
        <p><strong>Message:</strong></p>
        <p>${message.replace(/\n/g, '<br>')}</p>
      `
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Contact form error:', err);
    res.status(500).json({ error: 'Could not send message. Please try again later.' });
  }
});
