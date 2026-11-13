export type CostService = 'image' | 'video' | 'voice';

export const providerCostRanges: Record<string, Record<CostService, [number, number]>> = {
  'free-test': { image: [0, 0], video: [0, 0], voice: [0, 0] },
  'ai-horde': { image: [0, 0], video: [0, 0], voice: [0, 0] },
  'piper-local': { image: [0, 0], video: [0, 0], voice: [0, 0] },
  openai: { image: [0.02, 0.12], video: [0.05, 2], voice: [0.01, 0.3] },
  stability: { image: [0.02, 0.08], video: [0.05, 2], voice: [0.01, 0.3] },
  replicate: { image: [0.01, 0.2], video: [0.08, 3], voice: [0.01, 0.3] },
  fal: { image: [0.01, 0.2], video: [0.08, 3], voice: [0.01, 0.3] },
  elevenlabs: { image: [0.01, 0.2], video: [0.08, 3], voice: [0.01, 0.3] },
  'google-tts': { image: [0.01, 0.2], video: [0.08, 3], voice: [0.005, 0.15] },
  'azure-speech': { image: [0.01, 0.2], video: [0.08, 3], voice: [0.005, 0.15] },
  'openai-audio': { image: [0.01, 0.2], video: [0.08, 3], voice: [0.01, 0.3] },
};

export function estimateCostText(provider: string | undefined, service: CostService, units: number, lang: 'ar' | 'en') {
  const range = providerCostRanges[provider || '']?.[service];
  if (provider === 'piper-local') return lang === 'ar' ? 'مجاني — صوت عربي محلي على الخادم' : 'Free — local Arabic voice on the app server';
  if (provider === 'ai-horde') return lang === 'ar' ? 'مجاني — استخدام مجهول، أولوية منخفضة' : 'Free — anonymous use, low priority';
  if (provider === 'free-test') return lang === 'ar' ? 'مجاني — اختبار محلي' : 'Free — local test';
  if (!range) return lang === 'ar' ? 'غير متاح لهذا المزوّد' : 'Not available for this provider';
  return `$${(range[0] * units).toFixed(2)}–$${(range[1] * units).toFixed(2)}`;
}

export function defaultVideoModel(provider: string | undefined, mode: 'text' | 'image') {
  if (provider === 'fal') return mode === 'image' ? 'minimax/h3-max/image-to-video' : 'minimax/h3-max/text-to-video';
  if (provider === 'replicate') return 'minimax/video-01';
  return '';
}

export function defaultVoiceId(provider: string | undefined) {
  if (provider === 'free-test') return 'free-test-voice';
  if (provider === 'piper-local') return 'ar_JO-kareem-low';
  if (provider === 'elevenlabs') return 'EXAVitQu4vr4xnSDxMaL';
  if (provider === 'openai' || provider === 'openai-audio') return 'alloy';
  if (provider === 'google-tts') return 'en-US-Neural2-C';
  if (provider === 'azure-speech') return 'en-US:en-US-JennyNeural';
  return '';
}
