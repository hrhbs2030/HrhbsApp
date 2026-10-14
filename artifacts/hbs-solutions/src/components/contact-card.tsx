import { Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { contact } from '@/content/contact';
import './contact-card.css';

// Lucide stroke: mirrors --icon-stroke in index.css.
const ICON = 1.75;

// The office's contact channels. `tone="dark"` for the footer, `light` on paper.
export function ContactList({ tone = 'light', className = '' }: { tone?: 'light' | 'dark'; className?: string }) {
  return (
    <ul className={`contact-list contact-list--${tone} ${className}`}>
      <li><a href={`tel:${contact.phoneIntl}`}><Phone size={20} strokeWidth={ICON} aria-hidden="true" /><span dir="ltr">{contact.phone}</span></a></li>
      <li><a href={contact.whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle size={20} strokeWidth={ICON} aria-hidden="true" />واتساب</a></li>
      <li><a href={`mailto:${contact.email}`}><Mail size={20} strokeWidth={ICON} aria-hidden="true" /><span dir="ltr">{contact.email}</span></a></li>
      <li><a href={contact.mapUrl} target="_blank" rel="noopener noreferrer"><MapPin size={20} strokeWidth={ICON} aria-hidden="true" />{contact.address}</a></li>
    </ul>
  );
}

// `text` is the line under the title. With the default title it speaks to
// the owner who has a problem now and says where it is best sent: a request
// keeps the note, the office's answer and every document in one record. A
// page with its own title (the legal pages) gets no line unless it passes one.
const defaultTitle = 'تواصل مع المكتب';
const defaultText = 'ملاحظة وصلتك، أو مؤشر تغيّر، أو وثيقة تنتهي قريبًا؟ أرسلها طلبًا من حسابك ليبقى كل شيء في سجل واحد، أو تواصل معنا مباشرة.';
export function ContactCard({ title = defaultTitle, text }: { title?: string; text?: string | null }) {
  const line = text !== undefined ? text : title === defaultTitle ? defaultText : null;
  return (
    <section className="contact-card" aria-labelledby="contact-card-title">
      <h2 id="contact-card-title" className="display">{title}</h2>
      {line && <p className="contact-card-text">{line}</p>}
      <ContactList />
    </section>
  );
}