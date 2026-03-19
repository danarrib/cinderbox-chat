import { test, expect } from '@playwright/test';
import * as path from 'path';
import { EvidenceCollector } from './helpers/evidence';

test('001 — Solo Full Workflow', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const evidence = new EvidenceCollector('001', 'Solo Full Workflow');

  await evidence.step(page, 1, 'Load the application', async () => {
    await page.goto('/');
    await expect(page.locator('#screen-landing')).toBeVisible();
    await expect(page.locator('#btn-create')).toBeVisible();
  }, 'The landing screen is displayed with "Create Room" and "Join Room" options. No account or login is required.');

  await evidence.step(page, 2, 'Click the "Create Room" button', async () => {
    await page.click('#btn-create');
    await expect(page.locator('#screen-create')).toBeVisible();
    await expect(page.locator('#create-password')).toBeVisible();
  }, 'The room creation form is shown. The user provides a password used to derive the encryption key client-side. The password never leaves the device.');

  await evidence.step(page, 3, 'Enter a room password and create the room', async () => {
    await page.fill('#create-password', 'testpassword123');
    await page.click('#create-btn');
    await expect(page.locator('#screen-chat')).toBeVisible({ timeout: 10000 });
  }, 'After submitting, the room is created on the server. The client derives the AES-256-GCM encryption key via PBKDF2 (200k iterations, SHA-256). The chat interface opens immediately.');

  await evidence.step(page, 4, 'Type a message and send it', async () => {
    await page.fill('#msg-input', 'Hello, this is a test message!');
    await page.press('#msg-input', 'Enter');
    await expect(page.locator('#msg-input')).toHaveValue('');
  }, 'A text message is typed and sent by pressing Enter. The message is encrypted client-side before transmission and appears in the chat thread with a pending delivery tick.');

  await evidence.step(page, 5, 'Attach an image and type a caption', async () => {
    await page.locator('#image-file').setInputFiles(path.join(__dirname, 'testimage1.webp'));
    await expect(page.locator('#img-preview-overlay')).toBeVisible();
    await page.fill('#img-caption-input', 'This is a test image caption');
  }, 'An image is selected via the attachment button. The app compresses it client-side (resized to 1000px, encoded as AVIF → WebP → JPEG) and shows a preview with an optional caption field.');

  await evidence.step(page, 6, 'Send the image', async () => {
    await page.click('[onclick="confirmImgSend()"]');
    await expect(page.locator('#img-preview-overlay')).not.toBeVisible({ timeout: 5000 });
  }, 'The image is sent. The compressed blob is base64-encoded and embedded in the encrypted payload. The preview overlay closes and the image appears in the chat thread.');

  await evidence.step(page, 7, 'Open the Profile screen from the navigation menu', async () => {
    await page.click('#nav-avatar-btn');
    await page.click('[onclick="openProfileFromNav()"]');
    await expect(page.locator('#screen-profile')).toBeVisible();
  }, 'The profile screen is accessible from the avatar button in the top-right corner. All profile data is stored locally — no account is created on the server.');

  await evidence.step(page, 8, 'Generate a random handle with the dice button', async () => {
    await page.click('#btn-random-handle');
    const handle = await page.inputValue('#profile-handle');
    expect(handle.length).toBeGreaterThan(0);
  }, 'The dice button generates a random human-readable handle. Handles are arbitrary — they identify the user within a room but carry no persistent account information.');

  await evidence.step(page, 9, 'Save the profile', async () => {
    await page.click('#btn-save-profile');
    await expect(page.locator('#screen-chat')).toBeVisible();
  }, 'Saving the profile stores the handle and avatar in localStorage and broadcasts a profile_update message to all room participants. The app returns to the chat screen.');

  await evidence.step(page, 10, 'Toggle the UI theme', async () => {
    await page.click('.btn-theme-toggle');
    await page.waitForTimeout(1000);
  }, 'The theme toggles between dark and light mode. The preference is persisted in localStorage and applied immediately without a page reload.');

  await evidence.step(page, 11, 'Change the interface language to Portuguese (pt-BR)', async () => {
    await page.selectOption('#lang-select', 'pt-BR');
    await page.waitForTimeout(5000);
  }, 'The interface switches to Brazilian Portuguese. All strings are translated client-side from an embedded dictionary. The preference is persisted in localStorage.');

  await evidence.step(page, 12, 'Change the interface language back to English', async () => {
    await page.selectOption('#lang-select', 'en');
  }, 'The interface switches back to English. Language selection is independent of other settings and takes effect immediately.');

  await evidence.step(page, 13, 'Open the room settings panel', async () => {
    await page.click('#btn-settings');
    await expect(page.locator('#settings-panel.open')).toBeVisible();
    await page.waitForTimeout(1000);
  }, 'The room settings panel slides in from the right. It shows the room URL, participant list, message retention policy, and danger zone options (Leave Room / Delete Room).');

  await evidence.step(page, 14, 'Set a room name', async () => {
    await page.fill('#settings-room-name', 'Test Room Alpha');
    await page.click('[onclick="broadcastRoomName()"]');
    await expect(page.locator('#chat-room-name')).toContainText('Test Room Alpha');
  }, 'The room name is stored locally and broadcast as an encrypted room_name message to all participants. Room names are never stored on the server.');

  await evidence.step(page, 15, 'Reopen the settings panel to confirm the room name', async () => {
    await page.click('#btn-settings');
    await expect(page.locator('#settings-panel.open')).toBeVisible();
    await page.waitForTimeout(1000);
  }, 'After the room name is set, the topbar shows the custom name. Reopening the settings panel confirms the name is persisted in localStorage.');

  await evidence.step(page, 16, 'Click the "Delete Room" button', async () => {
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[onclick="deleteRoom()"]').click();
  }, 'The Delete Room button sends a deletion request to the server using the owner\'s delete token. A native confirmation dialog is presented before the action is executed.');

  await evidence.step(page, 17, 'Room deleted — app returns to the landing screen', async () => {
    await page.waitForTimeout(1000);
    await expect(page.locator('#screen-landing')).toBeVisible();
  }, 'After confirming deletion, the room and all its messages are permanently removed from the server. Since no other rooms exist, the app returns to the landing screen.');

  await evidence.generateReadme(testInfo);
});
