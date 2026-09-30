import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useAnswerCustomerInquiry } from '@workspace/api-client-react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { trackEvent } from '@/lib/analytics';

export function CustomerAssistant({ onAskOffice }: { onAskOffice: () => void }) {
  const [question, setQuestion] = useState('');
  const [exchange, setExchange] = useState<{ question: string; answer: string; sources: { id: number; title: string }[] } | null>(null);
  const answer = useAnswerCustomerInquiry();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (text.length < 5 || text.length > 1000 || answer.isPending) return;
    setExchange(null);
    try {
      const result = await answer.mutateAsync({ data: { question: text } });
      trackEvent('assistant_answered', { source_count: result.sources.length });
      setExchange({ question: text, answer: result.answer, sources: result.sources });
      setQuestion('');
    } catch {
      // The request error is rendered below; leave the question for retry.
    }
  }

  return <section aria-labelledby="assistant-title" className="surface overflow-hidden xl:sticky xl:top-24">
    <div className="flex items-start gap-3 border-b border-sage-2 bg-sage px-5 py-4">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal text-on-dark"><Sparkles size={19}/></div>
      <div className="min-w-0">
        <h2 id="assistant-title" className="display text-lg font-semibold">أم مشعل <span className="text-sm font-normal text-subtle">· المساعدة الآلية</span></h2>
        <p className="muted mt-0.5 text-xs leading-6">تجيب عن أسئلة استخدام البوابة فقط اعتمادًا على معلومات نشرها المكتب، ولا تطّلع على طلباتك ولا تنفّذ أي معاملة. إجابتها إرشاد، لا ردّ رسمي من المكتب.</p>
      </div>
    </div>
    <div className="space-y-4 p-5">
      <form onSubmit={submit} className="space-y-3">
        <label htmlFor="assistant-question" className="form-field">سؤالك
          <textarea id="assistant-question" className="form-control !min-h-24" placeholder="مثل: كيف أتابع حالة طلبي؟" value={question} onChange={event => setQuestion(event.target.value)} minLength={5} maxLength={1000} required/>
        </label>
        <p className="text-xs leading-6 text-subtle">يُرسل نص سؤالك إلى مزوّد الذكاء الاصطناعي لإعداد الإجابة (التفاصيل في سياسة الخصوصية). لا تكتب كلمات مرور أو أرقام هوية أو أي معلومات حساسة.</p>
        <button className="btn btn-outline w-full" type="submit" disabled={answer.isPending || question.trim().length < 5}>{answer.isPending ? 'جارٍ إعداد الإجابة…' : 'اسأل أم مشعل'}<Sparkles size={16}/></button>
      </form>
      {answer.isError && <div role="alert" className="rounded-lg bg-danger-soft p-4 text-sm leading-7 text-danger">
        {answer.error?.status === 429 ? 'وصلت إلى حد الأسئلة لهذا الوقت. عد لاحقًا أو أرسل استفسارًا للمكتب.' : answer.error?.status === 401 ? 'يجب تسجيل الدخول قبل سؤال أم مشعل.' : 'تعذّر الحصول على إجابة الآن. حاول مرة أخرى أو أرسل استفسارًا للمكتب.'}
      </div>}
      {exchange && <div aria-live="polite" className="rounded-xl border border-sage-2 bg-paper p-4">
        <div className="text-xs font-bold text-subtle">سؤالك</div>
        <p className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-7">{exchange.question}</p>
        <div className="mt-4 border-t border-sage-2 pt-4 text-xs font-bold text-teal-bright">إجابة أم مشعل</div>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-8">{exchange.answer}</p>
        {exchange.sources.length > 0 && <div className="mt-3 text-xs leading-6 text-subtle">
          <span className="font-bold">المعلومات المعتمدة:</span>{' '}
          {exchange.sources.map(source => <span key={source.id} className="me-2">{source.title}</span>)}
        </div>}
        <button type="button" onClick={onAskOffice} className="mt-3 inline-flex min-h-11 items-center gap-2 text-xs font-bold text-copper">تحتاج ردًا رسميًا؟ أرسل استفسارًا للمكتب<ArrowLeft size={15}/></button>
      </div>}
      <div className="border-t border-line pt-3 text-xs text-subtle">المساعد للأسئلة العامة فقط. <Link href="/requests" className="font-bold text-teal-bright">تابع طلباتك من حسابك.</Link></div>
    </div>
  </section>;
}