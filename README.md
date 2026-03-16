# Cinderbox Chat

A privacy-focused ephemeral messaging platform built for self-hosting. No accounts, no phone numbers, no logs — just encrypted rooms that disappear.

Cinderbox Chat was designed from the ground up to run on infrastructure you control. It deploys on any standard PHP/MySQL shared host with no build step, no Node.js, no Docker, and no CDN.

| Desktop | Mobile |
|----------|---------------|
| <img height="400" alt="image" src="https://github.com/user-attachments/assets/c18afcca-2c83-4300-a6f5-8697b3a1be73" /> | <img height="400" alt="image" src="https://github.com/user-attachments/assets/207e9f06-e054-400b-a551-b6ac0e59d3af" />

## Live Demo

A public instance is available at **[cc.outros.net](https://cc.outros.net)** — free to use for testing and real conversations. No registration required.

---

## Features

### Messaging
- **Text, image, and audio messages** — send text, photos, and voice clips up to 2 minutes
- **Message replies** — reply to any specific message; a quoted snippet appears inline and clicking it scrolls to the original
- **Single-view messages** — content that can only be opened once; the recipient must be online to open it, and it is permanently wiped from their device after viewing
- **Message deletion** — delete a message for yourself only, or request deletion from all recipients' devices and track confirmation per recipient

### Rooms
- **No accounts** — identify yourself with a handle and a password, nothing more
- **Ephemeral rooms** — choose a retention period (1h, 6h, 12h, 24h) or create a permanent room; ephemeral rooms and all their messages are automatically purged
- **Custom room names and avatars** — names stay on your device only, never stored on the server
- **Multiple rooms** — manage several conversations simultaneously from a single interface

### Privacy & Security
- **End-to-end encryption** — all message content is encrypted in the browser before it leaves your device, using AES-256-GCM with keys derived via PBKDF2 (200,000 iterations, SHA-256)
- **Zero plaintext on the server** — the server stores only ciphertext blobs it cannot read
- **No identity correlation** — your identity tag is `SHA-256(handle + room_id)`, making it impossible to correlate your presence across different rooms
- **Password never leaves the browser** — the room password is used locally to derive the encryption key and is never transmitted
- **Single-view offline protection** — opening a single-view message requires a confirmed server sync first; disabling your network connection before tapping will result in a failure, not content exposure
- **Crash-recovery for single-view** — if the app is force-killed mid-open, a sentinel flag ensures the deletion acknowledgement is sent on the next launch
- **Message deletion tracking** — "Delete for everyone" sends a signed deletion request to each recipient and tracks confirmation; the sender retains a tombstone to audit who confirmed

### UI
- **Dark and light themes** — persisted per device
- **Internationalisation** — English and Brazilian Portuguese (pt-BR); language selector in the nav bar
- **5-state delivery ticks** — 🕐 queued → ✓ server received → ✓✓ downloaded → ✓✓ (partial) viewed → ✓✓ all viewed
- **Message Info modal** — tap any outgoing message to see per-recipient delivery, view, and deletion status
- **Context menu** — right-click or long-press any message to reply, delete, or view message data
- **Image compression** — photos are automatically resized to 1000px and re-encoded as AVIF (with WebP/JPEG fallback) before sending
- **No CDN, no external requests** — the entire frontend is a single self-contained HTML file

---

## Self-Hosting

Cinderbox Chat deploys as a small set of static files alongside a single PHP script. There is no build step, no package manager, and no environment variables.

| File | Role |
|------|------|
| `index.html` | Full SPA frontend — all UI and client-side logic |
| `api.php` | Backend API — all database interactions |
| `sw.js` | Service Worker — offline shell and PWA update cycle |
| `manifest.json` | PWA manifest — enables "Add to Home Screen" |
| `icon.svg` | Application icon |

`index.html` and `api.php` are the only files strictly required for the app to function. The remaining three enable PWA installation and the offline fallback shell.

### Requirements
- PHP 8.0+ with PDO and PDO_MySQL
- MySQL 8.0+ (or MariaDB equivalent)
- Any standard web host (shared hosting works fine)

### Setup

1. Copy the files to your web root:
   ```bash
   scp api.php index.html sw.js manifest.json icon.svg user@yourhost.com:~/public_html/
   ```

2. Visit your site in a browser. A setup screen will appear asking for your MySQL credentials.

3. Submit the form. `config.php` is written automatically and the database schema is created. The setup endpoint is permanently disabled after first run.

That's all. No build step, no package manager, no environment variables.

### Deploying Updates

```bash
scp api.php index.html sw.js manifest.json icon.svg user@yourhost.com:~/public_html/
```

Any new database migrations run automatically on the first request after deployment.

**Important — bump the Service Worker version on every deploy** that changes `index.html`. Open `sw.js` and increment the cache name (e.g. `cinderbox-v4` → `cinderbox-v5`) before uploading. This triggers an automatic update cycle: the new SW activates immediately and all open tabs reload with the fresh version. Without this step, users on Android/iOS PWA may continue running the old version indefinitely.

---

## Security Design

| Property | Implementation |
|----------|---------------|
| Encryption algorithm | AES-256-GCM |
| Key derivation | PBKDF2, SHA-256, 200,000 iterations |
| Key material | Room password (never transmitted) |
| Identity tag | SHA-256(handle + room\_id) — per-room, non-correlatable |
| Server knowledge | Ciphertext only — no plaintext, no metadata, no IP logs |
| SQL injection | PDO prepared statements throughout, no exceptions |
| Delete tokens | Stored as SHA-256 hash, verified with `hash_equals` |
| Error disclosure | `error_reporting(0)` — no stack traces or error output |
| Rate limiting | 60 messages per sender tag per minute |
| Message size | 2 MB hard limit enforced server-side |
| Setup endpoint | Disabled permanently after first run (returns 403) |
| Config file | Excluded from git via `.gitignore` |

---

## Documentation

| Document | Description |
|----------|-------------|
| [User Manual](docs/user_manual.md) | End-user guide: rooms, messaging, single-view, profiles, notifications |
| [Self-Hosting Guide](docs/setup.md) | Deployment, database setup, Service Worker versioning, reverse proxy config |
| [Architecture](docs/architecture.md) | Sync model, storage layers, message flow, presence model, ACK system |
| [Encryption](docs/encryption.md) | Cryptographic primitives, key derivation, threat model |
| [Client Database](docs/client_database.md) | IndexedDB schema, localStorage keys, outbox structure |
| [Server Cleanup](docs/server_cleanup.md) | Server-side expiry routines: lazy expiry, global expiry, inbox delivery |

---

## License

See [LICENSE](LICENSE).
