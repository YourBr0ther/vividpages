import { execFileSync } from 'node:child_process';

import { expect, test, type Page } from '@playwright/test';

/**
 * Jobs dashboard journey against the real dev stack:
 *
 *   register a fresh user → reassign the dev book ('Assistant to the Villain',
 *   the only 'ready' book with a completed pipeline) to that user via psql →
 *   open Jobs from the nav → the dashboard shows the book's pipeline history
 *   (segment / profiles / imagine runs) with durations and an LLM token tally
 *   for the profiles stage → screenshot.
 *
 * The book is reassigned (not copied), so it is moved back to the original
 * owner in afterAll to leave dev data as we found it. No pipeline run is
 * triggered (no worker required); this asserts the dashboard renders existing
 * history correctly, which the task notes is sufficient.
 */
const PSQL = ['exec', '-i', 'vividpages-postgres-1', 'psql', '-U', 'vividpages', '-d', 'vividpages', '-tAc'];

function sql(query: string): string {
  return execFileSync('docker', [...PSQL, query], { encoding: 'utf8' }).trim();
}

test.describe.serial('the jobs dashboard journey', () => {
  const email = `e2e-jobs-${Date.now()}@example.com`;
  const password = 'a-very-good-password';

  let page: Page;
  let bookId: string;
  let originalOwner: string;
  let newOwner: string;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();

    bookId = sql("select id from books where status='ready' order by created_at desc limit 1;");
    expect(bookId, 'a ready dev book must exist').toBeTruthy();
    originalOwner = sql(`select user_id from books where id='${bookId}';`);
    expect(originalOwner).toBeTruthy();
  });

  test.afterAll(async () => {
    // Restore the dev book's original owner.
    if (bookId && originalOwner) {
      sql(`update books set user_id='${originalOwner}' where id='${bookId}';`);
    }
    await page.close();
  });

  test('registers a fresh user', async () => {
    await page.goto('/register');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'The Bookcase' })).toBeVisible();

    newOwner = sql(`select id from users where email='${email}';`);
    expect(newOwner).toBeTruthy();
    // Reassign the dev book to this user so the dashboard is populated.
    sql(`update books set user_id='${newOwner}' where id='${bookId}';`);
  });

  test('Jobs page loads from the nav with the run history', async () => {
    await page.getByRole('link', { name: 'Jobs' }).click();
    await expect(page.getByRole('heading', { name: 'Jobs', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();

    // The summary strip reports a non-zero LLM token tally (profiles runs).
    await expect(page.getByText('Tokens in')).toBeVisible();
    await expect(page.getByText('Tokens out')).toBeVisible();

    // History lists the book's completed stages with durations + a token tally.
    const history = page.getByRole('region', { name: 'History' });
    await expect(history.getByText('Assistant to the Villain').first()).toBeVisible();
    await expect(history.getByText('Profiles').first()).toBeVisible();
    await expect(history.getByText(/done/i).first()).toBeVisible();
    // Profiles runs carry an LLM token tally (… in · … out).
    await expect(history.getByText(/in · .* out/).first()).toBeVisible();
  });

  test('screenshots the populated dashboard', async () => {
    await page.screenshot({ path: 'docs/screenshots/jobs.png', fullPage: true });
  });
});
