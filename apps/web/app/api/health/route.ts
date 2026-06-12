import { getDb } from '@vividpages/db';

export async function GET() {
  let db = false;
  try {
    await getDb().execute('select 1');
    db = true;
  } catch {
    // DB unreachable or DATABASE_URL missing — report db: false.
  }
  return Response.json({ ok: true, db });
}
