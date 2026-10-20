import { created, parseBody, withPublic } from '@/server/http';
import { RegisterInput } from '@/schemas/auth';
import { register } from '@/server/services/registration';

/** Self-registration for Learner, Space Giver and Course Provider (never Administrator). */
export const POST = withPublic(async (req) => {
  const input = await parseBody(req, RegisterInput);
  return created(await register(input));
});
