import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams, useSearch } from 'wouter';
import { ArrowLeft, BookUser, BriefcaseBusiness, Building2, CircleHelp, FileText, Hash, History, Info, KeyRound, MessageSquareText, Search, ShieldCheck, Shapes, UserRoundCheck } from 'lucide-react';
import { PublicPage } from '@/components/site-chrome';
import { categories, categoryById, searchServices, serviceBySlug, services, type ServiceCategory } from '@/content/services';
import { faqs, trustFacts } from '@/content/site';
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

// The four real portal statuses, with what each means for the customer.
const statusSteps = [
  { label: 'تم الاستلام', text: 'يصلك رقم مرجعي فور الإرسال.' },
  { label: 'قيد المراجعة', text: 'يعمل المكتب على طلبك ويحدّث حالته.' },
  { label: 'بانتظار العميل', text: 'يحتاج المكتب معلومة منك، ويظهر لك تنبيه.' },
  { label: 'مكتملة', text: 'انتهى الطلب ويبقى في سجلك.' },
];

export function ServicesDirectory() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const [query, setQuery] = useState(params.get('q') ?? '');
  const initialCategory = categories.find((c) => c.slug === params.get('category'))?.id ?? null;
  const [category, setCategory] = useState<ServiceCategory | null>(initialCategory);
  const results = useMemo(() => searchServices(query, category), [query, category]);

  // Keep the URL shareable without adding a history entry per keystroke.
  useEffect(() => {
    const next = new URLSearchParams();
    if (query.trim()) next.set('q', query.trim());
    if (category) next.set('category', categoryById[category].slug);
    const qs = next.toString();
    navigate(qs ? `/services?${qs}` : '/services', { replace: true });
  }, [query, category, navigate]);

  return (
    <PublicPage intro={<PageIntro kicker="دليل الخدمات" title="ما الخدمة التي تحتاجها؟" text="ابحث بالاسم أو اختر المجال، وستجد في كل خدمة ما يفيد أن تكتبه في طلبك." />}>
      <div className="site-wrap pub-page">
        <div className="pub-toolbar">
          <label className="pub-search">
            <span className="sr-only">ابحث في الخدمات</span>
            <Search size={19} strokeWidth={ICON} aria-hidden="true" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث: إقامة، سجل تجاري، تأمينات" autoComplete="off" />
          </label>
          <div className="pub-chips" role="group" aria-label="تصفية حسب المجال">
            <button type="button" aria-pressed={category === null} onClick={() => setCategory(null)}>كل المجالات</button>
            {categories.map((c) => (
              <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(category === c.id ? null : c.id)}>{c.name}</button>
            ))}
          </div>
        </div>
        <p className="pub-count" role="status" aria-live="polite">{resultsLabel(results.length)}</p>
        {results.length ? (
          <ul className="pub-service-grid">
            {results.map((service) => {
              const Icon = categoryIcons[service.category];
              return (
                <li key={service.slug}>
                  <Link href={`/services/${service.slug}`} className="pub-service-card">
                    <span className="pub-service-cat"><Icon size={16} strokeWidth={ICON} aria-hidden="true" />{categoryById[service.category].name}</span>
                    <strong>{service.name}</strong>
                    <span className="pub-service-summary">{service.summary}</span>
                    <ArrowLeft className="pub-service-arrow" size={18} strokeWidth={ICON} aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="surface pub-empty">
            <Search size={28} strokeWidth={1.5} aria-hidden="true" />
            <h2 className="display">لم نجد خدمة بهذا الاسم</h2>
            <p>جرّب كلمة أخرى، أو اختر «خدمة غير مدرجة» وصِف ما تحتاجه.</p>
            <Link href="/services/other-service" className="btn btn-primary">خدمة غير مدرجة</Link>
          </div>
        )}
      </div>
    </PublicPage>
  );
}

export function ServiceDetail() {
  const { slug } = useParams<{ slug: string }>();
  const service = serviceBySlug[slug ?? ''];
  if (!service) {
    return (
      <PublicPage intro={<PageIntro kicker="دليل الخدمات" title="الخدمة غير موجودة" />}>
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
  const category = categoryById[service.category];
  const related = services.filter((s) => s.category === service.category && s.slug !== service.slug).slice(0, 3);

  const intro = (
    <div className="pub-intro">
        <nav aria-label="مسار التنقل" className="pub-crumbs">
          <Link href="/services">دليل الخدمات</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/services?category=${category.slug}`}>{category.name}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{service.name}</span>
        </nav>
            <h1 className="display pub-detail-title">{service.name}</h1>
            <p className="pub-detail-lead">{service.summary}</p>
    </div>
  );
  return (
    <PublicPage intro={intro}>
      <div className="site-wrap pub-page">
        <div className="pub-split">
          <div className="pub-detail-main">

            <section className="surface pub-block" aria-labelledby="write-title">
              <h2 id="write-title" className="display"><FileText size={20} strokeWidth={ICON} aria-hidden="true" />ما يفيد أن تكتبه في طلبك</h2>
              <ul className="pub-checklist">
                {service.whatToWrite.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <p className="pub-note"><Info size={16} strokeWidth={ICON} aria-hidden="true" />إرشادات لوصف حالتك، وليست قائمة مستندات رسمية. لا يدعم النموذج رفع الملفات حاليًا.</p>
            </section>

            <section className="surface pub-block" aria-labelledby="flow-title">
              <h2 id="flow-title" className="display"><History size={20} strokeWidth={ICON} aria-hidden="true" />مراحل الطلب</h2>
              <ol className="pub-steps">
                {statusSteps.map((step, index) => (
                  <li key={step.label}>
                    <span className="pub-step-num" aria-hidden="true">{index + 1}</span>
                    <strong>{step.label}</strong>
                    <span>{step.text}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <aside className="pub-aside">
            <div className="pub-cta">
              <h2 className="display">ابدأ هذا الطلب</h2>
              <p>يُفتح النموذج واسم الخدمة معبّأ. يلزم حساب معتمد من المكتب.</p>
              <Link href={`/requests/new?service=${service.slug}`} className="btn btn-light">ابدأ الطلب <ArrowLeft size={17} strokeWidth={ICON} aria-hidden="true" /></Link>
              <Link href="/sign-up" className="pub-cta-link">ليس لديك حساب؟ طلب التسجيل</Link>
            </div>
            {related.length > 0 && (
              <div className="pub-related">
                <h2>خدمات أخرى في {category.name}</h2>
                <ul>
                  {related.map((s) => <li key={s.slug}><Link href={`/services/${s.slug}`}>{s.name}<ArrowLeft size={15} strokeWidth={ICON} aria-hidden="true" /></Link></li>)}
                </ul>
              </div>
            )}
          </aside>
        </div>
      </div>
    </PublicPage>
  );
}

export function TrustPage() {
  const icons = [ShieldCheck, History, Hash];
  const facts = [
    ...trustFacts.map((fact, i) => ({ ...fact, Icon: icons[i] ?? ShieldCheck })),
    { title: 'حسابات يراجعها المكتب', text: 'يُنشأ الحساب بالبريد الإلكتروني بعد تأكيده، ولا تُتاح الخدمات إلا بعد موافقة المكتب على طلب التسجيل.', Icon: UserRoundCheck },
    { title: '«أم مشعل» لا ترى طلباتك', text: 'المساعدة الآلية تجيب عن أسئلة استخدام البوابة فقط ولا تنفّذ معاملات. للسؤال عن طلبك، أرسل استفسارًا يطّلع عليه المكتب.', Icon: MessageSquareText },
  ];
  return (
    <PublicPage intro={<PageIntro kicker="الخصوصية والأمان" title="كيف نتعامل مع طلباتك" />}>
      <div className="site-wrap pub-page pub-split">
        <ul className="surface pub-facts">
          {facts.map(({ title, text, Icon }) => (
            <li key={title}>
              <span className="pub-fact-icon"><Icon size={20} strokeWidth={ICON} aria-hidden="true" /></span>
              <div><h2 className="display">{title}</h2><p>{text}</p></div>
            </li>
          ))}
        </ul>
        <aside className="pub-aside">
          <section className="pub-warn" aria-labelledby="warn-title">
            <h2 id="warn-title" className="display"><KeyRound size={20} strokeWidth={ICON} aria-hidden="true" />لا تشارك كلمات المرور</h2>
            <p>لا تكتب كلمات مرور المنصات الحكومية أو رموز التحقق في الطلبات أو الاستفسارات. إن احتاج المكتب معلومة، طلبها منك داخل طلبك.</p>
          </section>
        </aside>
      </div>
    </PublicPage>
  );
}

export function HelpPage() {
  return (
    <PublicPage intro={<PageIntro kicker="المساعدة" title="الأسئلة الشائعة" />}>
      <div className="site-wrap pub-page pub-split">
        <div className="pub-faq">
          {faqs.map((faq, i) => (
            <details key={faq.question} className="pub-faq-item" open={i === 0}>
              <summary>{faq.question}</summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
        <aside className="pub-aside">
          <section className="pub-help-cta" aria-labelledby="contact-title">
            <h2 id="contact-title" className="display">لم تجد إجابتك؟</h2>
            <p>أرسل استفسارًا من حسابك، ويصلك رد المكتب في المكان نفسه.</p>
            <div className="pub-help-actions">
              <Link href="/inquiries" className="btn btn-primary">استفساراتي</Link>
              <Link href="/sign-up" className="btn btn-outline">طلب التسجيل</Link>
            </div>
          </section>
        </aside>
      </div>
    </PublicPage>
  );
}
