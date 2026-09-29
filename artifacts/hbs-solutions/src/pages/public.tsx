import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams, useSearch } from 'wouter';
import { ArrowLeft, ArrowRight, BookUser, BriefcaseBusiness, Building2, CircleHelp, FileText, Hash, History, Info, MessageSquareText, Search, ShieldCheck, Shapes, UserRoundCheck } from 'lucide-react';
import { PublicPage } from '@/components/site-chrome';
import { StageRail } from '@/components/request-object';
import { categories, categoryById, searchServices, serviceBySlug, services, type ServiceCategory } from '@/content/services';
import { faqs, trustFacts } from '@/content/site';
import './public.css';

const ICON = 1.75;
const categoryIcons: Record<ServiceCategory, typeof BookUser> = { passports: BookUser, labor: BriefcaseBusiness, business: Building2, other: Shapes };
const resultsLabel = (n: number) => (n === 0 ? 'لا توجد نتائج' : n === 1 ? 'خدمة واحدة' : n === 2 ? 'خدمتان' : n <= 10 ? `${n} خدمات` : `${n} خدمة`);

function PageIntro({ kicker, title, text }: { kicker: string; title: string; text: string }) {
  return (
    <header className="pub-intro">
      <p className="eyebrow">{kicker}</p>
      <h1 className="display">{title}</h1>
      <p>{text}</p>
    </header>
  );
}

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
    <PublicPage>
      <div className="site-wrap pub-page">
        <PageIntro kicker="دليل الخدمات" title="ما الخدمة التي تحتاجها؟" text="ابحث بالاسم أو اختر المجال. في صفحة كل خدمة تجد ما يفيد المكتب أن تكتبه في طلبك." />
        <div className="pub-toolbar">
          <label className="pub-search">
            <span className="sr-only">ابحث في الخدمات</span>
            <Search size={19} strokeWidth={ICON} aria-hidden="true" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="مثال: إقامة، سجل تجاري، تأمينات" autoComplete="off" />
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
                    <span className="pub-service-more">التفاصيل <ArrowLeft size={15} strokeWidth={ICON} aria-hidden="true" /></span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="surface pub-empty">
            <Search size={28} strokeWidth={1.5} aria-hidden="true" />
            <h2 className="display">لم نجد خدمة بهذا الاسم</h2>
            <p>جرّب كلمة أخرى، أو اختر «خدمة غير مدرجة» وصف ما تحتاجه، وسيراجعه المكتب.</p>
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
      <PublicPage>
        <div className="site-wrap pub-page">
          <div className="surface pub-empty">
            <CircleHelp size={28} strokeWidth={1.5} aria-hidden="true" />
            <h1 className="display">الخدمة غير موجودة</h1>
            <p>قد يكون الرابط قديمًا. تصفّح دليل الخدمات للعثور على ما تحتاجه.</p>
            <Link href="/services" className="btn btn-primary">دليل الخدمات</Link>
          </div>
        </div>
      </PublicPage>
    );
  }
  const category = categoryById[service.category];
  const Icon = categoryIcons[service.category];
  const related = services.filter((s) => s.category === service.category && s.slug !== service.slug).slice(0, 3);

  return (
    <PublicPage>
      <div className="site-wrap pub-page">
        <nav aria-label="مسار التنقل" className="pub-crumbs">
          <Link href="/services">دليل الخدمات</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/services?category=${category.slug}`}>{category.name}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{service.name}</span>
        </nav>
        <div className="pub-detail">
          <div className="pub-detail-main">
            <span className="pub-service-cat"><Icon size={16} strokeWidth={ICON} aria-hidden="true" />{category.name}</span>
            <h1 className="display pub-detail-title">{service.name}</h1>
            <p className="pub-detail-lead">{service.summary}</p>

            <section className="surface pub-block" aria-labelledby="write-title">
              <h2 id="write-title" className="display"><FileText size={20} strokeWidth={ICON} aria-hidden="true" />ما يفيد أن تكتبه في طلبك</h2>
              <ul className="pub-checklist">
                {service.whatToWrite.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <p className="pub-note"><Info size={16} strokeWidth={ICON} aria-hidden="true" />هذه إرشادات لوصف حالتك، لا قائمة مستندات رسمية. يحدد المكتب ما يحتاجه بعد مراجعة طلبك، والبوابة لا تدعم رفع الملفات حاليًا.</p>
            </section>

            <section className="surface pub-block" aria-labelledby="flow-title">
              <h2 id="flow-title" className="display"><History size={20} strokeWidth={ICON} aria-hidden="true" />كيف يسير طلبك</h2>
              <div className="pub-rail"><StageRail stage={0} tone="light" /></div>
              <ol className="pub-flow">
                <li><strong>تم الاستلام:</strong> يصل الطلب برقم مرجعي فور إرساله.</li>
                <li><strong>قيد المراجعة:</strong> يعمل المكتب على طلبك ويحدّث حالته.</li>
                <li><strong>بانتظار العميل:</strong> يحتاج المكتب معلومة منك، وتظهر لك في أعلى حسابك.</li>
                <li><strong>مكتملة:</strong> انتهى الطلب ويبقى في سجلك.</li>
              </ol>
            </section>
          </div>

          <aside className="pub-detail-aside">
            <div className="pub-cta">
              <h2 className="display">ابدأ هذا الطلب</h2>
              <p>تحتاج حسابًا معتمدًا من المكتب. إن كان لديك حساب، يفتح النموذج واسم الخدمة معبأ مسبقًا.</p>
              <Link href={`/requests/new?service=${service.slug}`} className="btn btn-light">ابدأ الطلب <ArrowLeft size={17} strokeWidth={ICON} aria-hidden="true" /></Link>
              <Link href="/sign-up" className="pub-cta-link">لا أملك حسابًا: طلب التسجيل</Link>
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
        <Link href="/services" className="pub-back"><ArrowRight size={16} strokeWidth={ICON} aria-hidden="true" />العودة إلى دليل الخدمات</Link>
      </div>
    </PublicPage>
  );
}

export function TrustPage() {
  const icons = [ShieldCheck, History, Hash];
  return (
    <PublicPage>
      <div className="site-wrap pub-page pub-narrow">
        <PageIntro kicker="الخصوصية والأمان" title="كيف نتعامل مع طلباتك" text="ما تجده هنا يصف ما تفعله البوابة فعلًا اليوم، لا وعودًا عامة." />
        <ul className="pub-facts">
          {trustFacts.map((fact, i) => {
            const Icon = icons[i] ?? ShieldCheck;
            return <li key={fact.title} className="surface"><Icon size={22} strokeWidth={ICON} aria-hidden="true" /><div><h2 className="display">{fact.title}</h2><p>{fact.text}</p></div></li>;
          })}
          <li className="surface"><UserRoundCheck size={22} strokeWidth={ICON} aria-hidden="true" /><div><h2 className="display">حسابات يراجعها المكتب</h2><p>يُنشأ الحساب بالبريد الإلكتروني بعد التحقق منه، ثم يراجع المكتب طلب التسجيل قبل إتاحة الخدمات.</p></div></li>
          <li className="surface"><MessageSquareText size={22} strokeWidth={ICON} aria-hidden="true" /><div><h2 className="display">المساعد الآلي لا يرى معاملاتك</h2><p>المساعد يجيب عن أسئلة عامة عن استخدام البوابة فقط. للسؤال عن طلبك أرسل استفسارًا يراه فريق المكتب.</p></div></li>
        </ul>
        <section className="surface pub-block">
          <h2 className="display">ما الذي لا تطلبه البوابة منك</h2>
          <p className="pub-muted">لا تشارك كلمات مرور المنصات الحكومية أو رموز التحقق في الطلبات أو الاستفسارات. إن احتاج المكتب معلومة، سيطلبها منك بوضوح في طلبك.</p>
        </section>
      </div>
    </PublicPage>
  );
}

export function HelpPage() {
  return (
    <PublicPage>
      <div className="site-wrap pub-page pub-narrow">
        <PageIntro kicker="المساعدة" title="أسئلة وإجابات" text="إن لم تجد إجابتك هنا، أرسل استفسارًا من حسابك وسيرد المكتب في المكان نفسه." />
        <div className="pub-faq">
          {faqs.map((faq, i) => (
            <details key={faq.question} className="pub-faq-item" open={i === 0}>
              <summary>{faq.question}</summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
        <section className="pub-help-cta">
          <div>
            <h2 className="display">تحتاج التواصل مع المكتب؟</h2>
            <p>التواصل يتم من داخل حسابك عبر صفحة الاستفسارات، ليبقى السؤال والرد مرتبطين بطلبك.</p>
          </div>
          <div className="pub-help-actions">
            <Link href="/inquiries" className="btn btn-primary">استفساراتي</Link>
            <Link href="/sign-up" className="btn btn-outline">طلب التسجيل</Link>
          </div>
        </section>
      </div>
    </PublicPage>
  );
}
