import { Check, CircleDashed, Clapperboard, Download, Film, ImagePlus, Languages, LayoutList, LoaderCircle, Sparkles, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

export type StudioStageId = 'idea' | 'script' | 'storyboard' | 'images' | 'video' | 'voice' | 'export';
export type StageStatus = 'done' | 'current' | 'running' | 'review' | 'blocked' | 'todo';

export type ProductionStage = {
  id: StudioStageId;
  ar: string;
  en: string;
  status: StageStatus;
  detailAr: string;
  detailEn: string;
  count?: number;
};

const statusLabel: Record<StageStatus, [string, string]> = {
  done: ['مكتملة', 'Complete'],
  current: ['الحالية', 'Current'],
  running: ['قيد التنفيذ', 'Running'],
  review: ['تحتاج مراجعة', 'Needs review'],
  blocked: ['غير متاحة', 'Unavailable'],
  todo: ['لم تبدأ', 'Not started'],
};

const stageIcon = (id: StudioStageId) => {
  if (id === 'idea') return Sparkles;
  if (id === 'script') return LayoutList;
  if (id === 'storyboard') return Clapperboard;
  if (id === 'images') return ImagePlus;
  if (id === 'video') return Film;
  if (id === 'voice') return Languages;
  return Download;
};

export function ProductionRail({ lang, stages, active, onSelect }: {
  lang: 'ar' | 'en';
  stages: ProductionStage[];
  active: StudioStageId;
  onSelect: (stage: StudioStageId) => void;
}) {
  const t = (ar: string, en: string) => lang === 'ar' ? ar : en;
  return <aside className="studio-rail panel" aria-label={t('مراحل الإنتاج', 'Production stages')}>
    <div className="studio-rail-head">
      <span className="eyebrow">{t('مسار الإنتاج', 'PRODUCTION PATH')}</span>
      <h3>{t('مراحل الفيلم', 'Film stages')}</h3>
    </div>
    <ol className="studio-rail-list">
      {stages.map((stage, index) => {
        const Icon = stageIcon(stage.id);
        const label = statusLabel[stage.status];
        return <li key={stage.id}>
          <button
            type="button"
            className={`studio-rail-step is-${stage.status} ${active === stage.id ? 'is-active' : ''}`}
            onClick={() => onSelect(stage.id)}
            aria-current={active === stage.id ? 'step' : undefined}
            data-testid={`studio-stage-${stage.id}`}
          >
            <span className="studio-rail-mark" aria-hidden="true">
              {stage.status === 'done' ? <Check size={13} /> : stage.status === 'running' ? <LoaderCircle size={13} className="animate-spin" /> : stage.status === 'blocked' ? <TriangleAlert size={12} /> : stage.status === 'review' ? <CircleDashed size={12} /> : <Icon size={13} />}
            </span>
            <span className="studio-rail-copy">
              <b>{String(index + 1).padStart(2, '0')} · {t(stage.ar, stage.en)}</b>
              <small>{t(stage.detailAr, stage.detailEn)}</small>
            </span>
            <span className={`studio-rail-state is-${stage.status}`}>{t(label[0], label[1])}</span>
          </button>
        </li>;
      })}
    </ol>
    <p className="studio-rail-note">{t('تتغير أدوات اللوحة اليمنى حسب المرحلة. لا تظهر أدوات الفيديو أو الصوت قبل توافر مدخلاتها.', 'The right-hand tools follow the selected stage. Video and voice tools stay hidden until their inputs exist.')}</p>
  </aside>;
}

export function StageTools({ lang, stage, titleAr, titleEn, hintAr, hintEn, children }: {
  lang: 'ar' | 'en';
  stage: ProductionStage;
  titleAr: string;
  titleEn: string;
  hintAr: string;
  hintEn: string;
  children: ReactNode;
}) {
  const t = (ar: string, en: string) => lang === 'ar' ? ar : en;
  const label = statusLabel[stage.status];
  const Icon = stageIcon(stage.id);
  return <aside className="studio-tools panel" data-testid={`studio-tools-${stage.id}`}>
    <div className="studio-tools-head">
      <span className="studio-tools-icon"><Icon size={17} /></span>
      <div>
        <span className="eyebrow">{t('أدوات المرحلة', 'STAGE TOOLS')}</span>
        <h3>{t(titleAr, titleEn)}</h3>
      </div>
      <span className={`studio-rail-state is-${stage.status}`}>{t(label[0], label[1])}</span>
    </div>
    <p className="studio-tools-hint">{t(hintAr, hintEn)}</p>
    <div className="studio-tools-body">{children}</div>
  </aside>;
}

export function StudioProgress({ lang, value, labelAr, labelEn }: { lang: 'ar' | 'en'; value: number; labelAr: string; labelEn: string }) {
  const t = (ar: string, en: string) => lang === 'ar' ? ar : en;
  return <div className="studio-progress" role="status" aria-live="polite">
    <div><span>{t(labelAr, labelEn)}</span><b>{value}%</b></div>
    <div className="studio-progress-track"><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
  </div>;
}
