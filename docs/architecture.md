# Cinderbox Chat — System Architecture

## Design Philosophy

Cinderbox Chat is built around two constraints: it must run on the cheapest possible hosting (shared PHP/MySQL), and it must never store anything the server operator can read. Everything else follows from those two decisions.

The result is a two-file application — `index.html` and `api.php` — with no build step, no Node.js, no package manager, and no CDN. The entire frontend ships as a single self-contained HTML file with Bootstrap 5 and all JavaScript embedded inline. Deploying an update is a single `scp` command.

---

## File Structure and Roles

| File | Role |
|------|------|
| `index.html` | Full single-page application. All UI, all client-side logic, Bootstrap 5 CSS/JS, and the Web Crypto encryption layer are embedded inline. No external requests. |
| `api.php` | Backend API. All database interactions use PDO prepared statements. Receives outbox items, delivers inbox items, manages presence, and runs cleanup. |
| `config.php` | Auto-generated on first run. Contains DB credentials as PHP `define()` constants. Never committed (enforced by `.gitignore`). |
| `sw.js` | Service Worker. Caches the HTML shell for offline access. Only intercepts navigation requests — all API calls go directly to the network. |
| `manifest.json` | PWA manifest. Enables "Add to Home Screen" on mobile. Standalone display mode, portrait orientation. |
| `icon.svg` | Application icon. Used by the PWA manifest. |

---

## Sync Model

There are no WebSockets. The client polls the server every **5 seconds** using a single HTTP POST to `api.php?action=sync`.

A single sync request covers all rooms the client is currently in. The request body contains:

```json
{
  "sender_tag": "<sha256(handle)>",
  "rooms": [
    {
      "room_id": "<uuid>",
      "outbox": [
        { "id": "<uuid>", "recipient_tag": "<hex64>", "ciphertext": "<base64>" }
      ],
      "leave": true  // optional, only when leaving
    }
  ]
}
```

The server processes all rooms in a single transaction pass: inserts outbox items, fetches and deletes inbox items, upserts presence, and runs lazy expiry. It returns inbox contents, presence lists, and any per-item errors.

The sync timer is started by `startSync()` and runs via `setInterval(doSync, 5000)`. An immediate call is made on start. The `isSyncing` flag prevents concurrent sync calls.

### Sender tag in sync requests

The top-level `sender_tag` in a sync request is `SHA-256(handle)` — a session-level identifier used by the server for rate limiting and presence upserts. This differs from the per-room sender tag (`SHA-256(handle + room_id)`) that is embedded inside encrypted message payloads. The server stores presence keyed by `(room_id, sender_tag)` using the session tag. Recipient-to-sender mapping is resolved through `profile_update` messages exchanged in the inbox.

---

## Storage Layers

### Server: MySQL

Four tables are maintained on the server. All SQL uses PDO prepared statements — no exceptions.

**`rooms`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | CHAR(36) | UUIDv4 room identifier |
| `delete_token` | CHAR(64) | SHA-256 hash of the owner's plaintext delete token |
| `retention` | TINYINT | 0–5; see retention policy |
| `encryption_test` | TEXT | Encrypted room ID, used to validate passwords on join |
| `last_used_at` | DATETIME | Updated on every sync; used to detect abandoned rooms |

**`messages`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | CHAR(36) | UUIDv4 message identifier |
| `room_id` | CHAR(36) | Foreign key to `rooms.id` (not enforced via FK constraint) |
| `sender_tag` | CHAR(64) | 64-char hex tag. Server-generated ACKs use 64 zeros. |
| `recipient_tag` | CHAR(64) | 64-char hex tag of the intended recipient |
| `ciphertext` | MEDIUMTEXT | Base64-encoded ciphertext (or unencrypted base64 JSON for server ACKs) |
| `created_at` | DATETIME | Server insertion time |

The table has indexes on `(room_id, recipient_tag)` and `(created_at)`.

**`presence`**

| Column | Type | Description |
|--------|------|-------------|
| `room_id` | CHAR(36) | Room identifier |
| `sender_tag` | CHAR(64) | Session sender tag (`SHA-256(handle)`) |
| `updated_at` | DATETIME | Timestamp of last sync from this participant |

**`schema_version`**

| Column | Type | Description |
|--------|------|-------------|
| `version` | INT | Migration number (1, 2, 3, …) |
| `applied_at` | DATETIME | When the migration ran |

---

### localStorage

All keys are prefixed `cc_`. Values are read on every page load; there is no in-memory cache for most of them (reads hit `localStorage` directly via helper functions).

| Key | Type | Contents |
|-----|------|----------|
| `cc_handle` | String | User's display name. Auto-generated as `AdjectiveNoun` on first launch if absent. |
| `cc_avatar` | String or null | Base64 data URL of user's avatar image, or absent if no avatar set. |
| `cc_rooms` | JSON array | Array of room objects (see structure below). This is the authoritative client-side room list. |
| `cc_profiles` | JSON object | Map of `sender_tag → {handle, avatar}`. Populated from received `profile_update` messages. |
| `cc_outbox_map` | JSON object | Map of `outbox_item_id → original_message_id`. Persisted across page loads so ACKs received in a future session can update the correct message record. |
| `cc_theme` | String | `"dark"` or `"light"`. Read immediately on page load (before the DOM is fully parsed) to avoid a flash of unstyled content. |
| `cc_debug` | String or absent | Set to `"1"` to enable verbose `[cbx]` console logging. Absent by default. |

**Room object structure (inside `cc_rooms` array):**

```json
{
  "id": "<uuid>",
  "name": "My Room",
  "password": "the room password",
  "deleteToken": "<64-char hex>",
  "retention": 2,
  "joinedAt": "2026-03-15T10:00:00.000Z"
}
```

- `deleteToken` is the plaintext token (32 random bytes as hex). Present only for room owners. Non-owners have `null`. This is how the client determines ownership.
- `name` is the locally stored room display name. For newly joined rooms (non-owner), this is initially `""` and populated when a `room_name` message arrives from the owner.
- The password is stored in plaintext in localStorage because the key derivation is slow (PBKDF2 200k iterations) and must be re-run each session. The alternative — storing the derived key — would require exportable keys, which weakens the security model.

---

### IndexedDB: `cinderbox` database (version 1)

Heavy message data lives in IndexedDB. The database is opened by `openDB()` and accessed through `dbPut`, `dbGet`, `dbDelete`, `dbGetAll`, and `dbGetByIndex` helper functions.

**`messages` store** (keyPath: `id`):

Stores all messages — both sent and received. See `client_database.md` for the full field listing.

Indexes: `room_id`, `sender_tag`, `recipient_tag`.

**`outbox` store** (keyPath: `id`):

Stores encrypted items waiting to be flushed to the server on the next sync. Each item is one encrypted ciphertext for one recipient. A single user-visible message with N recipients creates N outbox entries. See `client_database.md` for the full field listing.

No indexes (all outbox queries use `getAll()` and filter in JavaScript).

---

## Message Flow

### Sending (sender side)

1. **`sendMessage()`** is called with message content and type.
2. A canonical `msgId` (UUIDv4) is generated. The message is written to IndexedDB `messages` with `status: 'sending'`.
3. The current presence list for the room is consulted. One outbox entry is created per recipient in IndexedDB `outbox`. Each entry contains the encrypted payload and the recipient's tag.
4. The payload embedded in each outbox entry's ciphertext includes `original_id: msgId` — this is how the recipient knows which canonical ID to store the message under.
5. The `outboxMsgMap` (`cc_outbox_map`) is updated: `outbox_item_id → msgId`.
6. On the next `doSync()` call (within 5 seconds, or immediately if triggered), all pending outbox items are included in the sync request and deleted from IndexedDB after a successful response.

### Server processing

7. The server inserts the outbox item as a row in `messages`.
8. Immediately after insertion, the server generates an `ack_delivered` message (unencrypted base64 JSON) addressed to the sender, with `sender_tag` = 64 zeros.

### Recipient receiving

9. On the recipient's next sync, their inbox fetch returns the message row.
10. The server deletes the row from `messages` and generates an `ack_received` back to the original sender.
11. The recipient's client decrypts the ciphertext, extracts `original_id`, and stores the message in IndexedDB under that canonical ID.

### Sender receiving ACKs

12. The sender's next sync returns the `ack_delivered` (from step 8) and/or `ack_received` (from step 10) in their inbox.
13. The client uses `outboxMsgMap` to resolve the outbox item ID in the ACK payload to the original `msgId`, then updates the message record in IndexedDB with the ACK entry and new status.

### Rendering

14. After each sync cycle where changes occurred, `renderMessages()` is called for the current room, re-rendering the message thread with updated tick states.

---

## Presence Model

The server maintains a `presence` table. On each sync, the server upserts a row for the syncing user (keyed by `room_id` + `sender_tag`). When the client sends `leave: true` for a room, the server deletes that row instead.

### Sticky presenceMap

The client maintains an in-memory `presenceMap` object: `roomId → [sender_tags]`. This map is sticky — tags are only added, never removed, except when a `leave_room` encrypted message is received from a participant. This prevents participants from disappearing due to a missed sync.

Two additional in-memory structures support the presence model:

- `knownPresenceTags` (`roomId → Set`) — tracks every tag ever seen for a room to detect new arrivals and trigger `profile_update` sends.
- `firstJoinRooms` (Set of roomIds) — marks rooms where the client should broadcast a `joined_room` message on the first sync after joining.

### Presence in single-view rooms

Presence is disabled for single-view rooms (retention = 4). The server does not upsert presence for these rooms, and the client does not include them in the outgoing presence.

---

## outboxMsgMap: The Two-ID Problem

A single user-visible message with N recipients requires N distinct server-side row IDs (one per outbox item, since the server row `id` must be unique and the same UUID cannot be sent to two different recipients without creating a duplicate-key error). However, the sender needs a single canonical ID to display the message and accumulate ACKs from all recipients.

The solution:

1. **`msgId`** — a single UUID generated at compose time. This is the canonical ID stored in IndexedDB `messages` and included in the payload as `original_id`.
2. **`outboxId`** — a distinct UUID per recipient, used as the row ID in the server's `messages` table. This is the ID that appears in server-generated ACK payloads.

`outboxMsgMap` bridges these two: it maps every `outboxId` to the corresponding `msgId`. It is persisted in `cc_outbox_map` in localStorage so that ACKs received in a future browser session (after a page reload) can still be matched to the correct message in IndexedDB.

When an `ack_delivered` or `ack_received` arrives, the client resolves `ack.message_id` (which is an `outboxId`) to the canonical `msgId` via `outboxMsgMap[ack.message_id] || ack.message_id`. The fallback handles the case where the ACK ID is already the canonical ID (e.g., for self-addressed messages or silent types with no outbox map entry).

---

## ACK System (5-State Delivery)

| State | Display | Condition |
|-------|---------|-----------|
| Pending | 🕐 gray | No `ack_delivered` yet; message is still in outbox or server has not yet returned the ACK |
| Server synced | ✓ gray | `ack_delivered` received from server (sender_tag = 64 zeros) |
| Downloaded | ✓✓ gray | At least one `ack_received` received (recipient fetched from server) |
| Partially viewed | ✓ blue + ✓ gray | At least one `ack_viewed` but not all recipients have viewed |
| All viewed | ✓✓ blue | `ack_viewed` received from every recipient in `recipient_tags` |

ACK entries are stored as an array on the message object in IndexedDB:

```json
{
  "acks": [
    { "type": "ack_delivered", "sender_tag": "0000...0000", "received_at": "..." },
    { "type": "ack_received", "recipient_tag": "<hex64>", "received_at": "..." },
    { "type": "ack_viewed", "sender_tag": "<hex64>", "received_at": "..." }
  ]
}
```

`ack_delivered` and `ack_received` are server-generated and travel as unencrypted base64 JSON (they contain no sensitive information — only message IDs and recipient tags). `ack_viewed` and `ack_single_view_deleted` are client-generated and travel as normal encrypted messages.

---

## Room Lifecycle

**Create:** Client generates a UUIDv4 room ID, a 32-byte random delete token (stored as hex), derives an encryption key from the password, encrypts the room ID as the `encryption_test`, and POSTs to `?action=create`. On success, the room is added to `cc_rooms` with the plaintext delete token and password.

**Join:** Client POSTs to `?action=check` with the room ID. Server returns `exists` and the `encryption_test`. Client derives the key from the entered password and attempts to decrypt the `encryption_test`. If the decrypted value matches the room ID, the password is correct. The room is added to `cc_rooms` (with `deleteToken: null`) and marked in `firstJoinRooms` for a `joined_room` broadcast.

**Sync:** After joining or creating, `startSync()` begins the 5-second polling loop.

**Leave (non-owner):** Sends encrypted `leave_room` messages to all visible participants, sets `leave: true` in the sync payload to remove the server-side presence row, then removes the room from `cc_rooms`.

**Delete (owner only):** POSTs to `?action=delete` with the plaintext delete token. Server verifies `SHA-256(token) == stored_hash` using `hash_equals`, then deletes all messages, presence rows, and the room row. Owners cannot leave; they can only delete.

**Abandonment purge:** Any room with `last_used_at` more than 7 days ago is purged automatically by `global_expiry()`, which runs on every sync request. This removes the room row, all its messages, and all its presence rows.

---

## Service Worker and PWA

`sw.js` registers a cache named `cinderbox-v1` containing only the HTML shell (`./`). On a navigation request, it attempts a network fetch first and falls back to the cached shell only if the network is unavailable. All non-navigation requests (API calls) bypass the service worker entirely.

On activation, the service worker deletes any caches with names other than `cinderbox-v1`, ensuring stale caches from previous versions are purged.

The PWA manifest (`manifest.json`) enables installation as a standalone app with a dark background (`#0f1923`) and portrait-primary orientation.

The Service Worker requires HTTPS to function. On HTTP origins, the app works but is not installable and has no offline shell fallback.
