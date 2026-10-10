/**
 * nexus-ai.js — free AI bot for Remix Nexus rooms (Groq free tier)
 *
 * Adds its OWN listener on every socket connection, so you do not have to
 * touch your existing 'chat:message' handler.
 * Users trigger it by sending a room message that starts with "@ai".
 *
 * SETUP
 *  1. Free key at https://console.groq.com -> Render > Environment > GROQ_API_KEY
 *  2. Put this file next to server.js
 *  3. In server.js, AFTER makeMessageId() is defined (just below removeOnline), add:
 *
 *       require('./nexus-ai').init({ io, RoomMessage, makeMessageId });
 */

const MODEL = 'openai/gpt-oss-120b'; // check console.groq.com for current model names
const COOLDOWN_MS = 3000;            // wait between questions, per user
const DAILY_LIMIT = 30;              // questions per user per day
const CONTEXT_MESSAGES = 6;          // recent room messages sent as context

const AI_NAME = 'Nexus AI';
const AI_ID = 'nexus-ai';

const lastCall = new Map(); // userId -> timestamp
const daily = new Map();    // userId -> { day, count }

function checkLimits(userId) {
  const now = Date.now();
  if (now - (lastCall.get(userId) || 0) < COOLDOWN_MS) {
    return 'Easy, wait a few seconds 🙂';
  }
  const today = new Date().toISOString().slice(0, 10);
  let d = daily.get(userId);
  if (!d || d.day !== today) {
    d = { day: today, count: 0 };
    daily.set(userId, d);
  }
  if (d.count >= DAILY_LIMIT) return "You've hit today's AI limit. Try again tomorrow!";
  lastCall.set(userId, now);
  d.count++;
  return null;
}

async function askGroq(prompt, history) {
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
            'You are Nexus AI, a friendly assistant inside Remix Nexus, a gaming community chat app. ' +
            'Keep replies short, casual and fun. Plain text only.',
        },
        ...history,
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!r.ok) throw new Error(`Groq error ${r.status}`);
  const data = await r.json();
  return (data.choices?.[0]?.message?.content || '...').trim();
}

function init({ io, RoomMessage, makeMessageId }) {
  async function postAIMessage(room, text) {
    const id = makeMessageId();
    const time = Date.now();
    try {
      await RoomMessage.create({
        id, room, author: AI_NAME, authorId: AI_ID, text, time: new Date(time),
      });
    } catch (e) {
      console.error('[nexus-ai] could not save reply:', e.message);
    }
    io.to(room).emit('chat:message', {
      room,
      message: { id, author: AI_NAME, authorId: AI_ID, text, time, replyTo: null },
    });
  }

  async function recentContext(room) {
    try {
      const rows = await RoomMessage.find({ room, text: { $ne: '' } })
        .sort({ time: -1 })
        .limit(CONTEXT_MESSAGES)
        .lean();
      return rows.reverse().map((m) =>
        m.authorId === AI_ID
          ? { role: 'assistant', content: m.text }
          : { role: 'user', content: `${m.author}: ${m.text}` }
      );
    } catch {
      return [];
    }
  }

  io.on('connection', (socket) => {
    socket.on('chat:message', async (payload) => {
      try {
        const room = payload && payload.room;
        const text = payload && payload.message && payload.message.text;
        if (!room || typeof text !== 'string' || !/^@ai\b/i.test(text.trim())) return;

        const prompt = text.trim().replace(/^@ai\b/i, '').trim();
        if (!prompt) return;

        if (!process.env.GROQ_API_KEY) {
          return postAIMessage(room, 'AI is not set up yet (missing GROQ_API_KEY).');
        }

        const blocked = checkLimits(String(socket.userId || socket.id));
        if (blocked) return postAIMessage(room, blocked);

        // Recent chat as context; drop the last entry (the "@ai ..." message itself,
        // which is passed separately as the prompt) if it's already saved.
        let history = await recentContext(room);
        if (history.length && history[history.length - 1].content.includes(prompt)) {
          history = history.slice(0, -1);
        }

        try {
          await postAIMessage(room, await askGroq(prompt, history));
        } catch (e) {
          console.error('[nexus-ai]', e.message);
          await postAIMessage(room, 'AI is offline right now. Try again in a bit.');
        }
      } catch (e) {
        console.error('[nexus-ai] handler error:', e);
      }
    });
  });

  console.log('✨ Nexus AI ready (type "@ai ..." in a room)');
}

module.exports = { init };
