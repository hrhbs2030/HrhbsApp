import { createContext, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { getGetPortalMeQueryKey } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { serviceBySlug } from '@/content/services';
import { CityScene } from '@/components/city-scene';
import { SceneWindow } from '@/components/scene-window';
import { hasSessionHint } from '@/lib/session-hint';
import Landing from '@/pages/landing';
import NotFound from '@/pages/not-found';

// Public pages load on demand, so landing-page visitors download only the
// landing page. Everything that needs Clerk (auth screens, role gate, portal
// pages) sits behind the lazy PortalShell: public routes never load the auth
// script, and the shell stays mounted as the visitor moves between portal pages.
const PortalShell = lazy(() => import('@/components/portal-shell'));
const publicPages = () => import('@/pages/public');
const ServicesDirectory = lazy(() => publicPages().then(m => ({ default: m.ServicesDirectory })));
const ServiceDetail = lazy(() => publicPages().then(m => ({ default: m.ServiceDetail })));
const TrustPage = lazy(() => publicPages().then(m => ({ default: m.TrustPage })));
const HelpPage = lazy(() => publicPages().then(m => ({ default: m.HelpPage })));
const legalPages = () => import('@/pages/legal');
const PrivacyPage = lazy(() => legalPages().then(m => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => legalPages().then(m => ({ default: m.TermsPage })));

export const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
// The public origin of the site, fixed at build time (SITE_URL → `define` in
// vite.config.ts), so canonical and structured-data URLs stay on the real host
// whichever host served the page (bare domain, preview).
export const siteUrl = (import.meta.env.VITE_SITE_URL || 'https://hrhbs.com').replace(/\/$/, '');
const officeDeniedEvent = 'hbs:office-access-denied';
export const authChangedEvent = 'hbs:auth-changed';
function isOfficeDenied(error: unknown): boolean {
  const response = error as { status?: number; url?: string } | null;
  if (response?.status !== 403 || typeof response.url !== 'string') return false;
  try {
    return new URL(response.url, window.location.origin).pathname.startsWith('/api/office/');
  } catch {
    return false;
  }
}
function onOfficeError(error: unknown) {
  if (isOfficeDenied(error)) window.dispatchEvent(new Event(officeDeniedEvent));
}
const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onOfficeError }),
  mutationCache: new MutationCache({ onError: onOfficeError }),
  defaultOptions: { queries: { staleTime: 15_000, retry: (count, error) => !isOfficeDenied(error) && count < 1, refetchOnWindowFocus: true } },
});
export const OfficeAccessContext = createContext<{ denied: boolean; restore: () => void }>({ denied: false, restore: () => {} });
export function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}
// The public skeleton: same markup as portal-ui's LoadingBlock, kept here so
// the entry does not import portal-ui (which pulls in Clerk).
function LoadingBlock() { return <div className="surface space-y-4 p-6" aria-label="جارٍ تحميل البيانات"><div className="skeleton h-6 w-1/3"/><div className="skeleton h-16 w-full"/><div className="skeleton h-16 w-full"/><div className="skeleton h-16 w-3/4"/></div>; }

function OfficeAccessProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [denied, setDenied] = useState(false);
  const lastRole = useRef<string | null>(null);
  const lock = () => {
    setDenied(true);
    // clear() also detaches in-flight queries, preventing a late response from
    // putting another customer's details back on screen after access is revoked.
    qc.clear();
  };
  useEffect(() => {
    const onDenied = () => lock();
    const onAuthChanged = () => { lastRole.current = null; setDenied(false); };
    window.addEventListener(officeDeniedEvent, onDenied);
    window.addEventListener(authChangedEvent, onAuthChanged);
    const unsubscribe = qc.getQueryCache().subscribe(event => {
      if (event.type !== 'updated' || event.query.queryHash !== JSON.stringify(getGetPortalMeQueryKey()) || event.action.type !== 'success') return;
      const role = (event.query.state.data as { role?: string } | undefined)?.role ?? null;
      if (lastRole.current === 'staff' && role !== 'staff') window.dispatchEvent(new Event(officeDeniedEvent));
      lastRole.current = role;
    });
    return () => { window.removeEventListener(officeDeniedEvent, onDenied); window.removeEventListener(authChangedEvent, onAuthChanged); unsubscribe(); };
  }, [qc]);
  const restore = () => { setDenied(false); lastRole.current = null; };
  return <OfficeAccessContext.Provider value={{ denied, restore }}>{children}</OfficeAccessContext.Provider>;
}
export function Missing() { return <NotFound/>; }
const isPublicPath = (location: string) => location === '/' || location === '/services' || location.startsWith('/services/') || location === '/trust' || location === '/help' || location === '/privacy' || location === '/terms';
const isPortalPath = (location: string) => ['/registration', '/dashboard', '/requests', '/inquiries', '/messages', '/documents', '/settings', '/notifications', '/company', '/office'].some((p) => location === p || location.startsWith(p + '/'));
const routeTitles: Record<string,string> = {'/':'الرئيسية','/services':'دليل الخدمات','/trust':'الخصوصية والأمان','/help':'المساعدة','/privacy':'سياسة الخصوصية','/terms':'شروط الاستخدام','/registration':'طلب التسجيل','/dashboard':'نظرة عامة','/requests':'طلباتي','/requests/new':'طلب جديد','/inquiries':'استفساراتي','/messages':'الرسائل','/office/messages':'الرسائل','/office':'مساحة المكتب','/office/registrations':'طلبات التسجيل','/office/requests':'طلبات العملاء','/office/inquiries':'استفسارات العملاء','/office/legacy':'الأرشيف القديم','/office/staff':'فريق المكتب','/office/audit':'سجل التدقيق','/documents':'تنبيهات وثائقي','/settings':'الإعدادات','/notifications':'الإشعارات','/office/notifications':'الإشعارات','/office/whatsapp':'واتساب الوارد','/office/reminders':'وثائق تنتهي قريبًا','/office/catalog':'الأسعار والمتطلبات','/office/reports':'التقارير','/company':'ملف المنشأة','/office/customers':'ملفات العملاء','/office/plans':'الباقات','/office/subscriptions':'الاشتراكات'};
const isAuthPath = (location: string) => location.startsWith('/sign-in') || location.startsWith('/sign-up');
const staleJsonLdTypes = new Set(['BreadcrumbList', 'Service', 'WebSite', 'FAQPage']);
function Routes() {
  const [location]=useLocation();
  // The route the document was served for (null before the first effect, '' once its static JSON-LD is gone).
  const landed = useRef<string | null>(null);
  // A session cookie hint stands in for Clerk's isSignedIn on public routes;
  // it only decides which tree to show, the shell still verifies the session.
  const isSignedIn = hasSessionHint();
  // One backdrop across public, auth and portal routes; changing the variant
  // preserves the active scene without restarting it on navigation.
  const sceneVariant = location === '/' && !isSignedIn ? 'full'
    : location.startsWith('/sign-in') || location.startsWith('/sign-up') ? 'full'
    : isPublicPath(location) ? 'band' : isPortalPath(location) ? 'portal' : 'full';
  useEffect(()=>{
    const title = routeTitles[location] || (location.startsWith('/services/')?(serviceBySlug[location.slice(10)]?.name ?? 'الخدمة'):location.startsWith('/requests/')?'تفاصيل الطلب':location.startsWith('/inquiries/')?'الاستفسار':location.startsWith('/office/customers/')?'ملف عميل':location.startsWith('/office/requests/')?'طلب عميل':location.startsWith('/sign-in')?'تسجيل الدخول':location.startsWith('/sign-up')?'إنشاء حساب':'الصفحة غير موجودة');
    document.title=`${title} | HBS حلول الغد`;
    const service = location.startsWith('/services/') ? serviceBySlug[location.slice(10)] : undefined;
    // A service address that does not exist is a "not found" page: keep it out of search results.
    const isPublic = isPublicPath(location) && !(location.startsWith('/services/') && !service);
    document.querySelector('meta[name="robots"]')?.setAttribute('content', isPublic ? 'index, follow' : 'noindex, nofollow');
    const description = location === '/'
      ? 'HBS حلول الغد: مكتب يتابع التزام منشأتك ومؤشراتها في المنصات ويعالج الملاحظات، وترى كل طلب بحالته من حسابك.'
      : service ? `${service.summary} اطلبها من HBS حلول الغد وتابع حالتها من حسابك.`
      : location.startsWith('/services') ? 'دليل خدمات حلول الغد: التزام المنشأة من إقامات ورخص وعقود، ومؤشرات المنشأة في قوى ومُدد والتأمينات، ومعالجة الملاحظات، وما يفيد أن تكتبه في طلبك.'
      : location === '/privacy' ? 'تعرّف على بيانات بوابة HBS حلول الغد، بما فيها مرفقات الطلبات، وكيفية حفظها ومشاركتها وحقوقك.'
      : location === '/terms' ? 'شروط استخدام موقع HBS حلول الغد وبوابة العملاء، والطلبات والمرفقات والمساعدة الآلية.'
      : location === '/help' ? 'إجابات عن إرسال الملاحظة ومتابعة معالجتها، وتنبيهات الوثائق، وحالات الطلب في بوابة HBS حلول الغد، مع وسائل التواصل مع المكتب.'
      : location === '/trust' ? 'كيف تحفظ بوابة HBS حلول الغد طلباتك وملاحظاتك ومستندات منشأتك، ومن يطّلع عليها، وما لا يطلبه المكتب منك.'
      : `${title} في بوابة HBS حلول الغد.`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', description);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', `${title} | HBS حلول الغد`);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', description);
    document.querySelector('meta[name="twitter:title"]')?.setAttribute('content', `${title} | HBS حلول الغد`);
    document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', description);
    // Canonical URL without query strings, on the site host, for public pages only.
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (isPublic) {
      if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.appendChild(canonical); }
      canonical.href = `${siteUrl}${basePath}${location === '/' ? '/' : location}`;
      document.querySelector('meta[property="og:url"]')?.setAttribute('content', canonical.href);
    } else {
      canonical?.remove();
      document.querySelector('meta[property="og:url"]')?.removeAttribute('content');
    }
    // The prerendered page shipped structured data for the route it was built
    // for (un-id'd scripts; scripts/prerender.mjs). They describe that page
    // only, so the first client-side navigation drops them; the pages inject
    // their own id'd scripts (useJsonLd in pages/public.tsx). The organisation
    // block (ProfessionalService) is true on every route and stays.
    if (landed.current === null) landed.current = location;
    else if (location !== landed.current) {
      for (const script of document.querySelectorAll('script[type="application/ld+json"]:not([id])')) {
        try { if (staleJsonLdTypes.has((JSON.parse(script.textContent || 'null') as { '@type'?: string } | null)?.['@type'] ?? '')) script.remove(); } catch { /* not ours */ }
      }
      landed.current = '';
    }
  },[location]);
  // The top window: the first screen (full), the dark band (public pages) or
  // the strip above the working sheet (portal). Footers add bottom windows.
  // Portal, auth and a signed-in "/" render through the Clerk shell; public
  // routes and unknown addresses never load it.
  const portal = isPortalPath(location) || isAuthPath(location) || (location === '/' && isSignedIn);
  return <><CityScene routeKey={location} variant={sceneVariant} /><SceneWindow edge="top" className={`scene-window--top scene-window--${sceneVariant}`} /><ErrorBoundary resetKey={location}><Suspense fallback={<div dir="rtl" className="mx-auto max-w-2xl p-10"><LoadingBlock/></div>}>{portal ? <PortalShell/> : <Switch>
    <Route path="/" component={Landing}/>
    <Route path="/services" component={ServicesDirectory}/>
    <Route path="/services/:slug" component={ServiceDetail}/>
    <Route path="/trust" component={TrustPage}/>
    <Route path="/help" component={HelpPage}/>
    <Route path="/privacy" component={PrivacyPage}/>
    <Route path="/terms" component={TermsPage}/>
    <Route component={Missing}/>
  </Switch>}</Suspense></ErrorBoundary></>;
}
function App() { return <WouterRouter base={basePath}><QueryClientProvider client={queryClient}><OfficeAccessProvider><Routes/></OfficeAccessProvider></QueryClientProvider></WouterRouter>; }
export default App;
