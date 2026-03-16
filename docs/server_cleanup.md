# Cinderbox Chat — Server-Side Cleanup Audit

This document audits every cleanup routine in `api.php` — what is cleaned, when it runs, how it works, and any known gaps.

---

## 1. Lazy Expiry (`lazy_expiry`)

### What it cleans up

Expired messages and stale presence rows for a specific room, based on that room's configured retention period.

### When it triggers

Called once per room on every `?action=sync` request, after the inbox has been fetched. It runs for every room included in the sync payload.

```php
// In the sync action, once per room in the request:
lazy_expiry($pdo, $room_id, $retention);
```

### How it works

```php
function lazy_expiry(PDO $pdo, string $room_id, int $retention): void {
    if ($retention === 5) return;

    $interval = retention_interval($retention);

    $pdo->prepare(
        "DELETE FROM messages WHERE room_id = ? AND created_at < (NOW() - INTERVAL {$interval})"
    )->execute([$room_id]);

    $pdo->prepare(
        "DELETE FROM presence WHERE room_id = ? AND updated_at < (NOW() - INTERVAL {$interval})"
    )->execute([$room_id]);
}
```

Two DELETE statements run per call:

1. **Messages:** deletes all rows in `messages` for this room where `created_at` is older than the retention interval.
2. **Presence:** deletes all rows in `presence` for this room where `updated_at` is older than the retention interval — effectively removing participants who have not synced within the retention window.

### Retention values handled

| Value | Interval | Behavior |
|-------|----------|----------|
| 0 | 1 HOUR | Messages and presence older than 1 hour are deleted |
| 1 | 6 HOUR | Messages and presence older than 6 hours are deleted |
| 2 | 24 HOUR | Messages and presence older than 24 hours are deleted |
| 3 | 12 HOUR | Messages and presence older than 12 hours are deleted |
| 4 | 24 HOUR | Messages and presence older than 24 hours are deleted (single-view rooms) |
| 5 | — | **Skipped entirely** — permanent rooms are never expired by lazy_expiry |

### Known gaps and edge cases

- **Only triggered by sync activity.** If no client syncs a room, lazy_expiry never runs for it. Expired messages accumulate in `messages` until someone syncs. Global expiry (see below) catches the room at the 7-day abandoned threshold, but messages within active-but-unsynced rooms can linger past their retention period until the next sync.

- **Single-view rooms use 24 HOUR as the cleanup interval** (same as retention = 2). This is the stated 24-hour maximum for single-view message lifetime. In practice, single-view message content is pulled from the server as soon as a recipient syncs (inbox fetch deletes the row immediately), so the 24-hour lazy_expiry is a backstop for unconsumed single-view messages.

- **Presence cleanup uses the same interval as message cleanup.** This is a reasonable heuristic — a participant who hasn't synced in longer than the room's retention period is effectively gone — but it means presence rows can be deleted slightly before the participant would actually be considered gone in a strict sense.

- **Permanent rooms (retention = 5) are never cleaned by lazy_expiry.** They are only affected by the `?action=delete` endpoint and global_expiry (7-day abandonment). There is no mechanism to expire individual messages in permanent rooms.

---

## 2. Global Abandoned Room Expiry (`global_expiry`)

### What it cleans up

Entire rooms (and all associated messages and presence rows) that have had no activity for more than 7 days.

### When it triggers

Called once per `?action=sync` request, after all rooms in the request have been processed.

```php
// At the end of the sync action:
global_expiry($pdo);
```

### How it works

```php
function global_expiry(PDO $pdo): void {
    $old_rooms = $pdo->query(
        "SELECT id FROM rooms WHERE last_used_at < (NOW() - INTERVAL 7 DAY)"
    )->fetchAll();

    foreach ($old_rooms as $r) {
        $rid = $r['id'];
        $pdo->prepare("DELETE FROM messages WHERE room_id = ?")->execute([$rid]);
        $pdo->prepare("DELETE FROM presence WHERE room_id = ?")->execute([$rid]);
        $pdo->prepare("DELETE FROM rooms WHERE id = ?")->execute([$rid]);
    }
}
```

For each abandoned room:

1. All rows in `messages` for that room are deleted.
2. All rows in `presence` for that room are deleted.
3. The room row itself is deleted.

`last_used_at` is updated on every sync that touches a room (`UPDATE rooms SET last_used_at = NOW() WHERE id = ?`), so any room where at least one participant has synced within the last 7 days is preserved regardless of its retention setting.

### Retention values handled

All rooms are eligible. The 7-day threshold is independent of the room's retention setting — a 1-hour retention room that receives a sync every 6 days will not be abandoned-purged, though its messages will have long since expired via lazy_expiry.

### Known gaps and edge cases

- **Runs on ~1% of sync requests.** `global_expiry` skips execution with a `rand(1, 100) !== 1` guard, so it runs approximately once every 100 sync calls. This avoids a full table scan on every request while still running frequently enough to purge abandoned rooms promptly (at 10 active users syncing every 5 seconds, it fires roughly every 50 seconds). The `rooms.last_used_at` column is indexed (`idx_last_used_at`, added in migration_4) so the query is fast when it does run.

- **No cleanup for orphaned messages.** If a room row is deleted by `?action=delete` (owner-initiated), the delete handler explicitly removes messages and presence first:
  ```php
  $pdo->prepare("DELETE FROM messages WHERE room_id = ?")->execute([$room_id]);
  $pdo->prepare("DELETE FROM presence WHERE room_id = ?")->execute([$room_id]);
  $pdo->prepare("DELETE FROM rooms WHERE id = ?")->execute([$room_id]);
  ```
  There are no foreign key constraints enforcing cascades. If a room row were to disappear without the corresponding cleanup (which shouldn't happen via normal API flow), orphaned messages and presence rows would remain in the database indefinitely.

- **No scheduled job.** The application has no cron job. Global expiry only runs when a user syncs. A deployment with zero active users will accumulate abandoned rooms until someone visits. This is acceptable for small deployments but worth noting.

---

## 3. Inbox Delivery Deletes Messages

### What it cleans up

Delivered inbox messages — rows addressed to the syncing user — are immediately deleted after being returned in the sync response.

### When it triggers

On every `?action=sync` request, for every room in the request, after the inbox is fetched.

### How it works

```php
// Fetch inbox
$inbox_stmt = $pdo->prepare(
    "SELECT id, sender_tag, ciphertext FROM messages
     WHERE room_id = ? AND recipient_tag = ?
     ORDER BY created_at ASC"
);
$inbox_stmt->execute([$room_id, $sender_tag]);
$inbox_rows = $inbox_stmt->fetchAll();

if (!empty($inbox_rows)) {
    $del_stmt = $pdo->prepare(
        "DELETE FROM messages WHERE room_id = ? AND recipient_tag = ?"
    );
    $del_stmt->execute([$room_id, $sender_tag]);
    // ... generate ack_received messages for each original sender
}
```

After fetching, all rows with `recipient_tag = $sender_tag` in this room are deleted in a single DELETE. The `ack_received` messages are then inserted for each original sender (skipping server-ACK rows and self-addressed rows).

### Known gaps and edge cases

- **All-or-nothing delivery.** The fetch and delete are not wrapped in a transaction. If the PHP process is killed between the SELECT and the DELETE, the client receives messages that are not yet deleted from the server. On the next sync, the client would fetch the same rows again. The client-side deduplication (`if (existing) continue`) handles this gracefully for regular messages (keyed by canonical ID), but ACK messages processed on the client side could be processed twice. The duplicate-ACK guards on the client (`alreadyAcked` checks) handle this case.

- **Race condition between two clients for the same tag.** If two browser tabs for the same user sync simultaneously (same `recipient_tag`), both might receive overlapping inbox rows before either DELETE runs. The second DELETE would find no rows but succeed silently. Both clients would process the same inbox items and the duplicate guards would prevent double-application.

---

## 4. Presence Cleanup on Leave

### What it cleans up

A single presence row for the leaving participant.

### When it triggers

When a sync request includes `"leave": true` for a room.

### How it works

```php
$is_leaving = !empty($room_req['leave']);
if ($is_leaving) {
    $pdo->prepare("DELETE FROM presence WHERE room_id = ? AND sender_tag = ?")->execute([$room_id, $sender_tag]);
} elseif ($retention !== 4) {
    $pres_stmt = $pdo->prepare(
        "INSERT INTO presence (room_id, sender_tag, updated_at) VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE updated_at = NOW()"
    );
    $pres_stmt->execute([$room_id, $sender_tag]);
}
```

On leave, the row is deleted. Otherwise (and for non-single-view rooms), the row is upserted.

Single-view rooms (retention = 4) never upsert presence — the `elseif` condition explicitly skips them.

### Known gaps and edge cases

- **Leave message may not be delivered if the client crashes.** The leave flag is set by the client (`leavingRooms.has(room.id)`). If the client crashes before sending the leave sync, the presence row is never deleted. The row will eventually expire via lazy_expiry when the presence `updated_at` ages past the retention interval.

- **Presence rows for single-view rooms are created and cleaned up normally.** The 24-hour retention interval applies (`lazy_expiry` uses the same interval as retention = 2). Presence is needed in single-view rooms to route messages to recipients — without it, nobody can discover other participants and message delivery is impossible.

---

## 5. Client-Side Expiry (Not Server-Side)

This is documented here for completeness, as it complements the server-side cleanup.

On app startup, the client runs a local expiry pass:

```javascript
// Client-side expiry cleanup at startup
const retentionMs = [3600000, 21600000, 86400000, 43200000]; // 1h, 6h, 24h, 12h
for (const room of allRooms) {
    if (room.retention === 4 || room.retention === 5) continue;
    const ms = retentionMs[room.retention] ?? 86400000;
    const joined = new Date(room.joinedAt).getTime();
    if (now - joined > ms * 2) {
        // Purge old messages from IndexedDB
        for (const msg of msgs) {
            if (msg.room_id === room.id) {
                const msgTime = new Date(msg.sent_at).getTime();
                if (now - msgTime > ms) await dbDelete('messages', msg.id);
            }
        }
    }
}
```

This runs only if the room has been around for longer than 2× its retention period, reducing unnecessary work on young rooms. It purges messages from IndexedDB (local storage only) that are older than the retention period.

---

## Summary of Cleanup Coverage

| Scenario | Handled By |
|----------|------------|
| Messages expired by retention period | `lazy_expiry` (per-room, on sync) |
| Stale presence rows | `lazy_expiry` (per-room, on sync) |
| Participant leaving cleanly | Presence DELETE on leave sync |
| Participant leaving uncleanly (crash) | `lazy_expiry` (presence row expires by `updated_at`) |
| Entire abandoned room (7-day threshold) | `global_expiry` (on every sync) |
| Owner-deleted room | Explicit DELETEs in `?action=delete` handler |
| Old messages in client IndexedDB | Client-side expiry at startup |
| Permanent rooms (retention = 5) | Only by `?action=delete` or 7-day abandonment |
