// Office contact details, shown in the footer, the help page and the legal
// pages, and in the structured data in index.html (keep both in sync).
export const contact = {
  phone: '0555208213',
  phoneIntl: '+966555208213',
  whatsapp: 'https://wa.me/966555208213',
  email: 'hr@hrhbs.com',
  address: 'جدة، حي الأندلس، شارع الجفالي',
  city: 'جدة',
  mapUrl: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('شارع الجفالي، حي الأندلس، جدة'),
} as const;

// Last review date of the privacy policy and terms (update when the text changes).
export const legalUpdated = '30 سبتمبر 2026';
