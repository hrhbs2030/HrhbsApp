import { useEffect, useRef, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { arSA } from '@clerk/localizations';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { useGetPortalMe, getGetPortalMeQueryKey } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import Landing from '@/pages/landing';
import { Dashboard, Requests, NewRequest, RequestDetail, Inquiries } from '@/pages/customer';
import { OfficeOverview, OfficeRequests, OfficeInquiries } from '@/pages/office';
import { CustomerRegistration, OfficeRegistrations } from '@/pages/registration-connected';
import { ErrorBlock, LoadingBlock } from '@/components/portal-ui';
import Legacy from '@/pages/legacy';

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
  variables: { colorPrimary: '#174b50', colorForeground: '#173e42', colorMutedForeground: '#647872', colorDanger: '#aa4a3b', colorBackground: '#fcfaf4', colorInput: '#fffcf6', colorInputForeground: '#173e42', colorNeutral: '#c9d0c7', fontFamily: "'IBM Plex Sans Arabic', sans-serif", borderRadius: '10px' },
  elements: {
    rootBox: { width: '100%', display: 'flex', justifyContent: 'center' },
    cardBox: { width: '100%', maxWidth: '440px', borderRadius: '18px', background: '#fcfaf4', border: '1px solid #e1e1d5', boxShadow: '0 20px 70px rgba(23,75,80,.09)', overflow: 'hidden' },
    card: { boxShadow: 'none', background: 'transparent', border: 'none' },
    footer: { boxShadow: 'none', background: 'transparent' },
    headerTitle: { color: '#173e42', fontFamily: "'Readex Pro', sans-serif", fontSize: '24px' },
    headerSubtitle: { color: '#647872' },
    socialButtonsBlockButtonText: { color: '#173e42' },
    formFieldLabel: { color: '#173e42' },
    footerActionLink: { color: '#b85f3f' },
    footerActionText: { color: '#647872' },
    dividerText: { color: '#647872' },
    identityPreviewEditButton: { color: '#174b50' },
    formFieldSuccessText: { color: '#387551' },
    alertText: { color: '#a54032' },
    formButtonPrimary: { backgroundColor: '#174b50', color: '#fcfaf4' },
    formFieldInput: { backgroundColor: '#fffcf6', color: '#173e42', borderColor: '#c9d0c7' },
    socialButtonsBlockButton: { backgroundColor: '#fcfaf4', borderColor: '#c9d0c7' },
    socialButtons: { display: 'none' },
    dividerRow: { display: 'none' },
    otpCodeFieldInput: { backgroundColor: '#fffcf6', color: '#173e42' },
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
function RoleGate({ children, staff = false, registration = false }: { children: ReactNode; staff?: boolean; registration?: boolean }) {
  const { isLoaded, isSignedIn } = useAuth();
  const me = useGetPortalMe({ query: { enabled: !!isLoaded && !!isSignedIn, queryKey: getGetPortalMeQueryKey(), refetchInterval: 20_000 } });
  if (!isLoaded) return <div dir="rtl" className="mx-auto max-w-2xl p-10"><LoadingBlock/></div>;
  if (!isSignedIn) return <Redirect to="/sign-in"/>;
  if (me.isLoading) return <div dir="rtl" className="mx-auto max-w-2xl p-10"><LoadingBlock/></div>;
  if (me.isError) return <div dir="rtl" className="mx-auto max-w-2xl p-10"><ErrorBlock retry={()=>me.refetch()}/></div>;
  if (staff && me.data?.role !== 'staff') return <Redirect to="/dashboard"/>;
  if (!staff && me.data?.role === 'staff') return <Redirect to="/office"/>;
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
  return <div dir="rtl" className="flex min-h-[100dvh] flex-col items-center justify-center gap-7 bg-[#f6f4ed] px-4 py-10"><a href={basePath || '/'} className="display text-xl font-semibold text-[#174b50] no-underline">HBS / حلول الغد</a>{kind==='sign-up' && <p className="max-w-sm text-center text-sm leading-7 text-[#62766e]">أنشئ حسابًا بالبريد الإلكتروني وتحقق منه، ثم قدّم طلب تسجيل يراجعه المكتب قبل إتاحة خدمات البوابة.</p>}<div dir="rtl" className="w-full max-w-[440px]">{kind==='sign-in' ? <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /> : <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />}</div><p className="text-center text-xs text-[#7d8b82]">تتوفر خدمات العملاء بعد موافقة المكتب على طلب التسجيل.</p></div>;
}
function Missing() { return <div dir="rtl" className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#f6f4ed] p-6 text-center"><div className="display text-7xl font-semibold text-[#c4714c]">404</div><h1 className="display mt-5 text-2xl">الصفحة غير موجودة</h1><p className="mt-3 text-sm text-[#70847b]">قد يكون الرابط غير صحيح أو تغيّر مكان الصفحة.</p><a href={basePath || '/'} className="btn btn-primary mt-7">العودة للرئيسية</a></div>; }
const routeTitles: Record<string,string> = {'/':'الرئيسية','/registration':'طلب التسجيل','/dashboard':'نظرة عامة','/requests':'طلباتي','/requests/new':'طلب جديد','/inquiries':'استفساراتي','/office':'مساحة المكتب','/office/registrations':'طلبات التسجيل','/office/requests':'طلبات العملاء','/office/inquiries':'استفسارات العملاء','/office/legacy':'الأرشيف القديم'};
function Routes() {
  const [location]=useLocation();
  useEffect(()=>{
    const title = routeTitles[location] || (location.startsWith('/requests/')?'تفاصيل الطلب':location.startsWith('/sign-in')?'تسجيل الدخول':location.startsWith('/sign-up')?'إنشاء حساب':'الصفحة');
    document.title=`${title} | HBS حلول الغد`;
    document.querySelector('meta[name="robots"]')?.setAttribute('content', location === '/' ? 'index, follow' : 'noindex, nofollow');
    document.querySelector('meta[name="description"]')?.setAttribute('content', location === '/'
      ? 'HBS حلول الغد: أرسل طلب خدمة أو استفسارًا وتابع حالته من حسابك عبر بوابة العملاء.'
      : `${title} في بوابة HBS حلول الغد للعملاء المسجلين.`);
  },[location]);
  return <ErrorBoundary resetKey={location}><Switch>
    <Route path="/" component={HomeRoute}/>
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
    <Route path="/office/legacy"><RoleGate staff><Legacy/></RoleGate></Route>
    <Route path="/office"><RoleGate staff><OfficeOverview/></RoleGate></Route>
    <Route component={Missing}/>
  </Switch></ErrorBoundary>;
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
