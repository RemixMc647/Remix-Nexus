/*==============================
REMIX-NEXUS — DELETE /api/me/chats
Permanently deletes chat data for the logged-in user:
  - Their own messages in public rooms (RoomMessage docs they authored)
  - Every DM conversation they're a participant in (DirectMessage docs)

⚠️ IMPORTANT — check these before pasting in:
  1. Replace `RoomMessage` / `DirectMessage` with your ACTUAL Mongoose
     model names/imports if they differ.
  2. This assumes room messages have an `author` (or `sender`) field
     storing the user's ID/username, and DirectMessage has a
     `participants` array. Adjust field names to match your schema.
  3. This uses your existing JWT auth middleware (the same one that
     protects /api/me/username etc.) — swap `requireAuth` for whatever
     you actually named it.

Drop this into server.js near your other /api/me/* routes.
==============================*/

app.delete('/api/me/chats', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id; // adjust if your auth middleware stores it differently

    const [roomResult, dmResult] = await Promise.all([
      RoomMessage.deleteMany({ author: userId }),
      DirectMessage.deleteMany({ participants: userId })
    ]);

    res.json({
      success: true,
      roomMessagesDeleted: roomResult.deletedCount,
      dmConversationsDeleted: dmResult.deletedCount
    });
  } catch (err) {
    console.error('Clear all chats error:', err);
    res.status(500).json({ error: 'Could not clear chats. Please try again later.' });
  }
});
