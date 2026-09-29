# إعادة تصميم HBS حلول الغد — الجرد والاتجاه والخطة

## 1. جرد ما هو موجود (بعد فحص الشيفرة)

| المجال | الحالة | المرجع |
|---|---|---|
| تسجيل الدخول وإنشاء الحساب (Clerk، بريد + تحقق) | يعمل | `App.tsx` |
| طلب التسجيل ومراجعة المكتب له | يعمل | `pages/registration*.tsx`، `/portal/registration` |
| إرسال طلب خدمة (المجال، اسم الخدمة، التفاصيل، رقم التواصل) | يعمل | `POST /service-requests` |
| أربع حالات للطلب ورقم مرجعي | يعمل | `ServiceRequest.status` |
| الاستفسارات وربطها بطلب ورد المكتب | يعمل | `/inquiries`، `/office/inquiries` |
| مساعد آلي لأسئلة استخدام البوابة (لا يرى المعاملات) | يعمل | `/anthropic/answer-inquiry` |
| مساحة المكتب: بحث، فلترة، ترتيب، تحديث الحالة، ملاحظة داخلية | يعمل | `pages/office.tsx` |
| فريق المكتب، سجل التدقيق، استيراد الأرشيف القديم | يعمل (للمالك) | `pages/office-admin.tsx`، `pages/legacy.tsx` |
| رفع المستندات | **غير موجود** | لا يوجد حقل أو مسار رفع |
| سجل زمني لتغيّر الحالة يراه العميل | **غير موجود** | يوجد `createdAt` و`updatedAt` فقط؛ سجل التدقيق داخلي |
| إسناد الطلب لموظف | **غير موجود** | لا حقل `assignee` |
| الدفع، واتساب، ربط بمنصات حكومية | **غير موجود** | — |
| صفحات الخدمات | **غير موجودة قبل هذا الفرع** | — |

## 2. الاتجاه البصري

**الفكرة:** «رحلة الطلب». طلب واحد يُرسم كوثيقة من طبقات (CSS 3D) تمر بالمراحل الأربع الحقيقية للبوابة. الفكرة نفسها تظهر في المقدمة، والواجهة الرئيسية، وقسم «رحلة الطلب»، وصفحة الخدمة، وخط زمني صفحة الطلب.

- **الألوان:** أخضر عميق (`teal`، `night`)، عاجي دافئ (`paper`، `surface`)، ونحاسي واحد (`copper`). كل الألوان في `src/index.css` داخل `@theme`، ومع كل لون نص نسبة تباينه.
- **الخطوط:** Readex Pro للعناوين، IBM Plex Sans Arabic للنص. لا تباعد أحرف في العربية.
- **الأرقام:** 0-9 والتقويم الميلادي بأسماء أشهر عربية، من مكان واحد: `src/lib/format.ts`.
- **الحركة:** مفردات موحّدة (`--duration-*`، `--ease-*`). transform وopacity فقط. لا حلقات مستمرة. لكل تسلسل بديل عند «تقليل الحركة».

### قرار المقدمة: CSS 3D بدل Three.js

التطبيق Vite + React، والصفحة الرئيسية تُحمّل مباشرة. Three.js/R3F كانت ستضيف نحو 600KB للصفحة الأولى، وتحتاج مسار فشل خاصًا. المشهد المطلوب (وثيقة من طبقات تمر بمراحل) يتحقق بـ CSS 3D بلا تحميل إضافي، ولا يمكن أن «يفشل في التحميل». النص HTML دائمًا.

- تُعرض مرة واحدة لكل متصفح (`localStorage: hbs:intro:v1`)، وزر «تخطَّ المقدمة» ظاهر فورًا، ومفتاح Esc والنقر يتخطيانها.
- 3.9 ثانية على الحاسب، 2.7 على الجوال بتأثيرات أقل.
- لا تُعرض إطلاقًا مع «تقليل الحركة» أو عند فتح رابط فيه `#`.
- للمراجعة: `?intro=1` يعيد العرض، `?intro=0` يتخطاها.

## 3. خريطة الصفحات

| المسار | الصفحة | جديد؟ |
|---|---|---|
| `/` | الرئيسية + المقدمة | أُعيد تصميمها |
| `/services` | دليل الخدمات (بحث عربي يتجاهل الهمزات والتشكيل، وفلترة بالمجال) | جديد |
| `/services/:slug` | صفحة الخدمة، وزر يبدأ الطلب واسم الخدمة معبأ | جديد |
| `/trust` | الخصوصية والأمان (وقائع من الشيفرة فقط) | جديد |
| `/help` | الأسئلة والمساعدة | جديد |
| `/requests/new` | نموذج من ثلاث خطوات مع تحقق ومراجعة | أُعيد بناؤه |
| `/requests/:id` | خط زمني متحرك + رسالة تأكيد بعد الإرسال | مُحسّن |
| `/dashboard`، `/office` | شبكة 2×2 على الجوال، ألوان من النظام | مُحسّن |

## 4. خريطة المكوّنات

- `design/tokens.ts`: نسخة JS من الألوان (لتصميم Clerk فقط).
- `lib/format.ts`: التواريخ والأرقام وجمع «يوم».
- `lib/motion.ts`: تقليل الحركة، الظهور عند التمرير، الفصل النشط، تخزين آمن.
- `components/request-object.tsx`: الوثيقة ثلاثية الأبعاد و`StageRail`.
- `components/intro.tsx`: المقدمة.
- `components/site-chrome.tsx`: رأس وتذييل الصفحات العامة.
- `components/portal-ui.tsx`: `StatusTrack` أصبح خطًا زمنيًا متحركًا.
- `content/services.ts`، `content/site.ts`: المحتوى منفصل عن العرض.
- `pages/new-request.tsx`: النموذج متعدد الخطوات (نفس عقد الـ API).

## 5. ما يحتاج قرارًا أو مدخلات

1. **قائمة الخدمات مسودة** (`content/services.ts`): الأسماء والإرشادات تحتاج مراجعة المكتب قبل النشر. لا أسعار ولا مدد ولا متطلبات رسمية.
2. **رفع المستندات:** يحتاج تخزين ملفات (مثل S3 أو Replit Object Storage) وجدولًا ومسارات جديدة وفحص الملفات.
3. **سجل الحالة للعميل:** يحتاج جدول `hbs_service_request_events` يُكتب مع كل تحديث حالة، ثم يعرضه الخط الزمني بتواريخ كل مرحلة.
4. **إسناد الطلب لموظف:** يحتاج حقل `assigneeId` وترحيلًا وواجهة في المكتب.
5. **بيانات التواصل العامة** (هاتف، عنوان، ساعات العمل): غير موجودة في المستودع؛ لم أكتب أي بيانات افتراضية.
6. **الإنجليزية (LTR):** الألوان والحركة تستخدم خصائص منطقية (`inset-inline`، `padding-inline`)، والأشرطة تعكس اتجاهها تلقائيًا تحت `[dir="ltr"]`، و`LOCALE` في مكان واحد. الخطوة التالية: ملف نصوص لكل لغة.
7. بعد تسجيل الدخول من صفحة خدمة، يعيد Clerk المستخدم إلى لوحة التحكم لا إلى النموذج المعبأ.

## Landing v3 (brief: dashboard preview + «أم مشعل»)

- Kept Vite + React (no Next.js migration) and the city scenes; the hero keeps its interactive request preview. Motion stays CSS (no GSAP / Three.js), with reduced-motion fallbacks.
- New sections: `#dashboard` (client dashboard preview, demo data labelled «بيانات توضيحية»; documents upload and invoices are marked as not available) and `#assistant` («أم مشعل», pre-written example answers, clear split between AI guidance and office execution).
- The portal assistant is renamed «أم مشعل»; its server prompt now uses that name and states it never executes government transactions.
- Category display names now follow the four service areas: الجوازات والإقامة، الموارد البشرية والعمل، تأسيس الشركات والتراخيص، دعم الأعمال (API enum unchanged).

## City residents (سكان المدن)

- `components/city-scenes/people.tsx` draws small residents in each city's foreground layer, in regional dress: Najdi thobe, red shemagh and agal, and a bisht (Riyadh); Hijazi sideri vest with ghabana turban, and white ghutra (Jeddah); striped izar with flower wreath or straw hat, and the tall straw hat المظلة for women (Jazan); the abaya in all three.
- Pairs talk about their transactions in speech bubbles timed to the 12 s city cycle (restarted each time a city comes on screen). Passers-by cross slowly. All motion is transform/opacity and pauses with the scene.
- Bubbles are hidden in the portal strip and on phones; reduced-motion users see the residents without bubbles. Edit the casts and lines at the bottom of `people.tsx`.

## Site review fixes (30 Sep 2026)

- Office contact details in `src/content/contact.ts` (footer column, help page card, legal pages) and in the JSON-LD block of `index.html` — keep the two in sync.
- New pages `/privacy` (سياسة الخصوصية, written against the fields the API actually stores and PDPL rights) and `/terms` (شروط الاستخدام). Update `legalUpdated` when their text changes. Should be reviewed before relying on them legally.
- `sitemap.xml` generated at build time from the public routes and the service slugs in `content/services.ts`; `robots.txt` points to it. Absolute `og:image`, `og:url`, `og:locale`, `og:site_name`.
- Header switches to the menu button below 1180px (it wrapped before); residents' speech bubbles hidden below 1180px and behind the footer.
- Footer links are 44px tap targets; heading order fixed on the inquiries list and empty/error blocks.
- Not in code (deployment side): gzip/brotli compression and security headers, and the Clerk application name.

## Notifications and status history (phase 2)

- `GET /service-requests/{id}/history` returns the request's status changes (status and time only), rebuilt from `created_at` and the office audit log's `service_request.update` entries. No new table or migration. The request page shows it as «سجل الحالة».
- Email notifications (`artifacts/api-server/src/lib/notify.ts`, SMTP via nodemailer), sent after the change is saved; failures are logged and never fail the request. Off until the SMTP secrets are set.
  - Customer: status change, first answer to an inquiry, registration approved or rejected.
  - Office inbox: new request, new registration, new inquiry.
  - Messages carry the reference, service and status only; details stay behind sign-in.
- Secrets: `SMTP_HOST`, `SMTP_PORT` (465, or 587 for STARTTLS), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `HBS_NOTIFY_EMAIL` (defaults to `HBS_OFFICE_EMAIL`), `PUBLIC_SITE_URL`.

## Request documents (phase 3)

- Table `hbs_request_files` (migration `0003_request_files.sql`): one row per document, the bytes in private Replit App Storage under `requests/<id>/<uuid>`. Removing a file deletes the object and keeps the row with `deleted_at` / `deleted_reason` (uploader, office, retention).
- Routes (`artifacts/api-server/src/routes/files.ts`): list, upload (raw body, `X-File-Name`), download (attachment, no-store, nosniff, sandbox CSP) and delete, for the customer (own requests) and the office (all). Type is read from the file's first bytes (PDF, JPEG, PNG only); 10 MB per file, 10 active files per request; customers cannot add or remove files once a request is completed.
- Office uploads, downloads and removals are in the audit log; files of requests completed more than 90 days ago are purged by the server every six hours (audited as «النظام»).
- Emails: the office inbox when a customer attaches a file; the customer when the office attaches one.
- UI: «المستندات» on the customer request page and in the office request panel (`components/request-files.tsx`), and optional attachments on the new-request form.
- Storage settings: `HBS_FILE_STORE` (`replit` on Replit, `local` for development, `memory` for tests), `HBS_STORAGE_BUCKET_ID` for a non-default bucket. App Storage must be enabled for the Repl.
