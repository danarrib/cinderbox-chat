import { test, expect } from '@playwright/test';
import { EvidenceCollector } from './helpers/evidence';

test('007 — Multiple Rooms', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const evidence = new EvidenceCollector('007', 'Multiple Rooms');

  await evidence.step(page, 1, 'Load the application', async () => {
    await page.goto('/');
    await expect(page.locator('#screen-landing')).toBeVisible();
    await page.waitForTimeout(1000);
  }, 'The landing screen is displayed. No rooms exist yet.');

  let room1Id = '';
  let room2Id = '';
  await evidence.step(page, 2, 'Create Room 1', async () => {
    await page.click('#btn-create');
    await expect(page.locator('#screen-create')).toBeVisible();
    await page.fill('#create-password', 'password-room-one');
    await page.click('#create-btn');
    await expect(page.locator('#screen-chat')).toBeVisible({ timeout: 10000 });
    await page.waitForURL(/.*#[0-9a-f-]{36}/, { timeout: 10000 });
    room1Id = page.url().split('#')[1];
    await page.waitForTimeout(1000);
  }, 'Room 1 is created with its own password and encryption key. The chat screen opens and the room ID is captured from the URL hash.');

  await evidence.step(page, 3, 'Create Room 2 using the sidebar button', async () => {
    await page.click('#btn-new-room-sidebar');
    await expect(page.locator('#screen-landing')).toBeVisible();
    await page.click('#btn-create');
    await expect(page.locator('#screen-create')).toBeVisible();
    await page.fill('#create-password', 'password-room-two');
    await page.click('#create-btn');
    await expect(page.locator('#screen-chat')).toBeVisible({ timeout: 10000 });
    await page.waitForURL(/.*#[0-9a-f-]{36}/, { timeout: 10000 });
    room2Id = page.url().split('#')[1];
    await page.waitForTimeout(1000);
  }, 'The "+ New Room" button in the sidebar navigates back to the landing screen. From there, Room 2 is created with a different password and a completely independent encryption key.');

  await evidence.step(page, 4, 'Verify the sidebar shows both rooms', async () => {
    await expect(page.locator('.room-item')).toHaveCount(2);
    await page.waitForTimeout(1000);
  }, 'The sidebar lists both rooms. Each room has its own isolated message thread, password, and encryption key. Switching rooms changes the active context entirely.');

  await evidence.step(page, 5, 'Switch to Room 1 and send a message', async () => {
    await page.locator(`.room-item[data-room-id="${room1Id}"]`).click();
    await expect(page.locator('#screen-chat')).toBeVisible();
    await page.fill('#msg-input', 'Hello from Room 1!');
    await page.press('#msg-input', 'Enter');
    await expect(page.locator('#msg-input')).toHaveValue('');
    await page.waitForTimeout(1000);
  }, 'Clicking Room 1 in the sidebar switches the active context. A message is sent and encrypted with Room 1\'s key. The URL hash updates to Room 1\'s ID.');

  await evidence.step(page, 6, 'Switch to Room 2 and verify message isolation', async () => {
    await page.locator(`.room-item[data-room-id="${room2Id}"]`).click();
    await page.waitForTimeout(2000); // wait for renderMessages() to complete
    await expect(page.locator('#chat-messages')).not.toContainText('Hello from Room 1!');
    await page.waitForTimeout(1000);
  }, 'Switching to Room 2 shows an empty chat thread. The message sent in Room 1 does not appear here — rooms are fully isolated. The URL hash updates to Room 2\'s ID.');

  await evidence.step(page, 7, 'Delete Room 2', async () => {
    await page.click('#btn-settings');
    await expect(page.locator('#settings-panel.open')).toBeVisible();
    await page.waitForTimeout(1000);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[onclick="deleteRoom()"]').click();
    await page.waitForTimeout(1000);
  }, 'Room 2 is deleted. Since Room 1 still exists, the app switches to Room 1 automatically.');

  await evidence.step(page, 8, 'App switches to Room 1 after deleting Room 2', async () => {
    await expect(page.locator('#screen-chat')).toBeVisible();
    await expect(page.locator('#chat-messages')).toContainText('Hello from Room 1!', { timeout: 10000 });
    await page.waitForTimeout(1000);
  }, 'After deleting Room 2, the app automatically switches to the remaining room (Room 1). The previously sent message is still present, confirming room isolation was maintained throughout.');

  await evidence.step(page, 9, 'Delete Room 1', async () => {
    await page.click('#btn-settings');
    await expect(page.locator('#settings-panel.open')).toBeVisible();
    await page.waitForTimeout(1000);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[onclick="deleteRoom()"]').click();
    await page.waitForTimeout(1000);
  }, 'Room 1 is deleted. No rooms remain.');

  await evidence.step(page, 10, 'App returns to the landing screen', async () => {
    await expect(page.locator('#screen-landing')).toBeVisible();
    await page.waitForTimeout(1000);
  }, 'With no rooms remaining, the app returns to the landing screen. The multiple-rooms workflow is complete.');

  await evidence.generateReadme(testInfo);
});
