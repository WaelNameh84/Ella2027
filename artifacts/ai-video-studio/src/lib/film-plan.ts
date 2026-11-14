export type FilmPlan = {
  title: string;
  summary: string;
  plot: string[];
  characters: string[];
  sceneCount: number;
  sceneDurationSeconds: number;
  totalDurationSeconds: number;
  complexity: 'simple' | 'medium' | 'complex';
  complexityLabelAr: string;
  complexityLabelEn: string;
  tools: { ar: string; en: string; ready: boolean }[];
  costAr: string;
  costEn: string;
  source: 'local' | 'provider';
  providerReady: boolean;
};

type PlanInput = {
  idea: string;
  title?: string;
  videoType: string;
  sceneCount: number;
  sceneDurationSeconds: number;
  visualStyle?: string;
  lang: 'ar' | 'en';
  providerReady: boolean;
};

function firstSentence(text: string, max = 180) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const sentence = clean.split(/(?<=[.!؟?])\s/)[0] || clean;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

function detectNames(idea: string) {
  const names = new Set<string>();
  const latin = idea.match(/\b[A-Z][a-z]{2,}\b/g) || [];
  latin.forEach(name => names.add(name));
  const arabic = idea.match(/(?:اسمه|اسمها|تدعى|يدعى|تُدعى|يُدعى)\s+([\u0600-\u06FF]{3,})/g) || [];
  arabic.forEach(match => {
    const name = match.split(/\s+/).pop();
    if (name) names.add(name);
  });
  return [...names].slice(0, 4);
}

export function buildFilmPlan(input: PlanInput): FilmPlan {
  const ar = input.lang === 'ar';
  const idea = input.idea.trim();
  const summary = firstSentence(idea, 220) || (ar ? 'فكرة المشروع كما كتبتها.' : 'Your project idea as written.');
  const names = detectNames(idea);
  const characters = names.length
    ? names
    : [ar ? 'شخصية محورية (لم يُذكر اسمها في الفكرة)' : 'Lead character (no name given in the idea)'];
  const complexity: FilmPlan['complexity'] = input.sceneCount >= 12 || idea.length > 900
    ? 'complex'
    : input.sceneCount >= 6 || idea.length > 320
      ? 'medium'
      : 'simple';
  const complexityAr = complexity === 'complex' ? 'مركّب' : complexity === 'medium' ? 'متوسط' : 'بسيط';
  const complexityEn = complexity === 'complex' ? 'Complex' : complexity === 'medium' ? 'Medium' : 'Simple';
  const style = input.visualStyle?.trim();
  const plot = ar
    ? [
        `الافتتاح: ${firstSentence(idea, 110) || 'نقدّم المكان أو اللحظة التي تبدأ منها الحكاية.'}`,
        'التصعيد: تظهر الحاجة أو العقبة التي تحرّك الشخصية، ويتضح ما الذي يريده وما يمنعه.',
        `الحل: لحظة قرار أو اكتشاف تغيّر المسار، ثم خاتمة بصرية تترك أثرًا${style ? ` بأسلوب ${style}` : ''}.`,
      ]
    : [
        `Opening: ${firstSentence(idea, 110) || 'Establish the place or moment where the story begins.'}`,
        'Rising action: a need or obstacle pushes the character forward, making the goal and resistance clear.',
        `Resolution: a decision or discovery changes the path, followed by a visual ending${style ? ` in a ${style} style` : ''}.`,
      ];
  return {
    title: (input.title || '').trim() || summary.slice(0, 72) || (ar ? 'فيلم بلا عنوان' : 'Untitled film'),
    summary,
    plot,
    characters,
    sceneCount: input.sceneCount,
    sceneDurationSeconds: input.sceneDurationSeconds,
    totalDurationSeconds: input.sceneCount * input.sceneDurationSeconds,
    complexity,
    complexityLabelAr: complexityAr,
    complexityLabelEn: complexityEn,
    tools: [
      {
        ar: `Storyboard محلي (${input.sceneCount} مشاهد × ${input.sceneDurationSeconds} ث)`,
        en: `Local storyboard (${input.sceneCount} scenes × ${input.sceneDurationSeconds}s)`,
        ready: true,
      },
      {
        ar: input.providerReady ? 'مزوّد كتابة متاح — يحتاج موافقة قبل كل طلب' : 'لا يوجد مزوّد كتابة جاهز حاليًا',
        en: input.providerReady ? 'Text provider available — approval required per request' : 'No writing provider is ready right now',
        ready: input.providerReady,
      },
      {
        ar: 'صور وفيديو وصوت: تظهر أدواتها بعد توفر المفاتيح والمدخلات',
        en: 'Images, video, and voice tools appear after their keys and inputs exist',
        ready: false,
      },
    ],
    costAr: input.providerReady
      ? 'الخطة المحلية مجانية. استخدام مزوّد الكتابة قد يُحتسب حسب خطتك، ولا يمكن تقدير المبلغ بدقة من التطبيق قبل معرفة النموذج والتسعير.'
      : 'إنشاء الخطة والـ Storyboard المحلي مجاني ولا يستدعي أي مزوّد خارجي.',
    costEn: input.providerReady
      ? 'The local plan is free. A writing provider may charge according to your plan; the app cannot estimate the amount accurately before the model and pricing are known.'
      : 'Building the plan and local storyboard is free and calls no external provider.',
    source: 'local',
    providerReady: input.providerReady,
  };
}
