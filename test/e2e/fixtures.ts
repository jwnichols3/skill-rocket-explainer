import { test as base, expect } from '@playwright/test';
import { startTestApp, type TestApp } from '../helpers/app.ts';

/** Each test gets its own app (fresh data dir, fake providers) and a page pointed at it. */
export const test = base.extend<{ app: TestApp }>({
  app: async ({}, use) => {
    const app = await startTestApp();
    await use(app);
    await app.stop();
  },
  baseURL: async ({ app }, use) => { await use(app.url); },
});
export { expect };
