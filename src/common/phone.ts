import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';

/**
 * Normalize a user-entered phone number to E.164 (`+<country><number>`), which is
 * what GHL/Twilio need to route an SMS internationally. Uses libphonenumber (the
 * same rules Google/Twilio use) so each country's quirks — trunk-zero prefixes,
 * variable lengths, valid ranges — are handled correctly rather than hard-coded.
 *
 * - A number the user typed with a leading `+` is parsed for whatever country it
 *   declares; `defaultCountry` is ignored.
 * - A local number (no `+`) is interpreted using `defaultCountry` (ISO-3166 alpha-2,
 *   e.g. "US", "GB", "IN") — the country the user selected in the UI.
 *
 * Returns the E.164 string only when the number actually validates for that region;
 * otherwise null, so the caller rejects it (on save) or skips it (on send) instead
 * of dispatching to a bad number.
 */
export function normalizePhone(raw?: string | null, defaultCountry?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const country = (defaultCountry || '').trim().toUpperCase();
  try {
    const parsed = parsePhoneNumberFromString(
      trimmed,
      country ? (country as CountryCode) : undefined,
    );
    if (parsed && parsed.isValid()) return parsed.number; // E.164
  } catch {
    // malformed input — fall through to null
  }
  return null;
}
