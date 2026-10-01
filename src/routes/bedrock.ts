import type { App } from '../app.ts';
import type { Router } from '../router.ts';
import { HttpError } from '../router.ts';
import { listAwsProfiles, listInferenceProfiles, suggestMapping, isCredentialsError } from '../providers/claude/bedrock.ts';
import { bedrockAuthFix } from '../providers/claude/agent.ts';
import { readCatalog, refreshCatalog } from '../models.ts';

const REGION = /^[a-z]{2}(-[a-z]+)+-\d+$/;
const PROFILE = /^[\w.+@-]+$/;

/** Discovery for Settings > Agent surfaces > Bedrock. */
export function bedrockRoutes(app: App, router: Router) {
  // Profile names and regions from ~/.aws/config and ~/.aws/credentials; never keys.
  router.get('/api/bedrock/profiles', async () => ({ profiles: await listAwsProfiles(), selected: app.settings().bedrock.profile ?? '' }));

  // Models for Settings' dropdowns: built-in list, plus Bedrock's once refreshed (cached).
  router.get('/api/models/available', () => readCatalog(app.paths.home));
  // A POST: it calls AWS and rewrites the cache, so it sits behind the mutation guard.
  router.post('/api/models/available/refresh', () => refreshCatalog(app.paths.home, app.settings()));

  router.get('/api/bedrock/inference-profiles', async ({ url }) => {
    const s = app.settings();
    const profile = url.searchParams.get('profile') ?? s.bedrock.profile ?? '';
    const region = url.searchParams.get('region') || s.bedrock.region;
    if (profile && !PROFILE.test(profile)) throw new HttpError(400, `not an AWS profile name: "${profile}"`);
    if (!REGION.test(region)) throw new HttpError(400, `not an AWS region: "${region}"`);
    let inferenceProfiles;
    try {
      inferenceProfiles = await listInferenceProfiles({ profile, region });
    } catch (err: any) {
      if (isCredentialsError(err)) throw new HttpError(401, `AWS credentials for profile ${profile || 'default'} are not usable (${err?.message ?? err}). Fix: ${bedrockAuthFix({ profile })}`);
      throw new HttpError(502, `Bedrock (${region}): ${err?.message ?? err}`);
    }
    return { profile, region, inferenceProfiles, suggested: suggestMapping(s.models.map((m) => m.id), inferenceProfiles, region) };
  });
}
