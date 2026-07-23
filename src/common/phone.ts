/**
 * Normalize a user-entered phone number to E.164 (`+<country><number>`), which is
 * what GHL/Twilio need to route an SMS. Real users type "(862) 322-9027" or
 * "8623229027" — never the country code — so a bare 10-digit number is assumed US
 * and gets a `+1`. A number the user already typed with a leading `+` is trusted
 * as-is. Returns null when there aren't enough digits to be a real phone, so the
 * caller can reject it or store nothing rather than persist garbage.
 */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7) return null; // too short to be a real number

  if (hadPlus) return `+${digits}`; // already carried a country code
  if (digits.length === 10) return `+1${digits}`; // US 10-digit → +1
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`; // 1 + US 10-digit
  return `+${digits}`; // best effort: assume the digits already include a country code
}
