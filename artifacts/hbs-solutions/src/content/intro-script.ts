// The words of the opening film (components/intro.tsx), scene by scene.
// Each scene shows one step of how the portal works. Keep lines short:
// they animate in as kinetic type and must read in about three seconds.
// Digits are Latin (0-9), like everywhere else in the product (lib/format.ts).

export type IntroScene = {
  key: 'brand' | 'request' | 'office' | 'documents' | 'company' | 'done';
  kicker: string;
  title: string;
  line: string;
};

export const introScenes: IntroScene[] = [
  { key: 'brand', kicker: 'HBS حلول الغد', title: 'معاملاتك كلها في مكان واحد', line: 'بوابة تصلك بالمكتب، من أول طلب حتى اكتماله.' },
  { key: 'request', kicker: '1 – اطلب', title: 'اختر الخدمة وأرسل طلبك', line: 'ورقم مرجعي يصلك فور الإرسال.' },
  { key: 'office', kicker: '2 – تابع', title: 'المكتب يعمل، وأنت ترى', line: 'كل تغيير في الحالة يصلك، والمحادثة داخل الطلب.' },
  { key: 'documents', kicker: '3 – أرفق وسدّد', title: 'المستندات والفاتورة في الطلب نفسه', line: 'ارفع ما يطلبه المكتب، وسدّد إلكترونيًا أو في المكتب.' },
  { key: 'company', kicker: '4 – لا تفوّت موعدًا', title: 'ملف منشأتك يذكّرك قبل الموعد', line: 'تنبيه قبل انتهاء أي إقامة أو رخصة: 30 يومًا، 7 أيام، يوم.' },
  { key: 'done', kicker: 'HBS حلول الغد', title: 'من أول طلب، تعرف أين وصلت معاملتك.', line: '' },
];
