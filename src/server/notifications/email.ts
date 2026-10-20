import { Resend } from 'resend';
import { getEnv, resendConfigured } from '@/lib/env';
import { logger } from '@/lib/logger';

let client: Resend | null = null;

/**
 * Sends one plain-text email through Resend. Returns false (and logs) when Resend
 * is not configured or the send fails; callers never depend on email succeeding.
 */
export async function sendEmail(msg: { to: string; subject: string; text: string }): Promise<boolean> {
  const env = getEnv();
  if (!resendConfigured(env)) return false;
  client ??= new Resend(env.RESEND_API_KEY);
  try {
    const { error } = await client.emails.send({ from: env.EMAIL_FROM!, to: msg.to, subject: msg.subject, text: msg.text });
    if (error) {
      logger.warn('email.send_failed', { name: error.name, message: error.message });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('email.send_failed', { message: (err as Error).message });
    return false;
  }
}
