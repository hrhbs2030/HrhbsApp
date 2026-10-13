import { lazy, Suspense, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { arSA } from '@clerk/localizations';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { useQueryClient } from '@tanstack/react-query';
import { Redirect, Route, Switch, useLocation } from 'wouter';
import { useGetPortalMe, getGetPortalMeQueryKey } from '@workspace/api-client-react';
import { color, font } from '@/design/tokens';
import { SceneWindow } from '@/components/scene-window';
import { ErrorBlock, LoadingBlock } from '@/components/portal-ui';
import { Missing, OfficeAccessContext, authChangedEvent, basePath, stripBase } from '@/App';
import { resetNotificationStream, dismissToast, getToastIds } from '@/lib/use-notifications';
import Landing from '@/pages/landing';

// Everything that needs Clerk lives behind this lazy shell: the auth screens,
// the role gate and the portal pages. Public pages never import it, so
// visitors to the landing page and the catalogue download neither
// @clerk/react nor clerk.browser.js from the CDN.

// Portal pages load on demand, so the auth screens download only the shell.
const customerPages = () => import('@/pages/customer');
const officePages = () => import('@/pages/office');
const registrationPages = () => import('@/pages/registration-connected');
const Dashboard = lazy(() => customerPages().then(m => ({ default: m.Dashboard })));
const Requests = lazy(() => customerPages().then(m => ({ default: m.Requests })));
const NewRequest = lazy(() => customerPages().then(m => ({ default: m.NewRequest })));
const RequestDetail = lazy(() => customerPages().then(m => ({ default: m.RequestDetail })));
const Inquiries = lazy(() => customerPages().then(m => ({ default: m.Inquiries })));
const OfficeOverview = lazy(() => officePages().then(m => ({ default: m.OfficeOverview })));
const OfficeRequests = lazy(() => officePages().then(m => ({ default: m.OfficeRequests })));
const OfficeInquiries = lazy(() => officePages().then(m => ({ default: m.OfficeInquiries })));
const CustomerRegistration = lazy(() => registrationPages().then(m => ({ default: m.CustomerRegistration })));
const OfficeRegistrations = lazy(() => registrationPages().then(m => ({ default: m.OfficeRegistrations })));
const Legacy = lazy(() => import('@/pages/legacy'));
const officeAdminPages = () => import('@/pages/office-admin');
const OfficeStaff = lazy(() => officeAdminPages().then(m => ({ default: m.OfficeStaff })));
const OfficeAuditLog = lazy(() => officeAdminPages().then(m => ({ default: m.OfficeAuditLog })));
const OfficePlans = lazy(() => officeAdminPages().then(m => ({ default: m.OfficePlans })));
const OfficeSubscriptions = lazy(() => officeAdminPages().then(m => ({ default: m.OfficeSubscriptions })));
const OfficeRequestPage = lazy(() => import('@/pages/office-request'));
const customerExtras = () => import('@/pages/customer-extras');
const Documents = lazy(() => customerExtras().then(m => ({ default: m.Documents })));
const NotificationSettings = lazy(() => customerExtras().then(m => ({ default: m.NotificationSettings })));
const officeExtras = () => import('@/pages/office-extras');
const OfficeReminders = lazy(() => officeExtras().then(m => ({ default: m.OfficeReminders })));
const OfficeCatalog = lazy(() => officeExtras().then(m => ({ default: m.OfficeCatalog })));
const OfficeReports = lazy(() => officeExtras().then(m => ({ default: m.OfficeReports })));
const companyPages = () => import('@/pages/company');
const CompanyPage = lazy(() => companyPages().then(m => ({ default: m.CompanyPage })));
const OfficeCustomers = lazy(() => companyPages().then(m => ({ default: m.OfficeCustomers })));
const OfficeCustomerFilePage = lazy(() => companyPages().then(m => ({ default: m.OfficeCustomerFilePage })));
const notificationPages = () => import('@/pages/notifications');
const NotificationsPage = lazy(() => notificationPages().then(m => ({ default: m.NotificationsPage })));
const OfficeNotificationsPage = lazy(() => notificationPages().then(m => ({ default: m.OfficeNotificationsPage })));
const OfficeWhatsappInbox = lazy(() => import('@/pages/office-whatsapp'));
const messagePages = () => import('@/pages/messages');
const MessagesInbox = lazy(() => messagePages().then(m => ({ default: m.MessagesInbox })));
const OfficeMessagesInbox = lazy(() => messagePages().then(m => ({ default: m.OfficeMessagesInbox })));
const InquiryThread = lazy(() => messagePages().then(m => ({ default: m.InquiryThread })));

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const appearance = {
  theme: 'simple' as const,
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: { colorPrimary: color.teal, colorForeground: color.ink, colorMutedForeground: color.quiet, colorDanger: color.danger, colorBackground: color.surface, colorInput: color.field, colorInputForeground: color.ink, colorNeutral: color.lineStrong, fontFamily: font.body, borderRadius: '10px' },
  elements: {
    rootBox: { width: '100%', display: 'flex', justifyContent: 'center' },
    cardBox: { width: '100%', maxWidth: '440px', borderRadius: '18px', background: color.surface, border: `1px solid ${color.line}`, boxShadow: '0 20px 70px rgba(23,75,80,.09)', overflow: 'hidden' },
    card: { boxShadow: 'none', background: 'transparent', border: 'none' },
    footer: { boxShadow: 'none', background: 'transparent' },
    headerTitle: { color: color.ink, fontFamily: font.display, fontSize: '24px' },
    headerSubtitle: { color: color.quiet },
    socialButtonsBlockButtonText: { color: color.ink },
    formFieldLabel: { color: color.ink },
    footerActionLink: { color: color.copper },
    footerActionText: { color: color.quiet },
    dividerText: { color: color.quiet },
    identityPreviewEditButton: { color: color.teal },
    formFieldSuccessText: { color: color.ok },
    alertText: { color: color.danger },
    formButtonPrimary: { backgroundColor: color.teal, color: color.onDark },
    formFieldInput: { backgroundColor: color.field, color: color.ink, borderColor: color.lineStrong },
    socialButtonsBlockButton: { backgroundColor: color.surface, borderColor: color.lineStrong },
    socialButtons: { display: 'none' },
    dividerRow: { display: 'none' },
    otpCodeFieldInput: { backgroundColor: color.field, color: color.ink },
  },
};

function resetNotificationToasts() { for (const id of getToastIds()) dismissToast(id); }
function CacheResetOnAuthChange() {
  const { addListener } = useClerk(); const qc = useQueryClient(); const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({user}) => {
      const id = user?.id ?? null;
      if (previous.current !== undefined && previous.current !== id) {
        resetNotificationStream();
        resetNotificationToasts();
        qc.clear();
        window.dispatchEvent(new Event(authChangedEvent));
      }
      previous.current = id;
    });
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, [addListener,qc]);
  return null;
}
// Clerk's script comes from a CDN; when it is blocked or very slow `isLoaded`
// never turns true. After the delay the screens that wait on it stop spinning
// and say so, with a reload as the retry (the script is fetched once per load).
const CLERK_STALL_MS = 8_000;
function useClerkStalled(isLoaded: boolean): boolean {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (isLoaded) { setStalled(false); return; }
    const timer = window.setTimeout(() => setStalled(true), CLERK_STALL_MS);
    return () => window.clearTimeout(timer);
  }, [isLoaded]);
  return stalled && !isLoaded;
}
function ClerkStalled() {
  return <div role="alert" className="surface relative mx-auto w-full max-w-md p-8 text-center">
    <h2 className="display text-xl">تعذّر تحميل تسجيل الدخول</h2>
    <p className="muted my-4 text-sm leading-7">تعذّر تحميل تسجيل الدخول. تحقق من الاتصال ثم أعد المحاولة.</p>
    <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>إعادة المحاولة</button>
  </div>;
}
// The gate's own waiting state: the skeleton, or the stall notice once Clerk is late.
function AuthWait({ stalled }: { stalled: boolean }) {
  return <div dir="rtl" className="mx-auto max-w-2xl p-10">{stalled ? <ClerkStalled/> : <LoadingBlock/>}</div>;
}
function RoleGate({ children, staff = false, owner = false, registration = false }: { children: ReactNode; staff?: boolean; owner?: boolean; registration?: boolean }) {
  const { isLoaded, isSignedIn } = useAuth();
  const stalled = useClerkStalled(!!isLoaded);
  const { denied, restore } = useContext(OfficeAccessContext);
  // 60 s keeps role revocations and registration approvals flowing without a
  // request every 20 s per open tab; hidden tabs do not poll at all.
  const me = useGetPortalMe({ query: { enabled: !!isLoaded && !!isSignedIn, queryKey: getGetPortalMeQueryKey(), refetchInterval: 60_000 } });
  if (!isLoaded) return <AuthWait stalled={stalled}/>;
  if (!isSignedIn) return <Redirect to="/sign-in"/>;
  if (staff && (denied || (me.data && me.data.role !== 'staff'))) return <div dir="rtl" role="alert" className="mx-auto max-w-2xl p-10">
    <div className="surface p-8 text-center"><h1 className="display text-2xl">لم تعد لديك صلاحية الوصول إلى المكتب</h1>
      <p className="muted my-4 text-sm">أُخفيت بيانات المكتب من هذا التبويب. إذا أُعيدت صلاحيتك، تحقق منها مجددًا.</p>
      <button className="btn btn-outline" onClick={async () => { try { const result = await me.refetch(); if (result.data?.role === 'staff') restore(); } catch { /* keep the office locked */ } }}>التحقق من الصلاحية</button>
    </div></div>;
  if (me.isLoading) return <div dir="rtl" className="mx-auto max-w-2xl p-10"><LoadingBlock/></div>;
  if (me.isError) return <div dir="rtl" className="mx-auto max-w-2xl p-10"><ErrorBlock retry={()=>me.refetch()}/></div>;
  if (staff && me.data?.role !== 'staff') return <Redirect to="/dashboard"/>;
  if (!staff && me.data?.role === 'staff') return <Redirect to="/office"/>;
  if (owner && me.data?.officeRole !== 'owner') return <Redirect to="/office"/>;
  if (!staff && me.data?.registrationStatus !== 'approved' && !registration) return <Redirect to="/registration"/>;
  if (registration && me.data?.registrationStatus === 'approved') return <Redirect to="/dashboard"/>;
  return <>{children}</>;
}
// "/" for a visitor whose cookie says a session exists: the landing page shows
// at once, and only the signed-in redirect waits for the auth script.
function HomeRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  if (isLoaded && isSignedIn) return <RoleGate><Redirect to="/dashboard"/></RoleGate>;
  return <Landing/>;
}
function AuthPage({kind}:{kind:'sign-in'|'sign-up'}) {
  const { isLoaded, isSignedIn } = useAuth();
  const stalled = useClerkStalled(!!isLoaded);
  if (isSignedIn) return <RoleGate><Redirect to="/dashboard"/></RoleGate>;
  const title = kind==='sign-in' ? 'تسجيل الدخول' : 'إنشاء حساب';
  // Clerk's card carries the visible heading; the page keeps its own h1 for assistive tech.
  return <main dir="rtl" className="relative z-[1] flex min-h-[100dvh] flex-col items-center justify-center gap-7 px-4 py-10"><SceneWindow edge="top"/><h1 className="sr-only">{title}</h1><a href={basePath || '/'} className="display rounded-full bg-night/60 px-5 py-2 text-xl font-semibold text-on-dark no-underline backdrop-blur">HBS / حلول الغد</a>{kind==='sign-up' && <p className="max-w-sm rounded-2xl bg-night/70 px-5 py-3 text-center text-sm leading-7 text-on-dark-2 backdrop-blur">أنشئ حسابًا بالبريد الإلكتروني وتحقق منه، ثم قدّم طلب تسجيل يراجعه المكتب قبل إتاحة خدمات البوابة.</p>}<div dir="rtl" className="w-full max-w-[440px]">{stalled ? <ClerkStalled/> : kind==='sign-in' ? <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /> : <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />}</div><p className="rounded-full bg-night/70 px-4 py-2 text-center text-xs text-on-dark-2 backdrop-blur">تتوفر خدمات العملاء بعد موافقة المكتب على طلب التسجيل.</p></main>;
}
// Mounted once for every portal and auth route, so Clerk is not re-initialised
// as the visitor moves between portal pages. Its own Suspense keeps the shell
// on screen while a page chunk loads.
export default function PortalShell() {
  const [,setLocation]=useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance}
    signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    localization={{
      ...arSA,
      formFieldLabel__emailAddress: 'البريد الإلكتروني',
      formFieldInputPlaceholder__emailAddress: 'أدخل بريدك الإلكتروني',
      // Local branding only: the authentication tenant is shared with other
      // workspace products, whose names must not leak into the HBS interface.
      signIn: {...arSA.signIn, start: {...arSA.signIn?.start, subtitle: 'للمتابعة إلى HBS حلول الغد'}},
      signUp: {...arSA.signUp, start: {...arSA.signUp?.start, subtitle: 'إنشاء حساب في HBS حلول الغد'}},
    }}
    routerPush={to=>setLocation(stripBase(to))} routerReplace={to=>setLocation(stripBase(to),{replace:true})}>
    <CacheResetOnAuthChange/>
    <Suspense fallback={<div dir="rtl" className="mx-auto max-w-2xl p-10"><LoadingBlock/></div>}><Switch>
      <Route path="/" component={HomeRoute}/>
      <Route path="/sign-in/*?">{()=><AuthPage kind="sign-in"/>}</Route>
      <Route path="/sign-up/*?">{()=><AuthPage kind="sign-up"/>}</Route>
      <Route path="/registration"><RoleGate registration><CustomerRegistration/></RoleGate></Route>
      <Route path="/dashboard"><RoleGate><Dashboard/></RoleGate></Route>
      <Route path="/requests/new"><RoleGate><NewRequest/></RoleGate></Route>
      <Route path="/requests/:id"><RoleGate><RequestDetail/></RoleGate></Route>
      <Route path="/requests"><RoleGate><Requests/></RoleGate></Route>
      <Route path="/inquiries/:id"><RoleGate><InquiryThread/></RoleGate></Route>
      <Route path="/inquiries"><RoleGate><Inquiries/></RoleGate></Route>
      <Route path="/messages"><RoleGate><MessagesInbox/></RoleGate></Route>
      <Route path="/office/messages"><RoleGate staff><OfficeMessagesInbox/></RoleGate></Route>
      <Route path="/documents"><RoleGate><Documents/></RoleGate></Route>
      <Route path="/company"><RoleGate><CompanyPage/></RoleGate></Route>
      <Route path="/office/customers/:userId"><RoleGate staff><OfficeCustomerFilePage/></RoleGate></Route>
      <Route path="/office/customers"><RoleGate staff><OfficeCustomers/></RoleGate></Route>
      <Route path="/settings"><RoleGate><NotificationSettings/></RoleGate></Route>
      <Route path="/notifications"><RoleGate><NotificationsPage/></RoleGate></Route>
      <Route path="/office/notifications"><RoleGate staff><OfficeNotificationsPage/></RoleGate></Route>
      <Route path="/office/whatsapp"><RoleGate staff><OfficeWhatsappInbox/></RoleGate></Route>
      <Route path="/office/reminders"><RoleGate staff><OfficeReminders/></RoleGate></Route>
      <Route path="/office/catalog"><RoleGate staff owner><OfficeCatalog/></RoleGate></Route>
      <Route path="/office/reports"><RoleGate staff owner><OfficeReports/></RoleGate></Route>
      <Route path="/office/requests/:id"><RoleGate staff><OfficeRequestPage/></RoleGate></Route>
      <Route path="/office/requests"><RoleGate staff><OfficeRequests/></RoleGate></Route>
      <Route path="/office/plans"><RoleGate staff owner><OfficePlans/></RoleGate></Route>
      <Route path="/office/subscriptions"><RoleGate staff owner><OfficeSubscriptions/></RoleGate></Route>
      <Route path="/office/registrations"><RoleGate staff><OfficeRegistrations/></RoleGate></Route>
      <Route path="/office/inquiries"><RoleGate staff><OfficeInquiries/></RoleGate></Route>
      <Route path="/office/legacy"><RoleGate staff owner><Legacy/></RoleGate></Route>
      <Route path="/office/staff"><RoleGate staff owner><OfficeStaff/></RoleGate></Route>
      <Route path="/office/audit"><RoleGate staff owner><OfficeAuditLog/></RoleGate></Route>
      <Route path="/office"><RoleGate staff><OfficeOverview/></RoleGate></Route>
      <Route component={Missing}/>
    </Switch></Suspense>
  </ClerkProvider>;
}
