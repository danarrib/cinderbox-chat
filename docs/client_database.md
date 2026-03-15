# Cinderbox Chat — Client-Side Database Structure

All persistent client state lives in two places: **IndexedDB** (for heavy message data) and **localStorage** (for configuration, room list, and small mappings).

---

## IndexedDB — `cinderbox` database (version 1)

Opened by `openDB()`. The database name is `cinderbox` and the current schema version is `1`. Two object stores are defined in the `onupgradeneeded` handler.

---

### `messages` store

**keyPath:** `id`

**Indexes:**
- `room_id` — used by `getMessagesForRoom()` to fetch all messages for a given room
- `sender_tag` — available for lookups by sender
- `recipient_tag` — available for lookups by recipient

Every message visible to the user (both sent and received) lives here. Outgoing messages from the sender also live here — the sender stores their own copy with `recipient_tag` set to their own tag.

#### Fields

| Field | Type | Set by | Description |
|-------|------|--------|-------------|
| `id` | String (UUID) | Sender (canonical msgId) | Primary key. For outgoing messages, generated at compose time. For incoming messages, populated from `parsed.original_id` in the decrypted payload (falling back to `inboxItem.id` if absent). This ensures sender and recipient share the same ID. |
| `room_id` | String (UUID) | Both | The room this message belongs to. |
| `type` | String | Both | Message type. Possible values: `text`, `image`, `audio`, `single_view`, `system_notice`, `profile_update`, `room_name`, `joined_room`, `leave_room`, `ack_viewed`, `ack_single_view_deleted`, `ask_for_delete`, `ack_deleted`. Silent types (`profile_update`, `room_name`, etc.) are usually not stored as messages — they update localStorage instead and `continue` in the inbox loop. |
| `sender_tag` | String (hex64) | Both | 64-char hex. For outgoing messages: `SHA-256(handle)` (session tag). For incoming messages: the sender's tag as present in the server row. For server ACKs: 64 zeros (SERVER_ACK_TAG). For system notices: the sender's tag from the triggering inbox item. |
| `recipient_tag` | String (hex64) | Both | The intended recipient's tag. For the sender's own copy of a message: their own session tag (`SHA-256(handle)`). For incoming messages: the local user's session tag. |
| `content` | String or null | Both | The message body. For `text`: the plaintext string. For `image` and `audio`: a base64 data URL. For `single_view` on the **sender's side**: always `null` (the sender never has content). For `single_view` on the **recipient's side**: the plaintext/data URL until the message is opened, then `null` after deletion. For `system_notice`: the notice text (e.g., "X joined the room."). Set to `null` when `status` is `delete_requested` or `seen_and_deleted`. |
| `text` | String or null | Recipient | Present on incoming messages that include a separate `text` field in the payload. Typically `null`; used in some rendering paths as a fallback. |
| `caption` | String or null | Both | Optional caption for image and single_view messages. `null` if not provided. |
| `inner_type` | String or null | Both | For `single_view` messages: the content type inside the wrapper (`"text"`, `"image"`, or `"audio"`). `null` for all other types. |
| `replied_to_id` | String or null | Both | UUID of the message being replied to, or `null`. Set at compose time on the sender's copy and included in the encrypted payload so recipients can also display the quoted reply. |
| `sent_at` | String (ISO 8601) | Both | Timestamp of when the message was composed (sender-generated, included in the encrypted payload). For incoming messages, the client adjusts `sent_at` to avoid timestamp collisions in batch delivery. |
| `status` | String or null | Sender | Delivery/lifecycle status. See status values table below. `null` for incoming messages and system notices. |
| `is_outgoing` | Boolean | Both | `true` for the sender's own copy; `false` for incoming messages. Controls rendering alignment and tick display. |
| `recipient_tags` | Array of strings | Sender | The list of session tags that were addressed when the message was sent (populated from `presenceMap` at compose time). Used to determine when all recipients have viewed the message (for tick state). Present only on the sender's copy. |
| `acks` | Array of objects | Sender | ACK entries received for this message. See ACK entry structure below. Present only on the sender's copy; starts as `[]`. |
| `_acked` | Boolean | Recipient | Set to `true` once an `ack_viewed` has been sent for this message (by the IntersectionObserver). Prevents duplicate `ack_viewed` sends. Not present until the message has been viewed. |

#### Status values

| Status | Set when |
|--------|----------|
| `'sending'` | Message first written to IndexedDB at compose time. Outbox not yet flushed to server. |
| `'synced'` | `ack_delivered` received from server (server has stored the message). |
| `'delivered'` | `ack_viewed` received from at least one recipient (recipient has confirmed the message was seen). Also set immediately on outgoing messages with no recipients (sent to an empty room). |
| `'delete_requested'` | "Delete for everyone" initiated. Content (`text`, `content`) cleared, tombstone retained. |
| `'seen_and_deleted'` | Sent single-view message: recipient confirmed deletion. Recipient single-view message: after content wiped on close. |
| `'opening'` | Crash-recovery sentinel set at the start of the single-view open flow. Cleared on success or failure. Cleaned up to `undefined` on next app launch if found stuck. |
| `undefined` / `null` | Incoming messages and system notices. |

#### ACK entry structure (inside `acks` array)

Each ACK entry is a plain object. The shape differs by type:

```json
// ack_delivered (server-generated)
{ "type": "ack_delivered", "sender_tag": "0000...0000", "received_at": "2026-03-15T10:00:00.000Z" }

// ack_received (server-generated)
{ "type": "ack_received", "recipient_tag": "<hex64>", "received_at": "2026-03-15T10:01:00.000Z" }

// ack_viewed (client-generated, from recipient)
{ "type": "ack_viewed", "sender_tag": "<hex64>", "received_at": "2026-03-15T10:02:00.000Z" }

// ack_deleted (client-generated, from recipient after delete request)
{ "type": "ack_deleted", "sender_tag": "<hex64>", "ts": 1710494400000 }
```

Duplicate ACK entries are blocked by `alreadyAcked` checks before inserting.

#### Tombstone states

A "tombstone" is a message record where `content` has been cleared but the record itself remains in IndexedDB so the rendering layer can show a placeholder:

- `status: 'delete_requested'` — content cleared, record kept to show "Deletion requested" bubble and track per-recipient `ack_deleted` confirmations.
- `status: 'seen_and_deleted'` — content cleared, record kept to show a "seen and deleted" indicator with a 🔥 tick on the sender's side.
- `status: 'opening'` — transient sentinel during single-view open. No content yet shown to user.

---

### `outbox` store

**keyPath:** `id`

No indexes. All outbox queries use `dbGetAll('outbox')` and filter by `room_id` in JavaScript via `getOutboxForRoom(roomId)`.

Each outbox entry represents a single encrypted ciphertext destined for a single recipient. A message with N recipients creates N outbox entries.

#### Lifecycle

1. **Created in `sendMessage()`** (or `sendAck()` or silent message sends) — written to IndexedDB immediately.
2. **Read in `doSync()`** — all outbox entries for all rooms are collected and included in the sync POST body.
3. **Deleted from IndexedDB** after the sync response is received successfully (`await dbDelete('outbox', id)` for each ID that was sent).
4. **If sync fails**, the outbox entries remain in IndexedDB and are retried on the next sync (5 seconds later).

#### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | String (UUID) | Primary key. A distinct UUID per recipient per message — this becomes the server-side `messages.id`. Different from `original_message_id`. |
| `room_id` | String (UUID) | The room to send this message in. |
| `recipient_tag` | String (hex64) | The intended recipient's session tag (`SHA-256(handle)`). |
| `ciphertext` | String (base64) | The encrypted payload (output of `encrypt(key, payload)`). This is what the server stores and the recipient decrypts. |
| `sender_tag` | String (hex64) | The local user's session tag (`SHA-256(handle)`). Included for reference; not sent to the server (the server uses the top-level `sender_tag` from the sync request). |
| `original_message_id` | String (UUID) or absent | The canonical message ID (`msgId`) that this outbox item belongs to. Used to populate `cc_outbox_map` at sync time. Absent for silent protocol messages (e.g., `profile_update`, `leave_room`, `room_name`, `joined_room`) that have no corresponding IndexedDB `messages` record. |
| `type` | String | The message type (same as `type` in the encrypted payload). Used for debug logging. |
| `sent_at` | String (ISO 8601) | Timestamp when the outbox item was created. |

---

## localStorage Keys

All keys are prefixed `cc_`. There is no namespacing beyond the prefix — all keys live in the same origin storage.

---

### `cc_handle`

| Property | Value |
|----------|-------|
| Type | String |
| Example | `"SilentHawk"` |
| Written | On first launch (auto-generated random `AdjectiveNoun`), and when the user saves their profile. |
| Read | On every sync (`getHandle()`), in all tag derivations, and for display. |
| Deleted | When the user clears all data (`localStorage.clear()`). |

---

### `cc_avatar`

| Property | Value |
|----------|-------|
| Type | String (base64 data URL) or absent |
| Example | `"data:image/jpeg;base64,/9j/4AAQ..."` |
| Written | When the user saves a profile picture. |
| Read | On sync (to include in `profile_update` broadcasts), and for avatar rendering in the nav bar. |
| Deleted | When the user removes their avatar (via profile save with no image), or when all data is cleared. |

---

### `cc_rooms`

| Property | Value |
|----------|-------|
| Type | JSON array of room objects |
| Example | `[{"id":"3fa85f64-...","name":"Work","password":"hunter2","deleteToken":"a3b2...","retention":2,"joinedAt":"2026-03-15T10:00:00.000Z"}]` |
| Written | When a room is created, joined, updated (name change), or removed. |
| Read | On every sync, on every render, and whenever room context is needed. |
| Deleted | Entries removed individually when leaving/deleting a room. Entire key cleared on "clear all data". |

Room object fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID string | The room's UUID |
| `name` | String | Local display name; `""` if not set |
| `password` | String | Plaintext room password — used to re-derive the key each session |
| `deleteToken` | String or null | 64-char hex plaintext token (only for room owners); `null` for non-owners |
| `retention` | Number (0–5) | Room retention setting |
| `joinedAt` | ISO 8601 string | Timestamp of when the room was added locally |

---

### `cc_profiles`

| Property | Value |
|----------|-------|
| Type | JSON object (map) |
| Example | `{"a1b2c3d4...": {"handle": "QuickFox", "avatar": null}}` |
| Written | When a `profile_update` message is received, or when profile screen is saved. |
| Read | For displaying sender names and avatars in the message thread and participant list. |
| Deleted | On "clear all data". |

Key: 64-char hex sender tag. Value: `{ handle: string, avatar: string|null }`.

---

### `cc_outbox_map`

| Property | Value |
|----------|-------|
| Type | JSON object (map) |
| Example | `{"uuid-outbox-id-1": "uuid-msg-id-canonical", "uuid-outbox-id-2": "uuid-msg-id-canonical"}` |
| Written | In `sendMessage()` and any function that creates outbox entries for visible messages. Saved via `saveOutboxMap()`. |
| Read | At the start of every `doSync()` to seed the in-memory map; also read when resolving ACK payloads. |
| Deleted | Entries are never explicitly removed after ACK resolution (the map can grow indefinitely). The entire key is cleared on "clear all data". Individual entries are removed when "delete for me" is used for a message. |

Entries accumulate over time. The map is seeded into memory on each sync from this localStorage key, ensuring that ACKs arriving in a future session can still be resolved. The entries for messages that have been fully ACKed or deleted remain as dead weight but cause no functional problems.

---

### `cc_lang`

| Property | Value |
|----------|-------|
| Type | String: `"en"` or `"pt-BR"` |
| Example | `"pt-BR"` |
| Written | When the user selects a language from the nav bar language selector. |
| Read | On startup and whenever `applyI18n()` is called to translate the UI. Defaults to `"en"` if absent. |
| Deleted | On "clear all data". Reverts to `"en"` on next load. |

---

### `cc_theme`

| Property | Value |
|----------|-------|
| Type | String: `"dark"` or `"light"` |
| Example | `"dark"` |
| Written | When the user toggles the theme button. Default is `"dark"` (applied if absent). |
| Read | Inline in the `<head>` on every page load (before `DOMContentLoaded`) to set `data-bs-theme` on `<html>` and avoid a flash of the wrong theme. Also read by `updateThemeButtons()`. |
| Deleted | On "clear all data". Reverts to dark on next load. |

---

### `cc_debug`

| Property | Value |
|----------|-------|
| Type | String `"1"` or absent |
| Example | `"1"` |
| Written | Manually by the developer in the browser console: `localStorage.setItem('cc_debug', '1')`. |
| Read | By the `dbg()` function on every call to determine whether to log to console. |
| Deleted | `localStorage.removeItem('cc_debug')` to disable. Also cleared on "clear all data". |

When present and set to `"1"`, all `dbg()` calls output to the browser console prefixed with `[cbx]`. This includes sync activity, message routing, ACK resolution, presence changes, and encryption events. Not shown to end users.
