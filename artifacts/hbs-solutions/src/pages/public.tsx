import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, useLocation, useParams, useSearch } from 'wouter';
import { ArrowLeft, ArrowRight, BookUser, BriefcaseBusiness, Building2, CircleHelp, FileText, Hash, History, Info, KeyRound, LayoutGrid, MessageSquareText, MessagesSquare, Search, ShieldCheck, Shapes, UserRoundCheck } from 'lucide-react';
import { PublicPage } from '@/components/site-chrome';
import { siteUrl } from '@/App';
import { prefersReducedMotion, stagger, useActiveChapter } from '@/lib/motion';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ContactCard } from '@/components/contact-card';
import { ServiceDiscovery } from '@/components/service-discovery';
import { ServiceOffer } from '@/components/service-offer';
import { categories, categoryById, platforms, searchServices, serviceBySlug, services, type ServiceCategory, type ServiceEntry } from '@/content/services';
import { faqs, portalFlow, problemHref, problems, trustFacts } from '@/content/site';
import { contact } from '@/content/contact';
import { milestones, pauses } from '@/content/milestones';
import { formatNumber } from '@/lib/format';
import './public.css';

const ICON = 1.75;
const categoryIcons: Record<ServiceCategory, typeof BookUser> = { passports: BookUser, labor: BriefcaseBusiness, business: Building2, other: Shapes };
const resultsLabel = (n: number) => (n === 0 ? 'لا توجد نتائج' : n === 1 ? 'خدمة واحدة' : n === 2 ? 'خدمتان' : n <= 10 ? `${n} خدمات` : `${n} خدمة`);

function PageIntro({ kicker, title, text }: { kicker?: string; title: string; text?: string }) {
  return (
    <header className="pub-intro">
      {kicker && <p className="eyebrow">{kicker}</p>}
      <h1 className="display">{title}</h1>
      {text && <p className="pub-intro-lead">{text}</p>}
    </header>
  );
}

// The four portal milestones (content/milestones.ts); the pauses are named below them.
const pauseNote = `قد يتوقف الطلب عند المراجعة بحالة «${pauses.waiting_on_customer.label}» إن احتاج المكتب معلومة أو مستندًا منك، أو «${pauses.awaiting_payment.label}» حتى تسدَّد الفاتورة، ثم يتابع مساره.`;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const ORG = 'HBS حلول الغد';

// Structured data for crawlers that run scripts. The build prerenders the same
// objects (same shapes: scripts/prerender.mjs) statically into each service
// page, so on the page the visitor landed on a static script of the same @type
// is left alone and nothing is doubled. After the first client-side navigation
// the meta effect in App.tsx drops the static scripts, and from then on the
// runtime ones are always injected.
const landedPath = typeof window === 'undefined' ? '' : window.location.pathname;
const hasStaticJsonLd = (type: string) => window.location.pathname === landedPath && [...document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]:not([id])')].some((script) => {
  try { return (JSON.parse(script.textContent || 'null') as { '@type'?: string } | null)?.['@type'] === type; } catch { return false; }
});
function useJsonLd(id: string, data: Record<string, unknown> | null) {
  const json = data ? JSON.stringify(data) : null;
  const type = typeof data?.['@type'] === 'string' ? (data['@type'] as string) : '';
  useEffect(() => {
    const existing = document.getElementById(id);
    if (!json || (type && hasStaticJsonLd(type))) { existing?.remove(); return; }
    const script = existing instanceof HTMLScriptElement ? existing : document.createElement('script');
    script.type = 'application/ld+json';
    script.id = id;
    script.textContent = json;
    if (!script.isConnected) document.head.appendChild(script);
    return () => { script.remove(); };
  }, [id, json]);
}

// Public URL of a route, without query string; used only in structured data.
// Built from the site URL, not the current origin, so a preview host or the
// bare domain never leaks into the data.
const pageUrl = (path: string) => `${siteUrl}${basePath}${path}`;

// Questions and answers as a Radix accordion (ui/accordion is scanned for the
// public bundle). The first one opens by default, as the old <details> did.
function FaqAccordion({ items, compact = false }: { items: { q: string; a: string }[]; compact?: boolean }) {
  return (
    <Accordion type="single" collapsible defaultValue="faq-0" className={`pub-faq ${compact ? 'pub-faq-compact' : ''}`}>
      {items.map((item, index) => (
        <AccordionItem key={item.q} value={`faq-${index}`} className="pub-faq-item">
          <AccordionTrigger className="pub-faq-trigger">{item.q}</AccordionTrigger>
          <AccordionContent className="pub-faq-answer"><p>{item.a}</p></AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function ServiceCard({ service, index = 0 }: { service: ServiceEntry; index?: number }) {
  const Icon = categoryIcons[service.category];
  return (
    <li>
      <Link href={`/services/${service.slug}`} className="pub-service-card" style={stagger(Math.min(index, 9), 40)}>
        <span className="pub-service-cat"><Icon size={16} strokeWidth={ICON} aria-hidden="true" />{categoryById[service.category].name}</span>
        <strong>{service.name}</strong>
        {service.platform && <span className="pub-platform-name">المنصة: {service.platform}</span>}
        <span className="pub-service-summary">{service.summary}</span>
        <ArrowLeft className="pub-service-arrow" size={18} strokeWidth={ICON} aria-hidden="true" />
      </Link>
    </li>
  );
}

// Arrow keys move between the cards of a catalogue grid (Tab still walks
// them one by one). In RTL, ArrowRight is "previous" and ArrowLeft "next";
// Up/Down jump a row, using the column count measured from the first row.
function moveInGrid(event: ReactKeyboardEvent<HTMLElement>) {
  const target = event.target as HTMLElement;
  if (!target.classList.contains('pub-service-card')) return;
  const cards = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>('a.pub-service-card')];
  const index = cards.indexOf(target as HTMLAnchorElement);
  if (index < 0) return;
  const top = cards[0].offsetTop;
  const columns = Math.max(1, cards.filter((card) => card.offsetTop === top).length);
  const step: Record<string, number> = { ArrowLeft: 1, ArrowRight: -1, ArrowDown: columns, ArrowUp: -columns };
  const delta = step[event.key];
  if (delta === undefined && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : Math.min(cards.length - 1, Math.max(0, index + delta));
  cards[next]?.focus();
}

// Category tabs with roving focus (WAI-ARIA tabs): arrows move between the
// tabs, Home/End jump to the ends, and the results region is the panel.
const allTab = 'all';
function CategoryTabs({ value, onChange }: { value: ServiceCategory | null; onChange: (next: ServiceCategory | null) => void }) {
  const list = useRef<HTMLDivElement>(null);
  const items: { id: string; label: string; category: ServiceCategory | null }[] = [{ id: allTab, label: 'كل المجالات', category: null }, ...categories.map((c) => ({ id: c.id, label: c.name, category: c.id }))];
  const current = value ?? allTab;
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const tabs = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
    const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const next = event.key === 'ArrowLeft' ? index + 1 : event.key === 'ArrowRight' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const tab = tabs[(next + tabs.length) % tabs.length];
    tab.focus();
    onChange(items[(next + tabs.length) % tabs.length].category);
  }
  return (
    <div ref={list} className="pub-tabs" role="tablist" aria-label="تصفية حسب المجال" onKeyDown={onKeyDown}>
      {items.map((item) => {
        const selected = current === item.id;
        return (
          <button key={item.id} id={`tab-${item.id}`} type="button" role="tab" aria-selected={selected} aria-controls="directory-list" tabIndex={selected ? 0 : -1} onClick={() => onChange(item.category)}>
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function ServicesDirectory() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const cityPin = params.get('city');
  const [query, setQuery] = useState(params.get('q') ?? '');
  const initialCategory = categories.find((c) => c.slug === params.get('category'))?.id ?? null;
  const [category, setCategory] = useState<ServiceCategory | null>(initialCategory);
  const [platform, setPlatform] = useState(platforms.includes(params.get('platform') ?? '') ? params.get('platform') : null);
  const results = useMemo(() => searchServices(query, category, platform), [query, category, platform]);
  const searchField = useRef<HTMLInputElement>(null);
  const scrollTo = (el: Element | null) => el?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  // Arriving with a query or filter (the hero search, a shared link): the
  // search field and its results sit below the wizard, so bring them up and put
  // the cursor in the field; a plain visit keeps the page at the top.
  useEffect(() => {
    if (!(params.get('q') || params.get('category') || params.get('platform'))) return;
    requestAnimationFrame(() => { scrollTo(document.getElementById('directory-tools')); searchField.current?.focus({ preventScroll: true }); });
    // Only on mount: the URL is kept in sync below without re-running this.
  }, []);

  // Keep the URL shareable without adding a history entry per keystroke.
  useEffect(() => {
    const next = new URLSearchParams();
    if (query.trim()) next.set('q', query.trim());
    if (category) next.set('category', categoryById[category].slug);
    if (platform) next.set('platform', platform);
    if (cityPin && ['riyadh', 'jeddah', 'jazan'].includes(cityPin)) next.set('city', cityPin);
    const qs = next.toString();
    navigate(qs ? `/services?${qs}` : '/services', { replace: true });
  }, [query, category, platform, cityPin, navigate]);

  return (
    <PublicPage intro={<PageIntro kicker="دليل الخدمات" title="ما الخدمة التي تحتاجها؟" text="ابحث باسم المعاملة أو المنصة، أو ابدأ من مشكلتك: وثيقة تنتهي قريبًا، أو مؤشر تغيّر، أو ملاحظة وصلتك. يستقبل المكتب طلبك ويراجع إمكانية المساعدة قبل البدء." />}>
      {/* On phones the toolbar comes first (CSS order): the search is the primary tool, the wizard an alternative. The toolbar sticks under the header while the catalogue scrolls. */}
      <div className="site-wrap pub-page pub-directory">
        <div className="pub-directory-top">
          <ServiceDiscovery onViewAllMatches={({ query: nextQuery, category: nextCategory, platform: nextPlatform }) => {
            setQuery(nextQuery);
            setCategory(nextCategory);
            setPlatform(nextPlatform);
            requestAnimationFrame(() => scrollTo(document.getElementById('directory-results')));
          }} />
        </div>
        <div id="directory-tools" className="pub-toolbar">
          <div className="pub-toolbar-row">
            <label className="pub-search">
              <span className="sr-only">ابحث في الخدمات</span>
              <Search size={19} strokeWidth={ICON} aria-hidden="true" />
              <input ref={searchField} type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') scrollTo(document.getElementById('directory-results')); }} placeholder="ابحث: إقامة، سجل تجاري، تأمينات" autoComplete="off" />
            </label>
            <label className="pub-platform-filter" htmlFor="platform-filter">
              <span>المنصة</span>
              <select id="platform-filter" value={platform ?? ''} onChange={(event) => setPlatform(event.target.value || null)}>
                <option value="">كل المنصات</option>
                {platforms.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          </div>
          <CategoryTabs value={category} onChange={setCategory} />
        </div>
        <p className="pub-directory-intro">يجمع هذا الدليل الخدمات التي يقدّمها {ORG}، مكتب خدمات عامة في {contact.city}، للمنشآت والأفراد. أكثر ما يصل المكتب ثلاث مشاكل: التزام المنشأة، حين تنتهي إقامات ورخص وعقود وتأمينات في تواريخ متفرقة ويوقف تأخير واحدة منها معاملة أخرى؛ ومؤشرات المنشأة في قوى ومُدد والتأمينات، حين يتغير النطاق أو مؤشر الالتزام دون أن تعرف السبب؛ ومعالجة الملاحظات، سواء كانت ملاحظة على ملف الأجور أو من زيارة تفتيشية أو رفضًا في منصة. تفتح كل خدمة صفحة توضح متى تحتاجها وما يفيد أن تكتبه في طلبك، ثم ترسل الطلب من حسابك ويتابعه المكتب معك حتى «مكتملة».</p>
        <p className="pub-directory-intro">
          {problems.map((problem, index) => (
            <span key={problem.key}>
              {index > 0 && ' · '}
              <strong>{problem.title}:</strong> {problem.approach} <Link href={problemHref[problem.key]}>{problem.cta}</Link>
            </span>
          ))}
        </p>
        <p id="directory-results" className="pub-count" role="status" aria-live="polite"><LayoutGrid size={15} strokeWidth={ICON} aria-hidden="true" />{resultsLabel(results.length)} · طلب الخدمة عبر المكتب بعد مراجعة الحالة، وليس ربطًا مباشرًا بالمنصة.</p>
        <div id="directory-list" role="tabpanel" aria-labelledby={`tab-${category ?? allTab}`}>
        {results.length ? (
          <div className="pub-groups">
            {categories.map((group) => {
              const items = results.filter((service) => service.category === group.id);
              if (!items.length) return null;
              const Icon = categoryIcons[group.id];
              return (
                <section key={group.id} className="pub-group" aria-labelledby={`group-${group.slug}`}>
                  <div className="pub-group-head">
                    <span className="pub-group-icon"><Icon size={18} strokeWidth={ICON} aria-hidden="true" /></span>
                    <div>
                      <h2 id={`group-${group.slug}`} className="display">{group.name}</h2>
                      <p>{group.description} <span className="pub-group-count">{resultsLabel(items.length)}</span></p>
                    </div>
                  </div>
                  <ul className="pub-service-grid" onKeyDown={moveInGrid}>
                    {items.map((service, index) => <ServiceCard key={service.slug} service={service} index={index} />)}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="surface pub-empty">
            <Search size={28} strokeWidth={1.5} aria-hidden="true" />
            <h2 className="display">لم نجد خدمة بهذا الاسم</h2>
            <p>جرّب كلمة أخرى، أو اختر «خدمة غير مدرجة» وصِف ما تحتاجه.</p>
            <Link href="/services/other-service" className="btn btn-primary">خدمة غير مدرجة</Link>
          </div>
        )}
        </div>
      </div>
    </PublicPage>
  );
}

export function ServiceDetail() {
  const { slug } = useParams<{ slug: string }>();
  const service = serviceBySlug[slug ?? ''];
  const category = service ? categoryById[service.category] : undefined;
  const path = service ? `/services/${service.slug}` : '';

  // Breadcrumbs, the service itself and its FAQ, in the shape the build emits
  // (buildPages in scripts/prerender.mjs): home → directory → service, and the
  // category as the serviceType.
  useJsonLd('ld-breadcrumbs', service && category ? {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'الرئيسية', item: pageUrl('/') },
      { '@type': 'ListItem', position: 2, name: 'دليل الخدمات', item: pageUrl('/services') },
      { '@type': 'ListItem', position: 3, name: service.name, item: pageUrl(path) },
    ],
  } : null);
  useJsonLd('ld-service', service && category ? {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: service.name,
    description: service.summary,
    url: pageUrl(path),
    serviceType: category.name,
    inLanguage: 'ar',
    areaServed: { '@type': 'City', name: contact.city, containedInPlace: { '@type': 'Country', name: 'SA' } },
    provider: { '@type': 'ProfessionalService', name: ORG },
  } : null);
  useJsonLd('ld-faq', service ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: service.faq.map((item) => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })),
  } : null);

  const related = service ? (service.related ?? []).map((s) => serviceBySlug[s]).filter(Boolean) : [];
  // In-page contents (desktop sidebar): the article's sections, in order. The
  // one crossing the middle of the screen is marked as current.
  const toc = [
    { id: 'write-title', label: 'ما يفيد أن تكتبه في طلبك' },
    { id: 'flow-title', label: 'كيف تتم الخدمة عبر البوابة' },
    { id: 'faq-title', label: 'أسئلة شائعة' },
    ...(related.length ? [{ id: 'related-title', label: 'خدمات ذات صلة' }] : []),
  ];
  const chapters = useActiveChapter(toc.length);

  if (!service || !category) {
    return (
      <PublicPage intro={<PageIntro kicker="دليل الخدمات" title="الخدمة غير موجودة" text="قد يكون الرابط قديمًا. تصفّح دليل الخدمات للعثور على ما تحتاجه." />}>
        <div className="site-wrap pub-page">
        <div className="surface pub-empty">
            <CircleHelp size={28} strokeWidth={1.5} aria-hidden="true" />
            <h2 className="display">لم نعثر على هذه الخدمة</h2>
            <p>قد يكون الرابط قديمًا. ابحث عن الخدمة في الدليل.</p>
            <Link href="/services" className="btn btn-primary">دليل الخدمات</Link>
          </div>
        </div>
      </PublicPage>
    );
  }
  const Icon = categoryIcons[service.category];
  const samePlatform = services.filter((s) => s.platform && s.platform === service.platform && s.slug !== service.slug && !related.includes(s)).slice(0, 3);
  const steps = service.steps ?? portalFlow;
  const startHref = `/requests/new?service=${service.slug}`;

  const intro = (
    <div className="pub-intro">
      <nav aria-label="مسار التنقل" className="pub-crumbs">
        <Link href="/services">دليل الخدمات</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/services?category=${category.slug}`}>{category.name}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{service.name}</span>
      </nav>
      <span className="pub-service-cat"><Icon size={16} strokeWidth={ICON} aria-hidden="true" />{category.name}</span>
      <h1 className="display pub-detail-title">{service.name}</h1>
      {service.platform && <p className="pub-detail-platform">المنصة ذات الصلة: {service.platform}</p>}
      <p className="pub-detail-lead">{service.summary}</p>
    </div>
  );
  return (
    <PublicPage intro={intro}>
      <div className="site-wrap pub-page">
        <div className="pub-split">
          <div className="pub-detail-main">
            {/* On phones the sidebar lands below everything, so the same action sits right under the title band, inside the first screen even for long intros. */}
            <p className="pub-cta-inline">
              <Link href={startHref} className="btn btn-primary">ابدأ الطلب <ArrowLeft size={17} strokeWidth={ICON} aria-hidden="true" /></Link>
              <span>يلزم حساب معتمد من المكتب.</span>
            </p>
            <p className="pub-detail-intro">{service.intro}</p>
            <ServiceOffer slug={service.slug} />
            <section className="surface pub-block" aria-labelledby="write-title" ref={chapters.register(0)}>
              <h2 id="write-title" className="display"><FileText size={20} strokeWidth={ICON} aria-hidden="true" />ما يفيد أن تكتبه في طلبك</h2>
              <ul className="pub-checklist">
                {service.whatToWrite.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <p className="pub-note"><Info size={16} strokeWidth={ICON} aria-hidden="true" />هذه إرشادات لوصف حالتك، لا قائمة مستندات رسمية. يحدد المكتب ما يحتاجه من معلومات أو مستندات بعد مراجعة طلبك.</p>
            </section>

            <section className="surface pub-block" aria-labelledby="flow-title" ref={chapters.register(1)}>
              <h2 id="flow-title" className="display"><History size={20} strokeWidth={ICON} aria-hidden="true" />كيف تتم الخدمة عبر البوابة</h2>
              <ol className="pub-flow-list">
                {steps.map((step, index) => (
                  <li key={step}>
                    <span className="pub-step-num" aria-hidden="true">{formatNumber(index + 1)}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <p className="pub-milestones" aria-label="حالات الطلب كما تظهر في حسابك">
                <span>الحالات التي تراها في حسابك:</span>
                {milestones.map((step, index) => (
                  <span key={step.key} className="pub-milestone">{index > 0 && <ArrowLeft size={13} strokeWidth={ICON} aria-hidden="true" />}<strong>{step.label}</strong></span>
                ))}
              </p>
              <p className="pub-note"><Info size={16} strokeWidth={ICON} aria-hidden="true" />{pauseNote}</p>
            </section>

            <section className="surface pub-block" aria-labelledby="faq-title" ref={chapters.register(2)}>
              <h2 id="faq-title" className="display"><MessagesSquare size={20} strokeWidth={ICON} aria-hidden="true" />أسئلة شائعة</h2>
              <FaqAccordion items={service.faq} compact />
            </section>

            {related.length > 0 && (
              <section className="pub-related-block" aria-labelledby="related-title" ref={chapters.register(3)}>
                <h2 id="related-title" className="display">خدمات ذات صلة</h2>
                <ul className="pub-service-grid pub-related-grid" onKeyDown={moveInGrid}>
                  {related.map((s, index) => <ServiceCard key={s.slug} service={s} index={index} />)}
                </ul>
              </section>
            )}
          </div>

          <aside className="pub-aside">
            <div className="pub-cta">
              <h2 className="display">ابدأ هذا الطلب</h2>
              <p>يُفتح النموذج واسم الخدمة معبّأ. يلزم حساب معتمد من المكتب، ولا يطلب المكتب كلمات مرور المنصات أو رموز التحقق.</p>
              <Link href={startHref} className="btn btn-light">ابدأ الطلب <ArrowLeft size={17} strokeWidth={ICON} aria-hidden="true" /></Link>
              <Link href="/sign-up" className="pub-cta-link">لا أملك حسابًا: طلب التسجيل</Link>
            </div>
            <nav className="pub-toc" aria-label="محتويات الصفحة">
              <p>المحتويات</p>
              <ol>
                {toc.map((entry, index) => (
                  <li key={entry.id}><a href={`#${entry.id}`} aria-current={chapters.active === index ? 'location' : undefined}>{entry.label}</a></li>
                ))}
              </ol>
            </nav>
            {samePlatform.length > 0 && (
              <div className="pub-related">
                <h2>خدمات أخرى عبر {service.platform}</h2>
                <ul>
                  {samePlatform.map((s) => <li key={s.slug}><Link href={`/services/${s.slug}`}>{s.name}<ArrowLeft size={15} strokeWidth={ICON} aria-hidden="true" /></Link></li>)}
                </ul>
              </div>
            )}
          </aside>
        </div>
        <Link href="/services" className="pub-back"><ArrowRight size={16} strokeWidth={ICON} aria-hidden="true" />العودة إلى دليل الخدمات</Link>
      </div>
    </PublicPage>
  );
}

export function TrustPage() {
  const icons = [ShieldCheck, History, Hash];
  const facts = [
    ...trustFacts.map((fact, i) => ({ ...fact, Icon: icons[i] ?? ShieldCheck })),
    { title: 'حسابات يراجعها المكتب', text: 'يُنشأ الحساب بالبريد الإلكتروني بعد تأكيده، ولا تُتاح الخدمات إلا بعد موافقة المكتب على طلب التسجيل. ما ترسله عن منشأتك، من ملاحظة أو وثيقة أو بيانات ملف المنشأة، يبقى داخل حسابك.', Icon: UserRoundCheck },
    { title: 'المساعد الآلي لا يرى طلباتك', text: 'يُرسل نص السؤال ومقتطفات من المعلومات المنشورة ذات الصلة إلى مزوّد المساعدة الآلية؛ لا تُرسل بيانات حسابك أو سجلات طلباتك ولا نص الملاحظات التي أرسلتها. لا تكتب معلومات حساسة، واسأل عن طلب بعينه من صفحته.', Icon: MessageSquareText },
  ];
  return (
    <PublicPage intro={<PageIntro kicker="الخصوصية والأمان" title="كيف نتعامل مع طلباتك" text="ملاحظة على ملف الأجور، أو رخصة تنتهي، أو مؤشر تغيّر: كل ما ترسله عن منشأتك يبقى في حسابك، ويراه فريق المكتب المخوّل وحده. هنا ما يحدث له، ومن يراه، وما لا يطلبه المكتب منك." />}>
      <div className="site-wrap pub-page pub-split">
        <ul className="surface pub-facts">
          {facts.map(({ title, text, Icon }, index) => (
            <li key={title} style={stagger(index, 60)}>
              <span className="pub-fact-icon"><Icon size={20} strokeWidth={ICON} aria-hidden="true" /></span>
              <div><h2 className="display">{title}</h2><p>{text}</p></div>
            </li>
          ))}
        </ul>
        <aside className="pub-aside">
          <section className="pub-warn" aria-labelledby="warn-title">
            <h2 id="warn-title" className="display"><KeyRound size={20} strokeWidth={ICON} aria-hidden="true" />لا تشارك كلمات المرور</h2>
            <p>لا تكتب كلمات مرور المنصات الحكومية أو رموز التحقق في الطلبات أو الاستفسارات، حتى لمعالجة ملاحظة عاجلة. إن احتاج المكتب معلومة أو مستندًا، طلبه منك داخل طلبك بحالة «بانتظار العميل»، وترفعه من قائمة المستندات في صفحة الطلب.</p>
          </section>
        </aside>
      </div>
    </PublicPage>
  );
}

export function HelpPage() {
  return (
    <PublicPage intro={<PageIntro kicker="المساعدة" title="الأسئلة الشائعة" text="وصلتك ملاحظة ولا تعرف ماذا ترسل؟ تغيّر مؤشر منشأتك؟ وثيقة تنتهي قريبًا؟ هنا إجابات قصيرة عن ذلك وعن حالات الطلب في البوابة." />}>
      <div className="site-wrap pub-page pub-split">
        {/* Native disclosure here, not the accordion: Radix's header is an h3, and this page has no h2 above the questions. */}
        <div className="pub-faq">
          {faqs.map((faq, i) => (
            <details key={faq.question} className="pub-faq-item" open={i === 0} style={stagger(Math.min(i, 9), 40)}>
              <summary>{faq.question}</summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
        <aside className="pub-aside">
          <section className="pub-help-cta" aria-labelledby="contact-title">
            <h2 id="contact-title" className="display">لم تجد إجابتك؟</h2>
            <p>إن كانت لديك ملاحظة أو وثيقة تحتاج تجديدًا، أرسلها كما وصلتك في طلب جديد ويحدد المكتب ما يلزم. وللسؤال العام أرسل استفسارًا من حسابك، ويصلك رد المكتب في المكان نفسه.</p>
            <div className="pub-help-actions">
              <Link href="/requests/new" className="btn btn-primary">أرسل الملاحظة</Link>
              <Link href="/inquiries" className="btn btn-outline">استفساراتي</Link>
              <Link href="/sign-up" className="btn btn-outline">طلب التسجيل</Link>
            </div>
          </section>
          <ContactCard />
        </aside>
      </div>
    </PublicPage>
  );
}
