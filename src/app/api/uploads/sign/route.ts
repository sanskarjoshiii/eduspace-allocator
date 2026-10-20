import { ok, parseBody, withAuth } from '@/server/http';
import { UploadSignInput } from '@/schemas/user';
import { signUpload } from '@/server/services/uploads';

/** Signed Cloudinary upload parameters. 503 when Cloudinary is not configured. */
export const POST = withAuth({}, async (req, { user }) => {
  const { kind } = await parseBody(req, UploadSignInput);
  return ok(signUpload(user, kind));
});
