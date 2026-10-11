// Office contact details used by the footer, help and legal pages, and the
// structured data in index.html. Keep the published values in sync.
export const contact = {
  phone: '0555208213',
  phoneIntl: '+966555208213',
  whatsapp: 'https://wa.me/966555208213',
  email: 'hr@hrhbs.com',
  address: 'جدة، حي الأندلس، شارع الجفالي',
  city: 'جدة',
  mapUrl: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('شارع الجفالي، حي الأندلس، جدة'),
  // The office's Google review link (https://g.page/r/.../review). Left unset
  // until the owner fills it in; the rating panel then invites happy customers.
  reviewUrl: undefined as string | undefined,
} as const;

// Last review date of the privacy policy and terms (update when the text changes).
export const legalUpdated = '30 سبتمبر 2026';