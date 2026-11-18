import { useState } from 'react';
import { Check, Copy, LoaderCircle, Sparkles, X } from 'lucide-react';

type Lang = 'ar' | 'en';
type Task = 'scene' | 'dialogue' | 'visual' | 'rewrite';
type ApplyField = 'description' | 'imagePrompt' | 'narration';

const tasks: { id: Task; ar: string; en: string; field: ApplyField }[] = [
  { id: 'scene', ar: 'كتابة مشهد كامل', en: 'Write a full scene', field: 'description' },
  { id: 'dialogue', ar: 'كتابة الحوار', en: 'Write dialogue', field: 'narration' },
  { id: 'visual', ar: 'وصف بصري سينمائي', en: 'Cinematic visual prompt', field: 'imagePrompt' },
  { id: 'rewrite', ar: 'تحسين المشهد الحالي', en: 'Improve current scene', field: 'description' },
];

export function WritingAssistant({ lang, projectId, sceneId, onApply }: {
  lang: Lang;
  projectId: string;
  sceneId: string;
  onApply: (field: ApplyField, value: string) => void;
}) {
  const t = (ar: string, en: string) => lang === 'ar' ? ar : en;
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState<Task>('scene');
  const [instruction, setInstruction] = useState('');
  const [result, setResult] = useState('');
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState(false);
  const selected = tasks.find(item => item.id === task)!;
  const generate = async () => {
    if (!instruction.trim() || !approved || busy) return;
    setBusy(true); setError(''); setResult(''); setApplied(false);
    try {
      const response = await fetch(`/api/projects/${projectId}/scenes/${sceneId}/assistant`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, instruction: instruction.trim(), approvePotentialCharges: true }),
      });
      const body = await response.json().catch(() => ({})) as { text?: string; error?: string };
      if (!response.ok || !body.text?.trim()) throw new Error(body.error || t('لم يصل رد صالح من مزوّد الذكاء الاصطناعي.', 'The AI provider returned no usable response.'));
      setResult(body.text.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('تعذر الاتصال بالمساعد.', 'Could not reach the assistant.'));
    } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(result); } catch { setError(t('تعذر النسخ؛ يمكنك تحديد النص ونسخه يدويًا.', 'Copy failed; select and copy the text manually.')); }
  };
  return <div className="writing-assistant">
    <button type="button" className="btn btn-quiet writing-assistant-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open} data-testid="button-writing-assistant"><Sparkles size={15}/>{t('مساعد الذكاء الاصطناعي للمشهد', 'AI scene assistant')}</button>
    {open && <section className="writing-assistant-panel" aria-label={t('مساعد كتابة المشهد', 'Scene writing assistant')}>
      <div className="writing-assistant-head"><div><span className="eyebrow">ELLA AI · SCENE COPILOT</span><h4>{t('أعطه فكرتك ودعه يكتب المسودة.', 'Give it your idea and let it draft the scene.')}</h4></div><button type="button" className="btn btn-ghost !p-1" onClick={() => setOpen(false)} aria-label={t('إغلاق المساعد', 'Close assistant')}><X size={14}/></button></div>
      <div className="writing-assistant-targets">{tasks.map(item => <button type="button" key={item.id} className={task === item.id ? 'is-active' : ''} onClick={() => {setTask(item.id);setResult('');setApplied(false);}}>{t(item.ar,item.en)}</button>)}</div>
      <label className="inspector-field"><span className="field-label">{t('فكرتك أو تعليماتك','Your idea or instruction')}</span><textarea className="studio-input" rows={4} value={instruction} onChange={event => setInstruction(event.target.value)} placeholder={t('مثلاً: يدخل البطل إلى المطعم، يرى حبيبته السابقة، ويحاول إخفاء صدمته...','Example: The hero enters the restaurant, sees his former lover, and tries to hide his shock...')}/></label>
      <label className="checkline"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)}/><span>{t('أوافق على إرسال طلبي إلى مزوّد النص المحدد وقد تُحتسب رسوم. لن يتم الإرسال قبل موافقتي.','I approve sending this request to the configured text provider; charges may apply. Nothing is sent without my approval.')}</span></label>
      <button type="button" className="btn btn-primary w-full" onClick={() => void generate()} disabled={!instruction.trim() || !approved || busy}>{busy ? <LoaderCircle size={15} className="animate-spin"/> : <Sparkles size={15}/ >}{busy ? t('يكتب المشهد الآن…','Writing your scene…') : t('اكتب لي','Generate with AI')}</button>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {result && <div className="writing-assistant-suggestion"><div className="writing-assistant-rationale">{t('مسودة قابلة للتحرير — لم يتم تغيير المشهد بعد.','Editable draft — your scene has not been changed yet.')}</div><textarea className="studio-input" rows={9} value={result} onChange={event => setResult(event.target.value)}/><div className="writing-assistant-actions"><button type="button" className="btn btn-quiet" onClick={() => void copy()}><Copy size={14}/>{t('نسخ','Copy')}</button><button type="button" className="btn btn-primary" onClick={() => {onApply(selected.field,result);setApplied(true);}}><Check size={14}/>{t('اعتماد وإضافة للمشهد','Apply to scene')}</button></div>{applied && <p className="writing-assistant-applied" role="status">{t('تم تطبيق النص وحفظه تلقائيًا.','Text applied; it will be saved automatically.')}</p>}</div>}
      <p className="writing-assistant-source">{t('يستخدم مزوّد النص المفعّل في إعداداتك. إذا لم يتوفر مزوّد صالح، سيعرض سبب التعذر ولن يستبدل النص الحالي.','Uses your configured text provider. If none is available, it reports the reason and keeps your existing text unchanged.')}</p>
    </section>}
  </div>;
}
