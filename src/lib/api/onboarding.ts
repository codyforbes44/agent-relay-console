/**
 * Tunables for agent self-serve onboarding.
 * Kept in one place so limits can change without touching route code.
 */

/** Credits granted automatically when a workspace is created (DB trigger). */
export const SIGNUP_FREE_CREDITS = 500;

/** Max anonymous signups allowed per source IP inside the window below. */
export const SIGNUP_MAX_PER_IP = 3;

/** Rolling window for the per-IP signup limit, in hours. */
export const SIGNUP_WINDOW_HOURS = 24;

/** Lifetime of a workspace claim link, in minutes. */
export const CLAIM_TOKEN_TTL_MINUTES = 60;

/** Grace period an old key keeps working after rotation, in minutes. */
export const KEY_ROTATION_OVERLAP_MINUTES = 10;
