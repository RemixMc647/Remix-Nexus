// routes/aiAssist.js
// Mount in your main server file with: app.use(require('./routes/aiAssist'));
// Requires env var: GEMINI_API_KEY

const express = require('express');
const router = express.Router();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// --- Simple in-memory rate limiter ---
// NOTE: this resets if your Railway instance restarts / scales to multiple
// dynos. For production with multiple instances, swap this for Redis.
const rateLimits = new Map();
const RATE_LIMIT = 20; // requests per window
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(userId) {
  const now = Date.now();
  const entry = rateLimits.get(userId) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_WINDOW_MS;
  }
  entry.count++;
  rateLimits.set(userId, entry);
  return entry.count <= RATE_LIMIT;
}

const SYSTEM_PROMPT = `You are the Remix Nexus AI Assistant, built into a gaming/social chat app.
Personality: casual, friendly, gaming-savvy. Speak naturally in whatever language,
slang, or Pidgin English the user writes in — mirror their tone.

You have two jobs:
1. DRAFT MODE: Given a recent conversation, suggest 2-3 short reply options the
   user could send next, written in their own casual voice. Return ONLY a
   numbered list, nothing else — no preamble, no explanation.
2. ASK MODE: Answer any question — gaming strategy, patch notes, esports news,
   or general knowledge. Use web search for anything time-sensitive or current
   (patch notes, scores, news) rather than guessing from memory.

Keep everything concise — this is a mobile chat panel, not an essay.`;

router.post('/api/ai/assist', async (req, res) => {
  try {
    const { mode, userId, conversation, question } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' });
    }
    if (!checkRateLimit(userId)) {
      return res.status(429).json({ error: 'Rate limit reached. Try again in a bit.' });
    }
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Server missing GEMINI_API_KEY' });
    }

    let userMessage;
    if (mode === 'draft') {
      const convoText = (conversation || [])
        .map(m => `${m.sender}: ${m.text}`)
        .join('\n');
      userMessage = `Recent conversation:\n${convoText}\n\nSuggest 2-3 short reply options I could send next, in my own casual voice. Return ONLY a numbered list.`;
    } else if (mode === 'ask') {
      if (!question) return res.status(400).json({ error: 'Missing question' });
      userMessage = question;
    } else {
      return res.status(400).json({ error: 'Invalid mode — use "draft" or "ask"' });
    }

    // Cheaper/faster model for quick reply drafts, fuller model + web search for real questions
    // NOTE: gemini-2.5-flash / gemini-2.5-flash-lite were retired by Google (404 NOT_FOUND).
    // Updated to the current generation. gemini-flash-latest is an alias Google keeps pointed
    // at their current recommended Flash model, so it won't go stale the next time they retire one.
    const model = mode === 'ask' ? 'gemini-3.6-flash' : 'gemini-3.5-flash-lite';

    const body = {
      system_instruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      contents: [
        { role: 'user', parts: [{ text: userMessage }] },
      ],
      generationConfig: {
        maxOutputTokens: 1000,
      },
    };

    // Gemini's equivalent of Claude's web_search tool: Google Search grounding
    if (mode === 'ask') {
      body.tools = [{ google_search: {} }];
    }

    const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini API error:', data);
      return res.status(502).json({ error: 'AI service error' });
    }

    const parts = data.candidates?.[0]?.content?.parts || [];
    const textParts = parts
      .filter(part => typeof part.text === 'string')
      .map(part => part.text)
      .join('\n');

    if (mode === 'draft') {
      const options = textParts
        .split('\n')
        .map(line => line.replace(/^\d+[.)]\s*/, '').trim())
        .filter(line => line.length > 0);
      return res.json({ options });
    }

    return res.json({ answer: textParts });
  } catch (err) {
    console.error('AI assist error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

module.exports = router;
