import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * True for a Firebase anonymous user — the web app's "continue as guest".
 * Read from the claims on every request rather than from any cache, so linking
 * a real sign-in to the guest account lifts its limits on the very next call.
 */
export function isAnonymous(claims: DecodedIdToken): boolean {
  return claims.firebase?.sign_in_provider === 'anonymous';
}
