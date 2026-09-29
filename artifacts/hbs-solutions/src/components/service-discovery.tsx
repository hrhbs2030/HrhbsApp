import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, ArrowRight, Check, Compass, Search, Sparkles } from 'lucide-react';
import { categories, categoryById, platforms, searchServices, services, type ServiceCategory } from '@/content/services';
import './service-discovery.css';

const iconSize = 18;

function ServiceLinkCard({ slug, name, summary, platform, category }: {
  slug: string; name: string; summary: string; platform?: string; category: ServiceCategory;
}) {
  return (
    <Link href={`/services/${slug}`} className="discovery-result" data-testid={`link-discovery-service-${slug}`}>
      <span className="discovery-result-top"><span>{categoryById[category].name}</span>{platform && <span>{platform}</span>}</span>
      <strong>{name}</strong>
      <span className="discovery-result-summary">{summary}</span>
      <span className="discovery-result-more">عرض تفاصيل الخدمة <ArrowLeft size={15} aria-hidden="true" /></span>
    </Link>
  );
}

export function ServiceDiscovery({ onViewAllMatches }: { onViewAllMatches: (filters: { query: string; category: ServiceCategory | null; platform: string | null }) => void }) {
  const [slide, setSlide] = useState(0);
  const [step, setStep] = useState(0);
  const [category, setCategory] = useState<ServiceCategory | null>(null);
  const [platform, setPlatform] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const currentService = services[slide];
  const categoryPlatforms = useMemo(() => category ? [...new Set(services.filter((service) => service.category === category && service.platform).map((service) => service.platform as string))].sort((a, b) => a.localeCompare(b, 'ar')) : [], [category]);
  const matches = useMemo(() => searchServices(description, category, platform), [category, description, platform]);
  const visibleDotsStart = Math.max(0, Math.min(slide - 2, services.length - 5));

  const chooseCategory = (value: ServiceCategory | null) => {
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
    setCategory(null);
    setPlatform(null);
    setDescription('');
  };
  const backGuide = () => {
    if (step === 3) setStep(2);
    else if (step === 2) setStep(categoryPlatforms.length ? 1 : 0);
    else setStep(0);
  };
  const goToSlide = (next: number) => setSlide((next + services.length) % services.length);

  return (
    <section className="service-discovery" aria-label="طرق استكشاف الخدمات">
      <div className="discovery-heading">
        <div>
          <p className="eyebrow">اختر الطريقة الأنسب لك</p>
          <h2 className="display">خلّنا نقرّب لك الخيارات</h2>
          <p>تصفّح الخدمات واحدةً تلو الأخرى، أو أجب عن أسئلة قصيرة لنقترح ما قد يناسب وصفك.</p>
        </div>
        <span className="discovery-heading-mark" aria-hidden="true"><Compass size={25} strokeWidth={1.7} /></span>
      </div>

      <div className="discovery-layout">
        <section className="discovery-carousel" aria-label="تصفّح الخدمات">
          <div className="discovery-carousel-head">
            <div><span className="discovery-kicker">تصفّح الدليل</span><span className="discovery-total">{slide + 1} / {services.length}</span></div>
            <span className="discovery-mini-label">الخدمة التالية على بعد خطوة</span>
          </div>
          <div className="discovery-slide" aria-live="polite" key={currentService.slug}>
            <div className="discovery-slide-meta">
              <span className="discovery-number">{String(slide + 1).padStart(2, '0')}</span>
              <span>{categoryById[currentService.category].name}</span>
              {currentService.platform && <span className="discovery-platform">{currentService.platform}</span>}
            </div>
            <h3 className="display">{currentService.name}</h3>
            <p>{currentService.summary}</p>
            <Link href={`/services/${currentService.slug}`} className="discovery-slide-link">تفاصيل الخدمة <ArrowLeft size={16} aria-hidden="true" /></Link>
          </div>
          <div className="discovery-carousel-controls">
            <button type="button" className="discovery-arrow" onClick={() => goToSlide(slide - 1)} aria-label="الخدمة السابقة" data-testid="button-service-previous"><ArrowRight size={19} aria-hidden="true" /></button>
            <div className="discovery-progress" role="progressbar" aria-label="التقدم في تصفح الخدمات" aria-valuemin={1} aria-valuemax={services.length} aria-valuenow={slide + 1}>
              <span style={{ transform: `scaleX(${(slide + 1) / services.length})` }} />
            </div>
            <button type="button" className="discovery-arrow discovery-arrow-next" onClick={() => goToSlide(slide + 1)} aria-label="الخدمة التالية" data-testid="button-service-next"><ArrowLeft size={19} aria-hidden="true" /></button>
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
            <span className="discovery-guide-icon"><Sparkles size={19} strokeWidth={1.8} aria-hidden="true" /></span>
            <div><p className="discovery-kicker">دليل تفاعلي</p><h3 id="guide-title" className="display">نبحثها معك</h3></div>
            <button type="button" className="discovery-reset" onClick={resetGuide} data-testid="button-guide-reset">إعادة البدء</button>
          </div>
          <div className="discovery-stepper" aria-label={`الخطوة ${Math.min(step + 1, 3)} من 3`}>
            {[0, 1, 2].map((index) => <span key={index} className={step >= index ? 'is-current' : ''} />)}
          </div>
          <div className="discovery-guide-content" key={`${step}-${category ?? ''}`}>
            {step === 0 && (
              <div className="discovery-question">
                <span className="discovery-question-count">١ / ٣</span>
                <h4>في أي مجال معاملتك؟</h4>
                <p>اختيار المجال يساعدنا على تضييق الخيارات.</p>
                <div className="discovery-choice-grid">
                  {categories.map((item) => <button key={item.id} type="button" className="discovery-choice" onClick={() => chooseCategory(item.id)} data-testid={`button-guide-category-${item.id}`}><span>{item.name}</span><small>{item.description}</small><ArrowLeft size={15} aria-hidden="true" /></button>)}
                   <button type="button" className="discovery-choice" onClick={() => chooseCategory(null)} data-testid="button-guide-category-unsure"><span>لا أعرف المجال</span><small>صف معاملتك وسنبحث في الدليل كله.</small><ArrowLeft size={15} aria-hidden="true" /></button>
                </div>
              </div>
            )}
            {step === 1 && category && (
              <div className="discovery-question">
                <span className="discovery-question-count">٢ / ٣</span>
                <h4>هل تعرف المنصة المرتبطة؟</h4>
                <p>هذه خطوة اختيارية، ويمكنك المتابعة دون تحديد منصة.</p>
                <div className="discovery-platform-choices">
                  {categoryPlatforms.map((name) => <button key={name} type="button" onClick={() => choosePlatform(name)} data-testid={`button-guide-platform-${platforms.indexOf(name)}`}>{name}<ArrowLeft size={15} aria-hidden="true" /></button>)}
                  <button type="button" className="discovery-skip" onClick={() => choosePlatform(null)}>لا أعرف / تخطّ <ArrowLeft size={15} aria-hidden="true" /></button>
                </div>
                <button type="button" className="discovery-back" onClick={backGuide}><ArrowRight size={15} aria-hidden="true" /> رجوع للمجال</button>
              </div>
            )}
            {step === 2 && (
              <div className="discovery-question">
                <span className="discovery-question-count">٣ / ٣</span>
                <h4>صف المعاملة بكلماتك</h4>
                <p>{category ? `اكتب كلمة أو جملة قصيرة، أو اعرض كل خدمات المجال${platform ? ` على ${platform}` : ''}.` : 'اكتب كلمة تصف معاملتك لنبحث في جميع المجالات.'}</p>
                <label className="discovery-description">
                  <span className="sr-only">وصف المعاملة اختياري</span>
                  <Search size={17} aria-hidden="true" />
                   <input value={description} onChange={(event) => setDescription(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (category || description.trim())) setStep(3); }} placeholder="مثال: إدارة المنصات الحكومية لمنشأة" data-testid="input-guide-description" />
                </label>
                <div className="discovery-guide-actions">
                   <button type="button" className="btn btn-primary" disabled={!category && !description.trim()} onClick={() => setStep(3)} data-testid="button-guide-show-matches">اعرض الخدمات <ArrowLeft size={16} aria-hidden="true" /></button>
                  <button type="button" className="discovery-back" onClick={backGuide}><ArrowRight size={15} aria-hidden="true" /> رجوع</button>
                </div>
              </div>
            )}
            {step === 3 && (
              <div className="discovery-question discovery-match-view">
                <span className="discovery-question-count"><Check size={14} aria-hidden="true" /> اقتراحات من الدليل</span>
                <h4>{matches.length ? `وجدنا ${matches.length} نتيجة قد تناسبك` : 'لم نجد تطابقًا واضحًا'}</h4>
                <p className="discovery-disclaimer">هذه اقتراحات بحسب الكلمات والمجال، وليست قرارًا رسميًا بالأهلية أو إمكانية التنفيذ. يراجع المكتب تفاصيل طلبك.</p>
                {matches.length ? (
                  <div className="discovery-match-list" data-testid="status-guide-matches">
                    {matches.slice(0, 4).map((service) => <ServiceLinkCard key={service.slug} {...service} />)}
                    {matches.length > 4 && <button type="button" className="discovery-show-all" onClick={() => onViewAllMatches({ query: description, category, platform })} data-testid="button-guide-view-all">عرض كل النتائج ({matches.length}) <ArrowLeft size={15} aria-hidden="true" /></button>}
                  </div>
                ) : (
                  <div className="discovery-no-match" data-testid="status-guide-no-match">
                    <p>جرّب وصفًا آخر، أو أرسل وصفك إلى المكتب لمراجعته.</p>
                    <Link href="/services/other-service" className="btn btn-primary">خدمة غير مدرجة <ArrowLeft size={16} aria-hidden="true" /></Link>
                  </div>
                )}
                <div className="discovery-guide-actions">
                  <button type="button" className="discovery-back" onClick={backGuide}><ArrowRight size={15} aria-hidden="true" /> تعديل الوصف</button>
                  <button type="button" className="discovery-back" onClick={resetGuide}>ابدأ من جديد</button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}