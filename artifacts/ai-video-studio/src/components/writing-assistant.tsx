import { useState } from 'react';
import { Check, Copy, Sparkles, X } from 'lucide-react';
import { buildSuggestion, type AssistField, type AssistInput, type AssistTargetId } from '@/lib/writing-assistant';

const targets: { id: AssistTargetId; ar: string; en: string; ideaOnly?: boolean }[] = [
  { id: 'idea', ar: 'تحسين الفكرة', en: 'Improve idea', ideaOnly: true },
  { id: 'dialogue', ar: 'الحوار', en: 'Dialogue' },
  { id: 'tone', ar: 'النبرة', en: 'Tone' },
  { id: 'shorten', ar: 'اختصار', en: 'Shorten' },
  { id: 'suspense', ar: 'تشويق', en: 'Suspense' },
  { id: 'style', ar: 'أسلوب سينمائي', en: 'Cinematic style' },
  { id: 'camera', ar: 'حركة الكاميرا', en: 'Camera movement' },
  { id: 'music', ar: 'الموسيقى', en: 'Music' },
  { id: 'effects', ar: 'المؤثرات', en: 'Effects' },
];

export function WritingAssistant({ lang, values, context = 'scene', onApply }: {
  lang: 'ar' | 'en';
  values: AssistInput;
  context?: 'scene' | 'idea';
  onApply: (field: AssistField, value: string) => void;
}) {
  const t = (ar: string, en: string) => lang === 'ar' ? ar : en;
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<AssistTargetId | null>(null);
  const [text, setText] = useState('');
  const [applied, setApplied] = useState(false);
  const [copied, setCopied] = useState(false);
  const available = targets.filter(item => context === 'idea' ? item.id === 'idea' || item.id === 'tone' || item.id === 'shorten' || item.id === 'suspense' : !item.ideaOnly);
  const suggestion = target ? buildSuggestion(target, values, lang) : null;
  const choose = (id: AssistTargetId) => {
    const next = buildSuggestion(id, values, lang);
    setTarget(id);
    setText(next.value);
    setApplied(false);
    setCopied(false);
  };
  const apply = () => {
    if (!suggestion) return;
    onApply(suggestion.field, suggestion.advisory ? text : (suggestion.target === 'camera' ? suggestion.value : text));
    setApplied(true);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return <div className="writing-assistant">
    <button type="button" className="btn btn-quiet writing-assistant-toggle" onClick={() => setOpen(current => !current)} aria-expanded={open} data-testid="button-writing-assistant"><Sparkles size={15} />{t('مساعد الكتابة', 'Writing assistant')}</button>
    {open && <section className="writing-assistant-panel" aria-label={t('اقتراحات مساعد الكتابة', 'Writing assistant suggestions')}>
      <div className="writing-assistant-head"><div><span className="eyebrow">{t('اقتراحات قابلة للمراجعة', 'REVIEWABLE SUGGESTIONS')}</span><h4>{t('جرّب تحسينًا، ثم قرّر.', 'Try an improvement, then decide.')}</h4></div><button type="button" className="btn btn-ghost !p-1" onClick={() => setOpen(false)} aria-label={t('إغلاق المساعد', 'Close assistant')}><X size={14} /></button></div>
      <div className="writing-assistant-targets">{available.map(item => <button type="button" key={item.id} className={target === item.id ? 'is-active' : ''} onClick={() => choose(item.id)}>{t(item.ar, item.en)}</button>)}</div>
      {suggestion ? <div className="writing-assistant-suggestion">
        <p className="writing-assistant-rationale">{t(suggestion.rationaleAr, suggestion.rationaleEn)}</p>
        <textarea className="studio-input" rows={suggestion.target === 'camera' ? 2 : 5} value={suggestion.target === 'camera' ? t('حركة مقترحة: Dolly in بطيء نحو الوجه.', 'Suggested movement: slow dolly-in toward the face.') : text} onChange={event => { if (suggestion.target !== 'camera') setText(event.target.value); setApplied(false); }} aria-label={t('نص الاقتراح', 'Suggestion text')} />
        <p className="writing-assistant-note">{suggestion.advisory ? t('اقتراح إرشادي يُنسخ يدويًا؛ لا يوجد حقل نصي مطابق في المشروع.', 'An advisory suggestion to copy manually; the project has no matching text field.') : t('لن يُطبّق شيء قبل ضغط «تطبيق بعد المراجعة».', 'Nothing is applied until you press “Apply after review”.')}</p>
        {applied && <p className="writing-assistant-applied" role="status"><Check size={13} />{suggestion.advisory ? t('تم نسخ الاقتراح إلى الحافظة عبر زر النسخ.', 'Suggestion copied with the copy button.') : t('طُبّق الاقتراح بعد مراجعتك. يمكنك التراجع بتعديل الحقل.', 'Applied after your review. You can undo by editing the field.')}</p>}
        <div className="writing-assistant-actions"><button type="button" className="btn btn-quiet" onClick={() => void copy()}><Copy size={14} />{copied ? t('تم النسخ', 'Copied') : t('نسخ', 'Copy')}</button><button type="button" className="btn btn-ghost" onClick={() => { setTarget(null); setText(''); setApplied(false); }}>{t('تجاهل', 'Discard')}</button><button type="button" className="btn btn-primary" onClick={apply} disabled={suggestion.advisory || (suggestion.target !== 'camera' && !text.trim())} title={suggestion.advisory ? t('اقتراح إرشادي فقط؛ استخدم النسخ.', 'Advisory only; use copy.') : undefined}>{t('تطبيق بعد المراجعة', 'Apply after review')}</button></div>
      </div> : <p className="writing-assistant-empty">{t('اختر نوع الاقتراح لعرض نسخة قابلة للتعديل قبل تطبيقها.', 'Choose a suggestion type to preview an editable version before applying.')}</p>}
      <p className="writing-assistant-source">{t('اقتراحات مبنية بقواعد نصية محلية وليست نتيجة نموذج ذكاء اصطناعي. لا تُحفظ أي نسخة غير مطبّقة.', 'Suggestions are generated by local text rules, not an AI model. Unapplied drafts are never saved.')}</p>
    </section>}
  </div>;
}
