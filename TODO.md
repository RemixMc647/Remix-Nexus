 # Implementation Plan — WhatsApp & Snapchat Features

## Phase 1: Database Schema Updates (server.js) ✅ COMPLETE
- [x] Already have: `blockedUsers` array on User model
- [x] Already have: `seen` field on DM model
- [x] Already have: `replyTo` support in messages
- [x] Already have: `edited` flag on messages
- [x] Already have: Message `id` field for edits/deletes
- [x] Already have: Typing indicators (chat:typing & dm:typing)
- [x] Already have: Online presence (presence:online/offline)
- [x] Already have: Read receipts via dm:seen
- [x] **NEW:** `pinnedChats` field on User model — array of room/contact IDs (prefixed with 'room:'/'contact:')
- [x] **NEW:** `starredMessages` field on User model — array of message IDs
- [x] **NEW:** `mutedChats` field on User model — array of room/contact IDs
- [x] **NEW:** `archivedChats` field on User model — array of room/contact IDs
- [x] **NEW:** `lastSeen` field on User model — Date for "last seen" tracking
- [x] **NEW:** `chatWallpaper` field on User model — base64 data URL for wallpaper
- [x] **NEW:** `darkMode` field on User model — boolean
- [x] **NEW:** `reactions` sub-document array on DirectMessage schema — emoji reactions
- [x] **NEW:** `viewOnce` field on DirectMessage — boolean for Snapchat-style view-once
- [x] **NEW:** `selfDestructAt` field on DirectMessage — Date for auto-delete
- [x] **NEW:** `snapTimer` field on DirectMessage — number for snap timer seconds
- [x] **NEW:** `screenshotDetected` field on DirectMessage — boolean
- [x] **NEW:** `streaks` Map field on User model — snapchat-style streak counter per contact

## Phase 2: Server-side Socket Events & REST Endpoints (server.js) ✅ COMPLETE

### WhatsApp Features:
- [x] `chat:message:forward` — Forward a message to another room/contact
- [x] `chat:message:star` / `chat:message:unstar` — Star/unstar a message (via REST)
- [x] `chat:message:react` — Add emoji reaction to message
- [x] `chat:message:report` — Report a message
- [x] `chat:pin` / `chat:unpin` — Pin/unpin a chat (via REST)
- [x] `chat:mute` / `chat:unmute` — Mute/unmute a chat (via REST)
- [x] `chat:archive` / `chat:unarchive` — Archive/unarchive a chat (via REST)
- [x] `chat:search` — Server-side message search endpoint
- [x] `chat:export` — Export chat as TXT
- [x] `user:block` / `user:unblock` — Already done via REST
- [x] `user:report` — Report a user
- [x] `user:lastSeen` — Track & expose last seen timestamps
- [x] `GET /api/me/state` — Get full user state (pinned, starred, muted, archived, darkMode, wallpaper)
- [x] `GET /api/me/starred` — Get starred messages with full content
- [x] `GET /api/me/export/:userId` — Export DM conversation as TXT
- [x] `GET /api/me/export/room/:roomId` — Export room chat as TXT
- [x] `POST /api/users/:id/report` — Report a user
- [x] `POST /api/messages/report` — Report a message by ID

### Snapchat Features:
- [x] `dm:message:viewOnce` — Send a view-once message (photo/video) with selfDestructAt
- [x] `dm:message:screenshot` — Notify screenshot detection
- [x] `dm:message:screenRecording` — Notify screen recording detection
- [x] `chat:streak:update` — Increment/update streak counter
- [x] `chat:privacy` — Update conversation privacy settings

## Phase 3: Frontend - WhatsApp Features (Chat.js)

### Message Features:
- [ ] **Forward message** — Long-press/context menu → Forward → Select target
- [ ] **Copy message** — Context menu option to copy text
- [ ] **Delete for Me** — New delete option (currently only "delete for everyone")
- [ ] **Star/Favorite** — Star icon on messages, starred view
- [ ] **Message search** — Search bar in chat with results
- [ ] **Emoji reactions** — Tap message → emoji picker → show reactions
- [ ] **Voice message playback speed** — Speed selector on audio elements

### Chat List Features:
- [ ] **Pin chats** — Pin icon, pinned chats stay at top
- [ ] **Chat search** — Search bar in room/contact list
- [ ] **Mute notifications** — Mute icon, mute duration picker
- [ ] **Archive chats** — Archive section in sidebar
- [ ] **Chat wallpaper** — Wallpaper picker per chat
- [ ] **Auto-scroll to newest** — Auto scroll behavior
- [ ] **Floating "New Messages" button** — Floating button when scrolled up
- [ ] **Unread badge** — Already partially done, enhance

### Delivery Status:
- [ ] **Sent indicator** — Single ✓ on sent
- [ ] **Delivered indicator** — Double ✓ when delivered
- [ ] **Read receipts** — Double blue ✓ — Already done for DMs
- [ ] **Sender info for Delete for Everyone** — Track who deleted

## Phase 4: Frontend - Snapchat Features (Contacts.js + Chat.js)

### Media Features:
- [ ] **View-once photos** — Photo that disappears after viewing
- [ ] **View-once videos** — Video that disappears after viewing
- [ ] **Self-destructing media** — Timer-based auto-delete
- [ ] **Screenshot detection** — Notify sender if screenshot detected
- [ ] **Screen recording detection** — Where browser API allows

### Chat Features:
- [ ] **Snap timer** — Timer picker before sending
- [ ] **Temporary chat messages** — Messages that auto-delete
- [ ] **Chat disappears after chosen time** — Per-conversation timer
- [ ] **Story-style media viewer** — Full-screen media viewer

### Social Features:
- [ ] **Friend status icons** — Enhanced presence indicators
- [ ] **Fun emoji indicators** - Bitmoji/avatar placeholders
- [ ] **Simple streak counter** - Streak counter with fire emoji
- [ ] **Conversation privacy options** - Who can message/call
- [ ] **Camera shortcut** - If camera exists

## Phase 5: Settings Integration (Settings.js + Settings.html)

- [ ] Add new settings entries:
  - Dark Mode toggle
  - Chat wallpaper picker
  - Archived Chats management
  - Starred Messages view
  - Export Chat option
  - Muted Chats management
  - Snap Timer defaults
  - Streak settings
  - Privacy settings for Snapchat features

## Phase 6: UI Enhancements

### Chat UI (Chat.css):
- [ ] Starred messages visual style
- [ ] Forward message UI
- [ ] Emoji reaction picker UI
- [ ] Pin chat visual indicator
- [ ] Mute chat visual indicator
- [ ] Archive section styling
- [ ] Wallpaper support
- [ ] Floating button styling
- [ ] Voice speed selector UI

### DM/Contact UI (Contacts.css):
- [ ] View-once media styles
- [ ] Screenshot detection alert UI
- [ ] Snap timer UI
- [ ] Streak counter UI
- [ ] Friend status icons
- [ ] Privacy mode indicators

## Implementation Status

### ✅ COMPLETED (Chat.js + Chat.css - Phase 1):
1. ✅ Star/Favorite messages
2. ✅ Emoji reactions (reaction picker + display)
3. ✅ Pin chats (with icons in room list)
4. ✅ Chat search (filter rooms by name)
5. ✅ Message search (filter + highlight within room)
6. ✅ Copy message (context menu)
7. ✅ Forward message (to another room)
8. ✅ Delete for Me (local delete)
9. ✅ Mute notifications (with icons)
10. ✅ Archive chats (with icons and styling)
11. ✅ Chat wallpaper (via --chat-bg CSS variable)
12. ✅ Voice message playback speed (0.5x, 1x, 1.5x, 2x)
13. ✅ Floating "New Messages" button (when scrolled up)
14. ✅ Auto-scroll behavior improvements
15. ✅ Context menu (right-click/long-press on messages)
16. ✅ Read receipts (sent/delivered indicators)
17. ✅ Dark mode support (toggles class on body)
18. ✅ Enhanced connection state management
19. ✅ Reactions display on messages
20. ✅ Star indicator on starred messages
21. ✅ CSS for: context menu, reaction picker, starred messages, search highlight, dark mode, wallpaper, floating button, voice speed, sent/delivered ticks, online dot, archived section, view-once overlay, snap timer, streak counter, friend status emoji, last seen

### ✅ COMPLETED (server.js - Schema + REST + Socket):
- [x] User model fields: pinnedChats, starredMessages, mutedChats, archivedChats, darkMode, chatWallpaper, streaks, lastSeen
- [x] DirectMessage model fields: reactions, viewOnce, selfDestructAt, snapTimer, screenshotDetected
- [x] RoomMessage model fields: reactions
- [x] REST endpoints: GET /api/me/state, POST /api/me/pin, POST /api/me/mute, POST /api/me/archive, POST /api/me/star, GET /api/me/starred, GET /api/me/export/:userId, GET /api/me/export/room/:roomId, POST /api/users/:id/report, POST /api/messages/report
- [x] Socket handlers: chat:message:react, chat:message:forward, dm:message:viewOnce, chat:streak:update, dm:message:screenshot

### ✅ COMPLETED (Settings.html + Settings.js):
- [x] Dark Mode toggle setting card
- [x] Starred Messages view card
- [x] Archived Chats card
- [x] Muted Chats card
- [x] Export Chat card
- [x] Settings.js handlers for all new cards

### COMPLETED (Contacts.js):
- ✅ Context menu with Reply, Copy, Star, Delete for Me, Delete for Everyone
- ✅ Emoji reaction picker with 8 reactions
- ✅ View-once media support (Snapchat-style) with tap-to-reveal
- ✅ Self-destruct timer for view-once media
- ✅ Message search in DMs with search highlighting
- ✅ Streak counter display with fire emoji
- ✅ Friend status emoji indicators (💎, 🌟, 🟢, 🔥)
- ✅ Screenshot/screen recording detection alerts
- ✅ Enhanced renderDMMessages with stars, reactions, view-once, snap timer
- ✅ Socket listeners for: dm:message:reacted, dm:streak:update, dm:screenshot:detected, dm:screenrecording:detected, dm:message:viewed, dm:message:starred
- ✅ **BUG FIX**: Fixed ReferenceError (`msg` is not defined) in view-once tap handler

### DONE (just completed):
- ✅ Contacts.css — CSS for all Snapchat features in DM view added (view-once overlay, snap timer badge, streak counter, friend status emoji, reaction display, starred messages, search highlight, context menu, reaction picker, message search bar, screenshot alert, last seen text, enhanced online dot, DM header presence, mobile adjustments)

## Files Changed
- ✅ Chat.js — All frontend WhatsApp/Snapchat features added
- ✅ Chat.css — CSS for all new features added
- ✅ server.js — New models, socket handlers, REST endpoints added
- ✅ Settings.html — New setting cards added
- ✅ Settings.js — New setting handlers added
- ✅ Contacts.js — Snapchat DM features integrated (view-once, streaks, reactions, context menu, message search)
- ✅ Contacts.css — CSS for Snapchat features in DM view added

## Files to Modify (No files will be renamed or deleted)

### server.js — Append new models, socket handlers, REST endpoints to existing
### Chat.js — Append new UI handlers, features
### Contacts.js — Append Snapchat-related DM features
### Settings.html — Append new setting cards
### Settings.js — Append new setting handlers
### Chat.css — Append new CSS rules for features
### Contacts.css — Append new CSS rules for features
### rooms.js — If needed for pinned rooms order

## Files That Will NOT Be Changed
- index.html, index.js (home page)
- auth.js (authentication logic)
- config.js (URL configuration)
- calls.js (call logic)
- All static pages (Login, Signup, Profile, Search, Trending, About, Terms, Privacy, Contact, reset-password, download, etc.)

