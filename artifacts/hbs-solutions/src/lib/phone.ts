// One canonical form for phone numbers typed by people, mirrored by the API's
// normaliser: Saudi mobiles become 05XXXXXXXX, other countries +<digits>.
// Arabic-Indic (٠-٩) and Persian (۰-۹) digits are accepted because Arabic
// keyboards produce them; the API would otherwise reject a valid number.
const toAscii = (text: string) => text
  .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0));

export function normalizePhone(input: string): string | null {
  const compact = toAscii(input).replace(/[\s\-()]/g, '');
  // Keep only a leading + or 00 prefix and digits; anything else is not a number.
  if (!/^(\+|00)?\d+$/.test(compact)) return null;
  const international = compact.startsWith('+') || compact.startsWith('00');
  const digits = compact.replace(/^(\+|00)/, '');
  // Saudi mobile (05…) or landline (01…) in any of its spellings: company
  // contact numbers are often landlines, and records saved before this
  // normaliser existed must still be editable.
  if (!international && /^0?[15]\d{8}$/.test(digits)) return `0${digits.replace(/^0/, '')}`;
  if (/^966[15]\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  // No country code starts with 0, so "+05…" is a typo, as the API also treats it.
  if (international && !digits.startsWith('0') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}
