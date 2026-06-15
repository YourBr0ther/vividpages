/**
 * Provider SDK error messages can echo a server-redacted partial API key
 * (e.g. "Incorrect API key provided: sk-ant-...abcd"). Those strings get
 * persisted (images.error, pipeline_runs.error) and returned to clients, so
 * scrub anything key-shaped before it leaves the adapter boundary.
 *
 * Matches `sk-` followed by 6+ key characters and replaces the whole token
 * with `sk-***`. The 6-char floor avoids clobbering unrelated short tokens.
 */
const KEY_PATTERN = /sk-[A-Za-z0-9_-]{6,}/g;

export function redactSecrets(msg: string): string {
  return msg.replace(KEY_PATTERN, 'sk-***');
}
