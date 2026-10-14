# إعادة تصميم HBS حلول الغد — الجرد والاتجاه والخطة

> هذا الملف سجل تاريخي لقرارات إعادة التصميم ومراحلها. الوصف المرجعي للمنتج كما هو الآن في [README.md](../README.md)، ودليل التشغيل في [RUNBOOK.md](RUNBOOK.md). الأقسام 1 و3 و5 حُدّثت لتعكس الحالة الحالية؛ ما بعدها ملاحظات كل مرحلة كما كُتبت وقتها.

## 1. جرد ما هو موجود (محدَّث)

| المجال | الحالة | المرجع |
|---|---|---|
| تسجيل الدخول وإنشاء الحساب (Clerk، بريد + تحقق) | يعمل | `components/portal-shell.tsx` |
| طلب التسجيل ومراجعة المكتب له | يعمل | `pages/registration*.tsx`، `/portal/registration` |
| إرسال طلب خدمة بثلاث خطوات مع مرفقات وربط بموظف أو ترخيص أو عدة موظفين | يعمل | `pages/new-request.tsx`، `POST /service-requests` |
| ست حالات للطلب ورقم مرجعي وسجل حالة يراه العميل | يعمل | `ServiceRequest.status`، `GET /service-requests/{id}/history` |
| الاستفسارات كمحادثات وصندوق رسائل موحّد | يعمل | `/messages`، `/inquiries/:id`، `/office/messages` |
| مساعد «أم مشعل» لأسئلة استخدام البوابة (لا ينفّذ معاملات) | يعمل | `/anthropic/answer-inquiry` |
| مساحة المكتب: لوحة وجدول، بحث، فلترة، إسناد، أتمتة، صفحة طلب كاملة | يعمل | `pages/office.tsx`، `pages/office-request.tsx` |
| فريق المكتب، سجل التدقيق، التقارير، الخطط، الاستيراد القديم | يعمل (للمالك) | `pages/office-admin.tsx`، `pages/office-extras.tsx`، `pages/legacy.tsx` |
| رفع المستندات وقوائم المستندات المطلوبة والقراءة الآلية | يعمل | `components/request-files.tsx`، `hbs_request_attachments` |
| إسناد الطلب لموظف وموعد إنجاز وقواعد الإسناد | يعمل | `hbs_assignment_rules`، `/office/assignees` |
| عروض الأسعار والفواتير والسداد الإلكتروني (ميسّر) ومطابقة السداد | يعمل | `routes/quotes.ts`، `routes/billing.ts` |
| ملف المنشأة والموظفون والتراخيص والاستيراد من Excel | يعمل | `pages/company.tsx`، `components/company-file.tsx` |
| تنبيهات الوثائق والتجديد التلقائي | يعمل | `lib/document-reminders.ts` |
| الخطط والاشتراكات الشهرية | يعمل | `lib/subscriptions.ts` |
| أعضاء المنشأة بأدوار owner/hr/finance/viewer يتصرفون باسمها | يعمل | `lib/company-access.ts`، `routes/company-members.ts` |
| إدخال المكتب طلبًا للعميل من ملفه | يعمل | `POST /office/customers/{userId}/service-requests` |
| الإشعارات داخل التطبيق وSSE والدفع الفوري والملخص اليومي | يعمل | `pages/notifications.tsx`، `lib/notifications.ts` |
| واتساب: توثيق الرقم، روابط المتابعة، التوجيه بالمرجع، صندوق المكتب | يعمل | `routes/whatsapp-webhook.ts`، `pages/office-whatsapp.tsx` |
| لوحة الأوامر للمكتب وللعميل في كل صفحات البوابة | يعمل | `components/command-palette.tsx` |
| صفحات الخدمات العامة والمساعدة والخصوصية والشروط | يعمل | `pages/public.tsx`، `pages/legal.tsx` |
| ربط بمنصات حكومية | **غير موجود** | قرار المالك |
| ربط «فاتورة» المرحلة الثانية (ZATCA) | **غير موجود** | قرار المالك |
| العمل دون اتصال (PWA) | **غير موجود** | `public/sw.js` للدفع الفوري فقط |

## 2. الاتجاه البصري

**الفكرة:** «رحلة الطلب». طلب واحد يُرسم كوثيقة من طبقات (CSS 3D) تمر بمراحل البوابة الحقيقية. الفكرة نفسها تظهر في المقدمة، والواجهة الرئيسية، وقسم «رحلة الطلب»، وصفحة الخدمة، وخط زمني صفحة الطلب.

- **الألوان:** أخضر عميق (`teal`، `night`)، عاجي دافئ (`paper`، `surface`)، ونحاسي واحد (`copper`). كل الألوان في `src/index.css` داخل `@theme`، ومع كل لون نص نسبة تباينه.
- **الخطوط:** Readex Pro للعناوين، IBM Plex Sans Arabic للنص. لا تباعد أحرف في العربية.
- **الأرقام:** 0-9 والتقويم الميلادي بأسماء أشهر عربية، من مكان واحد: `src/lib/format.ts` (`nu-latn` و`ca-gregory` في كل تنسيق تاريخ ووقت).
- **الحركة:** مفردات موحّدة (`--duration-*`، `--ease-*`). transform وopacity فقط. الحلقات المستمرة في مشاهد المدن تتوقف خارج الشاشة وتحت «تقليل الحركة»، وتقل في الصفحات غير الرئيسية.

### قرار المقدمة: CSS 3D بدل Three.js

التطبيق Vite + React، والصفحة الرئيسية تُحمّل مباشرة. Three.js/R3F كانت ستضيف نحو 600KB للصفحة الأولى، وتحتاج مسار فشل خاصًا. المشهد المطلوب يتحقق بـ CSS 3D بلا تحميل إضافي، ولا يمكن أن «يفشل في التحميل». النص HTML دائمًا.

- تُعرض مرة واحدة لكل متصفح (`localStorage: hbs:intro:v1`)، وزر «تخطَّ المقدمة» ظاهر فورًا، ومفتاح Esc والنقر يتخطيانها.
- لا تُعرض إطلاقًا مع «تقليل الحركة» أو عند فتح رابط فيه `#`.
- للمراجعة: `?intro=1` يعيد العرض، `?intro=0` يتخطاها.

## 3. خريطة الصفحات (محدَّثة)

### الموقع العام (مسبق التصيير)
| المسار | الصفحة |
|---|---|
| `/` | الرئيسية والمقدمة، مع أقسام `#how` و`#problems` و`#dashboard` تُفتح من أي صفحة |
| `/services` | دليل الخدمات (بحث عربي وفلترة بالمجال) |
| `/services/:slug` | صفحة الخدمة، وزر يبدأ الطلب واسم الخدمة معبأ |
| `/trust` | الخصوصية والأمان |
| `/help` | الأسئلة والمساعدة |
| `/privacy`، `/terms` | سياسة الخصوصية وشروط الاستخدام |
| `/.well-known/security.txt` | جهة الاتصال الأمنية |

### بوابة العميل
| المسار | الصفحة |
|---|---|
| `/sign-in`، `/sign-up` | Clerk |
| `/registration` | طلب التسجيل (يظهر في القائمة قبل الاعتماد فقط) |
| `/dashboard` | لوحة التحكم: المهام، الفواتير غير المسددة، الوثائق القريبة من الانتهاء |
| `/requests`، `/requests/new`، `/requests/:id` | الطلبات، النموذج متعدد الخطوات، صفحة الطلب (سجل الحالة، المستندات، عرض السعر، القائمة، الفواتير، المحادثة) |
| `/inquiries`، `/inquiries/:id` | الاستفسارات ومحادثاتها |
| `/messages` | صندوق الرسائل الموحّد |
| `/notifications` | مركز الإشعارات والتفضيلات |
| `/documents` | الوثائق وتنبيهاتها و«اطلب التجديد» |
| `/company` | ملف المنشأة، الموظفون، التراخيص، الأعضاء، الاشتراك، الفواتير |
| `/settings` | رقم واتساب وتوثيقه |

### مساحة المكتب
| المسار | الصفحة |
|---|---|
| `/office` | اللوحة |
| `/office/requests`، `/office/requests/:id` | الطلبات (لوحة/جدول) وصفحة الطلب الكاملة |
| `/office/inquiries` | الاستفسارات |
| `/office/messages` | صندوق الرسائل |
| `/office/whatsapp` | صندوق واتساب |
| `/office/notifications` | إشعارات المكتب |
| `/office/registrations` | طلبات التسجيل |
| `/office/customers`، `/office/customers/:userId` | العملاء وملف العميل 360° مع إدخال طلب للعميل |
| `/office/reminders` | الوثائق القريبة من الانتهاء |
| `/office/catalog` | الأسعار والمتطلبات وقواعد الإسناد (المالك) |
| `/office/plans`، `/office/subscriptions` | الخطط والاشتراكات |
| `/office/reports` | التقارير (المالك) |
| `/office/staff`، `/office/audit`، `/office/legacy` | الفريق، سجل التدقيق، الأرشيف القديم (المالك) |

## 4. خريطة المكوّنات

- `design/tokens.ts`: نسخة JS من الألوان (لتصميم Clerk فقط).
- `lib/format.ts`: التواريخ والأرقام وجمع «يوم».
- `lib/motion.ts`: تقليل الحركة، الظهور عند التمرير، الفصل النشط، تخزين آمن.
- `lib/use-notifications.ts`: تدفق SSE مع إعادة الاتصال والاستطلاع الاحتياطي.
- `components/request-object.tsx`: الوثيقة ثلاثية الأبعاد و`StageRail`.
- `components/intro.tsx`، `components/how-film.tsx`: المقدمة وفيلم «كيف يعمل».
- `components/city-scene.tsx`، `city-scenes/*`: مشاهد المدن وسكانها.
- `components/site-chrome.tsx`: رأس وتذييل الصفحات العامة.
- `components/portal-shell.tsx`، `portal-ui.tsx`، `portal-kit.tsx`: غلاف البوابة والقائمة الجانبية وشريط الجوال ومكوّناتها الأساسية.
- `components/command-palette.tsx`: لوحة الأوامر المشتركة للمكتب والعميل.
- `content/services.ts`، `content/site.ts`، `content/contact.ts`: المحتوى منفصل عن العرض.
- `pages/new-request.tsx`: النموذج متعدد الخطوات (نفس عقد الـ API).

## 5. ما كان يحتاج قرارًا أو مدخلات — الحالة

1. **قائمة الخدمات** (`content/services.ts`): نُشرت بعد مراجعة المحتوى؛ لا أسعار ولا مدد ولا متطلبات رسمية في النص العام. ✅
2. **رفع المستندات:** تم على نظام المرفقات الموجود (انظر «Request documents» أدناه). ✅
3. **سجل الحالة للعميل:** تم دون جدول جديد (يُبنى من سجل التدقيق). ✅
4. **إسناد الطلب لموظف:** تم مع قواعد الإسناد التلقائي. ✅
5. **بيانات التواصل العامة:** في `content/contact.ts` وJSON-LD في `index.html`. ✅
6. **الإنجليزية (LTR):** الخصائص المنطقية وLOCALE جاهزة؛ ملف نصوص لكل لغة ما زال خطوة لاحقة. ⏳
7. **العودة إلى النموذج المعبأ بعد تسجيل الدخول من صفحة خدمة:** ما زال مفتوحًا؛ Clerk يعيد إلى لوحة التحكم. ⏳

## Landing v3 (brief: dashboard preview + «أم مشعل»)

- Kept Vite + React (no Next.js migration) and the city scenes; the hero keeps its interactive request preview. Motion stays CSS (no GSAP / Three.js), with reduced-motion fallbacks.
- New sections: `#dashboard` (client dashboard preview, demo data labelled «بيانات توضيحية») and `#assistant` («أم مشعل», pre-written example answers, clear split between AI guidance and office execution).
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
- Security headers and compression are now served by `server.mjs` (see README «الأمان والتشغيل»); the Clerk application name stays a deployment-side setting.

## Notifications and status history (phase 2)

- `GET /service-requests/{id}/history` returns the request's status changes (status and time only), rebuilt from `created_at` and the office audit log's `service_request.update` entries. No new table or migration. The request page shows it as «سجل الحالة».
- Email notifications (`artifacts/api-server/src/lib/notify.ts`, SMTP via nodemailer), sent after the change is saved; failures are logged and never fail the request. Off until the SMTP secrets are set.
  - Customer: status change, first answer to an inquiry, registration approved or rejected.
  - Office inbox: new request, new registration, new inquiry.
  - Messages carry the reference, service and status only; details stay behind sign-in.
- Secrets: `SMTP_HOST`, `SMTP_PORT` (465, or 587 for STARTTLS), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `HBS_NOTIFY_EMAIL` (defaults to `HBS_OFFICE_EMAIL`), `PUBLIC_SITE_URL`. Superseded by the single notification pipeline (package E below), which adds in-app rows, SSE, push (`VAPID_*`) and WhatsApp on top of the same mails.

## Request documents on the existing attachment system (replaces PR #15)

- Replit's `hbs_request_attachments` (signed-URL upload → checked copy to `/objects/submitted/`) stays the only document store. PR #15's separate `hbs_request_files` design was dropped.
- Added: attaching files to an open request later (`POST /service-requests/{id}/attachments`), office uploads (`/office/service-requests/attachments/upload-url` + attach), removal (customers: their own files while open; office: any, audited), 10 files per request, `uploadedBy`/`createdAt` on each attachment, audited office downloads, 90-day purge after completion in the existing sweep, and emails to the other side.
- UI: «المستندات» on the customer request page and the office request panel (`components/request-files.tsx`), optional files on the new-request form (uploaded before submitting, with a per-form `clientRequestId`).

## Database migrations (restored)

- Replit applied schema changes with `drizzle-kit push` and removed the migration scripts; `0003_replit_attachments_and_information.sql` now records those changes, and the status/category CHECK constraints are kept.
- Production is brought back under migrations with `pnpm --filter @workspace/db run adopt` (read-only report) and `-- --apply` (re-adds missing CHECK constraints after checking rows, records migrations as applied). `expected-schema.json` is regenerated with `run expected-schema` and checked in CI.
- Never use `push` against production; use `generate` + `migrate`. The full migration list (0000–0013) is in README «قاعدة البيانات».

## Packages C–D: quotes, checklists, subscriptions, members, bulk requests (migrations 0008–0009)

- Quotes on a request (`/office/service-requests/{id}/quote`, customer accept/decline), document checklists copied from the published offer, invoice reminders, Excel/print exports, Wathq commercial-register lookup.
- Plans and monthly subscriptions on the Riyadh calendar, company members (`hbs_company_members`), multi-employee requests (`hbs_request_employees`), inbound WhatsApp storage (`hbs_whatsapp_inbound`), the full-page office request workspace.

## Package E: smart notifications (migration 0010)

- One pipeline (`lib/notifications.ts`) for every event: priority, coalescing, dedupe, quiet hours, daily digest, channel plan from the user's preferences; rows in `hbs_notifications`, live SSE stream, free Web Push through `web-push` + `VAPID_*`, pure intelligence module (`lib/notification-intelligence.ts`) for priority, Arabic intent detection, suggested replies and the daily brief.
- Notification centre and preferences page for customers and staff; 180-day purge of read rows.

## Replit PR #31: security and integrity (migration 0011)

- WhatsApp number verification challenge (hashed token sent by the customer to the office number, matched by the inbound webhook), atomic inbound processing with duplicate rejection, invoice idempotency keys, `hbs_invoice_gateway_pages` for open Moyasar pages and reconciliation, read-only `verify-existing-schema` for Replit's dev database.

## Package G: messaging inbox and WhatsApp follow-up (migration 0012)

- Unified inbox (`/messages`, `/office/messages`) over request and inquiry threads (`hbs_inquiry_messages`, `hbs_thread_reads`), read markers, unread totals and SSE `thread` events; follow-up links to the office WhatsApp number with the reference prefilled; reference-routed inbound replies; office send-via-WhatsApp gated on a verified, opted-in number; office WhatsApp inbox with intent and suggested replies.

## Package H: premium template pass

- `portal-kit` primitives, the new `PortalLayout` shell (collapsible sidebar, phone tab bar, account menu), public-site sections, intro/how-film/city motion, customer portal pages, office panel with board/table, charts, audit timeline and the command palette.

## Package I: members as requesters, office intake, hardening (migration 0013)

- Company members act for the company through `requireApprovedCustomer` and a `customerId(req)` helper; roles owner/hr/finance/viewer gate writes; `GET /portal/me` returns `companyRole` and `actingFor`; `created_by`/`source` on requests and inquiries.
- Office intake `POST /office/customers/{userId}/service-requests` (source `office`, audited `service_request.create_for_customer`); quote acceptance moves the request to `awaiting_payment`; customer file 360° header with members, subscription, unpaid invoices and quick actions.
- One `<CommandPalette/>` for everyone, SSE reconnect with backoff, Latin digits and Gregorian dates everywhere, subscription confirmation dialog, WhatsApp verification banner.
- API: SSE listener cleanup, payment reconciliation over open pages only, Web Push endpoint validation and caps, bounded digest retries, brief paths limited to real routes, scheduled WhatsApp inbound and failed-push retention, graceful shutdown.
- Public site: services search results under the field on phones, idle-cost cuts in city scenes, hash links from any page, route-level code splitting with a vendor chunk, `/.well-known/security.txt`.
