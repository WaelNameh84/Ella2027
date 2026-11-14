import { useEffect, useRef, useState } from 'react';
import { Coins, ShieldCheck } from 'lucide-react';
import { estimateCostText, providerCostRanges, type CostService } from '@/lib/provider-costs';

export type ChargeService = CostService | 'text';

const serviceLabel: Record<ChargeService, [string, string]> = {
  image: ['صورة', 'Image'],
  video: ['فيديو', 'Video'],
  voice: ['صوت', 'Voice'],
  text: ['كتابة سيناريو', 'Script writing'],
};

export function useRequestApproval(signature: string) {
  const [approved, setApproved] = useState(false);
  const current = useRef(signature);
  useEffect(() => {
    if (current.current !== signature) {
      current.current = signature;
      setApproved(false);
    }
  }, [signature]);
  return [approved, setApproved] as const;
}

function costText(service: ChargeService, provider: string | undefined, units: number, lang: 'ar' | 'en') {
  if (service === 'text') return lang === 'ar' ? 'تعتمد على النموذج وطول الرد؛ غير قابلة للحساب بدقة من التطبيق.' : 'Depends on the model and response length; the app cannot estimate it accurately.';
  const range = provider ? providerCostRanges[provider]?.[service] : undefined;
  if (range && range[0] === 0 && range[1] === 0) return lang === 'ar' ? 'مجاني — لا توجد رسوم على هذا الطلب.' : 'Free — no charge for this request.';
  return estimateCostText(provider, service, units, lang);
}

export function ChargeApprovalCard({ lang, service, provider, providerLabel, model, scenes, variants = 1, approved, onChange }: {
  lang: 'ar' | 'en';
  service: ChargeService;
  provider?: string;
  providerLabel?: string;
  model?: string;
  scenes: number;
  variants?: number;
  approved: boolean;
  onChange: (approved: boolean) => void;
}) {
  const t = (ar: string, en: string) => lang === 'ar' ? ar : en;
  const units = Math.max(1, scenes) * Math.max(1, variants);
  const cost = costText(service, provider, units, lang);
  const free = (service !== 'text' && providerCostRanges[provider || '']?.[service]?.[1] === 0) || false;
  return <section className="charge-approval" data-testid="charge-approval" aria-label={t('موافقة الطلب المدفوع', 'Paid request approval')}>
    <div className="charge-approval-head"><span className="charge-approval-icon"><Coins size={16} /></span><div><span className="eyebrow">{t('بطاقة الطلب', 'REQUEST CARD')}</span><h4>{t('مراجعة قبل الإرسال', 'Review before sending')}</h4></div><span className={`charge-approval-cost ${free ? 'is-free' : ''}`}>{cost}</span></div>
    <dl className="charge-approval-rows">
      <div><dt>{t('الخدمة', 'Service')}</dt><dd>{t(serviceLabel[service][0], serviceLabel[service][1])}</dd></div>
      <div><dt>{t('المزوّد', 'Provider')}</dt><dd>{providerLabel || provider || t('غير محدد', 'Not selected')}</dd></div>
      <div><dt>{t('النموذج', 'Model')}</dt><dd>{model?.trim() || t('يحدده المزوّد', 'Provider default')}</dd></div>
      <div><dt>{t('المشاهد', 'Scenes')}</dt><dd>{scenes}</dd></div>
      <div><dt>{t('النسخ لكل مشهد', 'Variants per scene')}</dt><dd>{variants}</dd></div>
      <div><dt>{t('إجمالي الطلبات', 'Total requests')}</dt><dd>{units}</dd></div>
    </dl>
    <div className="charge-approval-gate"><ShieldCheck size={14} /><b>{t('لن يبدأ التوليد قبل موافقتك.', 'Generation will not start before your approval.')}</b></div>
    <label className="checkline charge-consent"><input type="checkbox" checked={approved} onChange={event => onChange(event.target.checked)} />{free ? t('أوافق على إرسال هذا الطلب المجاني المحدد فقط.', 'I approve sending this exact free request only.') : t('أوافق على هذا الطلب المحدد فقط وباحتمال احتساب رسوم.', 'I approve this exact request only, including possible charges.')}</label>
    <p className="charge-approval-note">{t('الموافقة مرتبطة بالمزوّد والنموذج والعدد المعروض أعلاه. أي تغيير في الخيارات يبطلها ويطلب موافقة جديدة. قد يستخدم الخادم مزوّدًا احتياطيًا مضبوطًا عند تعطل المزوّد الأساسي أو نفاد حصته.', 'Approval is tied to the provider, model, and counts shown above. Any option change voids it and asks again. The server may use a configured fallback provider if the primary fails or runs out of quota.')}</p>
  </section>;
}
