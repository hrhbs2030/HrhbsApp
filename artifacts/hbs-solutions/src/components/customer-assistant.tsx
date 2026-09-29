import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useAnswerCustomerInquiry } from '@workspace/api-client-react';
import { ArrowLeft, Sparkles } from 'lucide-react';

export function CustomerAssistant({ onAskOffice }: { onAskOffice: () => void }) {
  const [question, setQuestion] = useState('');
  const [exchange, setExchange] = useState<{ question: string; answer: string } | null>(null);
  const answer = useAnswerCustomerInquiry();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (text.length < 5 || text.length > 1000 || answer.isPending) return;
    setExchange(null);
    try {
      const result = await answer.mutateAsync({ data: { question: text } });
      setExchange({ question: text, answer: result.answer });
      setQuestion('');
    } catch {
      // The request error is rendered below; leave the question for retry.
    }
  }

  return <section aria-labelledby="assistant-title" className="surface mb-8 overflow-hidden border border-sage-2">
    <div className="flex items-start gap-4 border-b border-sage-2 bg-sage px-5 py-5 sm:px-8">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-teal text-on-dark"><Sparkles size={21}/></div>
      <div>
        <div className="mb-1 text-[11px] font-bold text-copper">مساعد آلي · Anthropic</div>
        <h2 id="assistant-title" className="display text-xl font-semibold">اسأل عن خدمات البوابة</h2>
        <p className="muted mt-1 text-xs leading-6">مساعد آلي لإرشادك إلى استخدام البوابة فقط؛ لا يطّلع على معاملاتك، وإجابته ليست ردًا من المكتب.</p>
      </div>
    </div>
    <div className="space-y-5 p-5 sm:p-8">
      <form onSubmit={submit} className="space-y-4">
        <label htmlFor="assistant-question" className="form-field">ما الذي تود معرفته؟
          <textarea id="assistant-question" className="form-control !min-h-28" placeholder="مثل: كيف أتابع حالة طلبي؟" value={question} onChange={event => setQuestion(event.target.value)} minLength={5} maxLength={1000} required/>
        </label>
        <p className="muted text-xs leading-6">يُرسل سؤالك إلى Anthropic عبر Replit AI Integrations لإعداد إجابة آلية. لا تكتب كلمات مرور أو أرقام هوية أو معلومات حساسة؛ المساعد لا يطّلع على طلباتك.</p>
        <button className="btn btn-primary" type="submit" disabled={answer.isPending || question.trim().length < 5}>{answer.isPending ? 'جارٍ إعداد الإجابة...' : 'احصل على إجابة'}<Sparkles size={16}/></button>
      </form>
      {answer.isError && <div role="alert" className="rounded-lg bg-danger-soft p-4 text-sm text-danger">
        {answer.error?.status === 429 ? 'وصلت إلى حد الأسئلة لهذا الوقت. يمكنك العودة لاحقًا أو إرسال استفسار للمكتب.' : answer.error?.status === 401 ? 'يجب تسجيل الدخول قبل سؤال المساعد.' : 'تعذّر الحصول على إجابة الآن. حاول مرة أخرى أو أرسل استفسارًا للمكتب.'}
      </div>}
      {exchange && <div aria-live="polite" className="rounded-xl border border-sage-2 bg-surface p-5">
        <div className="text-xs font-bold text-subtle">سؤالك</div>
        <p className="mt-2 whitespace-pre-wrap text-sm font-semibold">{exchange.question}</p>
        <div className="mt-5 border-t border-sage-2 pt-5 text-xs font-bold text-teal-bright">إجابة المساعد</div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-8">{exchange.answer}</p>
        <p className="muted mt-4 text-xs">تحتاج تأكيدًا رسميًا أو معلومات عن طلبك؟ أرسل استفسارًا إلى المكتب.</p>
        <button type="button" onClick={onAskOffice} className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-copper">أرسل استفسارًا إلى المكتب <ArrowLeft size={15}/></button>
      </div>}
      <div className="text-xs text-subtle">المساعد يجيب عن الأسئلة العامة فقط. <Link href="/requests" className="font-bold text-teal-bright">تابع طلباتك من حسابك.</Link></div>
    </div>
  </section>;
}