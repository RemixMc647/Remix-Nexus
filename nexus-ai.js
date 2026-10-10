/**
 * nexus-ai.js — free AI bot for Remix Nexus (uses Groq's free tier)
 *
 * SETUP
 * 1. Get a free key at https://console.groq.com
 * 2. On Render: Environment -> add GROQ_API_KEY
 * 3. Put this file next to your server file, then add:
 *
 *      const { handleAIMessage } = require('./nexus-ai');
 *
 *      // inside your existing socket.on('chat message', async (msg) => { ... })
 *      // after you save + broadcast the message:
 *      await handleAIMessage(io, socket, msg);
 *
 * Users trigger it by typing:  @ai your question
 * Rename the fields below (msg.room, msg.text, socket.userId) to match your app.
 */

const MODEL = 'openai/gpt-oss-120b'; // check console.groq.com for current model names
const COOLDOWN_MS = 3000;            // per-user wait between questions
const DAILY_LIMIT = 30;              // per-user questions per day

const AI_USER = { _id: 'nexus-ai', username: 'Nexus AI', avatar: '/ai.png' };

const lastCall = new Map();  // userId -> timestamp
const daily = new Map();     // userId -> { day, count }

function checkLimits(userId) {
  const now = Date.now();
  if (now - (lastCall.get(userId) || 0) < COOLDOWN_MS) {
    return 'Easy, wait a few seconds 🙂';
  }
  const today = new Date().toISOString().slice(0, 10);
  const d = daily.get(userId);
  if (!d || d.day !== today) daily.set(userId, { day: today, count: 0 });
  if (daily.get(userId).count >= DAILY_LIMIT) {
    return "You've hit today's AI limit. Try again tomorrow!";
  }
  lastCall.set(userId, now);
  daily.get(userId).count++;
  return null;
}

async function askAI(prompt, recent = []) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content:
            'You are Nexus AI, a friendly assistant inside the Remix Nexus chat app. Keep replies short and casual.',
        },
        ...recent, // [{ role: 'user' | 'assistant', content: '...' }]
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!r.ok) throw new Error(`AI error ${r.status}`);
  const data = await r.json();
  return data.choices?.[0]?.message?.content || '...';
}

/**
 * Call this inside your 'chat message' handler.
 * Does nothing unless the message starts with "@ai".
 */
async function handleAIMessage(io, socket, msg) {
  if (!msg || typeof msg.text !== 'string' || !/^@ai\b/i.test(msg.text)) return;

  const prompt = msg.text.replace(/^@ai\b/i, '').trim();
  if (!prompt) return;

  const send = (text) => {
    const aiMsg = { room: msg.room, sender: AI_USER, text, createdAt: new Date() };
    // If you store messages in MongoDB, save it here, e.g.:
    // await Message.create(aiMsg);
    io.to(msg.room).emit('chat message', aiMsg);
  };

  const blocked = checkLimits(socket.userId || socket.id);
  if (blocked) return send(blocked);

  io.to(msg.room).emit('typing', { user: AI_USER.username }); // optional

  try {
    send(await askAI(prompt));
  } catch (e) {
    console.error('[nexus-ai]', e.message);
    send('AI is offline right now.');
  }
}

module.exports = { handleAIMessage, askAI, AI_USER };
