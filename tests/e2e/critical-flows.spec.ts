import { expect, test, type Page } from '@playwright/test';

/**
 * The flows that must never break.
 *
 * Each test registers its own account, so they neither depend on nor disturb
 * each other and can run against any environment.
 */

const PASSWORD = 'e2e-strong-pass-9';

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}@e2e.test`;
}

async function register(page: Page, email: string): Promise<void> {
  await page.goto('/register');
  // The submit button is disabled until React hydrates, which makes it a
  // reliable readiness signal — clicking before then would do a native GET.
  await expect(page.getByRole('button', { name: 'Create account' })).toBeEnabled();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
}

test.describe('marketing', () => {
  test('landing page renders its sections and routes to sign up', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: /Practice interviews with an AI/i }),
    ).toBeVisible();
    await expect(page.locator('#how-it-works')).toBeVisible();
    await expect(page.locator('#pricing')).toBeVisible();
    await expect(page.locator('#faq')).toBeVisible();

    await page.getByRole('link', { name: 'Start your first interview' }).click();
    await expect(page).toHaveURL(/\/register$/);
  });

  test('theme toggle switches and persists', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Switch to (dark|light) theme/ }).click();

    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(['dark', 'light']).toContain(theme);

    await page.reload();
    const afterReload = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    expect(afterReload).toBe(theme);
  });
});

test.describe('authentication', () => {
  test('rejects a weak password with a field-level message', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByRole('button', { name: 'Create account' })).toBeEnabled();
    await page.getByLabel('Email').fill(uniqueEmail('weak'));
    await page.getByLabel('Password').fill('password123');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText(/too common/i)).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
  });

  test('signs up, signs out and signs back in', async ({ page }) => {
    const email = uniqueEmail('cycle');
    await register(page, email);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).first().click();
    await page.waitForURL('**/login', { timeout: 20_000 });

    await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard', { timeout: 30_000 });
  });

  test('redirects an unauthenticated visitor away from the app', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('shows a clear error for wrong credentials', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    await page.getByLabel('Email').fill('nobody@e2e.test');
    await page.getByLabel('Password').fill('not-the-password-9');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText(/not correct/i)).toBeVisible();
  });
});

test.describe('the interview journey', () => {
  test('runs an interview from setup to report', async ({ page }) => {
    await register(page, uniqueEmail('journey'));

    // ── Add a job so the interview has a skill matrix to plan from ──────────
    await page.getByRole('link', { name: 'Jobs' }).first().click();
    await expect(page).toHaveURL(/\/jobs$/);

    await expect(page.getByRole('button', { name: /Analyse job description/i })).toBeEnabled();
    await page.getByLabel('Job title').fill('Senior Data Engineer');
    await page.getByLabel('Job description').fill(
      `Senior Data Engineer
We need someone to own our analytics platform.
Responsibilities
- You will design and build batch and streaming data pipelines
- Own data quality across the warehouse
Required
- 5+ years of experience with Python and SQL
- Strong experience with Spark and Airflow
- Excellent communication skills
Nice to have
- Experience with dbt`,
    );
    await page.getByRole('button', { name: /Analyse job description/i }).click();
    await expect(page.getByText('ready').first()).toBeVisible({ timeout: 40_000 });

    // The skill matrix must separate required from preferred.
    await page.getByRole('button', { name: 'Skill matrix' }).first().click();
    await expect(page.getByRole('cell', { name: 'Python' })).toBeVisible();
    await expect(page.getByText('nice to have').or(page.getByText('preferred')).first()).toBeVisible();

    // ── Start the interview ────────────────────────────────────────────────
    await page.getByRole('link', { name: 'New interview' }).first().click();
    await expect(page).toHaveURL(/\/interviews\/new$/);

    await expect(page.getByRole('button', { name: 'Start interview' })).toBeEnabled();
    await page.getByLabel('Role you are interviewing for').fill('Senior Data Engineer');
    await page.getByRole('button', { name: 'Start interview' }).click();
    await page.waitForURL(/\/interviews\/[0-9a-f-]{36}$/, { timeout: 60_000 });

    // ── The room ───────────────────────────────────────────────────────────
    await expect(page.getByText(/Question 1 of/)).toBeVisible();
    await expect(page.getByText('Interviewer')).toBeVisible();
    await expect(page.getByText('Progress')).toBeVisible();

    // No grading may ever appear on screen during an interview.
    const roomText = (await page.locator('body').innerText()).toLowerCase();
    expect(roomText).not.toContain('/100');
    expect(roomText).not.toContain('your score');

    const answer =
      'I owned our Airflow deployment. The nightly ETL was a single DAG taking 3 hours, so I ' +
      'split it into 12 task groups with per-task retries because one failure re-ran everything. ' +
      'Moving to a Celery executor with 6 workers brought the run to 25 minutes. The trade-off ' +
      'was operational complexity, so I added SLA alerts rather than watching the UI.';

    for (let turn = 0; turn < 8; turn += 1) {
      const finished = await page
        .getByRole('heading', { name: 'Interview complete' })
        .isVisible()
        .catch(() => false);
      if (finished) break;

      const box = page.getByLabel('Your answer');
      if (!(await box.isVisible().catch(() => false))) break;

      await box.fill(answer);
      await page.getByRole('button', { name: 'Submit answer' }).click();
      // Wait for either the next question or the completion panel.
      await page
        .waitForFunction(
          () => {
            const text = document.body.innerText;
            return text.includes('Interview complete') || /Question \d+ of/.test(text);
          },
          undefined,
          { timeout: 45_000 },
        )
        .catch(() => {});
      await page.waitForTimeout(300);
    }

    // ── Report ─────────────────────────────────────────────────────────────
    await expect(page.getByRole('heading', { name: 'Interview complete' })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole('button', { name: /Generate my report/i }).click();
    await page.waitForURL(/\/report$/, { timeout: 90_000 });

    await expect(page.getByText('Scored dimensions')).toBeVisible();
    await expect(page.getByText('Question by question')).toBeVisible();
    await expect(page.getByText(/evidence confidence/i)).toBeVisible();
    // Every question must carry actionable feedback, not a generic message.
    await expect(page.getByText('A strong answer contains').first()).toBeVisible();
    await expect(page.getByText('Next time:').first()).toBeVisible();

    // ── The dashboard reflects it ──────────────────────────────────────────
    await page.getByRole('link', { name: 'Dashboard' }).first().click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText('Latest score')).toBeVisible();
    await expect(page.getByText('Score progression')).toBeVisible();
  });

  test('pausing blocks answering until resumed', async ({ page }) => {
    await register(page, uniqueEmail('pause'));

    await page.goto('/interviews/new');
    await expect(page.getByRole('button', { name: 'Start interview' })).toBeEnabled();
    await page.getByLabel('Role you are interviewing for').fill('Backend Engineer');
    await page.getByRole('button', { name: 'Start interview' }).click();
    await page.waitForURL(/\/interviews\/[0-9a-f-]{36}$/, { timeout: 60_000 });

    await page.getByRole('button', { name: 'Pause interview' }).click();
    await expect(page.getByText('This interview is paused.')).toBeVisible();
    await expect(page.getByLabel('Your answer')).toHaveCount(0);

    await page.getByRole('button', { name: 'Resume interview' }).click();
    await expect(page.getByLabel('Your answer')).toBeVisible();
  });
});

test.describe('responsive layout', () => {
  test('works on a phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await register(page, uniqueEmail('mobile'));

    // The desktop sidebar is hidden and the menu button takes over.
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
    // Signed-in pages are server-rendered; give the toggle its handler.
    await expect(page.getByRole('link', { name: 'New interview' })).toBeVisible();
    await page.getByRole('button', { name: 'Open navigation' }).click();
    // Scoped to the mobile landmark: the desktop sidebar is still in the DOM,
    // hidden by CSS, and would otherwise match too.
    const mobileNav = page.getByRole('navigation', { name: 'Mobile' });
    await expect(mobileNav.getByRole('link', { name: 'Interviews' })).toBeVisible();

    // Nothing may overflow horizontally.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflows).toBe(false);
  });
});
