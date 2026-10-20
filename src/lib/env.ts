import { z } from 'zod';

const optional = z.string().trim().optional().transform((v) => (v ? v : undefined));

const EnvSchema = z.object({
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 characters'),
  CRON_SECRET: z.string().min(16, 'CRON_SECRET must be at least 16 characters'),
  AUTH_URL: optional,
  ADMIN_SEED_EMAIL: optional,
  ADMIN_SEED_PASSWORD: optional,
  CLOUDINARY_CLOUD_NAME: optional,
  CLOUDINARY_API_KEY: optional,
  CLOUDINARY_API_SECRET: optional,
  RESEND_API_KEY: optional,
  EMAIL_FROM: optional,
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/** Validates process.env once. Throws an error naming every missing or invalid variable. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  cached = parsed.data;
  return cached;
}

export function cloudinaryConfigured(env: Env = getEnv()): boolean {
  return Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
}

export function resendConfigured(env: Env = getEnv()): boolean {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

/** Test hook: forget the cached env so a test can change process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
