import { test, expect, BrowserContext, Page } from '@playwright/test';
import { EvidenceCollector } from './helpers/evidence';

test('005 — Message Deletion', async ({ browser }, testInfo) => {
  test.setTimeout(120000);
  const evidence = new EvidenceCollector('005', 'Message Deletion');

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
      await pageA.fill('#create-password', 'deletepass');
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
      await pageB.fill('#join-password', 'deletepass');
      await pageB.click('#join-btn');
      await expect(pageB.locator('#screen-chat')).toBeVisible({ timeout: 10000 });
      await pageB.click('.btn-theme-toggle');
      await pageB.waitForTimeout(1000);
    }, 'User B joins the room with the shared password and toggles the UI theme. Each participant\'s theme preference is stored independently in their own localStorage.');

    await evidence.step(pageA, 3, '[User A] Observe the join notification', async () => {
      await pageA.waitForTimeout(12000);
      await expect(pageA.locator('.system-notice').last()).toBeVisible();
      await pageA.waitForTimeout(1000);
    }, 'User A detects User B\'s arrival from the server presence list. A system notice is generated locally.');

    await evidence.step(pageA, 4, '[User A] Send a message', async () => {
      await pageA.fill('#msg-input', 'This message will be deleted');
      await pageA.press('#msg-input', 'Enter');
      await expect(pageA.locator('#msg-input')).toHaveValue('');
      await pageA.waitForTimeout(1000);
    }, 'User A sends a message. It is encrypted client-side and stored on the server as ciphertext only.');

    await evidence.step(pageB, 5, '[User B] Receive the message', async () => {
      await pageB.waitForTimeout(12000);
      await expect(pageB.locator('#chat-messages')).toContainText('This message will be deleted');
      await pageB.waitForTimeout(1000);
    }, 'After a sync cycle, User B receives and decrypts the message. It appears in the chat thread.');

    await evidence.step(pageA, 6, '[User A] Open the context menu on the message', async () => {
      await pageA.locator('.msg-row', { hasText: 'This message will be deleted' }).click({ button: 'right' });
      await expect(pageA.locator('#ctx-menu')).toBeVisible();
      await pageA.waitForTimeout(1000);
    }, 'User A right-clicks the message to open the context menu. For outgoing messages, the menu offers "Message data", "Delete for everyone", and "Delete for me".');

    await evidence.step(pageA, 7, '[User A] Delete the message for everyone', async () => {
      await pageA.locator('#ctx-menu-items').getByText('Delete for everyone').click();
      await expect(pageA.locator('.tombstone-bubble')).toBeVisible();
      await pageA.waitForTimeout(1000);
    }, 'User A selects "Delete for everyone". The message content is immediately wiped locally and replaced with a tombstone. An ask_for_delete message is sent to each recipient.');

    await evidence.step(pageB, 8, '[User B] See the message disappear from the chat', async () => {
      await pageB.waitForTimeout(17000);
      await expect(pageB.locator('#chat-messages')).not.toContainText('This message will be deleted', { timeout: 10000 });
      await pageB.waitForTimeout(1000);
    }, 'After a sync cycle, User B\'s client processes the ask_for_delete message and permanently deletes the message from local storage. Unlike the sender (who sees a tombstone), the recipient\'s message simply disappears. An ack_deleted acknowledgement is sent back to User A.');

    await evidence.step(pageA, 9, '[User A] Delete the room', async () => {
      await pageA.click('#btn-settings');
      await expect(pageA.locator('#settings-panel.open')).toBeVisible();
      await pageA.waitForTimeout(1000);
      pageA.once('dialog', dialog => dialog.accept());
      await pageA.locator('[onclick="deleteRoom()"]').click();
      await pageA.waitForTimeout(1000);
    }, 'User A deletes the room. All remaining data is permanently removed from the server.');

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
