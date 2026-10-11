// The request's journey, as the portal really shows it (components/portal-ui.tsx
// StatusTrack): four milestones on the happy path, and two pause states that
// hold the request at the review milestone until the customer acts. Every
// stage list on the public site (hero card, film, service page, intro) and in
// the portal reads from here, so the story is the same everywhere.

export type MilestoneKey = 'received' | 'reviewing' | 'submitted_to_authority' | 'completed';
export type PauseKey = 'waiting_on_customer' | 'awaiting_payment';
export type RequestStage = MilestoneKey | PauseKey;

export type Milestone = { key: MilestoneKey; label: string; short: string };
export type Pause = { key: PauseKey; label: string; short: string; at: MilestoneKey };

export const milestones: readonly Milestone[] = [
  { key: 'received', label: 'تم الاستلام', short: 'وصل طلبك إلى المكتب وحصل على رقم مرجعي.' },
  { key: 'reviewing', label: 'قيد المراجعة', short: 'يعمل المكتب على طلبك الآن.' },
  { key: 'submitted_to_authority', label: 'تم الرفع للجهة', short: 'رفع المكتب طلبك إلى الجهة المختصة ويتابعه.' },
  { key: 'completed', label: 'مكتملة', short: 'اكتمل طلبك، ويبقى في سجل طلباتك.' },
];

// A pause is not a step: it sits on the review milestone as a badge.
export const pauses: Record<PauseKey, Pause> = {
  waiting_on_customer: { key: 'waiting_on_customer', label: 'بانتظار العميل', short: 'يحتاج المكتب معلومة أو مستندًا منك لإكمال الطلب.', at: 'reviewing' },
  awaiting_payment: { key: 'awaiting_payment', label: 'بانتظار السداد', short: 'طلبك بانتظار سداد الفاتورة. تجدها أدناه.', at: 'reviewing' },
};

export const milestoneKeys = milestones.map((m) => m.key) as readonly MilestoneKey[];
export const milestoneLabels = milestones.map((m) => m.label) as readonly string[];
export const isPause = (stage: string): stage is PauseKey => stage in pauses;

// Label and note for any stage, milestone or pause.
export const stageLabel = (stage: RequestStage): string => isPause(stage) ? pauses[stage].label : milestones[milestoneKeys.indexOf(stage)].label;
export const stageNote = (stage: RequestStage): string => isPause(stage) ? pauses[stage].short : milestones[milestoneKeys.indexOf(stage)].short;

// Index of the milestone a stage sits on (a pause sits on its `at` milestone).
export const milestoneIndex = (stage: RequestStage): number => milestoneKeys.indexOf(isPause(stage) ? pauses[stage].at : stage);
