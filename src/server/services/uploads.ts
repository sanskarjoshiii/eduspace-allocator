import { v2 as cloudinary } from 'cloudinary';
import { cloudinaryConfigured, getEnv } from '@/lib/env';
import { HttpError, type SessionUser } from '@/server/http';
import type { UploadKind } from '@/schemas/user';

export interface UploadSignature {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
  /** POST the file (multipart) with the fields above to this URL. */
  uploadUrl: string;
}

const FOLDERS: Record<UploadKind, string> = {
  'space-photo': 'eduspace/space-photos',
  logo: 'eduspace/logos',
  'course-cover': 'eduspace/course-covers',
  'facility-evidence': 'eduspace/facility-evidence',
};

/**
 * Server-signed parameters for a direct browser upload to Cloudinary. The API secret
 * only signs; it is never returned.
 */
export function signUpload(_user: SessionUser, kind: UploadKind): UploadSignature {
  const env = getEnv();
  if (!cloudinaryConfigured(env)) {
    throw new HttpError(503, 'uploads_unavailable', 'Photo uploads are not configured on this server. Ask an administrator to set the Cloudinary keys.');
  }
  const timestamp = Math.round(Date.now() / 1000);
  const folder = FOLDERS[kind];
  const signature = cloudinary.utils.api_sign_request({ timestamp, folder }, env.CLOUDINARY_API_SECRET!);
  return {
    cloudName: env.CLOUDINARY_CLOUD_NAME!,
    apiKey: env.CLOUDINARY_API_KEY!,
    timestamp,
    signature,
    folder,
    uploadUrl: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME!}/image/upload`,
  };
}
