import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { arSA } from '@clerk/localizations';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { useGetPortalMe, getGetPortalMeQueryKey } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { color, font } from '@/design/tokens';
import { serviceBySlug } from '@/content/services';
import { CityScene } from '@/components/city-scene';
import Landing from '@/pages/landing';
import { ErrorBlock, LoadingBlock } from '@/components/portal-ui';

// Portal pages load on demand, so landing-page visitors download only the landing page.
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
const publicPages = () => import('@/pages/public');
const ServicesDirectory = lazy(() => publicPages().then(m => ({ default: m.ServicesDirectory })));
const ServiceDetail = lazy(() => publicPages().then(m => ({ default: m.ServiceDetail })));
const TrustPage = lazy(() => publicPages().then(m => ({ default: m.TrustPage })));
const HelpPage = lazy(() => publicPages().then(m => ({ default: m.HelpPage })));
const officeAdminPages = () => import('@/pages/office-admin');
const OfficeStaff = lazy(() => officeAdminPages().then(m => ({ default: m.OfficeStaff })));
const OfficeAuditLog = lazy(() => officeAdminPages().then(m => ({ default: m.OfficeAuditLog })));

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } } });
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}
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

function CacheResetOnAuthChange() {
  const { addListener } = useClerk(); const qc = useQueryClient(); const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({user}) => {
      const id = user?.id ?? null;
      if (previous.current !== undefined && previous.current !== id) qc.clear();
      previous.current = id;
    });
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, [addListener,qc]);
  return null;
}
function RoleGate({ children, staff = false, owner = false, registration = false }: { children: ReactNode; staff?: boolean; owner?: boolean; registration?: boolean }) {
  const { isLoaded, isSignedIn } = useAuth();
  const me = useGetPortalMe({ query: { enabled: !!isLoaded && !!isSignedIn, queryKey: getGetPortalMeQueryKey(), refetchInterval: 20_000 } });
  if (!isLoaded) return <div dir="rtl" className="mx-auto max-w-2xl p-10"><LoadingBlock/></div>;
  if (!isSignedIn) return <Redirect to="/sign-in"/>;
  if (me.isLoading) return <div dir="rtl" className="mx-auto max-w-2xl p-10"><LoadingBlock/></div>;
  if (me.isError) return <div dir="rtl" className="mx-auto max-w-2xl p-10"><ErrorBlock retry={()=>me.refetch()}/></div>;
  if (staff && me.data?.role !== 'staff') return <Redirect to="/dashboard"/>;
  if (!staff && me.data?.role === 'staff') return <Redirect to="/office"/>;
  if (owner && me.data?.officeRole !== 'owner') return <Redirect to="/office"/>;
  if (!staff && me.data?.registrationStatus !== 'approved' && !registration) return <Redirect to="/registration"/>;
  if (registration && me.data?.registrationStatus === 'approved') return <Redirect to="/dashboard"/>;
  return <>{children}</>;
}
function HomeRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div dir="rtl" className="mx-auto max-w-2xl p-10"><LoadingBlock/></div>;
  return isSignedIn ? <RoleGate><Redirect to="/dashboard"/></RoleGate> : <Landing/>;
}
function AuthPage({kind}:{kind:'sign-in'|'sign-up'}) {
  const { isSignedIn } = useAuth();
  if (isSignedIn) return <RoleGate><Redirect to="/dashboard"/></RoleGate>;
  return <div dir="rtl" className="flex min-h-[100dvh] flex-col items-center justify-center gap-7 bg-paper px-4 py-10"><a href={basePath || '/'} className="display text-xl font-semibold text-teal no-underline">HBS / حلول الغد</a>{kind==='sign-up' && <p className="max-w-sm text-center text-sm leading-7 text-subtle">أنشئ حسابًا بالبريد الإلكتروني وتحقق منه، ثم قدّم طلب تسجيل يراجعه المكتب قبل إتاحة خدمات البوابة.</p>}<div dir="rtl" className="w-full max-w-[440px]">{kind==='sign-in' ? <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /> : <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />}</div><p className="text-center text-xs text-subtle">تتوفر خدمات العملاء بعد موافقة المكتب على طلب التسجيل.</p></div>;
}
function Missing() { return <div dir="rtl" className="flex min-h-[100dvh] flex-col items-center justify-center bg-paper p-6 text-center"><div className="display text-7xl font-semibold text-copper">404</div><h1 className="display mt-5 text-2xl">الصفحة غير موجودة</h1><p className="mt-3 text-sm text-subtle">قد يكون الرابط غير صحيح أو تغيّر مكان الصفحة.</p><a href={basePath || '/'} className="btn btn-primary mt-7">العودة للرئيسية</a></div>; }
const routeTitles: Record<string,string> = {'/':'الرئيسية','/services':'دليل الخدمات','/trust':'الخصوصية والأمان','/help':'المساعدة','/registration':'طلب التسجيل','/dashboard':'نظرة عامة','/requests':'طلباتي','/requests/new':'طلب جديد','/inquiries':'استفساراتي','/office':'مساحة المكتب','/office/registrations':'طلبات التسجيل','/office/requests':'طلبات العملاء','/office/inquiries':'استفسارات العملاء','/office/legacy':'الأرشيف القديم','/office/staff':'فريق المكتب','/office/audit':'سجل التدقيق'};
const isPublicPath = (location: string) => location === '/' || location === '/services' || location.startsWith('/services/') || location === '/trust' || location === '/help';
function Routes() {
  const [location]=useLocation();
  const { isSignedIn } = useAuth();
  // The city backdrop lives outside <Switch>, so it keeps playing across public pages.
  const showScene = isPublicPath(location) && !(location === '/' && isSignedIn);
  useEffect(()=>{
    const title = routeTitles[location] || (location.startsWith('/services/')?(serviceBySlug[location.slice(10)]?.name ?? 'الخدمة'):location.startsWith('/requests/')?'تفاصيل الطلب':location.startsWith('/sign-in')?'تسجيل الدخول':location.startsWith('/sign-up')?'إنشاء حساب':'الصفحة');
    document.title=`${title} | HBS حلول الغد`;
    const isPublic = isPublicPath(location);
    document.querySelector('meta[name="robots"]')?.setAttribute('content', isPublic ? 'index, follow' : 'noindex, nofollow');
    document.querySelector('meta[name="description"]')?.setAttribute('content', location === '/'
      ? 'HBS حلول الغد: أرسل طلب خدمة أو استفسارًا وتابع حالته من حسابك عبر بوابة العملاء.'
      : location.startsWith('/services') ? 'دليل خدمات حلول الغد: الجوازات والعمل والأعمال وخدمات أخرى، وما يفيد أن تكتبه في طلبك.'
      : `${title} في بوابة HBS حلول الغد.`);
    // Canonical URL without query strings, for public pages only.
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (isPublic) {
      if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.appendChild(canonical); }
      canonical.href = `${window.location.origin}${basePath}${location === '/' ? '/' : location}`;
    } else canonical?.remove();
  },[location]);
  return <>{showScene && <CityScene routeKey={location} compact={location !== '/'} />}<ErrorBoundary resetKey={location}><Suspense fallback={<div dir="rtl" className="mx-auto max-w-2xl p-10"><LoadingBlock/></div>}><Switch>
    <Route path="/" component={HomeRoute}/>
    <Route path="/services" component={ServicesDirectory}/>
    <Route path="/services/:slug" component={ServiceDetail}/>
    <Route path="/trust" component={TrustPage}/>
    <Route path="/help" component={HelpPage}/>
    <Route path="/sign-in/*?">{()=><AuthPage kind="sign-in"/>}</Route>
    <Route path="/sign-up/*?">{()=><AuthPage kind="sign-up"/>}</Route>
    <Route path="/registration"><RoleGate registration><CustomerRegistration/></RoleGate></Route>
    <Route path="/dashboard"><RoleGate><Dashboard/></RoleGate></Route>
    <Route path="/requests/new"><RoleGate><NewRequest/></RoleGate></Route>
    <Route path="/requests/:id"><RoleGate><RequestDetail/></RoleGate></Route>
    <Route path="/requests"><RoleGate><Requests/></RoleGate></Route>
    <Route path="/inquiries"><RoleGate><Inquiries/></RoleGate></Route>
    <Route path="/office/requests"><RoleGate staff><OfficeRequests/></RoleGate></Route>
    <Route path="/office/registrations"><RoleGate staff><OfficeRegistrations/></RoleGate></Route>
    <Route path="/office/inquiries"><RoleGate staff><OfficeInquiries/></RoleGate></Route>
    <Route path="/office/legacy"><RoleGate staff owner><Legacy/></RoleGate></Route>
    <Route path="/office/staff"><RoleGate staff owner><OfficeStaff/></RoleGate></Route>
    <Route path="/office/audit"><RoleGate staff owner><OfficeAuditLog/></RoleGate></Route>
    <Route path="/office"><RoleGate staff><OfficeOverview/></RoleGate></Route>
    <Route component={Missing}/>
  </Switch></Suspense></ErrorBoundary></>;
}
function ClerkWithRoutes() {
  const [,setLocation]=useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance}
    signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    localization={{...arSA, formFieldLabel__emailAddress: 'البريد الإلكتروني', formFieldInputPlaceholder__emailAddress: 'أدخل بريدك الإلكتروني'}}
    routerPush={to=>setLocation(stripBase(to))} routerReplace={to=>setLocation(stripBase(to),{replace:true})}>
    <QueryClientProvider client={queryClient}><CacheResetOnAuthChange/><Routes/></QueryClientProvider>
  </ClerkProvider>;
}
function App() { return <WouterRouter base={basePath}><ClerkWithRoutes/></WouterRouter>; }
export default App;
