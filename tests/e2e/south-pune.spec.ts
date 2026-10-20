import { expect, test, type Page } from '@playwright/test';
import { E2E_ACCOUNTS, E2E_ADMIN, E2E_PASSWORD, E2E_SCENARIO } from './env';

// PLAN 8.4: "Weekend coding classes in South Pune", from request to scheduled class.
// The e2e seed profile holds one Kothrud computer lab (auto approval), one Python Basics
// offering (15 seats, Sat 10:00–13:00) and 18 learners wanting Coding on Saturday mornings.

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL('**/dashboard**');
}

async function signOut(page: Page): Promise<void> {
  await page.context().clearCookies();
}

function nextMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

test('a new learner submits a coding request', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.freshLearner, E2E_PASSWORD);
  await page.goto('/requests/new');

  const category = page.getByLabel('Course category');
  const codingLabel = (await category.locator('option', { hasText: E2E_SCENARIO.category }).first().textContent())?.trim();
  expect(codingLabel).toBeTruthy();
  await category.selectOption({ label: codingLabel! });
  await page.getByLabel('Start month').fill(nextMonth());
  await page.getByLabel('Duration (months)').fill('3');
  await page.getByLabel('Latitude').fill('18.5074');
  await page.getByLabel('Longitude').fill('73.8077');
  await page.getByLabel('Maximum travel distance (km)').fill(String(E2E_SCENARIO.maxDistanceKm));
  await page.getByLabel('I agree to share these details at these stages').check();
  await page.getByRole('button', { name: 'Submit Request' }).click();

  await page.waitForURL(/\/requests\/[a-f0-9]{24}$/);
  await expect(page.getByText('Submitted').first()).toBeVisible();
  // The learner's own page never needs another role's data; the area is shown, not raw coordinates to others.
  await expect(page.getByText(E2E_SCENARIO.spaceArea).first()).toBeVisible();
  await signOut(page);
});

test('the administrator runs Smart Allocation', async ({ page }) => {
  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
  await page.goto('/runs');
  await page.getByRole('button', { name: 'Run Allocation' }).click();
  await expect(page.getByText('Smart Allocation run completed')).toBeVisible({ timeout: 60_000 });

  await page.goto('/allocations');
  const row = page.getByRole('row', { name: new RegExp(E2E_SCENARIO.courseTitle) }).first();
  await expect(row).toBeVisible();
  // The lab's policy is auto approval, so the proposal is approved straight away.
  await expect(row.getByText('Approved')).toBeVisible();
  await signOut(page);
});

test('the course provider confirms the class', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.provider, E2E_PASSWORD);
  const panel = page.getByText('Awaiting Your Confirmation').locator('xpath=ancestor::section[1]');
  await expect(panel.getByText(E2E_SCENARIO.courseTitle).first()).toBeVisible();
  await panel.getByRole('button', { name: 'Confirm' }).first().click();
  await expect(page.getByText(/confirmed/i).first()).toBeVisible();

  // Offers went out: the allocation now shows offered seats within the batch size.
  await page.goto('/allocations');
  await page.getByRole('row', { name: new RegExp(E2E_SCENARIO.courseTitle) }).first().click();
  await page.waitForURL(/\/allocations\/[a-f0-9]{24}$/);
  await expect(page.getByText('Why This Space')).toBeVisible();
  await expect(page.getByText('Why Not the Others')).toBeVisible();
  await expect(page.getByText(/compatibility score/i).first()).toBeVisible();
  await signOut(page);
});

test('a learner accepts the offer and the class is scheduled', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.learner, E2E_PASSWORD);
  await page.goto('/offers');
  await expect(page.getByText(E2E_SCENARIO.courseTitle).first()).toBeVisible();
  await page.getByRole('button', { name: 'Accept Offer' }).first().click();
  await expect(page.getByText('Offer accepted')).toBeVisible();

  await page.goto('/requests');
  await expect(page.getByRole('table').getByText('Scheduled', { exact: true })).toBeVisible({ timeout: 15_000 });
  await signOut(page);
});

test('the space giver sees the booking without learner contact details', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.spaceGiver, E2E_PASSWORD);
  await page.goto('/allocations');
  await page.getByRole('row', { name: new RegExp(E2E_SCENARIO.courseTitle) }).first().click();
  await page.waitForURL(/\/allocations\/[a-f0-9]{24}$/);
  await expect(page.getByText(E2E_SCENARIO.spaceName).first()).toBeVisible();
  // Space givers get a roster of names for entry, never phone numbers or emails.
  await expect(page.getByText(/@eduspace\.local/)).toHaveCount(0);
  await expect(page.getByText(/\+91/)).toHaveCount(0);
});
