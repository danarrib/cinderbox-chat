import { test, expect, BrowserContext, Page } from '@playwright/test';
import { EvidenceCollector } from './helpers/evidence';

// Provide a fake microphone so MediaRecorder works headlessly
test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

test('003 — Audio Message Workflow', async ({ browser }, testInfo) => {
  test.setTimeout(120000);
  const evidence = new EvidenceCollector('003', 'Audio Message Workflow');

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
      await pageA.waitForTimeout(1000);
    }, 'User A opens the app and sees the landing screen. The browser is launched with fake audio device flags so MediaRecorder can capture audio in a headless environment.');

    let roomUrl = '';
    await evidence.step(pageA, 2, '[User A] Create a room', async () => {
      await pageA.click('#btn-create');
      await expect(pageA.locator('#screen-create')).toBeVisible();
      await pageA.fill('#create-password', 'audiopassword');
      await pageA.click('#create-btn');
      await expect(pageA.locator('#screen-chat')).toBeVisible({ timeout: 10000 });
      await pageA.waitForURL(/.*#[0-9a-f-]{36}/, { timeout: 10000 });
      roomUrl = pageA.url();
      await pageA.waitForTimeout(1000);
    }, 'User A creates a room. The room ID is embedded in the URL hash and shared with User B out-of-band.');

    await evidence.step(pageB, 3, '[User B] Join the room and toggle the theme', async () => {
      await pageB.goto(roomUrl, { waitUntil: 'networkidle' });
      await expect(pageB.locator('#screen-join')).toBeVisible();
      await pageB.fill('#join-password', 'audiopassword');
      await pageB.click('#join-btn');
      await expect(pageB.locator('#screen-chat')).toBeVisible({ timeout: 10000 });
      await pageB.click('.btn-theme-toggle');
      await pageB.waitForTimeout(1000);
    }, 'User B joins the room with the shared password. The encryption key is derived and validated client-side. User B then toggles the UI theme, demonstrating that each participant\'s theme preference is stored independently in their own localStorage.');

    await evidence.step(pageA, 4, '[User A] Observe the join notification', async () => {
      await pageA.waitForTimeout(12000);
      await expect(pageA.locator('.system-notice').last()).toBeVisible();
      await pageA.waitForTimeout(1000);
    }, 'After a sync cycle, User A sees a system notice that User B has joined. Presence is detected client-side from the server presence list — no join message is transmitted.');

    await evidence.step(pageA, 5, '[User A] Start recording an audio message', async () => {
      await pageA.click('#btn-action');
      await expect(pageA.locator('#recording-bar')).toBeVisible();
      await pageA.waitForTimeout(1000);
    }, 'User A clicks the microphone button (visible when the message input is empty). The browser captures audio from the fake device. The recording bar appears with a live timer.');

    await evidence.step(pageA, 6, '[User A] Stop recording and send the audio message', async () => {
      await pageA.waitForTimeout(3000);
      await pageA.click('[onclick="stopRecording()"]');
      await expect(pageA.locator('#recording-bar')).not.toBeVisible({ timeout: 5000 });
      await pageA.waitForTimeout(1000);
    }, 'User A stops the recording after a few seconds. The audio blob is encoded as base64 and embedded in the encrypted payload before being sent to the server.');

    await evidence.step(pageB, 7, '[User B] Receive the audio message', async () => {
      await pageB.waitForTimeout(12000);
      await expect(pageB.locator('#chat-messages audio')).toBeVisible();
      await pageB.waitForTimeout(1000);
    }, 'After a sync cycle, User B\'s client fetches and decrypts the audio message. An HTML audio player is rendered inline in the chat thread. The server only ever stored the encrypted blob.');

    await evidence.step(pageA, 8, '[User A] Delete the room', async () => {
      await pageA.click('#btn-settings');
      await expect(pageA.locator('#settings-panel.open')).toBeVisible();
      await pageA.waitForTimeout(1000);
      pageA.once('dialog', dialog => dialog.accept());
      await pageA.locator('[onclick="deleteRoom()"]').click();
      await pageA.waitForTimeout(1000);
    }, 'User A deletes the room. The deletion request is authenticated with the owner\'s delete token. All messages are permanently removed from the server.');

    await evidence.step(pageA, 9, '[User A] App returns to the landing screen', async () => {
      await expect(pageA.locator('#screen-landing')).toBeVisible();
      await pageA.waitForTimeout(1000);
    }, 'After deletion, User A\'s app returns to the landing screen.');

    await evidence.step(pageB, 10, '[User B] Room deletion detected — device data purged', async () => {
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
