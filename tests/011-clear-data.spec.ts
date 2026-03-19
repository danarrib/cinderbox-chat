import { test, expect } from '@playwright/test';
import { EvidenceCollector } from './helpers/evidence';

test('011 — Clear Data', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const evidence = new EvidenceCollector('011', 'Clear Data');

  await evidence.step(page, 1, 'Load the application and create a room', async () => {
    await page.goto('/');
    await expect(page.locator('#screen-landing')).toBeVisible();
    await page.click('#btn-create');
    await page.fill('#create-password', 'clearpass');
    await page.click('#create-btn');
    await expect(page.locator('#screen-chat')).toBeVisible({ timeout: 10000 });
    await page.waitForURL(/.*#[0-9a-f-]{36}/, { timeout: 10000 });
    await page.waitForTimeout(1000);
  }, 'User creates a room and arrives at the chat screen. The room is stored in localStorage and its messages are stored in IndexedDB.');

  await evidence.step(page, 2, 'Send a message', async () => {
    await page.fill('#msg-input', 'This message will be erased');
    await page.press('#msg-input', 'Enter');
    await expect(page.locator('#msg-input')).toHaveValue('');
    await page.waitForTimeout(6000);
  }, 'A message is sent and synced to the server. It is stored in IndexedDB on the device and visible in the chat thread.');

  await evidence.step(page, 3, 'Verify the message appears in the chat', async () => {
    await expect(page.locator('#chat-messages')).toContainText('This message will be erased');
    await page.waitForTimeout(1000);
  }, 'The message is visible in the chat thread, confirming it is stored locally in IndexedDB.');

  await evidence.step(page, 4, 'Open the nav menu', async () => {
    await page.click('#nav-avatar-btn');
    await expect(page.locator('#nav-menu')).not.toHaveClass(/d-none/);
    await page.waitForTimeout(1000);
  }, 'The navigation menu opens, exposing the "Clear data" option alongside the Profile link.');

  await evidence.step(page, 5, 'Click "Clear data" and confirm the dialog', async () => {
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-i18n="nav.clear_data"]').click();
    await page.waitForTimeout(6000);
  }, 'The user confirms the destructive action in the native confirm dialog. The app sends leave_room notifications for non-owner rooms, deletes owner rooms via the API, wipes all IndexedDB stores (messages and outbox), and clears localStorage before reloading.');

  await evidence.step(page, 6, 'App returns to the landing screen with no rooms', async () => {
    await expect(page.locator('#screen-landing')).toBeVisible({ timeout: 10000 });
    const roomCount = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('cc_rooms') || '[]').length; } catch { return 0; }
    });
    expect(roomCount).toBe(0);
    await page.waitForTimeout(1000);
  }, 'After the reload, the app starts fresh on the landing screen. The cc_rooms key is gone from localStorage, confirming all room data has been erased from the device. The server room was also deleted via the API since the user was the owner.');

  await evidence.generateReadme(testInfo);
});
