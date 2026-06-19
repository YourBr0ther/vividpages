import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/**
 * The full reading journey, end to end against the real dev stack:
 * register → empty shelf → upload a real EPUB → pipeline runs to ready →
 * detail page → reader (themes, keyboard nav) → position save + resume →
 * continue affordance on the shelf → delete → empty shelf again.
 *
 * One serial describe that builds state across tests; a fresh user per run
 * keeps it independent of existing dev data.
 */

const EPUB_PATH = path.resolve(
  __dirname,
  '..',
  'Assistant to the Villain - Hannah Nicole Maehrer.epub',
);
const BOOK_TITLE = 'Assistant to the Villain';

test.describe.serial('the reading journey', () => {
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'a-very-good-password';

  let page: Page;
  let bookId: string;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('registers a fresh user and lands on an empty bookcase', async () => {
    await page.goto('/register');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('heading', { name: 'The Bookcase' })).toBeVisible();
    await expect(page.getByText('Your shelf is waiting')).toBeVisible();
  });

  test('uploads the EPUB, finishes the wizard, and watches it become ready', async () => {
    await page.locator('input[type="file"]').setInputFiles(EPUB_PATH);

    // Upload now opens the setup wizard before anything runs: step 1 asks
    // "Is this a mature book?", step 2 picks the style, Finish kicks off the
    // whole auto-chained pipeline.
    const wizard = page.getByRole('dialog');
    await expect(wizard.getByRole('heading', { name: 'Is this a mature book?' })).toBeVisible({
      timeout: 20_000,
    });
    await wizard.getByRole('button', { name: 'Next' }).click();
    await expect(wizard.getByRole('heading', { name: 'Illustration style' })).toBeVisible();
    await wizard.getByRole('button', { name: 'Finish & generate' }).click();

    // After Finish the live pipeline stages stream over SSE.
    await expect(
      page.getByText(/Uploading|Reading the book|Finding the scenes/).first(),
    ).toBeVisible({ timeout: 20_000 });

    // Ready card: the cover becomes a link to the detail page (with the
    // book's real metadata title) wrapping the real extracted cover image.
    const openLink = page.getByRole('link', { name: `Open “${BOOK_TITLE}”` });
    await expect(openLink).toBeVisible({ timeout: 60_000 });
    const coverImage = openLink.locator('img[src*="/cover"]');
    await expect(coverImage).toBeVisible();
  });

  test('shows the table of contents on the detail page', async () => {
    await page.getByRole('link', { name: `Open “${BOOK_TITLE}”` }).click();
    await page.waitForURL(/\/books\/[0-9a-f-]+$/);
    bookId = page.url().split('/').pop()!;

    await expect(page.getByRole('heading', { level: 1, name: BOOK_TITLE })).toBeVisible();

    const chapterRows = page.getByRole('region', { name: 'Chapters' }).getByRole('listitem');
    await expect(chapterRows.first()).toBeVisible();
    expect(await chapterRows.count()).toBeGreaterThanOrEqual(60);
  });

  test('opens the reader with prose on the page', async () => {
    await page.getByRole('link', { name: /Begin reading/ }).click();
    await page.waitForURL(/\/read/);

    const surface = page.locator('[data-reader-theme]');
    await expect(surface).toBeVisible();

    // Chapter heading plus actual prose paragraphs. (The opening "chapter"
    // of a real EPUB is often short front matter, so don't demand length.)
    const article = page.getByRole('article');
    await expect(article.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(article.getByRole('paragraph').first()).toBeVisible();
    expect((await article.innerText()).length).toBeGreaterThan(100);
  });

  test('switches the reading theme', async () => {
    await page.getByRole('button', { name: 'Display settings' }).click();
    await page.getByRole('button', { name: 'Paper' }).click();
    await expect(page.locator('[data-reader-theme="light"]')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('advances a chapter, saves the scrolled position, and resumes there', async () => {
    // → arrow steps to the next chapter and syncs ?chapter=.
    await page.keyboard.press('ArrowRight');
    await page.waitForURL(/\?chapter=1$/);
    await expect(page.getByText(/^2 of \d+$/)).toBeVisible();

    // Scroll a good way into the chapter so the position is mid-chapter.
    await page.mouse.move(640, 400);
    for (let i = 0; i < 10; i += 1) {
      await page.mouse.wheel(0, 1000);
      await page.waitForTimeout(100);
    }

    // The debounced PUT fires ~2s after the last scroll; poll the API until
    // a mid-chapter position for chapter idx 1 has landed.
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`/api/books/${bookId}/progress`);
          const data = (await res.json()) as {
            progress: { chapterIdx: number; sceneGlobalIdx: number } | null;
          };
          return data.progress;
        },
        { timeout: 15_000 },
      )
      .toMatchObject({ chapterIdx: 1 });
    const res = await page.request.get(`/api/books/${bookId}/progress`);
    const { progress } = (await res.json()) as {
      progress: { chapterIdx: number; sceneGlobalIdx: number };
    };
    // Chapter idx 1 starts at scene globalIdx 1, so anything greater is
    // mid-chapter.
    expect(progress.sceneGlobalIdx).toBeGreaterThan(1);

    // Reload WITHOUT the chapter query: the reader resumes from the saved
    // position and announces it (mid-chapter, so the toast must show).
    await page.goto(`/books/${bookId}/read`);
    await expect(page.getByText(/^2 of \d+$/)).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'Resumed where you left off' }),
    ).toBeVisible();
  });

  test('shows the continue affordance on the bookcase', async () => {
    await page.goto('/');
    const continueLink = page.getByRole('link', { name: /Continue · Ch 2/ });
    await expect(continueLink).toBeVisible();
    await expect(continueLink).toHaveAttribute('href', `/books/${bookId}/read`);
  });

  test('deletes the book and returns to the empty shelf', async () => {
    await page.getByRole('heading', { name: BOOK_TITLE }).hover();
    await page.getByRole('button', { name: `Delete “${BOOK_TITLE}”` }).click();

    const dialog = page.getByRole('dialog', { name: 'Remove this book?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.getByText('Your shelf is waiting')).toBeVisible({ timeout: 15_000 });
  });
});
