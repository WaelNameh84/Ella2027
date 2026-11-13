import { Check, Clapperboard, Clock3, Coins, LoaderCircle, Pencil, RefreshCw, Sparkles, Users } from 'lucide-react';
import type { FilmPlan } from '@/lib/film-plan';

export function FilmPlanCard({ plan, lang, pending, approveDisabled = false, onEdit, onReanalyze, onApprove }: {
  plan: FilmPlan;
  lang: 'ar' | 'en';
  pending: boolean;
  approveDisabled?: boolean;
  onEdit: () => void;
  onReanalyze: () => void;
  onApprove: () => void;
}) {
  const t = (ar: string, en: string) => lang === 'ar' ? ar : en;
  return <section className="film-plan panel" data-testid="film-plan">
    <div className="film-plan-head">
      <div>
        <span className="eyebrow">{t('خطة الفيلم', 'FILM PLAN')}</span>
        <h3>{plan.title}</h3>
        <p>{plan.summary}</p>
      </div>
      <span className="film-plan-source">{t('خطة محلية — ليست تحليل AI', 'Local plan — not AI analysis')}</span>
    </div>
    <div className="film-plan-grid">
      <div className="film-plan-block">
        <span className="eyebrow">{t('الحبكة', 'PLOT')}</span>
        <ol>{plan.plot.map((beat, index) => <li key={index}>{beat}</li>)}</ol>
      </div>
      <div className="film-plan-block">
        <span className="eyebrow"><Users size={12} /> {t('الشخصيات', 'CHARACTERS')}</span>
        <ul>{plan.characters.map((name, index) => <li key={index}>{name}</li>)}</ul>
        <p className="film-plan-note">{t('يمكنك إضافة الأسماء والملابس والصور لاحقًا من مكتبة الشخصيات.', 'You can add names, costumes, and reference images later in the character library.')}</p>
      </div>
    </div>
    <div className="film-plan-stats">
      <div><Clapperboard size={15} /><span>{t('المشاهد', 'Scenes')}</span><b>{plan.sceneCount}</b></div>
      <div><Clock3 size={15} /><span>{t('المدة', 'Duration')}</span><b>{Math.floor(plan.totalDurationSeconds / 60)}:{String(plan.totalDurationSeconds % 60).padStart(2, '0')}</b></div>
      <div><Sparkles size={15} /><span>{t('التعقيد', 'Complexity')}</span><b>{t(plan.complexityLabelAr, plan.complexityLabelEn)}</b></div>
      <div><Coins size={15} /><span>{t('التكلفة', 'Cost')}</span><b>{t('غير قابلة للحساب بدقة', 'Not precisely calculable')}</b></div>
    </div>
    <div className="film-plan-tools">
      <span className="eyebrow">{t('الأدوات', 'TOOLS')}</span>
      <ul>{plan.tools.map((tool, index) => <li key={index} className={tool.ready ? 'is-ready' : ''}>{tool.ready ? <Check size={12} /> : <span className="film-plan-dot" />}{t(tool.ar, tool.en)}</li>)}</ul>
    </div>
    <p className="film-plan-cost">{t(plan.costAr, plan.costEn)}</p>
    <div className="film-plan-actions">
      <button type="button" className="btn btn-quiet" onClick={onEdit} disabled={pending}><Pencil size={15} />{t('تعديل الخطة', 'Edit plan')}</button>
      <button type="button" className="btn btn-quiet" onClick={onReanalyze} disabled={pending}><RefreshCw size={15} />{t('إعادة التحليل', 'Re-analyze')}</button>
      <button type="button" className="btn btn-primary" onClick={onApprove} disabled={pending || approveDisabled} title={approveDisabled ? t('وافق على احتمال الرسوم أولًا', 'Approve potential charges first') : undefined} data-testid="button-approve-plan">{pending ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}{t('اعتماد الخطة وبدء السيناريو', 'Approve plan and start script')}</button>
    </div>
    <p className="film-plan-warning">{t('هذه الخطة مبنية من نص فكرتك بمنطق محلي وليست نتيجة نموذج ذكاء اصطناعي. لا يبدأ أي طلب مدفوع قبل موافقتك.', 'This plan is derived from your text with local logic, not an AI model result. No paid request starts before your approval.')}</p>
  </section>;
}
