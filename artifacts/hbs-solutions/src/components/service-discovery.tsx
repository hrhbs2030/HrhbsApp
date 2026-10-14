import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, ArrowRight, CalendarClock, Check, Compass, FileWarning, Gauge, Search, Sparkles } from 'lucide-react';
import { categories, categoryById, platforms, searchServices, serviceBySlug, services, type ServiceCategory } from '@/content/services';
import { problemHref, problems, type Problem, type ProblemKey } from '@/content/site';
import { formatNumber } from '@/lib/format';
import './service-discovery.css';

// Problem-first entry points: the three situations an owner brings to the
// office (content/site.ts → problems), in the words they use. Each one jumps
// straight to that problem's services, so nobody has to know the field or the
// platform first. Slugs that are not in the directory are skipped.
const problemEntries: { key: ProblemKey; label: string; hint: string; icon: typeof FileWarning }[] = [
  { key: 'observations', label: 'عندي ملاحظة', hint: 'على ملف الأجور، أو من زيارة تفتيشية، أو رفض في منصة.', icon: FileWarning },
  { key: 'indicator', label: 'تغيّر المؤشر', hint: 'نطاق المنشأة أو مؤشر الالتزام تغيّر ولا تعرف السبب.', icon: Gauge },
  { key: 'compliance', label: 'وثيقة تنتهي قريبًا', hint: 'إقامة أو رخصة عمل أو رخصة بلدية أو عقد يحتاج توثيقًا.', icon: CalendarClock },
];
const problemByKey = Object.fromEntries(problems.map((problem) => [problem.key, problem])) as Record<ProblemKey, Problem>;
const problemServices = (problem: Problem) => problem.services.map((slug) => serviceBySlug[slug]).filter(Boolean);
// «ابدأ بملف منشأتك» opens the company file; the other two open a new request
// with the problem's first service pre-filled.
const problemCtaHref = (problem: Problem, firstSlug: string) => problem.key === 'compliance' ? problemHref[problem.key] : `${problemHref[problem.key]}?service=${firstSlug}`;

// Counters use the product locale (Latin digits), like the carousel and the portal.
const ofThree = (n: number) => `${formatNumber(n)} / ${formatNumber(3)}`;

// Lucide stroke mirrors --icon-stroke (index.css); standalone icons are 20–24 px, inline arrows 16–18 px.
const ICON = 1.75;
const iconSize = 20;

function ServiceLinkCard({ slug, name, summary, platform, category }: {
  slug: string; name: string; summary: string; platform?: string; category: ServiceCategory;
}) {
  return (
    <Link href={`/services/${slug}`} className="discovery-result" data-testid={`link-discovery-service-${slug}`}>
      <span className="discovery-result-top"><span>{categoryById[category].name}</span>{platform && <span>{platform}</span>}</span>
      <strong>{name}</strong>
      <span className="discovery-result-summary">{summary}</span>
      <span className="discovery-result-more">عرض تفاصيل الخدمة <ArrowLeft size={16} strokeWidth={ICON} aria-hidden="true" /></span>
    </Link>
  );
}

export function ServiceDiscovery({ onViewAllMatches }: { onViewAllMatches: (filters: { query: string; category: ServiceCategory | null; platform: string | null }) => void }) {
  const [slide, setSlide] = useState(0);
  const [step, setStep] = useState(0);
  const [category, setCategory] = useState<ServiceCategory | null>(null);
  const [platform, setPlatform] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  // Set when the person started from a problem instead of a field; the
  // results view then lists that problem's services and its own next step.
  const [problemKey, setProblemKey] = useState<ProblemKey | null>(null);
  const problem = problemKey ? problemByKey[problemKey] : null;
  const currentService = services[slide];
  const categoryPlatforms = useMemo(() => category ? [...new Set(services.filter((service) => service.category === category && service.platform).map((service) => service.platform as string))].sort((a, b) => a.localeCompare(b, 'ar')) : [], [category]);
  const matches = useMemo(() => problem ? problemServices(problem) : searchServices(description, category, platform), [category, description, platform, problem]);
  const visibleDotsStart = Math.max(0, Math.min(slide - 2, services.length - 5));

  const chooseProblem = (key: ProblemKey) => {
    setProblemKey(key);
    setCategory(null);
    setPlatform(null);
    setDescription('');
    setStep(3);
  };
  const chooseCategory = (value: ServiceCategory | null) => {
    setProblemKey(null);
    setCategory(value);
    setPlatform(null);
    setDescription('');
    const hasPlatformChoices = value !== null && services.some((service) => service.category === value && service.platform);
    setStep(hasPlatformChoices ? 1 : 2);
  };
  const choosePlatform = (value: string | null) => {
    setPlatform(value);
    setStep(2);
  };
  const resetGuide = () => {
    setStep(0);
    setProblemKey(null);
    setCategory(null);
    setPlatform(null);
    setDescription('');
  };
  const backGuide = () => {
    if (step === 3 && problem) resetGuide();
    else if (step === 3) setStep(2);
    else if (step === 2) setStep(categoryPlatforms.length ? 1 : 0);
    else setStep(0);
  };
  const goToSlide = (next: number) => setSlide((next + services.length) % services.length);

  return (
    <section className="service-discovery" aria-label="طرق استكشاف الخدمات">
      <div className="discovery-heading">
        <div>
          <p className="eyebrow">ابدأ من مشكلتك، لا من اسم الخدمة</p>
          <h2 className="display">ابدأ مما ظهر لك</h2>
          <p>ملاحظة وصلتك، أو مؤشر تغيّر، أو وثيقة تنتهي قريبًا: اخترها وسنعرض الخدمات التي يعالجها المكتب بها. أو تصفّح الدليل واحدةً تلو الأخرى.</p>
        </div>
        <span className="discovery-heading-mark" aria-hidden="true"><Compass size={24} strokeWidth={ICON} aria-hidden="true" /></span>
      </div>

      <div className="discovery-layout">
        <section className="discovery-carousel" aria-label="تصفّح الخدمات">
          <div className="discovery-carousel-head">
            <div><span className="discovery-kicker">تصفّح الدليل</span><span className="discovery-total">{formatNumber(slide + 1)} / {formatNumber(services.length)}</span></div>
            <span className="discovery-mini-label">الخدمة التالية على بعد خطوة</span>
          </div>
          <div className="discovery-slide" aria-live="polite" key={currentService.slug}>
            <div className="discovery-slide-meta">
              <span className="discovery-number">{formatNumber(slide + 1).padStart(2, '0')}</span>
              <span>{categoryById[currentService.category].name}</span>
              {currentService.platform && <span className="discovery-platform">{currentService.platform}</span>}
            </div>
            <h3 className="display">{currentService.name}</h3>
            <p>{currentService.summary}</p>
            <Link href={`/services/${currentService.slug}`} className="discovery-slide-link">تفاصيل الخدمة <ArrowLeft size={18} strokeWidth={ICON} aria-hidden="true" /></Link>
          </div>
          <div className="discovery-carousel-controls">
            <button type="button" className="discovery-arrow" onClick={() => goToSlide(slide - 1)} aria-label="الخدمة السابقة" data-testid="button-service-previous"><ArrowRight size={22} strokeWidth={ICON} aria-hidden="true" /></button>
            <div className="discovery-progress" role="progressbar" aria-label="التقدم في تصفح الخدمات" aria-valuemin={1} aria-valuemax={services.length} aria-valuenow={slide + 1}>
              <span style={{ transform: `scaleX(${(slide + 1) / services.length})` }} />
            </div>
            <button type="button" className="discovery-arrow discovery-arrow-next" onClick={() => goToSlide(slide + 1)} aria-label="الخدمة التالية" data-testid="button-service-next"><ArrowLeft size={22} strokeWidth={ICON} aria-hidden="true" /></button>
          </div>
          <div className="discovery-dot-row" aria-label="الانتقال إلى خدمة">
            {services.slice(visibleDotsStart, visibleDotsStart + 5).map((service, offset) => {
              const index = visibleDotsStart + offset;
              return <button key={service.slug} type="button" className={`discovery-dot ${slide === index ? 'is-active' : ''}`} onClick={() => goToSlide(index)} aria-label={`الخدمة ${index + 1}: ${service.name}`} aria-current={slide === index ? 'step' : undefined} data-testid={`button-service-slide-${index + 1}`} />;
            })}
          </div>
        </section>

        <section className="discovery-guide" aria-labelledby="guide-title">
          <div className="discovery-guide-top">
            <span className="discovery-guide-icon"><Sparkles size={20} strokeWidth={ICON} aria-hidden="true" /></span>
            <div><p className="discovery-kicker">دليل تفاعلي</p><h3 id="guide-title" className="display">ثلاث خطوات إلى الخدمة المناسبة</h3></div>
            <button type="button" className="discovery-reset" onClick={resetGuide} data-testid="button-guide-reset">إعادة البدء</button>
          </div>
          <div className="discovery-stepper" aria-label={`الخطوة ${formatNumber(Math.min(step + 1, 3))} من ${formatNumber(3)}`}>
            {[0, 1, 2].map((index) => <span key={index} className={step >= index ? 'is-current' : ''} />)}
          </div>
          <div className="discovery-guide-content" key={`${step}-${category ?? ''}`}>
            {step === 0 && (
              <div className="discovery-question">
                <span className="discovery-question-count" dir="ltr">{ofThree(1)}</span>
                <h4>ما الذي يشغلك الآن؟</h4>
                <p>اختر الحالة الأقرب إليك، أو ابدأ من مجال المعاملة إن كنت تعرفه.</p>
                <div className="discovery-problem-grid" role="group" aria-label="ابدأ من مشكلتك">
                  {problemEntries.map((entry) => {
                    const Icon = entry.icon;
                    return <button key={entry.key} type="button" className="discovery-problem" onClick={() => chooseProblem(entry.key)} data-testid={`button-guide-problem-${entry.key}`}><Icon size={iconSize} strokeWidth={ICON} aria-hidden="true" /><span>{entry.label}</span><small>{entry.hint}</small></button>;
                  })}
                </div>
                <p className="discovery-or">أو اختر مجال المعاملة</p>
                <div className="discovery-choice-grid">
                  {categories.map((item) => <button key={item.id} type="button" className="discovery-choice" onClick={() => chooseCategory(item.id)} data-testid={`button-guide-category-${item.id}`}><span>{item.name}</span><small>{item.description}</small><ArrowLeft size={16} strokeWidth={ICON} aria-hidden="true" /></button>)}
                   <button type="button" className="discovery-choice" onClick={() => chooseCategory(null)} data-testid="button-guide-category-unsure"><span>لا أعرف المجال</span><small>صف معاملتك وسنبحث في الدليل كله.</small><ArrowLeft size={16} strokeWidth={ICON} aria-hidden="true" /></button>
                </div>
              </div>
            )}
            {step === 1 && category && (
              <div className="discovery-question">
                <span className="discovery-question-count" dir="ltr">{ofThree(2)}</span>
                <h4>هل تعرف المنصة المرتبطة؟</h4>
                <p>هذه خطوة اختيارية، ويمكنك المتابعة دون تحديد منصة.</p>
                <div className="discovery-platform-choices">
                  {categoryPlatforms.map((name) => <button key={name} type="button" onClick={() => choosePlatform(name)} data-testid={`button-guide-platform-${platforms.indexOf(name)}`}>{name}<ArrowLeft size={16} strokeWidth={ICON} aria-hidden="true" /></button>)}
                  <button type="button" className="discovery-skip" onClick={() => choosePlatform(null)}>لا أعرف / تخطّ <ArrowLeft size={16} strokeWidth={ICON} aria-hidden="true" /></button>
                </div>
                <button type="button" className="discovery-back" onClick={backGuide}><ArrowRight size={16} strokeWidth={ICON} aria-hidden="true" /> رجوع للمجال</button>
              </div>
            )}
            {step === 2 && (
              <div className="discovery-question">
                <span className="discovery-question-count" dir="ltr">{ofThree(3)}</span>
                <h4>صف المعاملة بكلماتك</h4>
                <p>{category ? `اكتب كلمة أو جملة قصيرة، أو اعرض كل خدمات المجال${platform ? ` على ${platform}` : ''}.` : 'اكتب كلمة تصف معاملتك لنبحث في جميع المجالات.'}</p>
                <label className="discovery-description">
                  <span className="sr-only">وصف ما تحتاجه (اختياري)</span>
                  <Search size={20} strokeWidth={ICON} aria-hidden="true" />
                   <input value={description} onChange={(event) => setDescription(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (category || description.trim())) setStep(3); }} placeholder="مثال: ملاحظة على ملف الأجور في مُدد" data-testid="input-guide-description" />
                </label>
                <div className="discovery-guide-actions">
                   <button type="button" className="btn btn-primary" disabled={!category && !description.trim()} onClick={() => setStep(3)} data-testid="button-guide-show-matches">اعرض الخدمات <ArrowLeft size={18} strokeWidth={ICON} aria-hidden="true" /></button>
                  <button type="button" className="discovery-back" onClick={backGuide}><ArrowRight size={16} strokeWidth={ICON} aria-hidden="true" /> رجوع</button>
                </div>
              </div>
            )}
            {step === 3 && (
              <div className="discovery-question discovery-match-view">
                <span className="discovery-question-count"><Check size={16} strokeWidth={ICON} aria-hidden="true" /> {problem ? problem.title : 'اقتراحات من الدليل'}</span>
                <h4>{problem ? 'هكذا يتعامل المكتب معها' : matches.length ? `وجدنا ${formatNumber(matches.length)} نتيجة قد تناسبك` : 'لم نجد تطابقًا واضحًا'}</h4>
                {problem
                  ? <p className="discovery-problem-approach">{problem.approach}</p>
                  : <p className="discovery-disclaimer">هذه اقتراحات بحسب الكلمات والمجال، وليست قرارًا رسميًا بالأهلية أو إمكانية التنفيذ. يراجع المكتب تفاصيل طلبك.</p>}
                {problem && matches.length > 0 && (
                  <div className="discovery-problem-cta">
                    <Link href={problemCtaHref(problem, matches[0].slug)} className="btn btn-primary" data-testid="link-guide-problem-request">{problem.cta} <ArrowLeft size={18} strokeWidth={ICON} aria-hidden="true" /></Link>
                    <span>{problem.portal}</span>
                  </div>
                )}
                {matches.length ? (
                  <div className="discovery-match-list" data-testid="status-guide-matches">
                    {(problem ? matches : matches.slice(0, 4)).map((service) => <ServiceLinkCard key={service.slug} {...service} />)}
                    {!problem && matches.length > 4 && <button type="button" className="discovery-show-all" onClick={() => onViewAllMatches({ query: description, category, platform })} data-testid="button-guide-view-all">عرض كل النتائج ({formatNumber(matches.length)}) <ArrowLeft size={16} strokeWidth={ICON} aria-hidden="true" /></button>}
                  </div>
                ) : (
                  <div className="discovery-no-match" data-testid="status-guide-no-match">
                    <p>جرّب وصفًا آخر، أو أرسل وصفك إلى المكتب لمراجعته.</p>
                    <Link href="/services/other-service" className="btn btn-primary">خدمة غير مدرجة <ArrowLeft size={18} strokeWidth={ICON} aria-hidden="true" /></Link>
                  </div>
                )}
                <div className="discovery-guide-actions">
                  <button type="button" className="discovery-back" onClick={backGuide}><ArrowRight size={16} strokeWidth={ICON} aria-hidden="true" /> {problem ? 'حالة أخرى' : 'تعديل الوصف'}</button>
                  {!problem && <button type="button" className="discovery-back" onClick={resetGuide}>ابدأ من جديد</button>}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}