import "server-only";

/**
 * Per-user monthly AI spend cap (USD). Single source of truth for both
 * the API route that enforces it and the profile UI that displays it.
 *
 * The default is intentionally tight ($2/mo) so a misbehaving client or
 * a user with a stack of recipe-card photos can't accidentally rack up a
 * huge bill against the operator's OpenAI key. Operators running a
 * trusted single-user instance can override by setting
 * `POTLUCK_USER_MONTHLY_USD_CAP` (set it to `0` or `none` to disable
 * the cap entirely).
 */
export const DEFAULT_USER_MONTHLY_USD_CAP = 2;

/**
 * The fraction of the cap above which we downgrade to the cheaper
 * `gpt-4o-mini` for image extractions (URL extraction already uses
 * mini). 2/3 leaves the user some runway on the expensive model and
 * lets them keep using the app without hitting the hard cap mid-month.
 */
export const SOFT_CAP_FRACTION = 2 / 3;

/**
 * Resolve the configured cap. Returns `null` when capping is explicitly
 * disabled. Invalid env values fall through to the default rather than
 * failing open — operators are unlikely to want "no cap" by accident.
 */
export function userMonthlyCapUsd(): number | null {
  const raw = process.env.POTLUCK_USER_MONTHLY_USD_CAP;
  if (raw == null || raw === "") return DEFAULT_USER_MONTHLY_USD_CAP;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "0" || trimmed === "none" || trimmed === "off") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_USER_MONTHLY_USD_CAP;
  return n;
}

/**
 * Returns the soft-cap dollar amount, or `null` if capping is disabled.
 */
export function userMonthlySoftCapUsd(): number | null {
  const cap = userMonthlyCapUsd();
  if (cap == null) return null;
  return cap * SOFT_CAP_FRACTION;
}
