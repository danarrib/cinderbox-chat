import { test, expect, BrowserContext, Page } from '@playwright/test';
import { EvidenceCollector } from './helpers/evidence';

test('009 — Join with Wrong Password', async ({ browser }, testInfo) => {
  test.setTimeout(120000);
  const evidence = new EvidenceCollector('009', 'Join with Wrong Password');

  let contextA: BrowserContext | null = null;
  let contextB: BrowserContext | null = null;

  try {
    contextA = await browser.newContext();
    contextB = await browser.newContext();

    const pageA: Page = await contextA.newPage();
    const pageB: Page = await contextB.newPage();

    await evidence.step(pageA, 1, '[User A] Create a room', async () => {
      await pageA.goto('/');
      await expect(pageA.locator('#screen-landing')).toBeVisible();
      await pageA.click('#btn-create');
      await pageA.fill('#create-password', 'correct-password');
      await pageA.click('#create-btn');
      await expect(pageA.locator('#screen-chat')).toBeVisible({ timeout: 10000 });
      await pageA.waitForURL(/.*#[0-9a-f-]{36}/, { timeout: 10000 });
      await pageA.waitForTimeout(1000);
    }, 'User A creates a room with a known password. The room URL will be shared with User B.');

    let roomUrl = '';
    await evidence.step(pageB, 2, '[User B] Navigate to the room URL', async () => {
      roomUrl = pageA.url();
      await pageB.goto(roomUrl, { waitUntil: 'networkidle' });
      await expect(pageB.locator('#screen-join')).toBeVisible();
      await pageB.waitForTimeout(1000);
    }, 'User B opens the room URL. The join screen is displayed with the room ID pre-filled.');

    await evidence.step(pageB, 3, '[User B] Attempt to join with the wrong password', async () => {
      await pageB.fill('#join-password', 'wrong-password');
      await pageB.click('#join-btn');
      await expect(pageB.locator('#join-error')).toBeVisible({ timeout: 10000 });
      await pageB.waitForTimeout(1000);
    }, 'User B submits an incorrect password. The client fetches the room\'s encryption_test value, derives a key from the wrong password, and attempts to decrypt. Decryption fails — the error is caught entirely client-side before any room data is saved locally.');

    await evidence.step(pageB, 4, '[User B] Verify the error message and join screen remains', async () => {
      await expect(pageB.locator('#join-error')).toContainText('Incorrect password');
      await expect(pageB.locator('#screen-join')).toBeVisible();
      await pageB.waitForTimeout(1000);
    }, '"Incorrect password." is displayed in a red alert below the form. The join screen remains active — User B has not been granted access. No room data has been stored on User B\'s device.');

    await evidence.step(pageA, 5, '[User A] Delete the room', async () => {
      await pageA.click('#btn-settings');
      await expect(pageA.locator('#settings-panel.open')).toBeVisible();
      await pageA.waitForTimeout(1000);
      pageA.once('dialog', dialog => dialog.accept());
      await pageA.locator('[onclick="deleteRoom()"]').click();
      await expect(pageA.locator('#screen-landing')).toBeVisible({ timeout: 10000 });
      await pageA.waitForTimeout(1000);
    }, 'User A deletes the room. The wrong-password test is complete.');

    await evidence.generateReadme(testInfo);

  } finally {
    await contextA?.close();
    await contextB?.close();
  }
});
