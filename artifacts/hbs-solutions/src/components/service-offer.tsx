import { BadgeCheck, Clock3, FileCheck2, Wallet } from 'lucide-react';
import { getListServiceOffersQueryKey, useListServiceOffers } from '@workspace/api-client-react';
import { daysLabel, formatMoney } from '@/lib/format';

// What the office published for a service: its fee, processing time and the
// documents to prepare. Renders nothing until the office publishes an offer.
export function ServiceOffer({ slug, compact = false }: { slug: string | undefined; compact?: boolean }) {
  const offers = useListServiceOffers({ query: { queryKey: getListServiceOffersQueryKey(), staleTime: 300_000 } });
  const offer = slug ? offers.data?.find(o => o.slug === slug) : undefined;
  if (!offer || (offer.price == null && offer.processingDays == null && !offer.requiredDocuments.length && !offer.governmentFeesNote)) return null;
  return <section className={`surface ${compact ? 'mt-6 p-4' : 'pub-block'}`} aria-label="السعر والمتطلبات">
    <h2 className={compact ? 'mb-3 flex items-center gap-2 text-sm font-semibold' : 'display'}><BadgeCheck size={compact ? 16 : 20} aria-hidden="true"/>السعر والمتطلبات</h2>
    <dl className="m-0 grid gap-3 text-sm sm:grid-cols-2">
      {offer.price != null && <div><dt className="flex items-center gap-1 text-xs font-medium text-subtle"><Wallet size={14} aria-hidden="true"/>أتعاب المكتب</dt><dd className="m-0 font-semibold">{formatMoney(offer.price)} <span className="text-xs font-normal text-subtle">قبل ضريبة القيمة المضافة</span></dd></div>}
      {offer.processingDays != null && <div><dt className="flex items-center gap-1 text-xs font-medium text-subtle"><Clock3 size={14} aria-hidden="true"/>مدة الإنجاز المتوقعة</dt><dd className="m-0 font-semibold">{daysLabel(offer.processingDays)} عمل</dd></div>}
      {offer.governmentFeesNote && <div className="sm:col-span-2"><dt className="text-xs font-medium text-subtle">الرسوم الحكومية</dt><dd className="m-0">{offer.governmentFeesNote}</dd></div>}
    </dl>
    {offer.requiredDocuments.length > 0 && <div className="mt-4"><h3 className="mb-2 flex items-center gap-1 text-xs font-semibold text-subtle"><FileCheck2 size={14} aria-hidden="true"/>جهّز هذه المستندات</h3>
      <ul className="m-0 list-disc space-y-1 pr-5 text-sm leading-7">{offer.requiredDocuments.map(d => <li key={d}>{d}</li>)}</ul></div>}
    <p className="mt-3 text-xs leading-6 text-subtle">السعر والمدة تقديريان، ويؤكدهما المكتب بعد مراجعة طلبك.</p>
  </section>;
}
