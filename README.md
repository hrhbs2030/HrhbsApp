# HBS حلول الغد

مصدر موقع HBS وبوابة العملاء ومساحة المكتب، مع خادم API والحزم المشتركة اللازمة لهما. هذا المستودع يضم الشيفرة فقط، ولا يتضمن بيانات العملاء أو قاعدة البيانات أو ملفات الأسرار أو تطبيق الهاتف والفيديو.

## بنية المشروع
- artifacts/hbs-solutions: واجهة React وVite.
- artifacts/api-server: خادم Express وواجهات API.
- lib/db: مخطط قاعدة البيانات.
- lib/api-spec: تعريف OpenAPI ومولّد العميل.
- lib/api-client-react وlib/api-zod: الشيفرة المولّدة اللازمة للتشغيل.
- lib/integrations-*: موصلات الذكاء الاصطناعي المستخدمة في الخادم.

## الإعداد
استخدم Node.js 24 وpnpm. شغّل pnpm install، ثم pnpm --filter @workspace/api-spec run codegen عند تغيير تعريف API، وبعدها pnpm run typecheck وpnpm test. يشغّل GitHub Actions الفحوص نفسها مع بناء الواجهة والخادم على كل طلب سحب.

اضبط متغيرات التشغيل اللازمة من ملف .env.example في بيئة الاستضافة الآمنة، دون رفع قيمها إلى Git. يحتاج الموقع مساري /api و/api/__clerk إلى خادم API؛ إعداد توجيه المسارات في Replit يتم خارج هذا المستودع. يحتاج بناء الواجهة إلى PORT وBASE_PATH (مثال: PORT=5173 BASE_PATH=/ pnpm --filter @workspace/hbs-solutions run build). شغّل خادم API مع PORT منفصل. لا تنقل أو تستبدل قاعدة إنتاج بمجرد استيراد المصدر.

رفع الشيفرة إلى GitHub لا ينشر hrhbs.com تلقائيًا ولا يغيّر إعدادات موفّر تسجيل الدخول في Clerk.

## قاعدة البيانات
تُدار تغييرات المخطط بملفات ترحيل في lib/db/migrations بدل drizzle-kit push.

- **تغيير المخطط:** عدّل ملفات lib/db/src/schema، ثم شغّل pnpm --filter @workspace/db run generate وراجع ملف SQL الناتج وارفعه مع التعديل. يفشل CI إذا تغيّر المخطط دون ملف ترحيل.
- **قاعدة جديدة فارغة:** شغّل pnpm --filter @workspace/db run migrate.
- **قاعدة موجودة أُنشئت سابقًا بـ push (مثل قاعدة الإنتاج الحالية)، مرة واحدة فقط:**
  1. خذ نسخة احتياطية من القاعدة، وجرّب الخطوات التالية أولًا على نسخة منها.
  2. تأكد أن الحالات والتصنيفات ضمن القيم المسموحة، وإلا فسيفشل الترحيل 0001 كاملًا دون أن يغيّر شيئًا. يجب أن يعيد هذا الاستعلام صفرًا:
     select (select count(*) from hbs_service_requests where status not in ('received','reviewing','waiting_on_customer','completed') or category not in ('passports','labor','business','other')) + (select count(*) from hbs_inquiries where status not in ('open','answered'));
  3. شغّل pnpm --filter @workspace/db run baseline لتسجيل المخطط الحالي كأنه مطبّق. السكربت يرفض العمل على قاعدة فارغة أو ناقصة الجداول، وتكراره آمن.
  4. شغّل pnpm --filter @workspace/db run migrate لتطبيق ما بعده.

  تشغيل migrate على قاعدة موجودة قبل baseline يفشل دون أن يغيّر شيئًا.
- **الأمر push** مخصص لقواعد التطوير المحلية فقط، ولا يُستخدم على الإنتاج.
