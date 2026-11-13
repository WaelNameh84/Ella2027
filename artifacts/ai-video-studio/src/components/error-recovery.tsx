import { AlertTriangle, ChevronDown, RefreshCw, Settings2, Sparkles } from 'lucide-react';
import { Link } from 'wouter';
import { explainJobError } from '@/lib/job-errors';

export function ErrorRecoveryPanel({ message, lang, sceneTitle, retrying = false, onRetry, freeAlternative, compact = false }: {
  message: string | null | undefined;
  lang: 'ar' | 'en';
  sceneTitle?: string;
  retrying?: boolean;
  onRetry?: () => void;
  freeAlternative?: { ar: string; en: string; onClick: () => void };
  compact?: boolean;
}) {
  const t = (ar: string, en: string) => lang === 'ar' ? ar : en;
  if (!message) return null;
  const explained = explainJobError(message, lang, sceneTitle);
  return <section className={`error-recovery ${compact ? 'is-compact' : ''}`} role="alert" data-testid="error-recovery">
    <div className="error-recovery-head"><span className="error-recovery-icon"><AlertTriangle size={15} /></span><div><b>{t(explained.titleAr, explained.titleEn)}</b>{sceneTitle && <span className="error-recovery-scene">{t('المشهد', 'Scene')}: {sceneTitle}</span>}</div></div>
    <p>{t(explained.causeAr, explained.causeEn)}</p>
    <div className="error-recovery-actions">
      {onRetry && <button type="button" className="btn btn-quiet" onClick={onRetry} disabled={retrying}>{retrying ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}{t('إعادة المحاولة', 'Retry')}</button>}
      <Link href="/settings/providers" className="btn btn-quiet"><Settings2 size={14} />{t('تغيير المزوّد أو النموذج', 'Change provider or model')}</Link>
      {freeAlternative && <button type="button" className="btn btn-quiet" onClick={freeAlternative.onClick}><Sparkles size={14} />{t(freeAlternative.ar, freeAlternative.en)}</button>}
    </div>
    {explained.technical && <details className="error-recovery-details"><summary>{t('تفاصيل تقنية', 'Technical details')}<ChevronDown size={13} /></summary><pre>{explained.technical}</pre></details>}
  </section>;
}
