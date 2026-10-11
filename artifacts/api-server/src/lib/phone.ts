// Phone numbers as customers type them: Arabic-Indic (٠-٩) or Persian (۰-۹)
// digits, spaces, dashes and brackets, with or without the country code.
// Saudi mobiles are stored as 05XXXXXXXX and Saudi landlines as 01XXXXXXXX
// so that one number has one spelling to search for; any other international
// number keeps its code as +<digits>.

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";

export function asciiDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (digit) => {
    const index = ARABIC_INDIC.indexOf(digit);
    return String(index >= 0 ? index : PERSIAN.indexOf(digit));
  });
}

export function normalizePhone(input: string): string | null {
  const text = asciiDigits(input).replace(/[\s\-()]/g, "");
  // 00 and + both mean "country code follows"; a bare 966 is accepted for Saudi numbers only.
  const international = text.startsWith("+") ? text.slice(1) : text.startsWith("00") ? text.slice(2) : null;
  const digits = international ?? text;
  if (!/^\d+$/.test(digits)) return null;
  const local = digits.startsWith("966") ? digits.slice(3) : international === null && digits.startsWith("0") ? digits.slice(1) : digits;
  if (/^[15]\d{8}$/.test(local)) return `0${local}`;
  if (international !== null && !international.startsWith("0") && international.length >= 8 && international.length <= 15) return `+${international}`;
  return null;
}

// Digits to compare with a stored number, both sides reduced to the local
// Saudi form: 0555…, +966 555… and ٠٥٥٥… are the same number. Partial
// numbers are searched as typed, so staff can paste the start of a number.
export function phoneSearchDigits(input: string): string | null {
  const text = asciiDigits(input).replace(/[\s\-()]/g, "");
  // Only a query that looks like (part of) a phone number is compared with
  // phones; "50%" or a reference number must not match every stored number.
  if (!/^(\+|00)?\d{4,15}$/.test(text)) return null;
  const digits = (normalizePhone(text) ?? text).replace(/\D/g, "");
  return digits.replace(/^(00)?966(?=5)/, "0");
}
