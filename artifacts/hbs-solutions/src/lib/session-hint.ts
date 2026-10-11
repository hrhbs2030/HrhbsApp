// Clerk keeps `__client_uat` (optionally suffixed per app) on the site's
// domain: a non-zero value means a session probably exists. Public pages read
// it to pick "حسابي" over "تسجيل الدخول" and to route "/" through the auth
// shell; nothing else trusts it, since the shell re-checks with Clerk.
export function hasSessionHint(): boolean {
  try {
    return /(?:^|;\s*)__client_uat(?:_[^=;]*)?=(?!0(?:;|$))[^;]+/.test(document.cookie);
  } catch {
    return false;
  }
}
