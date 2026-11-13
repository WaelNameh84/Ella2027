import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Columns2, Film, ImagePlus, LoaderCircle, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { getGetProjectQueryKey, useQueueSceneImageGeneration, useQueueSceneVideoGeneration, useUpdateScene } from '@workspace/api-client-react';
import type { ProviderKey, Scene, SceneAssetVersion } from '@workspace/api-client-react';
import { defaultVideoModel, estimateCostText } from '@/lib/provider-costs';

type Lang = 'ar' | 'en';

type Version = { id: string; url: string; type: 'image' | 'video'; prompt: string; createdAt: string; current?: boolean };

function usableKeys(keys: ProviderKey[], service: 'image' | 'video') {
  return keys.filter(key => key.enabled && key.serviceType === service && (key.status === 'valid' || key.status === 'untested' || key.status === 'quota_limited' || key.status === 'rate_limited'));
}

export function AssetVersionCompare({ projectId, scene, keys, lang, onQueued }: {
  projectId: string;
  scene: Scene;
  keys: ProviderKey[];
  lang: Lang;
  onQueued: () => void;
}) {
  const t = (ar: string, en: string) => lang === 'ar' ? ar : en;
  const qc = useQueryClient();
  const updateScene = useUpdateScene();
  const imageJob = useQueueSceneImageGeneration();
  const videoJob = useQueueSceneVideoGeneration();
  const [selected, setSelected] = useState<string[]>([]);
  const [regen, setRegen] = useState<Version | null>(null);
  const [providerId, setProviderId] = useState('');
  const [model, setModel] = useState('');
  const [approved, setApproved] = useState(false);
  const [message, setMessage] = useState('');

  const versions = useMemo<Version[]>(() => {
    const rows: Version[] = (scene.assetHistory || []).map(version => ({ ...version }));
    if (scene.assetUrl && (scene.assetType === 'image' || scene.assetType === 'video')) {
      rows.push({ id: 'current', url: scene.assetUrl, type: scene.assetType, prompt: scene.imagePrompt, createdAt: scene.updatedAt, current: true });
    }
    return rows;
  }, [scene.assetHistory, scene.assetUrl, scene.assetType, scene.imagePrompt, scene.updatedAt]);

  const toggleCompare = (version: Version) => {
    setMessage('');
    setSelected(current => current.includes(version.id) ? current.filter(id => id !== version.id) : [...current, version.id].slice(-2));
  };
  const approve = (version: Version) => {
    if (version.current) return;
    setMessage('');
    updateScene.mutate({ projectId, sceneId: scene.id, data: { assetUrl: version.url, assetType: version.type } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
        setSelected([]);
        setMessage(t('تم اعتماد النسخة؛ بقيت بقية النسخ محفوظة في السجل.', 'Version approved; the other versions stay saved in history.'));
        onQueued();
      },
      onError: () => setMessage(t('تعذر اعتماد النسخة. أعد المحاولة.', 'Could not approve this version. Try again.')),
    });
  };
  const openRegenerate = (version: Version) => {
    setRegen(version);
    setProviderId('');
    const first = usableKeys(keys, version.type)[0];
    setModel(version.type === 'video' ? defaultVideoModel(first?.provider, scene.assetType === 'image' ? 'image' : 'text') : '');
    setApproved(false);
    setMessage('');
  };
  const service = regen?.type || 'image';
  const ready = regen ? usableKeys(keys, regen.type) : [];
  const activeKey = ready.find(key => key.id === providerId) || ready[0];
  const busy = imageJob.isPending || videoJob.isPending;
  const queue = () => {
    if (!regen || !activeKey || !approved || !model.trim()) return;
    const done = () => { setRegen(null); setApproved(false); setMessage(t('أُرسل طلب توليد نسخة جديدة؛ ستظهر هنا بعد اكتمال المهمة.', 'A new variant was queued; it will appear here when the job completes.')); onQueued(); };
    if (regen.type === 'image') imageJob.mutate({ projectId, sceneId: scene.id, data: { providerKeyId: activeKey.id, model: model.trim(), outputs: 1, resolution: 1024, approvePotentialCharges: true } }, { onSuccess: done });
    else videoJob.mutate({ projectId, sceneId: scene.id, data: { providerKeyId: activeKey.id, model: model.trim(), mode: scene.assetType === 'image' ? 'image' : 'text', approvePotentialCharges: true } }, { onSuccess: done });
  };
  const compareVersions = selected.map(id => versions.find(version => version.id === id)).filter(Boolean) as Version[];
  if (!versions.length) return null;
  return <section className="asset-history asset-compare" data-testid="asset-versions">
    <div className="asset-compare-head">
      <span className="eyebrow">{t('نسخ الصور والفيديو', 'IMAGE & VIDEO VERSIONS')}</span>
      <span className="result-count">{versions.length}</span>
    </div>
    {message && <p className="asset-compare-message" role="status">{message}</p>}
    <div className="asset-version-grid">
      {versions.map((version, index) => <article className={`asset-version-card ${version.current ? 'is-current' : ''} ${selected.includes(version.id) ? 'is-selected' : ''}`} key={version.id}>
        <div className="asset-version-thumb">{version.type === 'image' ? <img src={version.url} alt="" loading="lazy" /> : <video src={version.url} muted preload="metadata" />}<span className="asset-version-type">{version.type === 'image' ? <ImagePlus size={11} /> : <Film size={11} />}{version.type}</span>{version.current && <span className="asset-version-current">{t('المعتمدة', 'Approved')}</span>}</div>
        <div className="asset-version-meta"><b>{version.current ? t('النسخة الحالية', 'Current version') : `${t('نسخة', 'Version')} ${versions.length - index}`}</b><small>{new Date(version.createdAt).toLocaleDateString(lang === 'ar' ? 'ar' : 'en')}</small>{version.prompt && <p title={version.prompt}>{version.prompt}</p>}</div>
        <div className="asset-version-actions">
          <button type="button" className={`btn btn-quiet ${selected.includes(version.id) ? 'is-active' : ''}`} onClick={() => toggleCompare(version)} title={t('إضافة إلى المقارنة', 'Add to comparison')}><Columns2 size={14} />{t('مقارنة', 'Compare')}</button>
          {!version.current && <button type="button" className="btn btn-quiet" onClick={() => approve(version)} disabled={updateScene.isPending}><Check size={14} />{t('اعتماد', 'Approve')}</button>}
          <button type="button" className="btn btn-ghost !p-1.5" onClick={() => openRegenerate(version)} title={t('إعادة توليد نسخة', 'Regenerate a variant')} aria-label={t('إعادة توليد نسخة', 'Regenerate a variant')}><RefreshCw size={14} /></button>
        </div>
      </article>)}
    </div>
    {compareVersions.length === 2 && <div className="asset-compare-board">
      <div className="asset-compare-board-head"><b>{t('مقارنة جنبًا إلى جنب', 'Side-by-side comparison')}</b><button type="button" className="btn btn-ghost !p-1" onClick={() => setSelected([])} aria-label={t('إغلاق المقارنة', 'Close comparison')}><X size={15} /></button></div>
      <div className="asset-compare-pair">
        {compareVersions.map((version, index) => <div className="asset-compare-side" key={version.id}>
          <span className="asset-compare-label">{index === 0 ? 'A' : 'B'}{version.current ? ` · ${t('المعتمدة', 'Approved')}` : ''}</span>
          <div className="asset-compare-media">{version.type === 'image' ? <img src={version.url} alt="" /> : <video src={version.url} controls muted preload="metadata" />}</div>
          <small>{version.type} · {new Date(version.createdAt).toLocaleString(lang === 'ar' ? 'ar' : 'en')}</small>
          {!version.current && <button type="button" className="btn btn-primary w-full" onClick={() => approve(version)} disabled={updateScene.isPending}>{updateScene.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}{t('اعتماد هذه النسخة', 'Approve this version')}</button>}
        </div>)}
      </div>
    </div>}
    {regen && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setRegen(null); }}><section className="modal panel" role="dialog" aria-modal="true" aria-labelledby="regen-title">
      <div className="modal-head"><div><span className="eyebrow">{t('طلب جديد', 'NEW REQUEST')}</span><h2 id="regen-title">{t('إعادة توليد نسخة واحدة', 'Regenerate one variant')}</h2><p>{t('تُحفظ النسخة الحالية وبقية النسخ كما هي، وتُضاف النتيجة الجديدة إلى السجل.', 'The current and other versions stay saved; the new result is added to history.')}</p></div><button type="button" className="btn btn-ghost !p-1" onClick={() => !busy && setRegen(null)} aria-label={t('إغلاق', 'Close')}><X size={16} /></button></div>
      <div className="form-stack">
        {!ready.length ? <div className="service-purpose-hint is-unavailable"><b>{t('لا يوجد مزوّد جاهز لهذا النوع', 'No provider is ready for this type')}</b><span>{t('أضف مفتاحًا مفعّلًا من إعدادات المزوّدات.', 'Add an enabled key in provider settings.')}</span></div> : <>
          {ready.length > 1 && <label><span className="field-label">{t('المزوّد', 'Provider')}</span><select className="studio-input" value={activeKey?.id || ''} onChange={event => { const selectedKey = ready.find(key => key.id === event.target.value); setProviderId(event.target.value); setModel(regen.type === 'video' ? defaultVideoModel(selectedKey?.provider, scene.assetType === 'image' ? 'image' : 'text') : ''); setApproved(false); }}>{ready.map(key => <option key={key.id} value={key.id}>{key.label} · {key.provider}</option>)}</select></label>}
          <label><span className="field-label">{regen.type === 'image' ? t('نموذج الصورة', 'Image model') : t('نموذج الفيديو', 'Video model')}</span><input className="studio-input" value={model} onChange={event => { setModel(event.target.value); setApproved(false); }} placeholder={activeKey?.provider === 'huggingface' ? 'black-forest-labs/FLUX.1-schnell' : activeKey?.provider === 'fal' ? 'minimax/h3-max/image-to-video' : t('معرّف النموذج لدى مزوّدك', 'Your provider model ID')} /></label>
          <div className="cost-estimate" role="note"><div><b>{t('تقدير تقريبي قبل الإرسال', 'Preflight cost estimate')}</b><span>{estimateCostText(activeKey?.provider, regen.type, 1, lang)}</span></div><small>{t('السعر النهائي يحدده النموذج والمزوّد. لن يبدأ التوليد قبل موافقتك.', 'Final pricing depends on the model and provider. Generation will not start before your approval.')}</small></div>
          <label className="checkline charge-consent"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} />{t('أوافق على إرسال طلب واحد قد تُحتسب عليه رسوم.', 'I approve one request that may incur a charge.')}</label>
        </>}
        {(imageJob.isError || videoJob.isError) && <p className="inline-error">{t('تعذر إرسال الطلب. تحقق من المفتاح والنموذج.', 'Could not queue the request. Check the key and model.')}</p>}
        <div className="modal-actions"><button type="button" className="btn btn-quiet" onClick={() => setRegen(null)} disabled={busy}>{t('إلغاء', 'Cancel')}</button><button type="button" className="btn btn-primary" onClick={queue} disabled={!activeKey || !model.trim() || !approved || busy}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : <ShieldCheck size={15} />}{t('إرسال بعد الموافقة', 'Queue after approval')}</button></div>
      </div>
    </section></div>}
  </section>;
}
