import { AlertTriangle, CheckCircle2, Clock3, Film, ImagePlus, KeyRound, RefreshCw, Save, Wifi, WifiOff } from 'lucide-react';
import type { Scene, StudioJob } from '@workspace/api-client-react';
import type { ProductionStage, StudioStageId } from '@/components/studio-layout';

function Metric({ icon: Icon, label, value, detail, tone = '' }: { icon: typeof Film; label: string; value: number; detail: string; tone?: string }) {
  return <div className={`studio-metric ${tone}`}>
    <div className="studio-metric-head"><Icon size={14} /><span>{label}</span><b>{value}%</b></div>
    <div className="studio-metric-track"><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
    <small>{detail}</small>
  </div>;
}

export function StudioStatusBoard({ lang, stages, scenes, jobs, readyProviders, totalProviders, externalOn, saving, updatedAt, onStage, onSelectScene, onOpenJobs }: {
  lang: 'ar' | 'en';
  stages: ProductionStage[];
  scenes: Scene[];
  jobs: StudioJob[];
  readyProviders: number;
  totalProviders: number;
  externalOn: boolean;
  saving: boolean;
  updatedAt: string;
  onStage: (stage: StudioStageId) => void;
  onSelectScene: (id: string) => void;
  onOpenJobs: () => void;
}) {
  const t = (ar: string, en: string) => lang === 'ar' ? ar : en;
  const completedStages = stages.filter(stage => stage.status === 'done').length;
  const projectPercent = Math.round((completedStages / stages.length) * 100);
  const readyScenes = scenes.filter(scene => scene.title.trim() && (scene.description.trim() || scene.imagePrompt.trim())).length;
  const scenePercent = scenes.length ? Math.round((readyScenes / scenes.length) * 100) : 0;
  const assetScenes = scenes.filter(scene => scene.assetUrl && (scene.assetType === 'image' || scene.assetType === 'video')).length;
  const assetPercent = scenes.length ? Math.round((assetScenes / scenes.length) * 100) : 0;
  const completedJobs = jobs.filter(job => job.status === 'completed').length;
  const jobPercent = jobs.length ? Math.round((completedJobs / jobs.length) * 100) : 0;
  const failedJobs = jobs.filter(job => job.status === 'failed');
  const missingAssets = scenes.filter(scene => !scene.assetUrl || !['image', 'video'].includes(scene.assetType || ''));
  const missingVoices = scenes.filter(scene => scene.narration.trim() && !scene.voiceUrl);
  const assetVersions = scenes.reduce((sum, scene) => sum + (scene.assetHistory?.length || 0), 0);
  const recoverable = [
    failedJobs.length ? { ar: `${failedJobs.length} مهمة فاشلة قابلة لإعادة المحاولة`, en: `${failedJobs.length} failed job(s) can be retried`, action: onOpenJobs, labelAr: 'فتح المهام', labelEn: 'Open jobs' } : null,
    missingAssets.length ? { ar: `${missingAssets.length} مشهد بلا صورة أو فيديو`, en: `${missingAssets.length} scene(s) without an image or video`, action: () => onSelectScene(missingAssets[0].id), labelAr: 'اختيار المشهد', labelEn: 'Select scene' } : null,
    missingVoices.length ? { ar: `${missingVoices.length} مشهد بتعليق بلا صوت`, en: `${missingVoices.length} narrated scene(s) without voice`, action: () => onSelectScene(missingVoices[0].id), labelAr: 'اختيار المشهد', labelEn: 'Select scene' } : null,
  ].filter(Boolean) as { ar: string; en: string; action: () => void; labelAr: string; labelEn: string }[];
  const savedLabel = saving
    ? t('جارٍ حفظ التغييرات…', 'Saving changes…')
    : t(`آخر حفظ ${new Date(updatedAt).toLocaleTimeString(lang === 'ar' ? 'ar' : 'en', { hour: '2-digit', minute: '2-digit' })}`, `Last saved ${new Date(updatedAt).toLocaleTimeString(lang === 'ar' ? 'ar' : 'en', { hour: '2-digit', minute: '2-digit' })}`);
  return <section className="studio-status panel" aria-label={t('لوحة حالة الإنتاج', 'Production status')}>
    <div className="studio-status-head">
      <div><span className="eyebrow">{t('حالة الإنتاج الفعلية', 'LIVE PRODUCTION STATUS')}</span><h3>{t('ما تم فعليًا، وما يحتاج تدخلًا.', 'What is actually done, and what needs action.')}</h3></div>
      <div className={`studio-connection ${externalOn ? 'is-on' : 'is-off'}`}>{externalOn ? <Wifi size={13} /> : <WifiOff size={13} />}<span>{externalOn ? t(`المزوّدات الخارجية مفعّلة · ${readyProviders}/${totalProviders} جاهز`, `External providers on · ${readyProviders}/${totalProviders} ready`) : t('المزوّدات الخارجية متوقفة', 'External providers are off')}</span></div>
    </div>
    <div className="studio-metrics">
      <Metric icon={CheckCircle2} label={t('المشروع', 'Project')} value={projectPercent} detail={t(`${completedStages} من ${stages.length} مراحل مكتملة`, `${completedStages} of ${stages.length} stages complete`)} />
      <Metric icon={Film} label={t('المشاهد', 'Scenes')} value={scenePercent} detail={t(`${readyScenes} من ${scenes.length} مشهد مكتوب`, `${readyScenes} of ${scenes.length} scenes written`)} />
      <Metric icon={ImagePlus} label={t('الأصول البصرية', 'Visual assets')} value={assetPercent} detail={t(`${assetScenes} من ${scenes.length} مشهد بصورة أو فيديو`, `${assetScenes} of ${scenes.length} scenes with visuals`)} />
      <Metric icon={Clock3} label={t('المهام', 'Jobs')} value={jobPercent} detail={jobs.length ? t(`${completedJobs} مكتملة من ${jobs.length}`, `${completedJobs} complete of ${jobs.length}`) : t('لا توجد مهام بعد', 'No jobs yet')} />
    </div>
    <div className="studio-status-foot">
      <span className="studio-save"><Save size={13} />{savedLabel}</span>
      <span className="studio-save"><KeyRound size={13} />{t(`${assetVersions} نسخة أصول محفوظة`, `${assetVersions} saved asset version(s)`)}</span>
      <button type="button" className="text-link" onClick={() => onStage(stages.find(stage => stage.status === 'blocked' || stage.status === 'review')?.id || 'export')}>{t('عرض المرحلة التي تحتاج تدخلًا', 'Open the stage needing action')}</button>
    </div>
    {recoverable.length > 0 && <div className="studio-recoverable" role="status">
      <div className="studio-recoverable-head"><AlertTriangle size={14} /><b>{t('عناصر قابلة للاستعادة أو تحتاج إجراءً', 'Recoverable or action-needed items')}</b></div>
      <ul>{recoverable.map((item, index) => <li key={index}><span>{t(item.ar, item.en)}</span><button type="button" className="text-link" onClick={item.action}>{t(item.labelAr, item.labelEn)}</button></li>)}</ul>
    </div>}
  </section>;
}
