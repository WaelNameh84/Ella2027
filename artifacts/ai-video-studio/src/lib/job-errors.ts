export type ErrorAction = 'retry' | 'settings' | 'free';

export type ExplainedError = {
  titleAr: string;
  titleEn: string;
  causeAr: string;
  causeEn: string;
  actions: ErrorAction[];
  technical: string;
};

const t = (ar: boolean, a: string, b: string) => ar ? a : b;

export function explainJobError(message: string | null | undefined, lang: 'ar' | 'en', sceneTitle?: string): ExplainedError {
  const ar = lang === 'ar';
  const technical = (message || '').trim();
  const scene = sceneTitle ? t(ar, `المشهد: ${sceneTitle}. `, `Scene: ${sceneTitle}. `) : '';
  if (!technical) return { titleAr: 'فشل الطلب', titleEn: 'Request failed', causeAr: scene + 'لم يصل تفصيل من الخادم.', causeEn: scene + 'The server returned no detail.', actions: ['retry'], technical: '' };

  const quota = /^Quota\/billing limit from ([^:]+):/i.exec(technical);
  if (quota) return {
    titleAr: 'نفاد الحصة أو الرصيد', titleEn: 'Quota or credits exhausted',
    causeAr: `${scene}المزوّد ${quota[1]} رفض الطلب لعدم توفر حصة أو رصيد. المفتاح قد يكون صحيحًا؛ جرّب مزوّدًا آخر أو انتظر تجدد الحصة.`,
    causeEn: `${scene}${quota[1]} rejected the request because its account has no quota or credits. The key may still be valid; try another provider or wait for the quota reset.`,
    actions: ['settings', 'retry'], technical,
  };
  if (/HTTP 401|HTTP 403|unauthorized|forbidden|invalid.*key|api key/i.test(technical)) return {
    titleAr: 'المفتاح غير صالح أو لا يملك الصلاحية', titleEn: 'Key is invalid or not authorized',
    causeAr: `${scene}رفض المزوّد المفتاح. تحقق من نسخه كاملًا ومن صلاحياته، ثم أعد الاختبار من الإعدادات.`,
    causeEn: `${scene}The provider rejected the key. Check that it is complete and has permission, then retest it in settings.`,
    actions: ['settings', 'retry'], technical,
  };
  if (/HTTP 429|rate.?limit|too many requests/i.test(technical)) return {
    titleAr: 'تجاوز حد المعدل', titleEn: 'Rate limit reached',
    causeAr: `${scene}أرسل المزوّد عددًا كبيرًا من الطلبات في وقت قصير. انتظر قليلًا أو استخدم مزوّدًا آخر.`,
    causeEn: `${scene}The provider received too many requests in a short time. Wait a moment or use another provider.`,
    actions: ['retry', 'settings'], technical,
  };
  const rejected = /^([^:]+): The provider rejected the request \(HTTP 400\):?\s*(.*)$/i.exec(technical);
  if (rejected) return {
    titleAr: 'المزوّد رفض إعدادات الطلب', titleEn: 'Provider rejected the request settings',
    causeAr: `${scene}${rejected[1]} رفض الطلب (HTTP 400). ${rejected[2]?.trim() ? `تفصيل المزوّد: ${rejected[2].trim()}.` : 'غالبًا النموذج أو صيغة الطلب، وليس بالضرورة المفتاح.'} جرّب نموذجًا آخر أو غيّر المزوّد.`,
    causeEn: `${scene}${rejected[1]} rejected the request (HTTP 400). ${rejected[2]?.trim() ? `Provider detail: ${rejected[2].trim()}.` : 'This usually points to the model or request format, not necessarily the key.'} Try another model or provider.`,
    actions: ['settings', 'retry'], technical,
  };
  if (/timeout|timed out|ETIMEDOUT|aborted/i.test(technical)) return {
    titleAr: 'انتهت مهلة الانتظار', titleEn: 'The request timed out',
    causeAr: `${scene}لم يستجب المزوّد ضمن الوقت المتاح. أعد المحاولة، وإن تكرر ذلك جرّب نموذجًا أسرع أو مزوّدًا آخر.`,
    causeEn: `${scene}The provider did not respond in time. Retry; if it repeats, try a faster model or another provider.`,
    actions: ['retry', 'settings'], technical,
  };
  if (/HTTP 5\d\d|bad gateway|service unavailable|internal server/i.test(technical)) return {
    titleAr: 'عطل مؤقت عند المزوّد', titleEn: 'Temporary provider outage',
    causeAr: `${scene}الخادم الخارجي أعاد خطأ خدمة. هذا غالبًا مؤقت؛ أعد المحاولة بعد قليل.`,
    causeEn: `${scene}The external server returned a service error. This is usually temporary; retry shortly.`,
    actions: ['retry'], technical,
  };
  if (/safety|content policy|moderation|blocked/i.test(technical)) return {
    titleAr: 'الطلب رُفض بسبب سياسة المحتوى', titleEn: 'Request rejected by content policy',
    causeAr: `${scene}رفض المزوّد الوصف أو الصورة لأسباب تتعلق بالسياسات. عدّل الوصف أو الموجّه ثم أعد المحاولة.`,
    causeEn: `${scene}The provider rejected the prompt or image for policy reasons. Edit the description or prompt, then retry.`,
    actions: ['retry'], technical,
  };
  if (/missing its scene|scene not found|attach.*image|no.*asset|requires.*image/i.test(technical)) return {
    titleAr: 'مدخلات المشهد ناقصة', titleEn: 'Scene inputs are missing',
    causeAr: `${scene}يحتاج الطلب إلى مشهد موجود أو صورة/وصف قبل التوليد. أكمل المدخلات ثم أعد المحاولة.`,
    causeEn: `${scene}The request needs an existing scene or an image/prompt before generation. Complete the inputs, then retry.`,
    actions: ['retry'], technical,
  };
  if (/network|fetch failed|ECONNREFUSED|ENOTFOUND|connection/i.test(technical)) return {
    titleAr: 'تعذر الاتصال بالخدمة', titleEn: 'Could not reach the service',
    causeAr: `${scene}فشل الاتصال الشبكي بالخادم أو المزوّد. تحقق من الاتصال وأعد المحاولة.`,
    causeEn: `${scene}The network connection to the server or provider failed. Check your connection and retry.`,
    actions: ['retry'], technical,
  };
  return {
    titleAr: 'فشل الطلب', titleEn: 'Request failed',
    causeAr: `${scene}لم يكتمل الطلب. راجع التفاصيل التقنية أدناه أو أعد المحاولة، وإن تكرر الخطأ غيّر المزوّد أو النموذج.`,
    causeEn: `${scene}The request did not complete. Check the technical details below or retry; if it repeats, change the provider or model.`,
    actions: ['retry', 'settings'], technical,
  };
}
