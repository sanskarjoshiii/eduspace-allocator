import { ok, parseBody, withAuth } from '@/server/http';
import { SettingsPatchInput } from '@/schemas/settings';
import { patchSettings, settingsView } from './settings-admin';

/** GET /api/settings: values, defaults, descriptions and strategy presets. */
export const GET = withAuth({ roles: ['Administrator'] }, async () => ok(await settingsView()));

/** PATCH /api/settings: partial update; weights must sum to 1 unless `normalise: true`. Audited. */
export const PATCH = withAuth({ roles: ['Administrator'] }, async (req, { user }) => {
  const input = await parseBody(req, SettingsPatchInput);
  return ok(await patchSettings(user, input));
});
