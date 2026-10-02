import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, post, put, type TestApp } from '../helpers/app.ts';
import { discovery, type BedrockQuery } from '../../src/providers/claude/bedrock.ts';

let app: TestApp;
const original = discovery.foundationModels;
before(async () => { app = await startTestApp(); });
after(async () => { discovery.foundationModels = original; await app.stop(); });

const ids = (r: any) => r.models.map((m: any) => m.id);

test('before any refresh, the available models are the built-in list, without asking Bedrock', async () => {
  discovery.foundationModels = async () => { throw new Error('must not be called'); };
  const r = await app.json('/api/models/available');
  assert.equal(r.fetchedAt, null);
  for (const id of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-haiku-4-5']) assert.ok(ids(r).includes(id), `missing ${id}`);
  assert.equal(r.models.find((m: any) => m.id === 'claude-opus-5-5').label, 'Opus 5.5');
  assert.deepEqual(r.problems, []);
});

test('refresh asks Bedrock with the saved profile and region, merges, and caches the result', async () => {
  await app.json('/api/settings', put({ bedrock: { profile: 'sandbox', region: 'us-west-2' } }));
  let asked: BedrockQuery | null = null;
  discovery.foundationModels = async (q) => {
    asked = q;
    return [
      { id: 'anthropic.claude-opus-5-5-v1:0', name: 'Claude Opus 5.5', inferenceTypesSupported: ['INFERENCE_PROFILE'] },
      { id: 'anthropic.claude-mythos-6-v1:0', name: 'Claude Mythos 6', inferenceTypesSupported: ['ON_DEMAND'] },
      { id: 'anthropic.claude-mythos-6-v1:0:200k', name: 'Claude Mythos 6', inferenceTypesSupported: ['PROVISIONED'] },
    ];
  };
  const r = await app.json('/api/models/available/refresh', post({}));
  assert.deepEqual(asked, { profile: 'sandbox', region: 'us-west-2' });
  assert.ok(r.fetchedAt);
  // A Bedrock-only model appears once (context-window variants fold into it), labelled without "Claude ".
  assert.equal(ids(r).filter((id: string) => id === 'claude-mythos-6').length, 1);
  const mythos = r.models.find((m: any) => m.id === 'claude-mythos-6');
  assert.deepEqual(mythos, { id: 'claude-mythos-6', label: 'Mythos 6', sources: ['bedrock'] });
  assert.deepEqual(r.models.find((m: any) => m.id === 'claude-opus-5-5').sources, ['built-in', 'bedrock']);

  // Cached: a plain GET returns the same list without asking again.
  discovery.foundationModels = async () => { throw new Error('must not be called'); };
  const again = await app.json('/api/models/available');
  assert.deepEqual(again, r);
});

test('a Bedrock failure is reported next to the list, not as an error', async () => {
  discovery.foundationModels = async () => { throw Object.assign(new Error('The SSO session has expired'), { name: 'TokenProviderError' }); };
  const res = await app.api('/api/models/available/refresh', post({}));
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.ok(ids(r).includes('claude-opus-5-5'));
  assert.equal(r.problems.length, 1);
  assert.equal(r.problems[0].source, 'bedrock');
  assert.match(r.problems[0].message, /SSO session has expired/);
});

test('refreshing is a mutation: it needs the app header, like every other write', async () => {
  const res = await fetch(`${app.url}/api/models/available/refresh`, { method: 'POST' });
  assert.equal(res.status, 403);
});
