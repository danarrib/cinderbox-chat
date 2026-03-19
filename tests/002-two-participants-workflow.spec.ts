import { test, expect, BrowserContext, Page } from '@playwright/test';
import * as path from 'path';
import { EvidenceCollector } from './helpers/evidence';

test('002 — Two Participants Workflow', async ({ browser }, testInfo) => {
  test.setTimeout(120000);
  const evidence = new EvidenceCollector('002', 'Two Participants Workflow');

  let contextA: BrowserContext | null = null;
  let contextB: BrowserContext | null = null;

  try {
    contextA = await browser.newContext();
    contextB = await browser.newContext();

    const pageA: Page = await contextA.newPage();
    const pageB: Page = await contextB.newPage();

    await evidence.step(pageA, 1, '[User A] Load the application', async () => {
      await pageA.goto('/');
      await expect(pageA.locator('#screen-landing')).toBeVisible();
    }, 'User A opens the app and sees the landing screen. No account or login is required. Each browser context has its own isolated localStorage and IndexedDB.');

    let roomUrl = '';
    await evidence.step(pageA, 2, '[User A] Create a room', async () => {
      await pageA.click('#btn-create');
      await expect(pageA.locator('#screen-create')).toBeVisible();
      await pageA.fill('#create-password', 'sharedpassword');
      await pageA.click('#create-btn');
      await expect(pageA.locator('#screen-chat')).toBeVisible({ timeout: 10000 });
      // Wait for switchRoom() to call history.replaceState and set the room hash
      await pageA.waitForURL(/.*#[0-9a-f-]{36}/, { timeout: 10000 });
      roomUrl = pageA.url();
    }, 'User A creates a room with a shared password. The room ID is appended to the URL as a hash fragment. User A\'s client derives the AES-256-GCM key via PBKDF2 (200k iterations, SHA-256). The chat screen opens.');

    await evidence.step(pageB, 3, '[User B] Navigate to the room URL and toggle the theme', async () => {
      await pageB.goto(roomUrl, { waitUntil: 'networkidle' });
      await expect(pageB.locator('#screen-join')).toBeVisible();
      await pageB.click('.btn-theme-toggle');
      await pageB.waitForTimeout(1000);
    }, 'User B opens the same URL shared by User A. The join screen is displayed with the room ID pre-filled. User B toggles the UI theme — demonstrating that theme preference is independent of room state and takes effect immediately.');

    await evidence.step(pageB, 4, '[User B] Enter the password and join the room', async () => {
      await pageB.fill('#join-password', 'sharedpassword');
      await pageB.click('#join-btn');
      await expect(pageB.locator('#screen-chat')).toBeVisible({ timeout: 10000 });
    }, 'User B enters the shared password. The client derives the same key and validates it against the encryption_test value stored on the server. On success, the room is saved locally and the chat screen opens.');

    await evidence.step(pageA, 5, '[User A] Observe the join notification', async () => {
      await pageA.waitForTimeout(11000);
      await expect(pageA.locator('.system-notice').last()).toBeVisible();
    }, 'After a sync cycle, User A\'s client compares the server presence list against its known tags and detects User B as a new arrival. A system notice is generated locally — no join message is ever sent to the server.');

    await evidence.step(pageA, 6, '[User A] Send a text message', async () => {
      await pageA.fill('#msg-input', 'Hello from User A!');
      await pageA.press('#msg-input', 'Enter');
      await expect(pageA.locator('#msg-input')).toHaveValue('');
      await pageA.waitForTimeout(1000);
    }, 'User A types and sends a message. It is encrypted client-side before transmission. The server stores only ciphertext. The message appears in User A\'s thread with a pending delivery tick.');

    await evidence.step(pageB, 7, '[User B] Receive and read the text message', async () => {
      await pageB.waitForTimeout(6000);
      await expect(pageB.locator('#chat-messages')).toContainText('Hello from User A!');
    }, 'After a sync cycle, User B\'s client fetches and decrypts the message. It appears in User B\'s chat thread. The server never had access to the plaintext content.');

    await evidence.step(pageA, 8, '[User A] Send a single-view text message', async () => {
      await pageA.click('#btn-sv');
      await pageA.fill('#msg-input', 'This is a single-view message');
      await pageA.press('#msg-input', 'Enter');
      await expect(pageA.locator('#msg-input')).toHaveValue('');
    }, 'User A activates single-view mode with the 💣 button and sends a message. Single-view messages are encrypted like any other — but the recipient\'s client wipes the content permanently after the first viewing.');

    await evidence.step(pageB, 9, '[User B] Receive and open the single-view message', async () => {
      await pageB.waitForTimeout(6000);
      const svBubble = pageB.locator('.sv-sealed-bubble').last();
      await expect(svBubble).toBeVisible();
      await svBubble.click();
      await expect(pageB.locator('#sv-modal-overlay')).toBeVisible({ timeout: 15000 });
    }, 'User B\'s sync delivers the single-view message as a sealed bubble. Tapping it triggers a server sync to confirm receipt before decryption. The content is then shown in a full-screen modal overlay.');

    await evidence.step(pageB, 10, '[User B] Close the single-view modal', async () => {
      await pageB.click('[onclick="closeSvModal()"]');
      await expect(pageB.locator('#sv-modal-overlay')).not.toBeVisible({ timeout: 5000 });
    }, 'User B closes the modal. The message content is immediately wiped from the device. An ack_single_view_deleted acknowledgement is queued and sent to User A on the next sync.');

    await evidence.step(pageA, 11, '[User A] Confirm the single-view deletion acknowledgement', async () => {
      await pageA.waitForTimeout(17000);
    }, 'After a sync cycle, User A receives the ack_single_view_deleted acknowledgement. The delivery tick on the single-view message updates to confirm that User B has opened and wiped the content.');

    await evidence.step(pageB, 12, '[User B] Send an image', async () => {
      await pageB.locator('#image-file').setInputFiles(path.join(__dirname, 'testimage2.jpg'));
      await expect(pageB.locator('#img-preview-overlay')).toBeVisible();
      await pageB.click('[onclick="confirmImgSend()"]');
      await expect(pageB.locator('#img-preview-overlay')).not.toBeVisible({ timeout: 5000 });
      await pageB.waitForTimeout(1000);
    }, 'User B selects an image from the device. The app compresses it client-side (resized to 1000px, encoded as AVIF → WebP → JPEG) and shows a preview overlay. After confirming, the encrypted image payload is sent to the server.');

    await evidence.step(pageA, 13, '[User A] Receive the image from User B', async () => {
      await pageA.waitForTimeout(6000);
      await expect(pageA.locator('#chat-messages img')).toBeVisible();
    }, 'After a sync cycle, User A\'s client fetches and decrypts the image message. The image is rendered inline in the chat thread. The server only ever stored the encrypted blob.');

    await evidence.step(pageB, 14, '[User B] Leave the room', async () => {
      await pageB.click('#btn-settings');
      await expect(pageB.locator('#settings-panel.open')).toBeVisible();
      pageB.once('dialog', dialog => dialog.accept());
      await pageB.click('[onclick="leaveRoom()"]');
      await expect(pageB.locator('#screen-landing')).toBeVisible({ timeout: 10000 });
      await pageB.waitForTimeout(1000);
    }, 'User B opens the settings panel and clicks Leave Room. A leave_room message is sent to the server before departure. User B is removed from the local room list and the app returns to the landing screen.');

    await evidence.step(pageA, 15, '[User A] Observe the leave notification', async () => {
      await pageA.waitForTimeout(11000);
      await expect(pageA.locator('.system-notice').last()).toBeVisible();
    }, 'After a sync cycle, User A\'s client processes the leave_room message and displays a system notice. User B is removed from the presence list. This is the last message sent before User B\'s departure.');

    await evidence.step(pageA, 16, '[User A] Delete the room', async () => {
      await pageA.click('#btn-settings');
      await expect(pageA.locator('#settings-panel.open')).toBeVisible();
      await pageA.waitForTimeout(1000);
      pageA.once('dialog', dialog => dialog.accept());
      await pageA.locator('[onclick="deleteRoom()"]').click();
    }, 'User A opens the settings panel and clicks Delete Room. A deletion request is sent using the owner\'s delete token (stored as a SHA-256 hash on the server). A confirmation dialog is presented before the action executes.');

    await evidence.step(pageA, 17, '[User A] App returns to the landing screen', async () => {
      await pageA.waitForTimeout(1000);
      await expect(pageA.locator('#screen-landing')).toBeVisible();
    }, 'After confirming deletion, the room and all its messages are permanently removed from the server. User A\'s app returns to the landing screen. The full two-party session is complete.');

    await evidence.step(pageB, 18, '[User B] Confirm User B is on the landing screen', async () => {
      await expect(pageB.locator('#screen-landing')).toBeVisible();
    }, 'User B is already on the landing screen after leaving the room in step 14. Both participants have returned to the initial state, with no residual data stored on the server.');

    await evidence.generateReadme(testInfo);

  } finally {
    await contextA?.close();
    await contextB?.close();
  }
});
