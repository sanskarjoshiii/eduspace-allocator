import { NextResponse } from 'next/server';
import { dbHealth } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const db = await dbHealth();
  return NextResponse.json({ status: db.ok ? 'ok' : 'degraded', db }, { status: db.ok ? 200 : 503 });
}
