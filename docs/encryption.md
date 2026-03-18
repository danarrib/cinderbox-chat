# Cinderbox Chat — Encryption

## Overview

All message content is encrypted in the browser before it leaves the device. The server stores only opaque ciphertext blobs. The encryption password is never transmitted to the server under any circumstances.

The Web Crypto API (`crypto.subtle`) is used for all cryptographic operations. There is no third-party crypto library.

---

## Key Derivation

**Function:** `deriveKey(password, roomId)`

**Algorithm:** PBKDF2

| Parameter | Value |
|-----------|-------|
| Password | The user-supplied room password |
| Salt | The room ID (UUIDv4, encoded as UTF-8) |
| Iterations | 200,000 |
| Hash | SHA-256 |
| Output key algorithm | AES-GCM |
| Output key length | 256 bits |

The derived key is marked non-extractable (`extractable: false`) and usages are restricted to `['encrypt', 'decrypt']`. Once derived, the key is cached in the module-level `keyCache` object (`password + '::' + roomId → CryptoKey`) so that repeated derives within a session avoid the 200k-iteration cost.

The room password is never stored in a form that would allow its retrieval — the cached `CryptoKey` cannot be exported from the browser's crypto implementation. The plaintext password is stored in `localStorage` (in the room list entry) only because the key must be re-derived on each page load; see the architecture notes on why storing the derived key instead is not practical.

---

## Encryption

**Function:** `encrypt(key, plaintext)`

1. Generate a random 12-byte IV: `crypto.getRandomValues(new Uint8Array(12))`
2. Encode the plaintext string to UTF-8 bytes: `new TextEncoder().encode(plaintext)`
3. Encrypt using AES-256-GCM: `crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext_bytes)`
4. Concatenate IV + ciphertext into a single `Uint8Array`: `[iv (12 bytes)][ciphertext (N + 16 bytes GCM tag)]`
5. Base64-encode the result: `btoa(binary_string)`

The output is a single base64 string. The IV is embedded in the first 12 bytes of the decoded value and is always unique per message (generated fresh per call to `encrypt()`).

---

## Decryption

**Function:** `decrypt(key, b64)`

1. Base64-decode: `Uint8Array.from(atob(b64), c => c.charCodeAt(0))`
2. Split: first 12 bytes are the IV; the remainder is the ciphertext + GCM tag.
3. Decrypt using AES-256-GCM: `crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)`
4. Decode the resulting bytes to a UTF-8 string: `new TextDecoder().decode(plain)`

If decryption fails (wrong key, corrupted data, or truncated ciphertext), the Web Crypto API throws a `DOMException`. The caller handles the exception — failed decryption of a join-time `encryption_test` produces an "Incorrect password" error; failed decryption of an inbox item causes that item to be silently skipped.

---

## Why the Password Never Leaves the Browser

The `deriveKey()` function operates entirely within `crypto.subtle`. The derived `CryptoKey` object exists only in the browser's secure key storage — it is never serialized to JSON or transmitted. The sync API receives only the encrypted output of `encrypt(key, payload)`, not the key or the password.

The server has no endpoint that accepts a password or key material. The `create` action receives `encryption_test` (a ciphertext); the `check` action returns it. No action accepts plaintext.

---

## Encryption Test

When a room is created:

1. The client derives the encryption key from the password.
2. It calls `encrypt(key, roomId)` — encrypting the room's own UUID as plaintext.
3. The resulting ciphertext is sent to the server as `encryption_test` and stored in `rooms.encryption_test`.

When a user joins the room:

1. The client fetches `encryption_test` from the server via `?action=check`.
2. It derives a key from the entered password.
3. It calls `decrypt(key, encryption_test)`.
4. If the decrypted value equals the room ID exactly, the password is correct and the room is saved locally.
5. If decryption throws or the result doesn't match, "Incorrect password" is shown and the room is not saved.

This mechanism validates the password entirely on the client side without the server ever learning the password.

---

## Sender Tag Derivation

**Formula:** `SHA-256(handle + room_id)`

**Function:** `sha256(handle + roomId)` — uses `crypto.subtle.digest('SHA-256', ...)`, output formatted as lowercase hex.

This tag identifies a sender within a specific room. Using the room ID as a component of the input means the same user has a different tag in every room they join. An operator who can observe traffic in two different rooms cannot determine whether the same person participates in both.

The sender tag is embedded in the encrypted payload of every message and is also used by the server as the `sender_tag` column for the outbox-to-inbox routing of non-ACK messages. (For the top-level sync request, a session tag is used instead — see below.)

---

## Session Tag

**Formula:** `SHA-256(handle)`

**Function:** `sha256(handle)`

The session tag is computed from the handle alone, without the room ID. It is used as the top-level `sender_tag` in sync requests (for rate limiting and presence upserts on the server). This means presence rows store the session tag, not the per-room tag. Recipients see the session tag in the `presence` array returned by sync; per-room identity is established through the encrypted `profile_update` messages exchanged via the inbox.

---

## Server ACK Tag

**Value:** `0000000000000000000000000000000000000000000000000000000000000000` (64 zeros)

Server-generated ACK messages (`ack_delivered`, `ack_received`) use this fixed value as their `sender_tag`. No real participant can have this tag because SHA-256 output is never all zeros for any non-empty input.

The client checks `inboxItem.sender_tag === SERVER_ACK_TAG` to identify server-generated messages. These messages carry unencrypted base64 JSON payloads — they are not encrypted, because the server cannot use the room key and because the payloads contain only non-sensitive identifiers (message UUIDs and recipient tags).

Both `api.php` and `index.html` define this constant:
- PHP: `$server_ack_tag = '0000...0000'`
- JS: `const SERVER_ACK_TAG = '0000...0000'`

---

## Single-View Security Model

Single-view messages are designed so that their content cannot be extracted by an attacker who captures the device before the message is opened.

The security relies on a **sync-before-display** requirement:

1. When the recipient taps a single-view message, the client first sets `msg.status = 'opening'` (a crash-recovery sentinel).
2. It immediately calls `doSync()` and waits for it to complete. This ensures an `ack_viewed` reaches the server before the content is shown.
3. Only if the sync succeeds does the client display the content in a modal.
4. After the user closes the modal, the client sends `ack_single_view_deleted`, wipes the `content` field from the IndexedDB record, and sets `status = 'seen_and_deleted'`.

**Offline attack prevention:** If the user disables their network connection before tapping, the sync will fail and the content will not be shown. The sentinel is reset to `undefined` on failure, returning the message to its openable state.

**Crash-recovery sentinel:** If the app is force-killed after step 1 but before step 4 (e.g., the process is killed mid-open), the `opening` status persists in IndexedDB. On next launch, the startup code scans for messages with `status === 'opening'` and resets them to `undefined`. This prevents a partially-opened message from being permanently stuck. The trade-off is that a killed session loses the content (it was being shown in the modal when the kill occurred) but the message is correctly left in an openable state.

---

## What the Server Can and Cannot See

**The server can see:**
- Room IDs (UUIDs)
- Session sender tags (`SHA-256(handle)`) — not linked to any identity
- Per-room sender tags in message rows (`SHA-256(handle + room_id)`) — not linked to handles or cross-room identities
- Recipient tags
- Ciphertext blobs (base64-encoded, not decryptable without the room password)
- Message sizes (length of ciphertext correlates roughly with plaintext length)
- Timestamps (server-generated `created_at`)
- Retention policy values
- Whether a participant is present in a room (via the presence table)

**The server cannot see:**
- Message content (text, images, audio — all encrypted)
- Message types (the type field is inside the encrypted payload)
- User handles or display names
- Room names
- Whether two tags across different rooms belong to the same person
- The room password or encryption key
- Delete tokens (stored only as SHA-256 hashes)

---

## Threat Model

### Trusted Server Assumption

The current model assumes the server is not actively malicious. A malicious server that controls the API responses could theoretically perform a man-in-the-middle attack by substituting a fake `encryption_test` during a join — causing the client to accept a password that the server also knows. Defense against this requires a public-key infrastructure or key verification out of band, which is not currently implemented.

For the intended use case (self-hosted by the room creator), the server is trusted.

### Forward Secrecy Limitations

The system uses a **static symmetric key** derived from the room password. There is no perfect forward secrecy. If an attacker:

1. Records encrypted messages from the server's database, and
2. Later obtains the room password (e.g., a participant reveals it),

they can decrypt all recorded messages using the same PBKDF2 derivation.

The 200,000 PBKDF2 iterations make offline brute-force attacks against weak passwords significantly slower, but a strong password is the primary defense.

### Shared Key Model

All participants in a room share the same encryption key (derived from the same password). Any participant can decrypt any message sent in the room — there is no per-user key pair. This is a deliberate design decision that keeps the join flow simple (one password, no key exchange), at the cost of not providing forward secrecy against other room participants.

Practical implication: if a participant's device is compromised, all historical messages they have stored locally can be read. The server's copy is protected (as ciphertext) until the attacker also learns the password.

### No IP Logging

The server sets `error_reporting(0)` and has no logging code. No IP addresses or user agents are written to disk. However, the web server's access log (managed by the hosting provider, outside the application) may record IP addresses independently.

### Client-Side XSS Mitigations

Decrypted message content is inserted into the DOM using template literals with `innerHTML`. All user-controlled values are sanitised at the point of insertion:

- **Avatars (received):** validated to start with `data:image/` before being stored in `cc_profiles`. If validation fails the avatar is discarded and a generated initial-letter avatar is shown instead. At render time the value is also passed through `escHtml()` in the `src` attribute.
- **Text content:** always passed through `escHtml()` before DOM insertion.
- **Image `src` and audio `src` in message bubbles:** passed through `escHtml()` to prevent attribute injection.
- **Single-view modal:** image and audio `src` values are passed through `escHtml()` before being set on the element.

The practical attack surface is limited to room participants who already know the room password (since all content is E2E-encrypted). These mitigations prevent a malicious participant from injecting JavaScript that could exfiltrate `localStorage` or `IndexedDB` data belonging to other rooms on the same origin.
