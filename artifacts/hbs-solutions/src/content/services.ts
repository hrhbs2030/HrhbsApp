// Service catalogue shown on /services and used to pre-fill new requests.
//
// DRAFT CONTENT — the office must review it before launch. It names services
// only; it deliberately states no prices, processing times, official
// requirements or government integrations. What a customer "should write"
// is guidance for describing their case, not a list of required documents:
// the office decides what it needs after reviewing each request.
//
// The four categories match the API enum (ServiceRequestInput.category), so
// every service here can be submitted through the existing request endpoint.

export type ServiceCategory = 'passports' | 'labor' | 'business' | 'other';

export type Service = {
  slug: string;
  category: ServiceCategory;
  name: string;
  summary: string;
  whatToWrite: string[];
  keywords: string[];
};

export type CategoryInfo = {
  id: ServiceCategory;
  slug: string;
  name: string;
  description: string;
};

export const categories: CategoryInfo[] = [
  { id: 'passports', slug: 'passports', name: 'الجوازات', description: 'معاملات الإقامة والتأشيرات والتنقل للعاملين والمقيمين.' },
  { id: 'labor', slug: 'labor', name: 'العمل', description: 'معاملات العمالة ورخص العمل ونقل الخدمات والأجور.' },
  { id: 'business', slug: 'business', name: 'الأعمال', description: 'السجلات التجارية وتأسيس المنشآت وتعديل بياناتها والتسجيل الضريبي.' },
  { id: 'other', slug: 'other', name: 'خدمات أخرى', description: 'استشارات ومعاملات لا تندرج تحت المجالات السابقة.' },
];

export const categoryById = Object.fromEntries(categories.map((c) => [c.id, c])) as Record<ServiceCategory, CategoryInfo>;

export const services: Service[] = [
  {
    slug: 'iqama-renewal', category: 'passports', name: 'تجديد الإقامة',
    summary: 'تجديد إقامتك أو إقامة أحد العاملين في منشأتك.',
    whatToWrite: ['اسم صاحب الإقامة كما في الوثيقة', 'تاريخ انتهاء الإقامة الحالية', 'اسم المنشأة إن كان العامل تابعًا لها'],
    keywords: ['إقامة', 'تجديد', 'مقيم'],
  },
  {
    slug: 'exit-reentry', category: 'passports', name: 'تأشيرة خروج وعودة',
    summary: 'إصدار تأشيرة خروج وعودة أو تمديدها.',
    whatToWrite: ['اسم المسافر', 'تاريخ السفر المتوقع ومدة الغياب', 'إصدار جديد أم تمديد'],
    keywords: ['خروج وعودة', 'تأشيرة', 'سفر', 'تمديد'],
  },
  {
    slug: 'final-exit', category: 'passports', name: 'تأشيرة خروج نهائي',
    summary: 'إنهاء إجراءات الخروج النهائي لعامل أو مقيم.',
    whatToWrite: ['اسم صاحب الإقامة', 'التاريخ المتوقع للمغادرة', 'أي التزامات قائمة تعلم بها'],
    keywords: ['خروج نهائي', 'مغادرة'],
  },
  {
    slug: 'passport-info-update', category: 'passports', name: 'تحديث بيانات الجواز',
    summary: 'نقل معلومات جواز جديد أو تصحيح البيانات المسجلة.',
    whatToWrite: ['اسم صاحب الجواز', 'سبب التحديث (جواز جديد، تصحيح بيانات…)'],
    keywords: ['جواز', 'نقل معلومات', 'تحديث'],
  },
  {
    slug: 'service-transfer', category: 'labor', name: 'نقل خدمات عامل',
    summary: 'نقل خدمات عامل من منشأة إلى أخرى.',
    whatToWrite: ['اسم العامل', 'المنشأة الحالية والمنشأة المنقول إليها', 'صفتك: صاحب العمل الحالي أم الجديد'],
    keywords: ['نقل كفالة', 'نقل خدمات', 'عامل'],
  },
  {
    slug: 'work-permit', category: 'labor', name: 'إصدار أو تجديد رخصة العمل',
    summary: 'إصدار رخص العمل للعاملين في منشأتك أو تجديدها.',
    whatToWrite: ['اسم المنشأة', 'عدد العاملين المعنيين', 'إصدار جديد أم تجديد'],
    keywords: ['رخصة عمل', 'تجديد', 'عمالة'],
  },
  {
    slug: 'contract-documentation', category: 'labor', name: 'توثيق عقود العمل',
    summary: 'إعداد عقود العاملين وتوثيقها.',
    whatToWrite: ['اسم المنشأة', 'عدد العقود', 'أي ملاحظة على بنود العقد'],
    keywords: ['عقد عمل', 'توثيق'],
  },
  {
    slug: 'wage-protection', category: 'labor', name: 'حماية الأجور',
    summary: 'متابعة ملف حماية الأجور ومعالجة ملاحظاته.',
    whatToWrite: ['اسم المنشأة', 'الشهر أو الفترة المعنية', 'الملاحظة أو المشكلة الظاهرة'],
    keywords: ['أجور', 'رواتب', 'حماية الأجور'],
  },
  {
    slug: 'social-insurance', category: 'labor', name: 'التأمينات الاجتماعية',
    summary: 'تسجيل العاملين أو استبعادهم أو تعديل أجورهم.',
    whatToWrite: ['اسم المنشأة', 'المطلوب: تسجيل، استبعاد، أو تعديل أجر', 'أسماء العاملين المعنيين'],
    keywords: ['تأمينات', 'تسجيل موظف', 'استبعاد'],
  },
  {
    slug: 'commercial-registration', category: 'business', name: 'إصدار سجل تجاري',
    summary: 'إصدار سجل رئيسي أو فرعي لنشاط جديد.',
    whatToWrite: ['النشاط المطلوب', 'المدينة', 'سجل رئيسي أم فرعي'],
    keywords: ['سجل تجاري', 'نشاط', 'فرع'],
  },
  {
    slug: 'registration-amendment', category: 'business', name: 'تعديل السجل التجاري',
    summary: 'تعديل النشاط أو العنوان أو أي بيانات مسجلة.',
    whatToWrite: ['رقم السجل أو اسم المنشأة', 'البيانات المطلوب تعديلها'],
    keywords: ['تعديل سجل', 'نشاط', 'عنوان'],
  },
  {
    slug: 'company-formation', category: 'business', name: 'تأسيس شركة',
    summary: 'تأسيس شركة وإعداد وثائق التأسيس.',
    whatToWrite: ['نوع الشركة المتوقع', 'عدد الشركاء', 'النشاط الرئيسي'],
    keywords: ['شركة', 'تأسيس', 'عقد تأسيس', 'شركاء'],
  },
  {
    slug: 'vat-registration', category: 'business', name: 'التسجيل في ضريبة القيمة المضافة',
    summary: 'تسجيل المنشأة ضريبيًا أو تحديث بياناتها.',
    whatToWrite: ['اسم المنشأة', 'تسجيل جديد أم تحديث بيانات'],
    keywords: ['ضريبة', 'قيمة مضافة', 'زكاة', 'تسجيل ضريبي'],
  },
  {
    slug: 'administrative-consultation', category: 'other', name: 'استشارة إدارية أو قانونية',
    summary: 'رأي المكتب في معاملة أو إجراء قبل البدء.',
    whatToWrite: ['الموضوع باختصار', 'ما تم حتى الآن', 'القرار الذي تحتاج الرأي فيه'],
    keywords: ['استشارة', 'قانونية', 'إدارية', 'رأي'],
  },
  {
    slug: 'other-service', category: 'other', name: 'خدمة غير مدرجة',
    summary: 'لم تجد خدمتك في الدليل؟ صِف ما تحتاجه ليراجعه المكتب.',
    whatToWrite: ['اسم الخدمة كما تعرفها', 'الجهة المعنية إن كنت تعرفها', 'ما تحتاجه بالتحديد'],
    keywords: ['أخرى', 'غير مدرجة'],
  },
];

export const serviceBySlug = Object.fromEntries(services.map((s) => [s.slug, s])) as Record<string, Service>;

// Arabic-aware search: ignore diacritics, tatweel, and hamza/alef/ya/ta-marbuta variants.
export function normalizeArabic(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim();
}

export function searchServices(query: string, category?: ServiceCategory | null): Service[] {
  const q = normalizeArabic(query);
  return services.filter((s) => {
    if (category && s.category !== category) return false;
    if (!q) return true;
    const haystack = normalizeArabic([s.name, s.summary, categoryById[s.category].name, ...s.keywords].join(' '));
    return q.split(/\s+/).every((part) => haystack.includes(part));
  });
}
