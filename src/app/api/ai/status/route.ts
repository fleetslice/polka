import { aiReady } from '@/lib/server-ai';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ ai: aiReady() });
}
