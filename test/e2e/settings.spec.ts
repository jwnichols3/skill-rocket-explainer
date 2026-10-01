import { test, expect } from './fixtures.ts';

test('settings: choose the video renderer from the renderers that produce video', async ({ page, app }) => {
  await page.goto('/settings');
  const select = page.getByLabel('Video renderer');
  await expect(select).toHaveValue('fake');
  const options = await select.locator('option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  const { available } = await app.json('/api/settings');
  const video = available.renderer.filter((r: any) => r.outputTypes.includes('video')).map((r: any) => r.id);
  expect(options).toEqual(video);
  expect(options).toEqual(expect.arrayContaining(['fake', 'hyperframes']));

  await select.selectOption('hyperframes');
  await expect.poll(async () => (await app.json('/api/settings')).settings.providers.renderer.video).toBe('hyperframes');

  await page.reload();
  await expect(page.getByLabel('Video renderer')).toHaveValue('hyperframes');
});
