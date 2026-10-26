/*
 * Who the current request belongs to.
 *
 * There is one person today, so this always returns 1. Everything that writes
 * per-user data goes through here rather than hard-coding the number, so when
 * accounts arrive this is the only place that has to learn about sessions —
 * and the data written until then is already attributed correctly.
 */
export const DEFAULT_USER_ID = 1

export function currentUserId(req) {
  return req?.user?.id ?? DEFAULT_USER_ID
}

/** For code with no request to hand: imports, the enrichment queue, scripts. */
export function systemUserId() {
  return DEFAULT_USER_ID
}
