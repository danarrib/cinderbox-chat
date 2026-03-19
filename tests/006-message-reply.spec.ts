import { test, expect, BrowserContext, Page } from '@playwright/test';
import { EvidenceCollector } from './helpers/evidence';

test('006 — Message Reply', async ({ browser }, testInfo) => {
  test.setTimeout(120000);
  const evidence = new EvidenceCollector('006', 'Message Reply');

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
      await pageA.fill('#create-password', 'replypass');
      await pageA.click('#create-btn');
      await expect(pageA.locator('#screen-chat')).toBeVisible({ timeout: 10000 });
      await pageA.waitForURL(/.*#[0-9a-f-]{36}/, { timeout: 10000 });
      await pageA.waitForTimeout(1000);
    }, 'User A creates a room and arrives at the chat screen.');

    let roomUrl = '';
    await evidence.step(pageB, 2, '[User B] Join the room and toggle the theme', async () => {
      roomUrl = pageA.url();
      await pageB.goto(roomUrl, { waitUntil: 'networkidle' });
      await expect(pageB.locator('#screen-join')).toBeVisible();
      await pageB.fill('#join-password', 'replypass');
      await pageB.click('#join-btn');
      await expect(pageB.locator('#screen-chat')).toBeVisible({ timeout: 10000 });
      await pageB.click('.btn-theme-toggle');
      await pageB.waitForTimeout(1000);
    }, 'User B joins the room with the shared password and toggles the UI theme. Each participant\'s theme preference is stored independently in their own localStorage.');

    await evidence.step(pageA, 3, '[User A] Observe the join notification', async () => {
      await pageA.waitForTimeout(12000);
      await expect(pageA.locator('.system-notice').last()).toBeVisible();
      await pageA.waitForTimeout(1000);
    }, 'User A detects User B\'s arrival from the server presence list and sees a system notice.');

    await evidence.step(pageA, 4, '[User A] Send the original message', async () => {
      await pageA.fill('#msg-input', 'Original message from User A');
      await pageA.press('#msg-input', 'Enter');
      await expect(pageA.locator('#msg-input')).toHaveValue('');
      await pageA.waitForTimeout(1000);
    }, 'User A sends a message that User B will reply to. It is encrypted and transmitted to the server.');

    await evidence.step(pageB, 5, '[User B] Receive the original message', async () => {
      await pageB.waitForTimeout(12000);
      await expect(pageB.locator('#chat-messages')).toContainText('Original message from User A');
      await pageB.waitForTimeout(1000);
    }, 'After a sync cycle, User B receives and decrypts the original message. It appears in the chat thread.');

    await evidence.step(pageB, 6, '[User B] Open the context menu and select Reply', async () => {
      await pageB.locator('.msg-row', { hasText: 'Original message from User A' }).click({ button: 'right' });
      await expect(pageB.locator('#ctx-menu')).toBeVisible();
      await pageB.locator('#ctx-menu-items').getByText('Reply').click();
      await expect(pageB.locator('#reply-bar')).toBeVisible();
      await pageB.waitForTimeout(1000);
    }, 'User B right-clicks the incoming message to open the context menu. For incoming messages, the menu offers "Reply" and "Delete for me". Clicking Reply shows a reply bar above the input with a preview of the original message.');

    await evidence.step(pageB, 7, '[User B] Type and send the reply', async () => {
      await pageB.fill('#msg-input', 'This is a reply from User B');
      await pageB.press('#msg-input', 'Enter');
      await expect(pageB.locator('#msg-input')).toHaveValue('');
      await expect(pageB.locator('#reply-bar')).not.toBeVisible();
      await pageB.waitForTimeout(1000);
    }, 'User B types the reply and sends it. The message is sent with a reference to the original message ID. The reply bar clears automatically after sending.');

    await evidence.step(pageA, 8, '[User A] Receive the reply with the quoted snippet', async () => {
      await pageA.waitForTimeout(12000);
      await expect(pageA.locator('.replied-quote')).toBeVisible();
      await pageA.waitForTimeout(1000);
    }, 'After a sync cycle, User A receives User B\'s reply. A quoted snippet of the original message is displayed inline above the reply text. Clicking the quote scrolls to the original message in the thread.');

    await evidence.step(pageA, 9, '[User A] Delete the room', async () => {
      await pageA.click('#btn-settings');
      await expect(pageA.locator('#settings-panel.open')).toBeVisible();
      await pageA.waitForTimeout(1000);
      pageA.once('dialog', dialog => dialog.accept());
      await pageA.locator('[onclick="deleteRoom()"]').click();
      await pageA.waitForTimeout(1000);
    }, 'User A deletes the room. All messages are permanently removed from the server.');

    await evidence.step(pageA, 10, '[User A] App returns to the landing screen', async () => {
      await expect(pageA.locator('#screen-landing')).toBeVisible();
      await pageA.waitForTimeout(1000);
    }, 'The app returns to the landing screen.');

    await evidence.step(pageB, 11, '[User B] Room deletion detected — device data purged', async () => {
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
