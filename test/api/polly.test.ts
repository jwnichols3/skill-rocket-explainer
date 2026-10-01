import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollyCapabilities, buildSsml, credentialsFix } from '../../src/providers/polly/tts.ts';
import { providerChecks } from '../../src/providers/registry.ts';
import { DEFAULT_SETTINGS, merge } from '../../src/settings.ts';

const R = 'us-east-1';

test('capabilities follow the engine: pitch only on standard, news only on certain neural voices', () => {
  const std = pollyCapabilities('Joey:standard', R);
  assert.ok(std.controls.pitch && std.controls.rate && std.controls.volume);
  assert.equal(std.wordTimings, 'native');

  const neural = pollyCapabilities('Matthew:neural', R);
  assert.equal(neural.controls.pitch, undefined);
  assert.match(neural.unsupported.pitch!, /pitch/);
  assert.deepEqual(neural.styles, ['news']);
  assert.deepEqual(neural.controls.rate, { min: 20, max: 200, default: 100, step: 5, unit: '%' });

  const ruth = pollyCapabilities('Ruth:neural', R);
  assert.deepEqual(ruth.styles, []);
  assert.match(ruth.unsupported.style!, /Matthew/);

  const gen = pollyCapabilities('Matthew:generative', R);
  assert.equal(gen.controls.pitch, undefined);
  assert.deepEqual(gen.styles, []);
  assert.equal(gen.wordTimings, 'aligned');

  assert.equal(pollyCapabilities('Danielle:long-form', R).wordTimings, 'native');
  assert.throws(() => pollyCapabilities('Danielle:long-form', 'eu-west-1'), /us-east-1/);
  assert.throws(() => pollyCapabilities('Matthew', R), /Name:engine/);
});

test('SSML carries only supported controls, clamped and escaped', () => {
  assert.equal(buildSsml('Tom & <Jerry>', 'Matthew:neural', {}, R), '<speak>Tom &amp; &lt;Jerry&gt;</speak>');
  assert.equal(buildSsml('Hi', 'Matthew:neural', { rate: 500, pitch: 10, volume: -3, style: 'news' }, R),
    '<speak><amazon:domain name="news"><prosody rate="200%" volume="-3dB">Hi</prosody></amazon:domain></speak>');
  assert.equal(buildSsml('Hi', 'Matthew:generative', { pitch: 10, style: 'news', rate: 90 }, R), '<speak><prosody rate="90%">Hi</prosody></speak>');
  assert.equal(buildSsml('Hi', 'Joey:standard', { pitch: 5, volume: 2 }, R), '<speak><prosody pitch="+5%" volume="+2dB">Hi</prosody></speak>');
});

test('doctor runs a Polly check only when Polly is selected, and the fix names the configured profile', () => {
  const fake = DEFAULT_SETTINGS;
  const polly = merge(DEFAULT_SETTINGS, { providers: { tts: 'polly' }, polly: { profile: 'some-profile' } });
  assert.ok(!providerChecks(fake).some((c) => c.id === 'polly-credentials'));
  assert.ok(providerChecks(polly).some((c) => c.id === 'polly-credentials'));
  assert.match(credentialsFix(polly.polly), /aws sso login --profile some-profile/);
});
