export type AssistTargetId = 'idea' | 'dialogue' | 'tone' | 'shorten' | 'suspense' | 'style' | 'camera' | 'music' | 'effects';
export type AssistField = 'idea' | 'description' | 'narration' | 'imagePrompt' | 'cameraMovement';

export type AssistSuggestion = {
  target: AssistTargetId;
  field: AssistField;
  value: string;
  rationaleAr: string;
  rationaleEn: string;
  advisory?: boolean;
};

export type AssistInput = {
  idea?: string;
  description?: string;
  narration?: string;
  imagePrompt?: string;
  cameraMovement?: string;
};

const clean = (value?: string) => (value || '').replace(/\s+/g, ' ').trim();

function shorten(text: string, max = 160) {
  const source = clean(text);
  if (!source) return '';
  const sentence = source.split(/(?<=[.!؟?])\s/)[0] || source;
  const trimmed = sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
  return trimmed;
}

export function buildSuggestion(target: AssistTargetId, input: AssistInput, lang: 'ar' | 'en'): AssistSuggestion {
  const ar = lang === 'ar';
  const description = clean(input.description);
  const narration = clean(input.narration);
  const imagePrompt = clean(input.imagePrompt);
  const idea = clean(input.idea);
  const base = description || narration || idea;
  switch (target) {
    case 'idea':
      return {
        target, field: 'idea',
        value: idea ? `${idea} لكن تفصيلًا صغيرًا في بداية الحكاية يعود في نهايتها ليقلب المعنى.` : (ar ? 'فكرة أولية: شخص يواجه موقفًا يوميًا يبدو عاديًا، لكن تفصيلًا صغيرًا يقلب كل شيء.' : 'Starting idea: a character faces an ordinary moment, but one small detail turns everything around.'),
        rationaleAr: 'أُضيفت جملة خطّاف تربط البداية بالنهاية دون تغيير موضوع الفكرة.',
        rationaleEn: 'Added a hook sentence that ties the opening to the ending without changing your premise.',
      };
    case 'dialogue':
      return {
        target, field: 'narration',
        value: narration ? `«${narration}»\n\n${ar ? '(صمت قصير، ثم خطوة إلى الأمام.)' : '(A short silence, then one step forward.)'}` : (ar ? '«لم أتوقع أن أجدك هنا.»\n\n(توقف قصير قبل أن ترد.)' : '"I did not expect to find you here."\n\n(A short pause before the reply.)'),
        rationaleAr: 'حُوّل النص إلى سطر حوار بين علامتي تنصيص مع إشارة أداء قصيرة.',
        rationaleEn: 'Turned the text into a quoted dialogue line with a short performance beat.',
      };
    case 'tone':
      return {
        target, field: 'description',
        value: base ? `${ar ? 'بنبرة هادئة لكن مشحونة' : 'In a quiet but tense tone'}: ${base}` : (ar ? 'بنبرة هادئة لكن مشحونة، مع تفاصيل صغيرة تكشف ما لا يُقال.' : 'Quiet but tense, with small details revealing what is left unsaid.'),
        rationaleAr: 'أُضيف وصف نبرة في بداية النص لتوجيه الأداء والموسيقى لاحقًا.',
        rationaleEn: 'Prefixed a tone cue to guide performance and score later.',
      };
    case 'shorten':
      return {
        target, field: description ? 'description' : 'narration',
        value: shorten(description || narration || idea),
        rationaleAr: 'اختُصر النص إلى الجملة الأولى بحد أقصى 160 حرفًا مع الحفاظ على المعنى الأساسي.',
        rationaleEn: 'Shortened to the first sentence within 160 characters while keeping the core meaning.',
      };
    case 'suspense':
      return {
        target, field: 'description',
        value: base ? `${base} ${ar ? 'ثم يتوقف كل شيء: صوت بعيد يقطع المشهد قبل أن تكتمل الجملة.' : 'Then everything stops: a distant sound cuts the scene before the line is finished.'}` : (ar ? 'يبدأ المشهد بخطوة بطيئة، ثم يتوقف كل شيء عند صوت بعيد.' : 'The scene starts with a slow step, then everything stops at a distant sound.'),
        rationaleAr: 'أُضيفت نهاية مفتوحة قصيرة تخلق تشويقًا للقطة التالية.',
        rationaleEn: 'Added a short open ending to create suspense for the next shot.',
      };
    case 'style':
      return {
        target, field: 'imagePrompt',
        value: `${imagePrompt || description || idea}${imagePrompt || description || idea ? ' — ' : ''}${ar ? 'إضاءة سينمائية متدرجة، عمق ميدان ضحل، ألوان دافئة باردة متضادة، حبيبات فيلم خفيفة' : 'graded cinematic lighting, shallow depth of field, warm-cool contrast, subtle film grain'}`,
        rationaleAr: 'أُضيفت كلمات أسلوب سينمائي ثابتة إلى موجّه الصورة لتحسين الاتساق البصري.',
        rationaleEn: 'Appended fixed cinematic-style keywords to the image prompt for visual consistency.',
      };
    case 'camera':
      return {
        target, field: 'cameraMovement',
        value: 'dolly-in',
        rationaleAr: 'اقتراح حركة Dolly in بطيئة تقرّب المشاهد من الوجه وتزيد التوتر تدريجيًا.',
        rationaleEn: 'Suggests a slow dolly-in that moves closer to the face and builds tension gradually.',
      };
    case 'music':
      return {
        target, field: 'description', advisory: true,
        value: ar ? 'موسيقى: طبقات أوتار منخفضة تتصاعد تدريجيًا، بلا إيقاع قوي؛ الصمت قبل الذروة جزء من التصميم.' : 'Music: low string layers rising gradually with no strong beat; silence before the peak is part of the design.',
        rationaleAr: 'اقتراح توجيه موسيقي نصي؛ لا يوجد حقل موسيقى نصي في المشروع، لذا يُنسخ يدويًا إلى مكتبة الموسيقى.',
        rationaleEn: 'A text music-direction suggestion; the project has no text music field, so copy it into your music library notes.',
      };
    case 'effects':
      return {
        target, field: 'description', advisory: true,
        value: ar ? 'مؤثرات: رياح خفيفة خارج الكادر، خطوات بعيدة، وصدى غرفة صغير؛ تجنّب المؤثرات الصاخبة قبل الذروة.' : 'Effects: soft wind off-screen, distant footsteps, a small room reverb; avoid loud effects before the peak.',
        rationaleAr: 'اقتراح توجيه مؤثرات نصي؛ لا يوجد حقل مؤثرات نصي في المشروع، لذا يُنسخ يدويًا إلى مكتبة المؤثرات.',
        rationaleEn: 'A text sound-effects suggestion; the project has no text effects field, so copy it into your effects library notes.',
      };
  }
}
