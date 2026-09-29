import { db, hbsApprovedInformation, hbsApprovedInformationHistory } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

// Public, product-owned portal instructions; never derived from customer records.
export const requestTrackingGuide = {
  title: "كيف أتابع حالة طلبي؟ دليل صفحة طلباتي",
  content: [
    "لمتابعة طلبك، سجّل الدخول إلى حسابك في بوابة HBS وافتح صفحة «طلباتي» من القائمة.",
    "تظهر طلباتك في هذه الصفحة مع رقم كل طلب وحالته، ويمكنك تصفيتها حسب الحالة. افتح الطلب لعرض تفاصيله ومراحل المتابعة وآخر تحديث.",
    "الحالات العامة هي: «تم الاستلام» (وصل الطلب إلى المكتب)، «قيد المراجعة» (يعمل المكتب على الطلب)، «بانتظار العميل» (يحتاج المكتب معلومة أو مستندًا منك)، و«مكتملة» (اكتمل الطلب ويبقى في سجل طلباتك).",
    "إذا ظهر «بانتظار العميل» أو أردت معرفة ما يلزم لطلب معين، افتح الطلب واختر «استفسر عن الطلب»، أو أرسل استفسارًا من صفحة «استفساراتي». يجيب المكتب عن حالة الطلب المعين؛ المساعد لا يطّلع على طلباتك ولا يستطيع تحديد حالتها نيابةً عن المكتب.",
  ].join("\n"),
} as const;

// Install the published office information once, without restoring it if staff
// later edits or withdraws it. History identifies it even after a title edit.
export async function ensureRequestTrackingGuide(): Promise<void> {
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(89004201)`);
    const [prior] = await tx.select({ id: hbsApprovedInformationHistory.id })
      .from(hbsApprovedInformationHistory)
      .where(and(eq(hbsApprovedInformationHistory.action, "published"),
        eq(hbsApprovedInformationHistory.title, requestTrackingGuide.title))).limit(1);
    if (prior) return;
    const [existing] = await tx.select({ id: hbsApprovedInformation.id })
      .from(hbsApprovedInformation)
      .where(eq(hbsApprovedInformation.draftTitle, requestTrackingGuide.title)).limit(1);
    if (existing) return;
    const now = new Date();
    const [row] = await tx.insert(hbsApprovedInformation).values({
      draftTitle: requestTrackingGuide.title, draftContent: requestTrackingGuide.content,
      reviewedAt: now, publishedTitle: requestTrackingGuide.title,
      publishedContent: requestTrackingGuide.content, publishedReviewedAt: now,
      publishedAt: now, updatedAt: now,
    }).returning({ id: hbsApprovedInformation.id });
    await tx.insert(hbsApprovedInformationHistory).values({
      informationId: row.id, action: "published", title: requestTrackingGuide.title,
      content: requestTrackingGuide.content, reviewedAt: now, publishedAt: now, changedAt: now,
    });
  });
}