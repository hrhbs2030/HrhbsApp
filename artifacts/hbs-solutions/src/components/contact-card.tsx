import { Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { contact } from '@/content/contact';
import './contact-card.css';

const ICON = 1.75;

// The office's contact channels. `tone="dark"` for the footer, `light` on paper.
export function ContactList({ tone = 'light', className = '' }: { tone?: 'light' | 'dark'; className?: string }) {
  return (
    <ul className={`contact-list contact-list--${tone} ${className}`}>
      <li><a href={`tel:${contact.phoneIntl}`}><Phone size={17} strokeWidth={ICON} aria-hidden="true" /><span dir="ltr">{contact.phone}</span></a></li>
      <li><a href={contact.whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle size={17} strokeWidth={ICON} aria-hidden="true" />واتساب</a></li>
      <li><a href={`mailto:${contact.email}`}><Mail size={17} strokeWidth={ICON} aria-hidden="true" /><span dir="ltr">{contact.email}</span></a></li>
      <li><a href={contact.mapUrl} target="_blank" rel="noopener noreferrer"><MapPin size={17} strokeWidth={ICON} aria-hidden="true" />{contact.address}</a></li>
    </ul>
  );
}

export function ContactCard({ title = 'تواصل مع المكتب' }: { title?: string }) {
  return (
    <section className="contact-card" aria-labelledby="contact-card-title">
      <h2 id="contact-card-title" className="display">{title}</h2>
      <ContactList />
    </section>
  );
}