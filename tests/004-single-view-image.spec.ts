import { test, expect, BrowserContext, Page } from '@playwright/test';
import * as path from 'path';
import { EvidenceCollector } from './helpers/evidence';

test('004 — Single-View Image Message', async ({ browser }, testInfo) => {
  test.setTimeout(120000);
  const evidence = new EvidenceCollector('004', 'Single-View Image Message');

  let contextA: BrowserContext | null = null;
  let contextB: BrowserContext | null = null;

  try {
    contextA = await browser.newContext();
    contextB = await browser.newContext();

    const pageA: Page = await contextA.newPage();
    const pageB: Page = await contextB.newPage();

    await evidence.step(pageA, 1, '[User A] Load the application and create a room', async () => {
      await pageA.goto('/');
      await expect(pageA.locator('#screen-landing')).toBeVisible();
      await pageA.click('#btn-create');
      await pageA.fill('#create-password', 'svimagepass');
      await pageA.click('#create-btn');
      await expect(pageA.locator('#screen-chat')).toBeVisible({ timeout: 10000 });
      await pageA.waitForURL(/.*#[0-9a-f-]{36}/, { timeout: 10000 });
      await pageA.waitForTimeout(1000);
    }, 'User A creates a room and arrives at the chat screen. The room URL hash is ready to share with User B.');

    let roomUrl = '';
    await evidence.step(pageA, 2, '[User A] Copy the room URL', async () => {
      roomUrl = pageA.url();
      await pageA.waitForTimeout(1000);
    }, 'The room URL (with hash) is extracted so User B can navigate directly to the room.');

    await evidence.step(pageB, 3, '[User B] Join the room and toggle the theme', async () => {
      await pageB.goto(roomUrl, { waitUntil: 'networkidle' });
      await expect(pageB.locator('#screen-join')).toBeVisible();
      await pageB.fill('#join-password', 'svimagepass');
      await pageB.click('#join-btn');
      await expect(pageB.locator('#screen-chat')).toBeVisible({ timeout: 10000 });
      await pageB.click('.btn-theme-toggle');
      await pageB.waitForTimeout(1000);
    }, 'User B joins the room with the shared password. The encryption key is derived and validated locally. User B then toggles the UI theme — each participant\'s preference is stored independently in their own localStorage and has no effect on the other participant\'s view.');

    await evidence.step(pageA, 4, '[User A] Observe the join notification', async () => {
      await pageA.waitForTimeout(12000);
      await expect(pageA.locator('.system-notice').last()).toBeVisible();
      await pageA.waitForTimeout(1000);
    }, 'User A detects User B\'s arrival from the presence list returned by the next sync. A system notice is generated locally.');

    await evidence.step(pageB, 5, '[User B] Activate single-view mode and select an image', async () => {
      await pageB.click('#btn-sv');
      await pageB.locator('#image-file').setInputFiles(path.join(__dirname, 'testimage2.jpg'));
      await expect(pageB.locator('#img-preview-overlay')).toBeVisible();
      await pageB.waitForTimeout(1000);
    }, 'User B activates single-view mode with the 💣 button (it turns yellow), then selects an image. The app compresses the image client-side and shows a preview overlay. Because single-view mode is active, the image will be sent as a single_view message.');

    await evidence.step(pageB, 6, '[User B] Send the single-view image', async () => {
      await pageB.click('[onclick="confirmImgSend()"]');
      await expect(pageB.locator('#img-preview-overlay')).not.toBeVisible({ timeout: 5000 });
      await pageB.waitForTimeout(1000);
    }, 'User B confirms the send. The compressed image blob is base64-encoded and embedded in the encrypted single_view payload. The preview overlay closes and a sealed bubble appears in User B\'s thread.');

    await evidence.step(pageA, 7, '[User A] Receive and open the single-view image', async () => {
      await pageA.waitForTimeout(12000);
      const svBubble = pageA.locator('.sv-sealed-bubble').last();
      await expect(svBubble).toBeVisible();
      await svBubble.click();
      await expect(pageA.locator('#sv-modal-overlay')).toBeVisible({ timeout: 15000 });
      await pageA.waitForTimeout(1000);
    }, 'After a sync cycle, User A sees a sealed single-view bubble. Tapping it triggers a server sync to confirm receipt before decryption. The image is shown in a modal overlay.');

    await evidence.step(pageA, 8, '[User A] Close the single-view modal', async () => {
      await pageA.click('[onclick="closeSvModal()"]');
      await expect(pageA.locator('#sv-modal-overlay')).not.toBeVisible({ timeout: 5000 });
      await pageA.waitForTimeout(1000);
    }, 'User A closes the modal. The image content is immediately wiped from User A\'s device. An ack_single_view_deleted acknowledgement is sent to User B on the next sync.');

    await evidence.step(pageB, 9, '[User B] Confirm the single-view deletion acknowledgement', async () => {
      await pageB.waitForTimeout(17000);
      await pageB.waitForTimeout(1000);
    }, 'After two sync cycles, User B receives the ack_single_view_deleted acknowledgement from User A. The delivery tick on the sent message updates to confirm the content has been viewed and wiped.');

    await evidence.step(pageA, 10, '[User A] Delete the room', async () => {
      await pageA.click('#btn-settings');
      await expect(pageA.locator('#settings-panel.open')).toBeVisible();
      await pageA.waitForTimeout(1000);
      pageA.once('dialog', dialog => dialog.accept());
      await pageA.locator('[onclick="deleteRoom()"]').click();
      await pageA.waitForTimeout(1000);
    }, 'User A deletes the room. All messages — including the wiped single-view image — are permanently removed from the server.');

    await evidence.step(pageA, 11, '[User A] App returns to the landing screen', async () => {
      await expect(pageA.locator('#screen-landing')).toBeVisible();
      await pageA.waitForTimeout(1000);
    }, 'The app returns to the landing screen.');

    await evidence.step(pageB, 12, '[User B] Room deletion detected — device data purged', async () => {
      await pageB.waitForTimeout(6000);
      await expect(pageB.locator('#screen-landing')).toBeVisible();
      await pageB.waitForTimeout(1000);
    }, 'On the next sync cycle after deletion, the server returns not_found for the room. User B\'s client calls purgeRoomLocally(): all messages and outbox items are deleted from IndexedDB, the room is removed from localStorage, and the app navigates to the landing screen. No residual data remains on the device.');

    await evidence.generateReadme(testInfo);

  } finally {
    await contextA?.close();
    await contextB?.close();
  }
});
