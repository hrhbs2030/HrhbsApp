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

اضبط متغيرات التشغيل اللازمة من ملف .env.example في بيئة الاستضافة الآمنة، دون رفع قيمها إلى Git. يحتاج الموقع مساري /api و/api/__clerk إلى خادم API؛ إعداد توجيه المسارات في Replit يتم خارج هذا المستودع. يحتاج بناء الواجهة إلى PORT وBASE_PATH (مثال: PORT=5173 BASE_PATH=/ pnpm --filter @workspace/hbs-solutions run build). شغّل خادم API مع PORT منفصل. طبّق تغييرات مخطط قاعدة البيانات أولًا في بيئة تطوير بعد مراجعتها، ولا تنقل أو تستبدل قاعدة إنتاج بمجرد استيراد المصدر.

رفع الشيفرة إلى GitHub لا ينشر hrhbs.com تلقائيًا ولا يغيّر إعدادات موفّر تسجيل الدخول في Clerk.
