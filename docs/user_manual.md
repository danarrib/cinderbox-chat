# Cinderbox Chat — User Manual

## What Is Cinderbox Chat?

Cinderbox Chat is a private, encrypted messaging app you use in your browser. There are no accounts, no phone numbers, no email addresses, and no registration of any kind. You create a room, share the room ID and password with whoever you want to talk to, and messages flow end-to-end encrypted between your devices.

The server cannot read your messages. When a room expires, everything disappears from the server — no backups, no archives, no records.

---

## Getting Started

When you first open Cinderbox Chat, you will see two buttons: **Create Room** and **Join Room**. Before you do either, tap the circular avatar in the top-right corner to open the profile menu.

### Choosing a Handle

Your handle is your display name inside rooms. One is generated for you automatically (e.g., "SilentHawk"). To change it:

1. Tap your avatar in the top-right corner.
2. Select **Profile**.
3. Type a new handle in the Name field.
4. Optionally add a profile picture (tap the avatar area).
5. Tap **Save**.

Your handle is stored on your device only. Other participants learn your handle when you join a room or send a message.

---

## Creating a Room

1. Tap **Create Room**.
2. Fill in the form:
   - **Room ID** — this is generated for you automatically. It's a long UUID (e.g., `3fa85f64-5717-4562-b3fc-2c963f66afa6`). You can copy it to share.
   - **Room Name** — a friendly name visible only on your device. Others will not see this unless you share it — the name is broadcast as an encrypted message when participants join.
   - **Password** — choose something strong and share it privately with participants. This password is used to encrypt all messages.
   - **Message Retention** — how long messages are kept on the server before automatic deletion:

| Option | Duration |
|--------|----------|
| 1 Hour | Messages vanish 1 hour after being sent |
| 6 Hours | Messages vanish 6 hours after being sent |
| 12 Hours | Messages vanish 12 hours after being sent |
| 24 Hours (default) | Messages vanish 24 hours after being sent |
| Permanent | Messages are never automatically expired; room persists until the owner deletes it |

   - **Single-View Only** — when enabled, every message sent in this room is automatically single-view, regardless of the sender's flame toggle. The toggle is hidden for all participants.

3. Tap **Create Room**.

You are now the room's owner. Ownership gives you one extra power: the ability to delete the room entirely, which removes all messages and presence data from the server.

### Sharing a Room

Share the room ID and password with your participants through any channel you trust (Signal, email, in person). There is no shareable invite link — participants enter the ID and password manually on the Join screen.

---

## Joining a Room

1. Tap **Join Room**.
2. Enter the **Room ID** (the UUID given to you by the creator).
3. Enter the **Password**.
4. Tap **Join Room**.

If the password is wrong, you'll see "Incorrect password." The server never receives your password — the verification happens entirely in your browser.

After joining, the app sends a silent join notification to other participants currently in the room, who will see "X joined the room." You'll also automatically exchange profile information with them.

---

## Sending Messages

### Text Messages

Type in the text box at the bottom and press **Enter** or tap the send button. Long messages are supported.

### Images

Tap the camera button (next to the text box). Select a photo from your device.

- Images are automatically resized to a maximum of 1000 pixels on their longest side.
- The app tries to encode as AVIF first (smaller), then WebP, then JPEG — whichever produces the smallest file under the size limit.
- A preview appears before sending. You can add an optional caption.
- Tick the **Single-view** toggle in the preview to send the image as a single-view message.
- Tap **Send** to confirm, or dismiss the preview to cancel.

### Audio Clips

Tap the microphone button to start recording. Tap again (or wait — there's a 2-minute limit) to stop. A preview allows you to listen before sending. Tap **Send** to send or discard to cancel.

### Single-View Messages

Toggle the **Single-view** switch (the flame icon) before sending any message to make it a single-view message. The recipient can open it exactly once — after viewing, the content is permanently deleted from their device.

**How opening works:** When the recipient taps a single-view message, the app must complete a successful sync with the server before displaying the content. This prevents the content from being revealed while offline. If there's no network connection, the message stays sealed.

**After viewing:** The content disappears. The recipient sees a tombstone and you see a "seen and deleted" confirmation.

---

## Message Status Ticks

Every outgoing message shows a small status indicator:

| Indicator | Meaning |
|-----------|---------|
| 🕐 (gray clock) | Queued on your device, waiting to be sent to the server |
| ✓ (gray) | Server received the message |
| ✓✓ (gray) | Recipient(s) downloaded the message from the server |
| ✓✓ (one blue, one gray) | At least one recipient has seen it, but not everyone |
| ✓✓ (both blue) | All recipients have viewed the message |

---

## Replying to Messages

Right-click (desktop) or long-press (mobile) any message to open the context menu, then select **Reply**. A reply bar appears above the text input showing a preview of the message you're replying to. Your reply will display with a quoted snippet of the original message. Tapping the quote scrolls to the original.

To cancel a reply, tap the X on the reply bar.

---

## Message Info

Tap the small info icon that appears on any of your outgoing messages to see per-recipient delivery status, including when the message was delivered to the server, when each recipient downloaded it, and when they viewed it.

For "Delete for everyone" requests, the info panel also shows which recipients have confirmed the deletion.

---

## Deleting Messages

Right-click or long-press a message and select a delete option:

- **Delete for me** — removes the message from your device only. Other participants are unaffected.
- **Delete for everyone** — sends a deletion request to each recipient. Their clients will delete the message content from their devices and send back a confirmation. Your copy shows a tombstone ("Deletion requested") and the info panel tracks who has confirmed.

Recipients are not obligated to honor deletion requests — the deletion is handled by their client software, and a modified client could ignore it. Delete-for-everyone is a best-effort courtesy, not a guarantee.

---

## Room Management

### Custom Room Name

Tap the room title at the top of the chat screen to rename the room. This name is stored on your device only. If you are the room owner, the name is also broadcast to participants as an encrypted message when they join.

### Leaving a Room

Long-press a room in the sidebar, or open the room settings, and select **Leave Room**. Before leaving, the app sends an encrypted leave notification to other participants so they know you've gone. Your local messages and the room entry are deleted from your device.

Note: **Room owners cannot leave** — you can only delete a room you created. If you want to leave a room you own, delete it instead.

### Deleting a Room (Owners Only)

Open room settings and tap **Delete Room**. This sends a delete request to the server (using your owner token), which removes all messages, presence records, and the room entry from the server. Your local copy is also removed.

---

## Profile

Tap your avatar (top-right) and select **Profile** to:

- Change your handle (display name)
- Add or change your profile picture (tap the avatar circle, choose a photo)
- Remove your avatar (if one is set)

Changes take effect immediately and are broadcast to room participants on the next sync.

---

## Notifications

When the app is in the background, Cinderbox Chat can send browser notifications for new messages. The notification shows only the room name — no message content.

To enable notifications: tap your avatar → your browser should prompt for permission the first time. If it didn't, check your browser's notification settings for this site.

A short audio chime also plays when a new message arrives while the app is not in focus. The chime is silent while you are actively using the app.

The browser tab icon shows a small red dot when there are unread messages in any room. The dot clears when you switch to that room.

---

## Theme

Tap the sun/moon icon (☀ / ☾) in the navigation bar to switch between dark and light themes. Your preference is saved and will be applied next time you open the app.

---

## Privacy Notes

- **Your messages are encrypted on your device** before they leave your browser. The server stores only ciphertext it cannot read.
- **No accounts, phone numbers, or email addresses** are ever collected.
- **Your handle exists only on your device** (and in encrypted messages to room participants). It is not stored on the server in any form.
- **The server cannot read your messages, see your handle, or know which rooms you are active in** across sessions.
- **Rooms expire automatically.** When the retention period ends, messages are deleted from the server. The server also purges rooms with no activity after 7 days.
- **localStorage on your device** stores your handle, avatar, room list (including passwords), and messages. Clearing your browser's site data or using the "Clear all data" option in the menu removes everything locally.
- **The encryption password is the key.** Anyone who has the room ID and password can join the room and read all messages. Choose a strong password and share it only with people you trust.
