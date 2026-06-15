import { expect, test, type Page } from '@playwright/test';

/**
 * Settings journey against the real dev stack: register → Settings loads →
 * add a JUNK Anthropic key → masked display appears → Test fails gracefully
 * (invalid key, no crash) → change default LLM provider/model and save →
 * reload persists → remove key → gone.
 *
 * A fresh user per run keeps this independent of dev data. No real API key is
 * ever entered, and no cloud pipeline run is triggered.
 */
test.describe.serial('the settings journey', () => {
  const email = `e2e-settings-${Date.now()}@example.com`;
  const password = 'a-very-good-password';

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('registers a fresh user', async () => {
    await page.goto('/register');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'The Bookcase' })).toBeVisible();
  });

  test('Settings page loads from the nav', async () => {
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'API keys' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Default engines' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Local endpoints' })).toBeVisible();
  });

  test('adds a junk Anthropic key and sees the masked display', async () => {
    const anthropic = page.getByTestId('api-key-anthropic');
    await anthropic.getByLabel('Anthropic API key').fill('sk-ant-junk');
    await anthropic.getByRole('button', { name: 'Save' }).click();

    // Masked display: last four chars only, never the real value.
    await expect(page.getByText('sk-…junk')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Connected').first()).toBeVisible();
  });

  test('Test on the junk key fails gracefully (no crash)', async () => {
    const anthropic = page.getByTestId('api-key-anthropic');
    await anthropic.getByRole('button', { name: 'Test' }).click();
    // A graceful failure status appears (✕ ...), and the page is still alive.
    await expect(anthropic.getByRole('status')).toContainText('✕', { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  });

  test('changes default LLM provider to anthropic and persists across reload', async () => {
    await page.getByLabel('LLM provider').selectOption('anthropic');
    await page.getByLabel('LLM model').selectOption('claude-sonnet-4-6');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Settings saved.')).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(page.getByLabel('LLM provider')).toHaveValue('anthropic');
    await expect(page.getByLabel('LLM model')).toHaveValue('claude-sonnet-4-6');

    // Capture the verification screenshot here (key connected + anthropic default).
    await page.screenshot({ path: 'docs/screenshots/settings.png', fullPage: true });
  });

  test('removes the key and it is gone', async () => {
    const anthropic = page.getByTestId('api-key-anthropic');
    await anthropic.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Anthropic key removed.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('sk-…junk')).toHaveCount(0);
    await expect(anthropic.getByText('Not set')).toBeVisible();
  });
});
