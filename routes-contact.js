// routes/contact.js
// Handles POST /api/contact from Contact.js — emails the complaint/message to you.

const express = require('express');
const router = express.Router();

// Reuse the SAME transporter you already use for password reset emails.
// Adjust this path to wherever that transporter/module actually lives, e.g.:
//   const transporter = require('../utils/mailer');
//   const { transporter } = require('../mailer');
const transporter = require('../utils/mailer'); // <-- CHANGE THIS PATH to match your project

router.post('/api/contact', async (req, res) => {
  try {
    const { name, email, reason, message } = req.body;

    if (!name || name.trim().length < 2 || !email || !message || message.trim().length < 10) {
      return res.status(400).json({ error: 'Please fill out all fields.' });
    }

    await transporter.sendMail({
      from: `"Remix Nexus Contact Form" <${process.env.EMAIL_USER}>`,
      to: process.env.CONTACT_TO_EMAIL, // where YOU receive complaints
      replyTo: email, // lets you hit "reply" and answer the user directly
      subject: `[Remix Nexus] ${reason || 'New message'} — from ${name}`,
      text: `From: ${name} <${email}>\nReason: ${reason}\n\n${message}`,
      html: `
        <p><strong>From:</strong> ${name} (${email})</p>
        <p><strong>Reason:</strong> ${reason}</p>
        <p><strong>Message:</strong></p>
        <p>${String(message).replace(/\n/g, '<br>')}</p>
      `,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Contact form error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
