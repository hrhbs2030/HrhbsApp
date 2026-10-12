// The words of the opening film (components/intro.tsx), scene by scene.
// The film opens on the owner's problem (a note on the wage file, an indicator
// that changed, a licence about to expire) and resolves it through the portal:
// send it as it reached you, the office finds the cause and prepares the
// correction, the documents and the invoice live inside the request, and the
// company file warns before the next expiry. Keep lines short (seven words or
// fewer): they animate in as kinetic type and must read in about three seconds.
// Digits are Latin (0-9), like everywhere else in the product (lib/format.ts).

export type IntroScene = {
  key: 'brand' | 'request' | 'office' | 'documents' | 'company' | 'done';
  kicker: string;
  title: string;
  line: string;
};

export const introScenes: IntroScene[] = [
  { key: 'brand', kicker: 'HBS حلول الغد', title: 'ظهرت ملاحظة؟ تغيّر المؤشر؟ رخصة تنتهي؟', line: 'أرسلها كما وصلتك، ويعالجها المكتب معك.' },
  { key: 'request', kicker: '1 – أرسل الملاحظة', title: 'اكتب الملاحظة كما تظهر لك', line: 'ورقم مرجعي يصلك فور الإرسال.' },
  { key: 'office', kicker: '2 – تابع المعالجة', title: 'المكتب يحدد السبب ويعدّ التصحيح', line: 'كل تحديث يصلك، والتفسير في محادثة الطلب.' },
  { key: 'documents', kicker: '3 – أرفق ما يُطلب', title: 'قائمة المستندات داخل الطلب نفسه', line: 'ارفع ما يطلبه المكتب، والفاتورة في الطلب.' },
  { key: 'company', kicker: '4 – قبل أن يصبح تأخيرًا', title: 'ملف منشأتك يذكّرك قبل الموعد', line: 'تنبيه قبل 30 يومًا، و7 أيام، ويوم.' },
  { key: 'done', kicker: 'HBS حلول الغد', title: 'تعرف أين وصلت الملاحظة، وما يلزم منك.', line: '' },
];
