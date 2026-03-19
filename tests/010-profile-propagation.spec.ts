import { test, expect, BrowserContext, Page } from '@playwright/test';
import { EvidenceCollector } from './helpers/evidence';

test('010 — Profile Propagation', async ({ browser }, testInfo) => {
  test.setTimeout(120000);
  const evidence = new EvidenceCollector('010', 'Profile Propagation');

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
      await pageA.fill('#create-password', 'profilepass');
      await pageA.click('#create-btn');
      await expect(pageA.locator('#screen-chat')).toBeVisible({ timeout: 10000 });
      await pageA.waitForURL(/.*#[0-9a-f-]{36}/, { timeout: 10000 });
      await pageA.waitForTimeout(1000);
    }, 'User A creates a room to get to the chat screen where the profile can be set.');

    await evidence.step(pageA, 2, '[User A] Set the profile handle to "Alice"', async () => {
      await pageA.click('#nav-avatar-btn');
      await pageA.click('[onclick="openProfileFromNav()"]');
      await expect(pageA.locator('#screen-profile')).toBeVisible();
      await pageA.fill('#profile-handle', 'Alice');
      await pageA.click('#btn-save-profile');
      await expect(pageA.locator('#screen-chat')).toBeVisible();
      await pageA.waitForTimeout(1000);
    }, 'User A opens the profile screen from the avatar button and sets the handle to "Alice". The handle is stored in localStorage. When another participant joins, a profile_update message will be broadcast carrying this handle.');

    let roomUrl = '';
    await evidence.step(pageB, 3, '[User B] Join the room', async () => {
      roomUrl = pageA.url();
      await pageB.goto(roomUrl, { waitUntil: 'networkidle' });
      await expect(pageB.locator('#screen-join')).toBeVisible();
      await pageB.fill('#join-password', 'profilepass');
      await pageB.click('#join-btn');
      await expect(pageB.locator('#screen-chat')).toBeVisible({ timeout: 10000 });
      await pageB.waitForTimeout(1000);
    }, 'User B joins the room. On the next sync, User A\'s client will detect User B\'s presence and broadcast a profile_update message containing the handle "Alice".');

    await evidence.step(pageA, 4, '[User A] Detect the join and broadcast profile', async () => {
      await pageA.waitForTimeout(12000);
      await expect(pageA.locator('.system-notice').last()).toBeVisible();
      await pageA.waitForTimeout(1000);
    }, 'User A\'s sync detects User B in the presence list. A profile_update message is automatically broadcast to all participants, carrying User A\'s handle "Alice" and avatar. User B will receive this on the next sync.');

    await evidence.step(pageB, 5, '[User B] Receive User A\'s profile', async () => {
      await pageB.waitForTimeout(12000);
      await pageB.waitForTimeout(1000);
    }, 'After a sync cycle, User B\'s client receives and stores the profile_update from User A. The handle "Alice" is now associated with User A\'s sender tag in User B\'s local profile store.');

    await evidence.step(pageB, 6, '[User B] Open settings and see "Alice" in the participants list', async () => {
      await pageB.click('#btn-settings');
      await expect(pageB.locator('#settings-panel.open')).toBeVisible();
      await expect(pageB.locator('#settings-participants-list')).toContainText('Alice');
      await pageB.waitForTimeout(1000);
    }, 'The settings panel\'s participants list shows "Alice" — confirming that User B has received and applied User A\'s profile_update. Profiles are never stored on the server; they travel as encrypted messages like any other content.');

    await evidence.step(pageA, 7, '[User A] Delete the room', async () => {
      await pageA.click('#btn-settings');
      await expect(pageA.locator('#settings-panel.open')).toBeVisible();
      await pageA.waitForTimeout(1000);
      pageA.once('dialog', dialog => dialog.accept());
      await pageA.locator('[onclick="deleteRoom()"]').click();
      await expect(pageA.locator('#screen-landing')).toBeVisible({ timeout: 10000 });
      await pageA.waitForTimeout(1000);
    }, 'User A deletes the room. The profile propagation workflow is complete.');

    await evidence.generateReadme(testInfo);

  } finally {
    await contextA?.close();
    await contextB?.close();
  }
});
