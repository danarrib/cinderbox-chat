import { test, expect } from '@playwright/test';
import { EvidenceCollector } from './helpers/evidence';

test('008 — Room Retention Policy', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const evidence = new EvidenceCollector('008', 'Room Retention Policy');

  await evidence.step(page, 1, 'Load the application', async () => {
    await page.goto('/');
    await expect(page.locator('#screen-landing')).toBeVisible();
    await page.waitForTimeout(1000);
  }, 'The landing screen is displayed.');

  await evidence.step(page, 2, 'Create a room with 1-hour retention', async () => {
    await page.click('#btn-create');
    await expect(page.locator('#screen-create')).toBeVisible();
    await page.fill('#create-password', 'retentionpass1');
    await page.selectOption('#create-retention', '0');
    await page.click('#create-btn');
    await expect(page.locator('#screen-chat')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);
  }, 'A room is created with the 1-hour retention policy (value 0). The retention setting is stored locally and sent to the server at creation time. Messages in this room are automatically purged after 1 hour.');

  await evidence.step(page, 3, 'Open settings and verify 1-hour retention is shown', async () => {
    await page.click('#btn-settings');
    await expect(page.locator('#settings-panel.open')).toBeVisible();
    await expect(page.locator('#settings-retention-value')).toContainText('1 hour');
    await page.waitForTimeout(1000);
  }, 'The settings panel shows the retention policy for the current room. "1 hour" confirms the correct policy was applied at creation.');

  await evidence.step(page, 4, 'Delete the 1-hour room', async () => {
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[onclick="deleteRoom()"]').click();
    await expect(page.locator('#screen-landing')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);
  }, 'The room is deleted and the app returns to the landing screen.');

  await evidence.step(page, 5, 'Create a room with permanent retention', async () => {
    await page.click('#btn-create');
    await expect(page.locator('#screen-create')).toBeVisible();
    await page.fill('#create-password', 'retentionpass2');
    await page.selectOption('#create-retention', '5');
    await page.click('#create-btn');
    await expect(page.locator('#screen-chat')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);
  }, 'A room is created with the Permanent retention policy (value 5). Messages in permanent rooms are never expired by the server\'s lazy-expiry routine. The room is only removed by explicit owner deletion or 7-day abandonment.');

  await evidence.step(page, 6, 'Open settings and verify permanent retention is shown', async () => {
    await page.click('#btn-settings');
    await expect(page.locator('#settings-panel.open')).toBeVisible();
    await expect(page.locator('#settings-retention-value')).toContainText('Permanent');
    await page.waitForTimeout(1000);
  }, 'The settings panel shows "Permanent" as the retention policy, confirming the correct value was stored and rendered.');

  await evidence.step(page, 7, 'Create a room with 12-hour retention', async () => {
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[onclick="deleteRoom()"]').click();
    await expect(page.locator('#screen-landing')).toBeVisible({ timeout: 10000 });
    await page.click('#btn-create');
    await page.fill('#create-password', 'retentionpass3');
    await page.selectOption('#create-retention', '3');
    await page.click('#create-btn');
    await expect(page.locator('#screen-chat')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);
  }, 'A third room is created with the 12-hour retention policy (value 3), covering one of the remaining retention options.');

  await evidence.step(page, 8, 'Open settings and verify 12-hour retention is shown', async () => {
    await page.click('#btn-settings');
    await expect(page.locator('#settings-panel.open')).toBeVisible();
    await expect(page.locator('#settings-retention-value')).toContainText('12 hours');
    await page.waitForTimeout(1000);
  }, 'The settings panel confirms "12 hours" retention. All five retention options — 1h, 6h, 12h, 24h, and Permanent — map to specific server-side expiry behaviour.');

  await evidence.step(page, 9, 'Delete the room and return to landing', async () => {
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[onclick="deleteRoom()"]').click();
    await expect(page.locator('#screen-landing')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);
  }, 'The final room is deleted. The app returns to the landing screen. The retention policy workflow is complete.');

  await evidence.generateReadme(testInfo);
});
