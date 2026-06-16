import { getEnv } from '@vividpages/core/env';
import { getDb, userSettings } from '@vividpages/db';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { auth } from '@/auth';

/** Short discovery deadline so an unreachable ComfyUI can't pin the request. */
const DISCOVERY_TIMEOUT_MS = 8_000;

/**
 * GET /api/loras — the LoRAs installed on the user's ComfyUI server, for the
 * cast-page character LoRA picker (issue #2). Resolves the ComfyUI base URL the
 * same way the pipeline does (`user_settings.comfyuiUrl ?? env.COMFYUI_URL`) and
 * proxies `/object_info/LoraLoader`.
 *
 * On ANY failure (unreachable, timeout, malformed payload) it returns
 * `{ loras: [], available: false }` with a 200 so the UI degrades to a
 * free-text field rather than surfacing a 5xx.
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const settings = await getDb().query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });
  const comfyui = (settings?.comfyuiUrl || getEnv().COMFYUI_URL).replace(/\/+$/, '');

  try {
    const res = await fetch(`${comfyui}/object_info/LoraLoader`, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!res.ok) return NextResponse.json({ loras: [], available: false });

    const data = (await res.json()) as {
      LoraLoader?: { input?: { required?: { lora_name?: [unknown, unknown] } } };
    };
    const names = data.LoraLoader?.input?.required?.lora_name?.[0];
    if (!Array.isArray(names)) return NextResponse.json({ loras: [], available: false });

    const loras = names.filter((n): n is string => typeof n === 'string');
    return NextResponse.json({ loras, available: true });
  } catch {
    return NextResponse.json({ loras: [], available: false });
  }
}
