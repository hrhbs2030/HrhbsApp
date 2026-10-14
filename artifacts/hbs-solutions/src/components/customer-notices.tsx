import { Link } from 'wouter';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import type { PortalSettings } from '@workspace/api-client-react';
import { financeNotice, readOnlyNotice, useCompanyRole } from '@/lib/company-role';
import './customer-notices.css';

// A saved WhatsApp number that is not verified gets nothing: migration 0011
// reset every existing verification, so the dashboard and the settings page
// point at the verification box until the number is proven.
export const whatsappNeedsVerification = (settings: PortalSettings | undefined | null) => !!settings && settings.whatsappOptIn && !!settings.whatsappPhone && settings.whatsappVerificationStatus !== 'verified';
export function WhatsappVerifyBanner({ settings, inline = false }: { settings: PortalSettings | undefined | null; inline?: boolean }) {
  if (!whatsappNeedsVerification(settings)) return null;
  return <div role="status" className="wa-verify-banner" data-testid="banner-whatsapp-verify">
    <ShieldAlert size={20} aria-hidden="true"/>
    <div className="min-w-0 flex-1"><strong>رقم واتساب يحتاج توثيقًا</strong><span>لن تصلك رسائل واتساب عن طلباتك حتى تثبت ملكية الرقم {settings?.whatsappPhone && <span dir="ltr" className="nums">{settings.whatsappPhone}</span>}.</span></div>
    {inline ? <a href="#whatsapp-verification-title" className="btn btn-outline btn-sm">إلى التحقق</a> : <Link href="/settings#whatsapp-verification-title" className="btn btn-outline btn-sm">وثّق الرقم</Link>}
  </div>;
}
// Members whose role cannot write see why the composers and buttons are missing.
export function RoleNotice() {
  const { role } = useCompanyRole();
  if (role !== 'viewer' && role !== 'finance') return null;
  return <p role="status" className="role-notice"><ShieldCheck size={16} aria-hidden="true"/>{role === 'viewer' ? readOnlyNotice : financeNotice}</p>;
}

