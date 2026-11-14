import { type ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, Show, SignIn, SignUp, UserProfile, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  useCreateProject, useListProjects, getListProjectsQueryKey, useGetStudioSummary,
  getGetStudioSummaryQueryKey, useDeleteProject, useGetProject, getGetProjectQueryKey,
  useUpdateProject, useCreateScene, useUpdateScene, useDeleteScene,
  useListProviderKeys, getListProviderKeysQueryKey,
  useCreateProviderKey, useUpdateProviderKey, useDeleteProviderKey, useTestProviderKey,
  useGetProviderSettings, getGetProviderSettingsQueryKey, useUpdateProviderSettings,
  useSearchFreeMedia, getSearchFreeMediaQueryKey, useListFreeTools, getListFreeToolsQueryKey,
  useQueueProjectScript, useQueueProjectExport, useListStudioJobs,
  getListStudioJobsQueryKey, useRetryStudioJob,
  useQueueSceneImageGeneration, useQueueSceneVideoGeneration, useQueueSceneVoiceGeneration,
  useListFavoriteMedia, getListFavoriteMediaQueryKey, useCreateFavoriteMedia, useDeleteFavoriteMedia,
  useGetAdminAccess, getGetAdminAccessQueryKey, useGetAdminOverview, getGetAdminOverviewQueryKey,
  useListAdminUsers, getListAdminUsersQueryKey, useListAdminJobs, getListAdminJobsQueryKey,
  useListAdminProviderKeys, getListAdminProviderKeysQueryKey, useUpdateAdminUser,
} from '@workspace/api-client-react';
import type { Project, ProjectDetail, ProjectInput, Scene, SceneInput, SceneUpdate, ProviderKey, ProviderSettings, MediaResult, MediaFavorite, StudioJob, CharacterProfile, AdminUser, AdminUserUpdate, StudioBrandKit, SceneImageGenerationInputOutputs } from '@workspace/api-client-react';
import { Route, Switch, Link, Redirect, useLocation, Router as WouterRouter } from 'wouter';
import {
  Aperture, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, Clapperboard, Sparkles,
  Clock3, Copy, ExternalLink, Eye, EyeOff, Film, Globe2, Heart, ImagePlus, KeyRound, Languages,
  LoaderCircle, LogOut, Mic, Moon, Pause, Plus, Search, Settings2, ShieldCheck, Sun, Trash2, UserRound, WandSparkles, X, AudioLines, Music2, Play,
  Activity, AlertTriangle, Ban, CheckCircle2, CircleUserRound, Download, FileUp, RefreshCw, Megaphone, Smartphone, BookOpen, Share2, Shield, Users,
} from 'lucide-react';
import NotFound from '@/pages/not-found';
import { ErrorBoundary } from '@/components/error-boundary';
import { FilmTimeline } from '@/components/film-timeline';
import { ProductionRail, StageTools, StudioProgress, type ProductionStage, type StudioStageId } from '@/components/studio-layout';
import { StudioStatusBoard } from '@/components/studio-status';
import { AssetVersionCompare } from '@/components/asset-versions';
import { ChargeApprovalCard, useRequestApproval } from '@/components/charge-approval';
import { WritingAssistant } from '@/components/writing-assistant';
import { ErrorRecoveryPanel } from '@/components/error-recovery';
import { FilmPlanCard } from '@/components/film-plan';
import { buildFilmPlan, type FilmPlan } from '@/lib/film-plan';
import { defaultVideoModel, defaultVoiceId, estimateCostText } from '@/lib/provider-costs';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { downloadProjectBackup, PROJECT_BACKUP_MAX_BYTES, parseProjectBackup } from '@/lib/project-backup';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path; }
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

const appearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: {
    colorPrimary: '#2d665b', colorForeground: '#26383b', colorMutedForeground: '#718080', colorDanger: '#b6453c',
    colorBackground: '#fbfaf5', colorInput: '#f4f1e9', colorInputForeground: '#26383b', colorNeutral: '#26383b',
    fontFamily: "'DM Sans', 'Noto Sans Arabic', sans-serif", borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fbfaf5] rounded-2xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#26383b] font-semibold', headerSubtitle: 'text-[#718080]',
    socialButtonsBlockButtonText: 'text-[#26383b] font-medium', formFieldLabel: 'text-[#415457] font-medium',
    footerActionLink: 'text-[#2d665b] font-semibold', footerActionText: 'text-[#718080]',
    dividerText: 'text-[#718080]', identityPreviewEditButton: 'text-[#2d665b]',
    formFieldSuccessText: 'text-[#2d665b]', alertText: 'text-[#26383b]',
    logoBox: 'mb-2', logoImage: 'h-10 w-auto', socialButtonsBlockButton: 'border-[#dfded4] bg-[#f9f7f0]',
    formButtonPrimary: 'bg-[#2d665b] hover:bg-[#24564c] text-white', formFieldInput: 'bg-[#f4f1e9] border-[#dfded4] text-[#26383b]',
    footerAction: 'text-[#718080]', dividerLine: 'bg-[#dfded4]', alert: 'bg-[#f7e9e5]',
    otpCodeFieldInput: 'bg-[#f4f1e9] border-[#dfded4]', formFieldRow: 'mb-4', main: 'gap-4',
  },
};

type Lang = 'ar' | 'en';
type AppCtx = { lang: Lang; setLang: (v: Lang) => void; dark: boolean; setDark: (v: boolean) => void };
const Context = createContext<AppCtx>({ lang: 'ar', setLang: () => {}, dark: false, setDark: () => {} });
const useApp = () => useContext(Context);
const tx = (lang: Lang, ar: string, en: string) => lang === 'ar' ? ar : en;
const FREE_TEST_KEYS: ProviderKey[] = [
  { id: '00000000-0000-4000-8000-000000000000', provider: 'free-test', label: 'Free local image test', serviceType: 'image', enabled: true, priority: -100, status: 'valid', lastTestAt: null, testMessage: 'Offline fixture; no provider call.', usedCount: 0, cooldownUntil: null, createdAt: new Date(0).toISOString() },
  { id: '00000000-0000-4000-8000-000000000001', provider: 'piper-local', label: 'Piper Arabic — local, free', serviceType: 'voice', enabled: true, priority: -100, status: 'valid', lastTestAt: null, testMessage: 'Local Arabic Jordanian narration. No provider API key or cloud inference fee.', usedCount: 0, cooldownUntil: null, createdAt: new Date(0).toISOString() },
  { id: '00000000-0000-4000-8000-000000000002', provider: 'ai-horde', label: 'AI Horde — anonymous, free, low priority', serviceType: 'image', enabled: true, priority: -200, status: 'valid', lastTestAt: null, testMessage: 'Official anonymous API identifier; no personal key. Anonymous requests have the lowest priority and may be restricted under load.', usedCount: 0, cooldownUntil: null, createdAt: new Date(0).toISOString() },
];

function providerKeyIsUsable(provider: string, status: ProviderKey['status'], cooldownUntil: string | null = null) {
  if (provider === 'free-test') return true;
  if (status === 'quota_limited' || status === 'rate_limited') {
    return !cooldownUntil || new Date(cooldownUntil).getTime() <= Date.now();
  }
  const verifyFirst = ['huggingface','cloudflare','stability','groq','assemblyai','deepgram'].includes(provider);
  return verifyFirst ? status === 'valid' : status === 'valid' || status === 'untested';
}

function userFacingJobError(message: string | null | undefined, lang: Lang): string {
  if (!message) return '';
  const quota = /^Quota\/billing limit from ([^:]+):/i.exec(message);
  if (quota) {
    return tx(lang,
      `المزوّد ${quota[1]} رفض الطلب بسبب عدم توفر حصة أو رصيد في حسابه. هذا لا يعني بالضرورة أن المفتاح مكتوب خطأ؛ سيبقى مفعّلًا ويُعاد استخدامه بعد انتهاء التهدئة إذا عادت الحصة. راجع صفحة Usage/Quota لدى المزوّد، أو انتظر تجدد الحصة، أو اختر مزوّدًا آخر لديه حصة مجانية متاحة. التطبيق لم يشترِ رصيدًا ولم يرقِّ الحساب.`,
      `${quota[1]} reports that its account has no quota or credits available. This does not necessarily mean the key is malformed. The key remains enabled and becomes selectable again after cooldown. Check the provider's Usage/Quota page, wait for its quota reset, or use another provider with available free quota. The app did not buy credits or upgrade the account.`,
    );
  }
  const rejected = /^([^:]+): The provider rejected the request \(HTTP 400\):?\s*(.*)$/i.exec(message);
  if (rejected) {
    const detail = rejected[2].trim();
    return tx(lang,
      `المزوّد ${rejected[1]} رفض طلب كتابة السيناريو (HTTP 400). ${detail ? `السبب الذي أرسله المزوّد: ${detail}.` : 'غالبًا المشكلة في النموذج أو إعدادات/صيغة الطلب، وليست مجرد مفتاح غير صحيح.'} لم نعدّ المفتاح غير صالح ولم نعطّله بسبب هذا الرد.`,
      `${rejected[1]} rejected the script request (HTTP 400). ${detail ? `Provider detail: ${detail}.` : 'This usually points to the model or request settings/format, not simply a bad key.'} The app did not mark the key invalid or disable it for this response.`,
    );
  }
  if (/quota(?:\/billing| or billing) limit/i.test(message)) {
    return tx(lang,
      'المزوّد أبلغ عن نفاد الحصة أو الرصيد. هذا لا يعني بالضرورة أن المفتاح خطأ؛ راجع صفحة الاستخدام/الحصة لدى المزوّد أو انتظر تجدد الحصة، أو استخدم مزوّدًا آخر لديه حصة متاحة.',
      'The provider reports an exhausted quota or credits. This does not necessarily mean the key is wrong; check the provider usage/quota page, wait for a reset, or use another provider with available quota.',
    );
  }
  return message;
}

function userFacingProviderTestMessage(message: string | null, providerLabel: string, lang: Lang): string {
  if (!message) return tx(lang, 'لا توجد نتيجة اختبار بعد.', 'No test result yet.');
  if (/quota(?:\/billing| or billing) limit/i.test(message)) {
    return tx(lang,
      `المزوّد ${providerLabel} أبلغ عن عدم توفر حصة أو رصيد. غالبًا المفتاح محفوظ لكنه لا يستطيع توليد السيناريو الآن. راجع Usage/Quota أو Billing لدى المزوّد، وانتظر تجدد الحصة أو استخدم مزوّدًا آخر. سيبقى المفتاح مفعّلًا، ولم يشترِ التطبيق رصيدًا أو يغيّر خطتك.`,
      `${providerLabel} reports no quota or credits available. The saved key may still be valid, but script generation will not work until quota is available. Check the provider's Usage/Quota or Billing page, wait for a reset, or use another provider. The key remains enabled; the app did not buy credits or change your plan.`,
    );
  }
  if (/rate limiting this key/i.test(message)) {
    return tx(lang,
      `المزوّد ${providerLabel} يقيّد عدد الطلبات مؤقتًا. المفتاح لم يُعطّل؛ انتظر قليلًا ثم أعد المحاولة، أو استخدم مفتاحًا/مزوّدًا آخر إذا كان تدوير المفاتيح مفعّلًا.`,
      `${providerLabel} is temporarily rate-limiting requests. The key was not disabled; wait and retry, or use another key/provider if rotation is enabled.`,
    );
  }
  return message;
}

function providerSupports(provider: string, service: string) {
  if (provider === 'free-test') return ['image', 'voice'].includes(service);
  if (service === 'text') return ['openai','gemini','anthropic','groq','cloudflare','openrouter','huggingface','colab-t5','mistral','cerebras','together','sambanova','deepseek','nvidia','cohere'].includes(provider);
  if (service === 'image') return ['openai','stability','replicate','huggingface','ai-horde'].includes(provider);
  if (service === 'video') return ['replicate','fal'].includes(provider);
  if (service === 'voice') return ['elevenlabs','openai','openai-audio','google-tts','azure-speech','piper-local'].includes(provider);
  if (service === 'transcription') return ['openai','whisper','huggingface','deepgram','assemblyai','google-speech','azure-speech'].includes(provider);
  if (service === 'media') return ['pexels','pixabay','unsplash'].includes(provider);
  return false;
}

function providerServicePurpose(service: string, lang: Lang, provider = '') {
  const purposes: Record<string, { label: string; description: string }> = {
    text: {
      label: tx(lang, 'الكتابة وتوليد السيناريو', 'Writing and script generation'),
      description: tx(lang, 'يُستخدم لكتابة النصوص وإنشاء مسودات المشاهد.', 'Used to write text and generate scene drafts.'),
    },
    image: {
      label: tx(lang, 'توليد الصور', 'Image generation'),
      description: tx(lang, 'يُستخدم لإنشاء صور للمشاهد.', 'Used to generate still images for scenes.'),
    },
    video: {
      label: tx(lang, 'توليد الفيديو', 'Video generation'),
      description: tx(lang, 'يُستخدم لإنشاء مقاطع فيديو للمشاهد.', 'Used to generate video clips for scenes.'),
    },
    voice: {
      label: tx(lang, 'التعليق الصوتي', 'Voice narration'),
      description: tx(lang, 'يحوّل النص إلى كلام أو تعليق صوتي.', 'Turns text into speech or voice narration.'),
    },
    transcription: {
      label: tx(lang, 'تفريغ الصوت والترجمة', 'Transcription and translation'),
      description: tx(lang, 'يحوّل الصوت إلى نص أو يترجمه.', 'Transcribes audio or translates it.'),
    },
    music: {
      label: tx(lang, 'الموسيقى', 'Music'),
      description: tx(lang, 'توليد الموسيقى بمفتاح API غير موصول حاليًا.', 'Music generation through API keys is not connected yet.'),
    },
    media: {
      label: tx(lang, 'البحث عن الوسائط', 'Media search'),
      description: tx(lang, 'يبحث عن الصور والفيديو من مزوّد الوسائط المحدد. مصادر Openverse وWikimedia وInternet Archive لا تحتاج إلى مفتاح.', 'Searches the selected media provider for images or video. Openverse, Wikimedia, and Internet Archive do not need a key.'),
    },
  };
  if (service === 'media' && provider === 'pexels') {
    return {
      label: tx(lang, 'البحث في Pexels', 'Pexels media search'),
      description: tx(lang, 'يبحث عن الصور ومقاطع الفيديو في Pexels بهذا المفتاح.', 'Searches Pexels for photos and video clips with this key.'),
    };
  }
  if (service === 'media' && provider === 'pixabay') {
    return {
      label: tx(lang, 'البحث في Pixabay', 'Pixabay media search'),
      description: tx(lang, 'يبحث عن الصور ومقاطع الفيديو في Pixabay بهذا المفتاح.', 'Searches Pixabay for images and video clips with this key.'),
    };
  }
  if (service === 'media' && provider === 'unsplash') {
    return {
      label: tx(lang, 'البحث عن الصور في Unsplash', 'Unsplash photo search'),
      description: tx(lang, 'يبحث عن الصور فقط في Unsplash بهذا المفتاح.', 'Searches Unsplash for photos only with this key.'),
    };
  }
  if (service === 'text' && provider === 'nvidia') {
    return {
      label: tx(lang, 'كتابة السيناريو عبر NVIDIA NIM', 'Script generation through NVIDIA NIM'),
      description: tx(lang, 'مستوى مجاني للتجربة مع حدود طلبات تتغير حسب النموذج.', 'Free prototyping access; request limits vary by model.'),
    };
  }
  if (service === 'text' && provider === 'cohere') {
    return {
      label: tx(lang, 'كتابة السيناريو عبر Cohere', 'Script generation through Cohere'),
      description: tx(lang, 'مفتاح تجريبي مجاني محدود؛ الحدود الحالية يحددها Cohere.', 'Free trial key with usage limits set by Cohere.'),
    };
  }
  if (service === 'voice' && provider === 'azure-speech') {
    return { label: tx(lang, 'التعليق الصوتي عبر Azure Speech', 'Voice narration through Azure Speech'), description: tx(lang, 'ينشئ ملف MP3 عبر منطقة Azure المضبوطة على الخادم.', 'Creates MP3 narration through the Azure region configured on the server.') };
  }
  if (service === 'voice' && provider === 'google-tts') {
    return {
      label: tx(lang, 'التعليق الصوتي عبر Google Cloud TTS', 'Voice narration through Google Cloud TTS'),
      description: tx(lang, 'ينشئ ملف MP3 من النص باستخدام مفتاح Google Cloud.', 'Creates an MP3 narration from text using a Google Cloud key.'),
    };
  }
  if (service === 'transcription' && ['deepgram','assemblyai','google-speech','azure-speech'].includes(provider)) {
    return {
      label: tx(lang, `التفريغ عبر ${provider}`, `Transcription through ${provider}`),
      description: tx(lang, 'يحوّل الملف الصوتي إلى نص. الترجمة المباشرة إلى الإنجليزية تحتاج Whisper.', 'Converts audio to text. Direct translation to English still requires Whisper.'),
    };
  }
  if (service === 'video' && ['wan22','cogvideox','ltx-video','hunyuan-video'].includes(provider)) {
    return {
      label: tx(lang, `فيديو محلي عبر ${provider}`, `Local video through ${provider}`),
      description: tx(lang, 'يحتاج Local Video Worker وسيرفر GPU. حفظه هنا يسجل اختيار النموذج ولا يبدأ التوليد قبل إعداد العامل المحلي.', 'Requires a Local Video Worker and a GPU server. Saving it records the model choice but does not generate until the worker is configured.'),
    };
  }
  if (service === 'video' && provider === 'fal') {
    return {
      label: tx(lang, 'توليد الفيديو عبر fal.ai', 'Video generation through fal.ai'),
      description: tx(lang, 'هذا المزوّد يحاسب حسب النموذج ومخرجات الفيديو؛ راجع السعر قبل كل طلب.', 'This provider bills by model and video output; review pricing before each request.'),
    };
  }
  if (service === 'video' && provider === 'replicate') {
    return {
      label: tx(lang, 'توليد الفيديو عبر Replicate', 'Video generation through Replicate'),
      description: tx(lang, 'قد تُحتسب تكلفة حسب النموذج ومدة التنفيذ؛ راجع سعره قبل الإرسال.', 'Charges may depend on the model and runtime; review its price before sending.'),
    };
  }
  return purposes[service] ?? {
    label: tx(lang, 'خدمة غير معروفة', 'Unknown service'),
    description: tx(lang, 'لم يُحدّد استخدام هذا المفتاح.', 'The purpose of this key is not defined.'),
  };
}

function providerServiceIsConnected(provider: string, service: string) {
  return ['text', 'image', 'video', 'voice', 'transcription', 'media'].includes(service)
    && providerSupports(provider, service);
}

function ThemeLanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => localStorage.getItem('studio-language') === 'en' ? 'en' : 'ar');
  const [dark, setDark] = useState(() => localStorage.getItem('studio-theme') !== 'light');
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); localStorage.setItem('studio-theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'; localStorage.setItem('studio-language', lang); }, [lang]);
  return <Context.Provider value={{ lang, setLang, dark, setDark }}>{children}</Context.Provider>;
}

const navItems = [
  { href: '/dashboard', icon: Aperture, ar: 'نظرة عامة', en: 'Overview' },
  { href: '/projects', icon: Clapperboard, ar: 'المشاريع', en: 'Projects' },
  { href: '/jobs', icon: Clock3, ar: 'المهام', en: 'Jobs' },
  { href: '/media', icon: ImagePlus, ar: 'مكتبة الوسائط', en: 'Media library' },
  { href: '/settings/providers', icon: KeyRound, ar: 'مفاتيح الخدمات', en: 'Provider keys' },
  { href: '/settings/tools', icon: Globe2, ar: 'موارد مجانية', en: 'Free resources' },
  { href: '/settings/account', icon: UserRound, ar: 'إعدادات الحساب', en: 'Account settings' },
  { href: '/admin', icon: Shield, ar: 'إدارة الاستوديو', en: 'Studio admin' },
];

function Brand({ compact = false }: { compact?: boolean }) {
  return <Link href="/" className="brand-lockup" data-testid="link-brand">
    <span className="brand-mark"><Aperture size={20} strokeWidth={1.8} /></span>
    {!compact && <span><b>مَشهد</b><small>AI VIDEO STUDIO</small></span>}
  </Link>;
}
function Busy({ text }: { text: string }) { return <div className="inline-flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle size={16} className="animate-spin" />{text}</div>; }
function SkeletonBlock({ className = '' }: { className?: string }) { return <div className={`skeleton rounded-xl ${className}`} />; }
function StateError({ retry, lang }: { retry: () => void; lang: Lang }) {
  return <div className="panel p-8 text-center"><div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-destructive/10 text-destructive"><X size={19} /></div><h3 className="font-semibold">{tx(lang, 'تعذر تحميل البيانات', 'Could not load this data')}</h3><p className="mt-1 text-sm text-muted-foreground">{tx(lang, 'تحقق من الاتصال ثم أعد المحاولة.', 'Check your connection and try again.')}</p><button onClick={retry} className="btn btn-quiet mt-4" data-testid="button-retry">{tx(lang, 'إعادة المحاولة', 'Try again')}</button></div>;
}
function MediaSearchError({ error, retry, lang }: { error: unknown; retry: () => void; lang: Lang }) {
  const detail = error instanceof Error ? error.message : '';
  return <div className="panel media-search-error" role="alert"><div className="media-search-error-icon"><X size={18}/></div><div><h3>{tx(lang,'تعذر البحث في مكتبة الوسائط','Media search failed')}</h3><p>{tx(lang,'تأكد من اتصال الإنترنت وأن المصدر المختار لا يحتاج مفتاح API، ثم أعد المحاولة.','Check your internet connection and make sure the selected source does not require an API key, then retry.')}</p>{detail && <code>{detail}</code>}<button onClick={retry} className="btn btn-quiet" data-testid="button-retry-media">{tx(lang,'إعادة المحاولة','Retry search')}</button></div></div>;
}

function MediaPreview({ item, lang }: { item: { url: string; thumbnailUrl?: string | null; title: string; mediaType: string }; lang: Lang }) {
  if (item.mediaType === 'audio') return <div className="media-audio-preview"><Music2 size={24}/><span>{tx(lang,'استمع قبل الاستخدام','Preview audio')}</span><audio controls preload="none" src={item.url} aria-label={tx(lang,`معاينة صوت ${item.title}`,`Preview ${item.title}`)} /></div>;
  return <MediaPreview item={item} lang={lang}/>;
}
function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="panel flex min-h-[220px] flex-col items-center justify-center px-6 py-10 text-center"><div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-primary"><Film size={21} /></div><h3 className="font-semibold">{title}</h3><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{body}</p>{action && <div className="mt-5">{action}</div>}</div>;
}
function HeaderBar({ title, crumb }: { title: string; crumb?: string }) {
  const { lang, setLang, dark, setDark } = useApp();
  return <header className="topbar">
    <div className="min-w-0"><div className="eyebrow">{crumb || tx(lang, 'مساحة الإنتاج', 'PRODUCTION DESK')}</div><h1 className="mt-1 truncate text-xl font-semibold tracking-tight">{title}</h1></div>
    <div className="flex shrink-0 items-center gap-2">
      <button className="btn btn-ghost top-icon" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} aria-label="Toggle language" data-testid="button-language"><Languages size={17} /><span className="hidden sm:inline">{lang === 'ar' ? 'EN' : 'عربي'}</span></button>
      <button className="btn btn-ghost top-icon" onClick={() => setDark(!dark)} aria-label="Toggle theme" data-testid="button-theme">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
      <Link href="/settings/account" className="profile-dot" title={tx(lang, 'إعدادات الحساب', 'Account settings')} aria-label={tx(lang, 'إعدادات الحساب', 'Account settings')}>م</Link>
    </div>
  </header>;
}
function Shell({ children, title, crumb }: { children: ReactNode; title: string; crumb?: string }) {
  const { lang } = useApp();
  const [path] = useLocation();
  const { signOut } = useClerk();
  const current = (href: string) => path === href || (href === '/projects' && path.startsWith('/projects/'));
  return <div className="app-shell">
    <aside className="sidebar hidden md:flex">
      <div className="sidebar-brand"><Brand /></div>
      <div className="sidebar-caption">{tx(lang, 'مساحة العمل', 'WORKSPACE')}</div>
      <nav className="side-nav">{navItems.map(({ href, icon: Icon, ar, en }) => <Link key={href} href={href} className={`side-link ${current(href) ? 'active' : ''}`} data-testid={`nav-${href.replaceAll('/', '-')}`}><Icon size={18} /><span>{tx(lang, ar, en)}</span>{current(href) && <span className="nav-indicator" />}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><span className="signal-dot" /><span>{tx(lang, 'مساحة آمنة لمشاريعك', 'Your production desk is ready')}</span></div><button className="side-link w-full" onClick={() => signOut({ redirectUrl: basePath || '/' })}><LogOut size={17} /><span>{tx(lang, 'تسجيل الخروج', 'Sign out')}</span></button></div>
    </aside>
    <main className="main-area">
      <HeaderBar title={title} crumb={crumb} />
      <div className="page-content page-enter">{children}</div>
    </main>
    <nav className="mobile-nav md:hidden">{navItems.map(({ href, icon: Icon, ar, en }) => <Link key={href} href={href} className={current(href) ? 'active' : ''}><Icon size={18} /><span>{tx(lang, ar, en)}</span></Link>)}</nav>
    <div className="grain" />
  </div>;
}
function AppFrame({ title, crumb, children }: { title: string; crumb?: string; children: ReactNode }) {
  const [path] = useLocation();
  return <SignedInOnly><Shell title={title} crumb={crumb}><RoutedErrorBoundary resetKey={path}>{children}</RoutedErrorBoundary></Shell></SignedInOnly>;
}
function SignedInOnly({ children }: { children: ReactNode }) {
  return <><Show when="signed-in">{children}</Show><Show when="signed-out"><Redirect to="/" /></Show></>;
}
function RoutedErrorBoundary({ children, resetKey }: { children: ReactNode; resetKey: string }) { return <ErrorBoundary resetKey={resetKey}>{children}</ErrorBoundary>; }

function Landing() {
  const { lang, setLang, dark, setDark } = useApp();
  return <main className="landing">
    <nav className="landing-nav"><Brand /><div className="flex items-center gap-1"><button className="btn btn-ghost top-icon" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} aria-label="Toggle language" data-testid="button-language"><Languages size={16}/><span className="hidden sm:inline">{lang === 'ar' ? 'EN' : 'عربي'}</span></button><button className="btn btn-ghost top-icon" onClick={() => setDark(!dark)} aria-label="Toggle theme" data-testid="button-theme">{dark ? <Sun size={16}/> : <Moon size={16}/>}</button><Link href="/sign-in" className="btn btn-ghost">{tx(lang, 'دخول', 'Sign in')}</Link><Link href="/sign-up" className="btn btn-primary">{tx(lang, 'ابدأ مشروعك', 'Start creating')}</Link></div></nav>
    <section className="landing-hero">
      <div className="hero-copy"><div className="eyebrow"><span className="signal-dot" />{tx(lang, 'من الفكرة إلى المشهد', 'IDEA TO FRAME')}</div>
        <h1>{lang === 'ar' ? <>اصنع فيلمك،<br/>مشهدًا بعد مشهد.</> : <>Make your film.<br/>One scene at a time.</>}</h1>
        <p>{tx(lang, 'مساحة إنتاج عربية تجمع كتابة السيناريو، ترتيب المشاهد، والوسائط المرخّصة في خط زمني واحد قابل للتحرير.', 'An Arabic-first production desk for turning a concept into a script, a scene-by-scene storyboard, and an editable timeline.')}</p>
        <div className="mt-8 flex flex-wrap gap-3"><Link href="/sign-up" className="btn btn-primary px-5 py-3">{tx(lang, 'ابدأ من فكرتك', 'Start with your idea')}<ArrowLeft size={16} /></Link><Link href="/sign-in" className="btn btn-quiet px-5 py-3">{tx(lang, 'لديك حساب؟', 'Already have an account?')}</Link></div>
        <div className="hero-proof"><span><ShieldCheck size={16} />{tx(lang, 'مشاريعك تبقى ملكك', 'Your projects stay yours')}</span><span><Film size={16} />{tx(lang, 'خط زمني قابل للتحرير', 'An editable timeline')}</span></div>
      </div>
      <div className="hero-art" aria-hidden="true"><div className="hero-art-sun" /><div className="frame-top"><span>SCENE 01 / 06</span><span className="frame-rec">REC</span></div><div className="frame-landscape"><div className="ridge ridge-back" /><div className="ridge ridge-front" /><div className="film-orb" /></div><div className="frame-bottom"><span>00:00:08:12</span><span className="frame-wave"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></span><span>16:9</span></div><div className="hero-stamp">A<br/>V<br/>S</div></div>
    </section>
    <section className="landing-process"><div className="section-intro"><span className="eyebrow">A QUIETER WAY TO MAKE</span><h2>{lang === 'ar' ? <>من شرارة أولى<br/>إلى نسخة جاهزة.</> : <>From the first spark<br/>to a finished cut.</>}</h2></div><div className="process-steps"><div><span>01</span><h3>{tx(lang, 'صِف فكرتك', 'Shape the premise')}</h3><p>{tx(lang, 'ابدأ بعنوان، جمهور، ونبرة بصرية واضحة.', 'Set a title, an audience, and a visual direction.')}</p></div><div><span>02</span><h3>{tx(lang, 'رتّب المشاهد', 'Build the storyboard')}</h3><p>{tx(lang, 'حرّر السرد، الصورة، والمدة لكل لقطة.', 'Edit the narration, image, and duration of every scene.')}</p></div><div><span>03</span><h3>{tx(lang, 'صدّر عملك', 'Render your cut')}</h3><p>{tx(lang, 'راجع الخط الزمني ونزّل الملف النهائي.', 'Review the timeline and download the rendered file.')}</p></div></div></section>
    <section className="landing-bottom"><div><span className="eyebrow">{tx(lang, 'ابدأ حين تكون جاهزًا', 'WHEN YOU ARE READY')}</span><h2>{lang === 'ar' ? <>كل فيلم يبدأ<br/>بلحظة انتباه.</> : <>Every film begins<br/>with a moment.</>}</h2></div><Link href="/sign-up" className="btn btn-primary">{tx(lang, 'افتح مساحة العمل', 'Open your workspace')}<ArrowLeft size={16} /></Link></section>
    <footer className="landing-footer"><Brand /><span>{tx(lang, 'مَشهد — مساحة صناعة الفيديو', 'Mashhad — video production workspace')}</span><span>© {new Date().getFullYear()}</span></footer><div className="grain" />
  </main>;
}

function HomeRedirect() { return <><Show when="signed-in"><Redirect to="/dashboard" /></Show><Show when="signed-out"><Landing /></Show></>; }

function Dashboard() { return <Projects homePage />; }

function DashboardOverview() {
  const { lang } = useApp();
  const q = useGetStudioSummary();
  const jobsQuery = useListStudioJobs(undefined, { query: { queryKey: getListStudioJobsQueryKey(), refetchInterval: query => query.state.data?.some(job => job.status === 'queued' || job.status === 'running') ? 3000 : false, staleTime: 15000 } });
  const summary = q.data;
  const jobs = jobsQuery.data ?? [];
  const activeJobs = jobs.filter(job => job.status === 'queued' || job.status === 'running');
  const failedJobs = jobs.filter(job => job.status === 'failed');
  const completedJobs = jobs.filter(job => job.status === 'completed');
  const label = tx(lang, 'نظرة عامة', 'Overview');
  const stats = [
    { name: tx(lang, 'كل المشاريع', 'Projects'), value: summary?.projectCount, icon: Clapperboard },
    { name: tx(lang, 'قيد الإنتاج', 'In production'), value: summary?.activeCount, icon: Clock3 },
    { name: tx(lang, 'المشاهد', 'Scenes'), value: summary?.sceneCount, icon: Film },
    { name: tx(lang, 'مفاتيح جاهزة', 'Provider keys'), value: summary?.providerCount, icon: KeyRound },
  ];
  return <AppFrame title={label}><div className="welcome-row"><div><span className="eyebrow">{tx(lang, 'AI FILM PRODUCTION STUDIO', 'AI FILM PRODUCTION STUDIO')}</span><h2>{tx(lang, 'حوّل قصتك إلى فيلم.', 'Turn your story into a film.')}</h2><p>{tx(lang, 'اكتب قصتك، أنشئ المشاهد، واختر أسلوب الإنتاج الذي يناسبك.', 'Write your story, build your scenes, and choose the production style that fits.')}</p></div><div className="flex flex-wrap gap-2"><Link href="/projects" className="btn btn-quiet"><Settings2 size={16} />{tx(lang, 'ابدأ يدويًا', 'Start manually')}</Link><Link href="/projects" className="btn btn-primary"><WandSparkles size={16} />{tx(lang, 'إنشاء مشروع جديد', 'Create new project')}</Link></div></div>
    <section className="panel dashboard-journey"><div><span className="eyebrow">{tx(lang, 'مسار الإنتاج', 'PRODUCTION JOURNEY')}</span><h3>{tx(lang, 'من الفكرة إلى التصدير.', 'From idea to export.')}</h3></div><div className="dashboard-journey-steps">{[['01','إنشاء المشروع','Create'],['02','كتابة المشاهد','Write'],['03','الشخصيات والوسائط','Build'],['04','الإنتاج والتصدير','Export']].map(([number,ar,en])=><div key={number}><span>{number}</span><b>{tx(lang,ar,en)}</b></div>)}</div></section>
    <section className="dashboard-launchpad"><div className="launchpad-copy"><span className="eyebrow">{tx(lang, 'ONE IDEA → FULL MOVIE', 'ONE IDEA → FULL MOVIE')}</span><h3>{tx(lang, 'اختر طريقة صناعة الفيلم.', 'Choose how you want to make the film.')}</h3><p>{tx(lang, 'ابدأ من فكرة أو تحكم بكل مشهد يدويًا. كلا المسارين يحفظان عملك داخل المشروع.', 'Start from an idea or control every scene manually. Both paths save your work inside the project.')}</p></div><div className="launchpad-actions"><Link href="/projects?new=1&mode=auto" className="launch-card is-featured"><span className="launch-card-icon"><WandSparkles size={18}/></span><span><b>{tx(lang, 'ابدأ من فكرة', 'Start from an idea')}</b><small>{tx(lang, 'Storyboard قابل للتعديل مع خيار مزود حقيقي وموافقة واضحة.', 'Editable storyboard with optional real provider generation and clear consent.')}</small></span><ArrowLeft size={16}/></Link><Link href="/projects?new=1&mode=manual" className="launch-card"><span className="launch-card-icon"><Settings2 size={18}/></span><span><b>{tx(lang, 'وضع احترافي يدوي', 'Professional manual mode')}</b><small>{tx(lang, 'اكتب المشاهد بنفسك دون استدعاء API للكتابة.', 'Write scenes yourself without calling a writing API.')}</small></span><ArrowLeft size={16}/></Link>{summary?.recentProjects?.[0]&&<Link href={`/projects/${summary.recentProjects[0].id}`} className="launch-card is-continue"><span className="launch-card-icon"><Play size={18}/></span><span><b>{tx(lang, 'استكمال آخر مشروع', 'Continue latest project')}</b><small>{summary.recentProjects[0].title}</small></span><ArrowLeft size={16}/></Link>}</div></section>
    {q.isLoading ? <div className="stats-grid">{stats.map((s) => <SkeletonBlock key={s.name} className="h-28" />)}</div> : q.isError ? <StateError lang={lang} retry={() => q.refetch()} /> : <div className="stats-grid">{stats.map(({ name, value, icon: Icon }, i) => <div key={name} className={`stat-card stat-${i}`}><div className="stat-icon"><Icon size={17} /></div><div className="eyebrow">{name}</div><strong>{value ?? 0}</strong><span>{i === 1 ? tx(lang, 'يحتاج متابعة', 'in progress') : tx(lang, 'في مساحة عملك', 'in your workspace')}</span></div>)}</div>}
    <section className="dashboard-operations panel"><div className="section-heading"><div><span className="eyebrow">{tx(lang, 'مراقبة الإنتاج', 'PRODUCTION MONITOR')}</span><h3>{tx(lang, 'الطابور الحقيقي الآن', 'Live production queue')}</h3></div><button className="btn btn-ghost !p-2" onClick={() => { void jobsQuery.refetch(); void q.refetch(); }} aria-label={tx(lang, 'تحديث لوحة الإنتاج', 'Refresh production dashboard')}><RefreshCw size={16} className={jobsQuery.isFetching ? 'animate-spin' : ''}/></button></div><div className="operations-grid"><div className="operation-metric"><span className="operation-icon is-active"><Activity size={16}/></span><b>{activeJobs.length}</b><span>{tx(lang, 'مهام تعمل أو تنتظر', 'queued or running')}</span></div><div className="operation-metric"><span className="operation-icon is-done"><CheckCircle2 size={16}/></span><b>{completedJobs.length}</b><span>{tx(lang, 'مهمة مكتملة', 'completed jobs')}</span></div><div className="operation-metric"><span className="operation-icon is-failed"><AlertTriangle size={16}/></span><b>{failedJobs.length}</b><span>{tx(lang, 'تحتاج مراجعة', 'need review')}</span></div></div>{activeJobs.length ? <div className="operation-job-list">{activeJobs.slice(0, 4).map(job => <Link key={job.id} href={`/projects/${job.projectId}`} className="operation-job"><span><i className="status-dot status-running"/><b>{job.message}</b></span><span>{job.progress}% <ArrowLeft size={13}/></span></Link>)}</div> : <p className="operation-empty">{tx(lang, 'لا توجد مهام قيد التنفيذ. يمكنك مراجعة مشاريعك أو بدء إنتاج جديد.', 'No jobs are running. Review a project or start a new production.')}</p>}<Link href="/jobs" className="text-link">{tx(lang, 'فتح سجل المهام الكامل', 'Open full job history')} <ArrowLeft size={14}/></Link></section>
    <section className="section-block"><div className="section-heading"><div><span className="eyebrow">{tx(lang, 'آخر ما عملت عليه', 'RECENT WORK')}</span><h3>{tx(lang, 'مشاريعك الأخيرة', 'Recent projects')}</h3></div><Link href="/projects" className="text-link">{tx(lang, 'عرض الكل', 'View all')} <ArrowLeft size={14} /></Link></div>
      {q.isLoading ? <div className="project-grid">{[1,2].map(n => <SkeletonBlock key={n} className="h-44" />)}</div> : q.isError ? null : summary?.recentProjects?.length ? <div className="project-grid">{summary.recentProjects.slice(0, 4).map(p => <ProjectCard key={p.id} project={p} />)}</div> : <Empty title={tx(lang, 'مساحة فارغة، وهذا جيد.', 'A blank slate, full of possibility.')} body={tx(lang, 'أنشئ مشروعك الأول وحوّل الفكرة إلى مشاهد.', 'Create your first project and turn a concept into scenes.')} action={<Link href="/projects" className="btn btn-primary"><Plus size={16} />{tx(lang, 'إنشاء مشروع', 'Create a project')}</Link>} />}
    </section>
    <div className="dashboard-footnote"><span className="signal-dot" />{tx(lang, 'لا توجد نتائج تجريبية هنا. ما تراه هو بيانات حسابك الفعلية.', 'No demo data here. Everything shown belongs to your account.')}</div>
  </AppFrame>;
}

function projectStatusLabel(status: string, lang: Lang) {
  const labels: Record<string, [string, string]> = { draft: ['مسودة', 'Draft'], scripting: ['كتابة السيناريو', 'Scripting'], editing: ['قيد التحرير', 'Editing'], exporting: ['قيد التصدير', 'Exporting'], completed: ['مكتمل', 'Completed'], failed: ['فشل', 'Failed'] };
  const [ar, en] = labels[status] || [status, status];
  return tx(lang, ar, en);
}
function ProjectCard({ project, onDelete, onExport, exporting = false }: { project: Project; onDelete?: (id: string) => void; onExport?: (id: string) => void; exporting?: boolean }) {
  const { lang } = useApp();
  const date = new Date(project.updatedAt).toLocaleDateString(lang === 'ar' ? 'ar' : 'en', { month: 'short', day: 'numeric' });
  return <article className="project-card panel">
    <Link href={`/projects/${project.id}`} className="project-thumb"><div className="thumb-shape thumb-a" /><div className="thumb-shape thumb-b" /><span>{project.aspectRatio}</span><div className="thumb-count">{String(project.sceneCount).padStart(2,'0')} {tx(lang, 'مشاهد', 'SCENES')}</div></Link>
    <div className="project-card-content"><div className="flex items-start justify-between gap-2"><Link href={`/projects/${project.id}`} className="project-title">{project.title}</Link><div className="flex shrink-0 items-center gap-1">{onExport && <button className="btn btn-ghost !p-1.5 text-muted-foreground" onClick={() => onExport(project.id)} disabled={exporting} title={tx(lang,'تنزيل نسخة JSON','Download JSON backup')} aria-label={tx(lang,'تنزيل نسخة احتياطية','Download backup')} data-testid={`backup-project-${project.id}`}>{exporting?<LoaderCircle size={15} className="animate-spin"/>:<Download size={15}/>}</button>}{onDelete && <button className="btn btn-ghost !p-1.5 text-muted-foreground" onClick={() => onDelete(project.id)} title={tx(lang,'حذف','Delete')} data-testid={`delete-project-${project.id}`}><Trash2 size={15} /></button>}</div></div><p>{project.idea}</p><div className="project-meta"><span><i className={`status-dot status-${project.status}`} />{projectStatusLabel(project.status, lang)}</span><span>{date}</span></div><Link href={`/projects/${project.id}`} className="project-continue">{tx(lang, 'متابعة العمل', 'Continue working')}<ArrowLeft size={14} /></Link></div>
  </article>;
}

const blankProject: ProjectInput = { title: '', idea: '', videoType: 'documentary', language: 'ar', durationSeconds: 60, audience: '', visualStyle: '', aspectRatio: '16:9' };
const videoTypes = [
  ['cinematic', 'واقعي سينمائي', 'Cinematic live action'],
  ['cartoon-3d', 'كرتون ثلاثي الأبعاد', '3D cartoon'],
  ['animation-2d', 'أنيميشن ثنائي الأبعاد', '2D animation'],
  ['animation-3d', 'أنيميشن ثلاثي الأبعاد', '3D animation'],
  ['children-story', 'قصة أطفال', 'Children’s story'],
  ['education', 'تعليمي وشرح', 'Educational explainer'],
  ['whiteboard', 'سبورة بيضاء', 'Whiteboard'],
  ['commercial', 'إعلان تجاري', 'Commercial'],
  ['product', 'عرض منتج', 'Product video'],
  ['marketing', 'تسويق', 'Marketing'],
  ['avatar', 'شخصية ناطقة', 'Talking avatar'],
  ['documentary', 'وثائقي', 'Documentary'],
  ['news', 'أخبار وتقارير', 'News report'],
  ['music-video', 'فيديو موسيقي', 'Music video'],
  ['gaming', 'ألعاب', 'Gaming'],
  ['social', 'سوشيال ميديا', 'Social media'],
  ['presentation', 'عرض تقديمي', 'Presentation'],
  ['photo-motion', 'صور مع حركة وموسيقى', 'Photo montage'],
  ['text-to-scenes', 'نص إلى مشاهد سينمائية', 'Text to cinematic scenes'],
] as const;
const visualStyles = [
  ['Hollywood Cinematic', 'هوليوود سينمائي'],
  ['Documentary', 'وثائقي'],
  ['Fantasy', 'فانتازيا'],
  ['Science Fiction', 'خيال علمي'],
  ['Animation', 'أنيميشن'],
  ['3D Cartoon', 'كرتون ثلاثي الأبعاد'],
  ['Realistic', 'واقعي'],
  ['Commercial', 'إعلاني'],
] as const;
const providerOfficialUrls: Record<string, string> = {
  openai: 'https://platform.openai.com/api-keys',
  cloudflare: 'https://dash.cloudflare.com/profile/api-tokens',
  gemini: 'https://aistudio.google.com/app/apikey',
  segmind: 'https://www.segmind.com/console/api-keys',
  cartesia: 'https://play.cartesia.ai/keys',
  luma: 'https://lumalabs.ai/dream-machine/api',
  anthropic: 'https://console.anthropic.com/settings/keys',
  groq: 'https://console.groq.com/keys',
  openrouter: 'https://openrouter.ai/keys',
  huggingface: 'https://huggingface.co/settings/tokens',
  mistral: 'https://console.mistral.ai/api-keys/',
  cerebras: 'https://cloud.cerebras.ai/',
  together: 'https://api.together.ai/settings/api-keys',
  sambanova: 'https://cloud.sambanova.ai/',
  nvidia: 'https://build.nvidia.com/settings',
  cohere: 'https://dashboard.cohere.com/api-keys',
  deepseek: 'https://platform.deepseek.com/api_keys',
  stability: 'https://platform.stability.ai/dashboard/api-keys',
  replicate: 'https://replicate.com/account/api-tokens',
  fal: 'https://fal.ai/dashboard/keys',
  runway: 'https://dev.runwayml.com/',
  elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
  'google-tts': 'https://console.cloud.google.com/apis/credentials',
  'azure-speech': 'https://portal.azure.com/',
  'openai-audio': 'https://platform.openai.com/api-keys',
  whisper: 'https://platform.openai.com/api-keys',
  deepgram: 'https://console.deepgram.com/signup?jump=keys',
  assemblyai: 'https://www.assemblyai.com/dashboard/home',
  'google-speech': 'https://console.cloud.google.com/apis/credentials',
  musicgen: 'https://github.com/facebookresearch/audiocraft',
  pexels: 'https://www.pexels.com/api/',
  pixabay: 'https://pixabay.com/api/docs/',
  unsplash: 'https://unsplash.com/developers',
  wan22: 'https://github.com/Wan-Video/Wan2.2',
  cogvideox: 'https://github.com/zai-org/CogVideo',
  'ltx-video': 'https://github.com/Lightricks/ltx-video',
  'hunyuan-video': 'https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5',
  openverse: 'https://openverse.org/',
};
const providerPlanInfo: Record<string, { kind: string; ar: string; en: string; url: string }> = {
  huggingface: { kind: 'paid', ar: 'مدفوع للاستدلال: الخطة المجانية لا تشمل رصيدًا شهريًا لمزوّدي الاستدلال؛ فحص هوية المفتاح لا يعني أن الاستدلال مجاني.', en: 'Paid inference: the Free plan includes no monthly Inference Providers credits; identity validation does not make inference free.', url: 'https://huggingface.co/docs/inference-providers/pricing' },
  cloudflare: { kind: 'free-quota', ar: 'حصة مجانية مستمرة: 10,000 Neurons يوميًا، تتجدد عند 00:00 UTC؛ تجاوز الحصة على Workers Paid يُحاسب بـ 0.011 دولار لكل 1,000 Neurons، وبعض النماذج تتطلب خطة مدفوعة.', en: 'Ongoing free quota: 10,000 Neurons/day, reset at 00:00 UTC; usage above it is billed at $0.011 per 1,000 Neurons on Workers Paid, and some models require paid billing.', url: 'https://developers.cloudflare.com/workers-ai/platform/pricing/' },
  stability: { kind: 'trial', ar: 'رصيد تجريبي محدود: 25 رصيدًا مجانيًا لمرة واحدة؛ لا تذكر الصفحة الرسمية تجديدًا دوريًا أو تاريخ انتهاء.', en: 'Limited trial: 25 one-time free credits; the cited official page does not state a recurring reset or expiry.', url: 'https://docs.stability.ai/pricing.md' },
  groq: { kind: 'free-quota', ar: 'خطة مجانية مستمرة؛ حدود الطلبات والرموز تختلف حسب النموذج والحساب، ولا يوجد رقم موحّد ثابت.', en: 'Ongoing $0 Free plan; request/token limits vary by model and account, with no single provider-wide quota.', url: 'https://console.groq.com/docs/rate-limits' },
  assemblyai: { kind: 'trial', ar: 'رصيد محدود للحسابات الجديدة: 50 دولارًا، لا تنتهي صلاحيته وفق الوثائق؛ ليس رصيدًا شهريًا متجددًا.', en: 'Limited new-account credits: $50, non-expiring per official docs; not a recurring monthly allowance.', url: 'https://www.assemblyai.com/docs/billing-and-pricing' },
  deepgram: { kind: 'trial', ar: 'رصيد تجريبي محدود: 200 دولار لمرة واحدة دون انتهاء، ثم الدفع حسب الاستخدام؛ ليس حصة دورية.', en: 'Limited trial credit: $200 one-time, with no expiry; pay-as-you-go afterward, not a recurring quota.', url: 'https://deepgram.com/pricing' },
};
const projectTemplates = [
  { id: 'shortfilm', ar: 'فيلم قصير', en: 'Short film', videoType: 'short-film', durationSeconds: 120, aspectRatio: '16:9', visualStyle: 'Cinematic narrative short', audience: 'General audience' },
  { id: 'children', ar: 'قصة أطفال', en: 'Children’s story', videoType: 'children-story', durationSeconds: 60, aspectRatio: '16:9', visualStyle: 'Warm illustrated storybook', audience: 'Children and families' },
  { id: 'lesson', ar: 'شرح تعليمي', en: 'Educational explainer', videoType: 'education', durationSeconds: 90, aspectRatio: '16:9', visualStyle: 'Clear, friendly explainer', audience: 'Students and curious learners' },
  { id: 'ad', ar: 'إعلان', en: 'Advertisement', videoType: 'commercial', durationSeconds: 30, aspectRatio: '16:9', visualStyle: 'Polished commercial', audience: 'Potential customers' },
  { id: 'product', ar: 'فيديو منتج', en: 'Product video', videoType: 'product', durationSeconds: 30, aspectRatio: '1:1', visualStyle: 'Detailed product showcase', audience: 'Online shoppers' },
  { id: 'youtube', ar: 'فيديو YouTube', en: 'YouTube video', videoType: 'social', durationSeconds: 300, aspectRatio: '16:9', visualStyle: 'Engaging creator-led video', audience: 'YouTube viewers' },
  { id: 'reels', ar: 'ريلز', en: 'Reels', videoType: 'social', durationSeconds: 30, aspectRatio: '9:16', visualStyle: 'Fast, energetic vertical video', audience: 'Social media viewers' },
  { id: 'tiktok', ar: 'TikTok', en: 'TikTok', videoType: 'social', durationSeconds: 30, aspectRatio: '9:16', visualStyle: 'Bold, quick-cut vertical video', audience: 'TikTok viewers' },
  { id: 'shorts', ar: 'Shorts', en: 'Shorts', videoType: 'social', durationSeconds: 45, aspectRatio: '9:16', visualStyle: 'High-impact vertical video', audience: 'Short-form video viewers' },
  { id: 'documentary', ar: 'وثائقي', en: 'Documentary', videoType: 'documentary', durationSeconds: 300, aspectRatio: '16:9', visualStyle: 'Grounded documentary', audience: 'General audience' },
  { id: 'presentation', ar: 'عرض تقديمي', en: 'Presentation', videoType: 'presentation', durationSeconds: 120, aspectRatio: '16:9', visualStyle: 'Readable, professional slides', audience: 'Meeting attendees' },
] as const;
function buildFreeTemplateScenes(templateId:string,idea:string,lang:Lang,visualStyle:string,sceneCount:number,sceneDurationSeconds:number) {
  const ar=lang==='ar';
  const beats:[string,string,string,string,string,string,string,string][]=ar?[
    ['الافتتاح','قدّم المكان أو اللحظة التي تبدأ منها الفكرة.','establishing','pan','المكان الذي تدور فيه الفكرة','إضاءة تأسيسية ناعمة تبرز المكان','لقطة واسعة تكشف عالم القصة وتفاصيله.','كل حكاية تبدأ من تفصيل صغير يستحق أن ننتبه له.'],
    ['السياق','عرّف المشاهد على الشخصية أو الحاجة الأساسية.','medium','tracking','بيئة الشخصية الرئيسية','إضاءة طبيعية متوازنة على الشخصية والخلفية','لقطة متوسطة تتبع الشخصية في بيئة واضحة.','هنا نلتقي بالشخصية التي تقود هذه الحكاية.'],
    ['التحدي','أظهر العقبة أو السؤال الذي يحرّك القصة.','close-up','handheld','مكان ظهور التحدي','إضاءة جانبية تصنع تباينًا وتكشف التوتر','لقطة قريبة تكشف توترًا أو قرارًا مهمًا.','لكن الطريق لا يخلو من سؤال أو تحدٍّ.'],
    ['التحوّل','قدّم لحظة اكتشاف أو خطوة إلى الأمام.','over-the-shoulder','dolly-in','موضع لحظة الاكتشاف','إضاءة دافئة تتسع تدريجيًا حول نقطة التحول','حركة كاميرا هادئة نحو لحظة اكتشاف ذات معنى.','تبدأ الأمور بالتغيّر عندما نجرؤ على المحاولة.'],
    ['الخاتمة','اختم بصورة أو فكرة تبقى في الذاكرة.','wide','zoom','المكان الختامي للقصة','إضاءة ختامية دافئة وهادئة','لقطة ختامية متوازنة تترك مساحة بصرية مريحة.','وهكذا تترك الفكرة أثرها بعد أن تنتهي الحكاية.'],
  ]:[
    ['Opening','Introduce the place or moment where the idea begins.','establishing','pan','The setting where the idea unfolds','Soft establishing light that reveals the location','Wide establishing shot revealing the story world and its details.','Every story begins with a small detail worth noticing.'],
    ['Context','Introduce the character or central need.','medium','tracking','The lead character’s environment','Balanced natural light on the character and background','Medium shot tracking a character in a clearly defined environment.','Here we meet the character who leads this story.'],
    ['Challenge','Show the obstacle or question driving the story.','close-up','handheld','The place where the challenge appears','Side lighting that adds contrast and reveals tension','Close shot revealing tension or an important decision.','But the path holds a question or a challenge.'],
    ['Turning point','Offer a discovery or a step forward.','over-the-shoulder','dolly-in','The location of the discovery','Warm light gradually opening around the turning point','Gentle camera move into a meaningful moment of discovery.','Things begin to change when we dare to try.'],
    ['Resolution','End on an image or idea that stays with the viewer.','wide','zoom','The story’s final setting','Calm, warm closing light','Balanced closing shot with calm negative space.','And the idea leaves an impression after the story ends.'],
  ];
  const template=projectTemplates.find(item=>item.id===templateId);
  return Array.from({length:sceneCount},(_,index)=>{
    const beat=beats[index%beats.length];
    const repeat=index>=beats.length?` ${Math.floor(index/beats.length)+1}`:'';
    return {
      title:`${beat[0]}${repeat}`, description:`${beat[1]} ${ar?'فكرة المشروع':'Project idea'}: ${idea.trim()}`,
      imagePrompt:`${visualStyle||template?.visualStyle||'Cinematic'}; ${beat[6]} ${ar?'الموقع':'Location'}: ${beat[4]}. ${ar?'الإضاءة':'Lighting'}: ${beat[5]}. ${ar?'من دون نص مكتوب داخل الصورة.':'No text or lettering in the image.'} ${idea.trim()}`,
      narration:beat[7], durationSeconds:sceneDurationSeconds, shotType:beat[2], cameraMovement:beat[3], location:beat[4], lighting:beat[5],
    };
  });
}
type ManualSceneDraft = { title: string; description: string; narration: string; imagePrompt: string; shotType: string; cameraMovement: string; location: string; lighting: string; imageFile: File | null };
const blankManualScene = (index: number, lang: Lang): ManualSceneDraft => ({ title: tx(lang, `المشهد ${index + 1}`, `Scene ${index + 1}`), description: '', narration: '', imagePrompt: '', shotType: 'wide', cameraMovement: 'static', location: '', lighting: '', imageFile: null });
const imageUploadContentType = (file: File) => file.type || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[file.name.split('.').pop()?.toLowerCase() || ''] || '');
function ProjectForm({ onClose, initial, initialMode = 'auto', initialTemplateId = '', onSave, pending, freeMode = true, textProviderReady = false, checkingProvider = false, generationError = false, projectCreated = false, onOpenCreated, inline = false }: { onClose: () => void; initial?: Partial<ProjectInput>; initialTemplateId?: string; onSave: (data: ProjectInput, approvePotentialCharges?: boolean, templateId?: string, mode?: 'auto' | 'manual', sceneCount?: number, sceneDurationSeconds?: number, allowExternalProviders?: boolean, manualScenes?: ManualSceneDraft[]) => void | Promise<void>; pending: boolean; freeMode?: boolean; textProviderReady?: boolean; checkingProvider?: boolean; generationError?: boolean; projectCreated?: boolean; onOpenCreated?: () => void; initialMode?: 'auto' | 'manual'; inline?: boolean }) {
  const { lang } = useApp();
  const [form, setForm] = useState<ProjectInput>({ ...blankProject, language: lang, ...initial });
  const [template, setTemplate] = useState(initialTemplateId);
  const [mode, setMode] = useState<'auto' | 'manual'>(initialMode);
  const [experienceMode, setExperienceMode] = useState<'quick' | 'pro'>(inline ? 'quick' : 'pro');
  const [customLanguage, setCustomLanguage] = useState('');
  const [approvePotentialCharges, setApprovePotentialCharges] = useState(false);
  const [sceneCount, setSceneCount] = useState(5);
  const [sceneDurationSeconds, setSceneDurationSeconds] = useState(8);
  const [manualScenes, setManualScenes] = useState<ManualSceneDraft[]>(() => Array.from({ length: 5 }, (_, index) => blankManualScene(index, lang)));
  const [allowExternalProviders, setAllowExternalProviders] = useState(!freeMode);
  const [submitError, setSubmitError] = useState('');
  const [plan, setPlan] = useState<FilmPlan | null>(null);
  const selectedTemplate = projectTemplates.find(item => item.id === template);
  const editing = Boolean(initial);
  const update = (key: keyof ProjectInput, val: string | number) => { setPlan(null); setForm(old => ({ ...old, [key]: val })); };
  const applyQuickPreset = (preset: 'shorts' | 'youtube' | 'ad') => {
    const values: { videoType: string; aspectRatio: ProjectInput['aspectRatio']; sceneCount: number; sceneDurationSeconds: number; visualStyle: string } = preset === 'shorts'
      ? { videoType: 'Social media', aspectRatio: '9:16', sceneCount: 6, sceneDurationSeconds: 5, visualStyle: 'Energetic' }
      : preset === 'youtube'
        ? { videoType: 'YouTube', aspectRatio: '16:9', sceneCount: 8, sceneDurationSeconds: 8, visualStyle: 'Cinematic' }
      : { videoType: 'Commercial', aspectRatio: '16:9', sceneCount: 6, sceneDurationSeconds: 5, visualStyle: 'Product commercial' };
    setForm(old => ({ ...old, videoType: values.videoType, aspectRatio: values.aspectRatio, visualStyle: values.visualStyle }));
    setSceneCount(values.sceneCount);
    setSceneDurationSeconds(values.sceneDurationSeconds);
    setTemplate('');
  };
  useEffect(() => setAllowExternalProviders(!freeMode), [freeMode]);
  useEffect(() => setManualScenes(current => Array.from({ length: sceneCount }, (_, index) => current[index] || blankManualScene(index, lang))), [sceneCount, lang]);
  useEffect(() => { if (projectCreated && generationError) setApprovePotentialCharges(false); }, [projectCreated, generationError]);
  const chooseExperienceMode = (next: 'quick' | 'pro') => { setExperienceMode(next); if (next === 'quick') { setMode('auto'); setTemplate(''); } };
  const quickSceneCount = Math.max(1, Math.min(24, Math.ceil(Math.max(5, form.durationSeconds) / 12)));
  const quickSceneDuration = Math.max(1, Math.floor(Math.max(5, form.durationSeconds) / quickSceneCount));
  const quickPlannedDuration = quickSceneCount * quickSceneDuration;
  const makePlan = () => buildFilmPlan({ idea: form.idea, videoType: form.videoType, sceneCount: experienceMode === 'quick' ? quickSceneCount : sceneCount, sceneDurationSeconds: experienceMode === 'quick' ? quickSceneDuration : sceneDurationSeconds, visualStyle: form.visualStyle || selectedTemplate?.visualStyle, lang, providerReady: Boolean(allowExternalProviders && textProviderReady) });
  const submit = async (planConfirmed = false) => {
    const idea = form.idea.trim();
    const firstLine = idea.split(/\r?\n/, 1)[0]?.trim() || idea;
    const firstSentence = firstLine.split(/[.!؟?]/, 1)[0]?.trim() || firstLine;
    const title = firstSentence.length > 72 ? `${firstSentence.slice(0, 71).trimEnd()}…` : firstSentence;
    const manualTitle = form.title.trim() || title;
    const effectiveSceneCount = experienceMode === 'quick' ? quickSceneCount : sceneCount;
    const effectiveSceneDuration = experienceMode === 'quick' ? quickSceneDuration : sceneDurationSeconds;
    const payload = editing ? { ...form, title: form.title.trim(), idea } : {
      ...form,
      title: mode === 'manual' ? manualTitle : title,
      idea: idea || manualTitle,
      videoType: form.videoType,
      language: form.language || (lang === 'ar' ? 'ar' : 'en'),
      durationSeconds: effectiveSceneCount * effectiveSceneDuration,
      audience: form.audience || (selectedTemplate ? (lang === 'ar' ? 'الجمهور العام' : selectedTemplate.audience) : (lang === 'ar' ? 'الجمهور العام' : 'General audience')),
      visualStyle: form.visualStyle || selectedTemplate?.visualStyle || (lang === 'ar' ? 'سينمائي' : 'Cinematic'),
      aspectRatio: form.aspectRatio || selectedTemplate?.aspectRatio || '16:9',
    };
    if (!editing && mode !== 'manual' && !plan && !planConfirmed) {
      setSubmitError('');
      setPlan(makePlan());
      return;
    }
    try {
      const useTextProvider = !editing && mode === 'auto' && !selectedTemplate && allowExternalProviders && textProviderReady;
      await onSave(payload, useTextProvider && approvePotentialCharges, !editing ? selectedTemplate?.id : undefined, mode, effectiveSceneCount, effectiveSceneDuration, !editing && mode === 'auto' ? allowExternalProviders : undefined, mode === 'manual' ? manualScenes : undefined);
      setSubmitError('');
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : tx(lang, 'تعذر حفظ إعدادات المشروع.', 'Could not save project settings.'));
    }
  };
  const useTextProvider = !editing && mode === 'auto' && !selectedTemplate && allowExternalProviders && textProviderReady;
  const approvePlan = () => {
    if (useTextProvider && !approvePotentialCharges) {
      setSubmitError(tx(lang, 'وافق على احتمال الرسوم قبل اعتماد الخطة التي تستخدم مزوّد كتابة.', 'Approve potential charges before confirming a plan that uses a writing provider.'));
      return;
    }
    setSubmitError('');
    void submit(true);
  };
  useEffect(() => { setPlan(null); }, [sceneCount, sceneDurationSeconds, allowExternalProviders]);
  const totalDurationSeconds = sceneCount * sceneDurationSeconds;
  const minSceneDuration = Math.ceil(5 / sceneCount);
  const maxSceneDuration = Math.floor(3600 / sceneCount);
  const manualScenesReady = manualScenes.length === sceneCount && manualScenes.every(scene => Boolean(scene.description.trim()));
  const retryingStory = projectCreated && mode === 'auto' && useTextProvider && generationError;
  const canSubmit = editing || (retryingStory && approvePotentialCharges) || (!projectCreated && Boolean((experienceMode === 'quick' || mode === 'auto' ? form.idea.trim() : form.title.trim())) && (experienceMode === 'quick' || mode !== 'manual' || manualScenesReady) && (!useTextProvider || approvePotentialCharges));
  const submitLabel = editing ? tx(lang,'حفظ التعديلات','Save changes') : pending ? projectCreated ? tx(lang,'جارٍ إنشاء السيناريو…','Creating story…') : tx(lang,'جارٍ إنشاء المشروع…','Creating project…') : experienceMode === 'quick' ? generationError ? tx(lang,'إعادة المحاولة','Retry') : tx(lang,'تحليل الفكرة','Analyze idea') : mode === 'manual' ? tx(lang,'أنشئ المشروع والمشاهد','Create project and scenes') : useTextProvider ? generationError ? tx(lang,'إعادة محاولة التأليف','Retry story generation') : tx(lang,'اكتب القصة','Write the story') : tx(lang,'أنشئ المشاهد تلقائيًا','Create scenes automatically');
  const submitButton = <button type="submit" disabled={pending || !canSubmit} className="btn btn-primary" data-testid="button-create-project">{pending ? <LoaderCircle className="animate-spin" size={16}/> : editing ? <Check size={16}/> : <WandSparkles size={16}/ >}{submitLabel}</button>;
  return <Modal inline={inline} className="idea-entry-card" onClose={onClose} title={editing ? tx(lang,'تعديل تفاصيل المشروع','Edit project details') : tx(lang, 'فكرتك إلى قصة', 'Turn your idea into a story')} subtitle={editing ? tx(lang, 'عدّل تفاصيل المشروع ومشاهده.', 'Update the project details.') : tx(lang, 'اكتب فكرة قصيرة، ثم اختر المسار السريع أو تحكم بالمشاهد في الوضع الاحترافي.', 'Describe your idea, then choose the quick path or control each scene in Professional mode.')}>
    <form onSubmit={e => { e.preventDefault(); void submit(); }} className="form-stack">
      {!editing && inline && <div className="experience-mode-switch" role="tablist" aria-label={tx(lang,'مستوى التحكم','Experience mode')}>
        <button type="button" role="tab" aria-selected={experienceMode==='quick'} className={experienceMode==='quick'?'is-selected':''} onClick={()=>chooseExperienceMode('quick')} disabled={projectCreated}>{tx(lang,'سريع','Quick')}</button>
        <button type="button" role="tab" aria-selected={experienceMode==='pro'} className={experienceMode==='pro'?'is-selected':''} onClick={()=>chooseExperienceMode('pro')} disabled={projectCreated}>{tx(lang,'احترافي','Professional')}</button>
      </div>}
      {!editing && mode !== 'manual' && plan && <FilmPlanCard plan={plan} lang={lang} pending={pending} approveDisabled={useTextProvider && !approvePotentialCharges} onEdit={()=>setPlan(null)} onReanalyze={()=>setPlan(makePlan())} onApprove={approvePlan} />}
      {!editing && inline && experienceMode === 'quick' ? <>
        <div className="quick-idea-entry is-inline"><label><span className="field-label">{tx(lang,'فكرة الفيلم','Film idea')}</span><textarea required maxLength={1500} rows={5} className="studio-input resize-y quick-idea-input" value={form.idea} onChange={e=>update('idea',e.target.value)} placeholder={tx(lang,'اكتب فكرتك وسنحوّلها إلى فيلم كامل…','Write your idea and we’ll shape it into a complete film…')} data-testid="input-project-idea" disabled={projectCreated} autoFocus /></label><WritingAssistant lang={lang} context="idea" values={{idea:form.idea}} onApply={(field,value)=>{if(field==='idea')update('idea',value)}} />{!plan && submitButton}</div>
        <div className="form-two"><label><span className="field-label">{tx(lang,'نوع العمل','Format')}</span><select className="studio-input" value={form.videoType} disabled={projectCreated} onChange={e=>update('videoType',e.target.value)}>{videoTypes.map(([value,ar,en])=><option key={value} value={value}>{tx(lang,ar,en)}</option>)}</select></label><label><span className="field-label">{tx(lang,'لغة الفيلم','Film language')}</span><select className="studio-input" value={form.language} disabled={projectCreated} onChange={e=>update('language',e.target.value)}><option value="ar">العربية</option><option value="en">English</option><option value="fr">Français</option><option value="es">Español</option><option value="de">Deutsch</option><option value="sv">Svenska</option></select></label></div>
        <div className="form-two"><label><span className="field-label">{tx(lang,'المدة المستهدفة بالثواني','Target duration in seconds')}</span><input type="number" min="5" max="3600" className="studio-input" value={form.durationSeconds} disabled={projectCreated} onChange={e=>update('durationSeconds',Math.max(5,Math.min(3600,Number(e.target.value)||5)))}/></label><label><span className="field-label">{tx(lang,'الجمهور','Audience')}</span><input maxLength={300} className="studio-input" value={form.audience} disabled={projectCreated} onChange={e=>update('audience',e.target.value)} placeholder={tx(lang,'مثال: العائلة، الشباب','e.g. families, young adults')}/></label></div>
        <div className="quick-duration-hint">{tx(lang,`المدة المستهدفة ${form.durationSeconds} ثانية؛ الخطة الحالية ${quickSceneCount} مشاهد × ${quickSceneDuration} ثوانٍ = ${quickPlannedDuration} ثانية.`,`Target ${form.durationSeconds}s; the current plan is ${quickSceneCount} scenes × ${quickSceneDuration}s = ${quickPlannedDuration}s.`)}</div>
        <div className="form-two"><label><span className="field-label">{tx(lang,'الأسلوب البصري','Visual style')}</span><select className="studio-input" value={visualStyles.some(([value])=>value===form.visualStyle)?form.visualStyle:'custom'} disabled={projectCreated} onChange={e=>{if(e.target.value!=='custom')update('visualStyle',e.target.value);else if(visualStyles.some(([value])=>value===form.visualStyle))update('visualStyle','');}}><option value="custom">{tx(lang,'أسلوب مخصص','Custom style')}</option>{visualStyles.map(([value,ar])=><option key={value} value={value}>{lang==='ar'?ar:value}</option>)}</select>{!visualStyles.some(([value])=>value===form.visualStyle)&&<input className="studio-input mt-2" value={form.visualStyle} disabled={projectCreated} onChange={e=>update('visualStyle',e.target.value)} placeholder={tx(lang,'اكتب أسلوبك الخاص','Describe your style')}/>}</label><label><span className="field-label">{tx(lang,'نسبة العرض','Aspect ratio')}</span><select className="studio-input" value={form.aspectRatio} disabled={projectCreated} onChange={e=>update('aspectRatio',e.target.value)}><option>16:9</option><option>9:16</option><option>1:1</option></select></label></div>
        <label className="rotation-row"><span><b>{tx(lang,'السماح بمزوّد كتابة خارجي (قد تكون هناك رسوم)','Allow an external writing provider (may cost)')}</b><small>{tx(lang,'لا يُرسل النص قبل موافقتك. الموافقة تخص طلب كتابة واحدًا؛ إعادة المحاولة تحتاج موافقة جديدة.','Nothing is sent before your approval. Consent covers one writing request; retries require fresh approval.')}</small></span><input type="checkbox" checked={allowExternalProviders} disabled={pending||projectCreated} onChange={e=>setAllowExternalProviders(e.target.checked)} data-testid="checkbox-allow-external-providers" /></label>
        {allowExternalProviders && checkingProvider && <Busy text={tx(lang,'جارٍ التحقق من مزوّد الكتابة…','Checking the writing provider…')} />}
        {allowExternalProviders && !checkingProvider && !textProviderReady && <div className="service-purpose-hint is-unavailable"><b>{tx(lang,'لا يوجد مزوّد كتابة جاهز','No writing provider is ready')}</b><span>{tx(lang,'يمكنك المتابعة بقالب Storyboard محلي؛ هذا ليس تحليلًا أو كتابة AI.','You can continue with a local storyboard template; this is not AI analysis or writing.')}</span><Link href="/settings/providers" className="text-link">{tx(lang,'إعداد المزوّدات','Set up providers')}<ArrowLeft size={14}/></Link></div>}
        {!useTextProvider && !allowExternalProviders && <div className="service-purpose-hint"><b>{tx(lang,'وضع محلي بلا تكلفة مزوّد','Local, no provider charge')}</b><span>{tx(lang,'سينشأ Storyboard أولي من قالب واضح، لا تحليل AI.','A starter storyboard template will be created, not an AI analysis.')}</span></div>}
        {useTextProvider && <label className="checkline charge-consent"><input type="checkbox" checked={approvePotentialCharges} disabled={projectCreated && !generationError} onChange={e=>setApprovePotentialCharges(e.target.checked)} data-testid="checkbox-story-charge-consent"/>{tx(lang,'أوافق على إرسال الفكرة إلى مزوّد نص واحد؛ قد تُحتسب رسوم حسب خطتي. لا يُفعّل تدوير المزوّدات، وكل إعادة محاولة تحتاج موافقة جديدة.','I approve sending this idea to one text provider; charges may apply. Provider rotation is off and every retry needs fresh approval.')}</label>}
        {generationError && <div className="inline-error" role="alert">{tx(lang,'تعذّر بدء كتابة السيناريو. أعد الموافقة قبل أي محاولة جديدة أو افتح المشروع المحفوظ.','Story generation failed. Approve again before any retry or open the saved project.')}{onOpenCreated && <button type="button" className="text-link mt-2" onClick={onOpenCreated}>{tx(lang,'فتح المشروع','Open project')}<ArrowLeft size={14}/></button>}</div>}
      </> : !editing ? <>
        <div className="workflow-mode-grid" role="radiogroup" aria-label={tx(lang,'طريقة إنشاء الفيديو','Video creation mode')}>
          <button type="button" className={`workflow-mode-card ${mode === 'auto' ? 'is-selected' : ''}`} onClick={() => setMode('auto')} role="radio" aria-checked={mode === 'auto'}>
            <WandSparkles size={19}/><strong>{tx(lang,'تلقائي','Automatic')}</strong><span>{tx(lang,'أدخل الفكرة ونوع الفيديو وعدد المشاهد ومدتها؛ ينشئ Storyboard تلقائيًا. توليد الفيديو يحتاج مفتاح مزوّد وموافقة منفصلة.','Enter the idea, format, scene count, and timing; it creates a storyboard automatically. Video generation needs a provider key and separate approval.')}</span>
          </button>
          <button type="button" className={`workflow-mode-card ${mode === 'manual' ? 'is-selected' : ''}`} onClick={() => setMode('manual')} role="radio" aria-checked={mode === 'manual'}>
            <Settings2 size={19}/><strong>{tx(lang,'يدوي','Manual')}</strong><span>{tx(lang,'أنشئ المشروع ثم أضف النصوص والوسائط وعدّل كل مشهد بنفسك.','Create the project, then add text, media, and edit every scene yourself.')}</span>
          </button>
        </div>
        {mode === 'manual' && <div className="service-purpose-hint"><b>{tx(lang,'تحكم كامل — بدون API','Full control — no API')}</b><span>{tx(lang,'سيُحفظ المشروع والمشاهد مباشرة دون استدعاء نموذج لغوي أو مزود كتابة.','The project and scenes are saved directly without calling a language model or writing provider.')}</span></div>}
        {mode === 'manual' && <>
          <label><span className="field-label">{tx(lang,'اسم الفيلم','Film title')}</span><input required maxLength={160} className="studio-input" value={form.title} onChange={e => update('title', e.target.value)} placeholder={tx(lang,'مثال: ليلة في المدينة','e.g. A night in the city')} data-testid="input-manual-film-title" autoFocus /></label>
          <div className="form-two"><label><span className="field-label">{tx(lang,'نوع الفيلم','Film genre')}</span><select className="studio-input" value={form.videoType} onChange={e => update('videoType', e.target.value)}>{videoTypes.map(([value,ar,en])=><option key={value} value={value}>{tx(lang,ar,en)}</option>)}</select></label><label><span className="field-label">{tx(lang,'لغة الفيلم','Film language')}</span><select className="studio-input" value={form.language} onChange={e => update('language', e.target.value)}><option value="ar">العربية</option><option value="en">English</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="es">Español</option></select></label></div>
          <div className="form-two"><label><span className="field-label">{tx(lang,'عدد المشاهد','Number of scenes')}</span><input type="number" min="1" max="24" step="1" className="studio-input" value={sceneCount} onChange={e => { const next = Math.max(1, Math.min(24, Number(e.target.value) || 1)); setSceneCount(next); setSceneDurationSeconds(value => Math.min(Math.floor(3600 / next), Math.max(Math.ceil(5 / next), value))); }} data-testid="input-manual-scene-count" /></label><label><span className="field-label">{tx(lang,'مدة كل مشهد بالثواني','Seconds per scene')}</span><input type="number" min={minSceneDuration} max={maxSceneDuration} step="1" className="studio-input" value={sceneDurationSeconds} onChange={e => setSceneDurationSeconds(Math.max(minSceneDuration, Math.min(maxSceneDuration, Number(e.target.value) || minSceneDuration)))} data-testid="input-manual-scene-duration" /></label></div>
          <div className="form-two"><label><span className="field-label">{tx(lang,'نسبة أبعاد الفيديو','Video aspect ratio')}</span><select className="studio-input" value={form.aspectRatio} onChange={e => update('aspectRatio', e.target.value)}><option>16:9</option><option>9:16</option><option>1:1</option><option>4:5</option></select></label><div className="service-purpose-hint"><b>{tx(lang,'المدة الإجمالية','Total duration')}</b><span>{tx(lang,`${sceneCount * sceneDurationSeconds} ثانية محفوظة مع المشروع`,`${sceneCount * sceneDurationSeconds} seconds saved with the project`)}</span></div></div>
          <label><span className="field-label">{tx(lang,'ملخص القصة (اختياري)','Story summary (optional)')}</span><textarea maxLength={12000} rows={3} className="studio-input resize-y" value={form.idea} onChange={e => update('idea', e.target.value)} placeholder={tx(lang,'أضف ملخصًا يساعدك أثناء كتابة المشاهد…','Add an optional summary to guide your scene writing…')} data-testid="input-manual-story-summary" /></label>
          <section className="manual-scene-drafts" aria-label={tx(lang, 'مسودات المشاهد اليدوية', 'Manual scene drafts')}>
            <div className="section-heading"><div><span className="eyebrow">SCENE DRAFTS</span><h3>{tx(lang, 'اكتب المشاهد قبل الإنشاء', 'Write scenes before creating')}</h3></div><span className="small-mono">{sceneCount} {tx(lang, 'مشاهد', 'scenes')}</span></div>
            <p className="generation-note">{tx(lang, 'هذه الحقول تُحفظ مباشرة في المشاهد ولا تُرسل إلى أي مزوّد كتابة. يمكنك تعديل كل التفاصيل لاحقًا من المحرر.', 'These fields are saved directly into the scenes and are never sent to a writing provider. You can edit every detail later in the workspace.')}</p>
            <div className="manual-scene-draft-list">{manualScenes.map((scene, index) => <article className="manual-scene-draft" key={index}>
              <div className="manual-scene-draft-head"><span className="storyboard-number">{String(index + 1).padStart(2, '0')}</span><b>{tx(lang, `المشهد ${index + 1}`, `Scene ${index + 1}`)}</b></div>
              <label><span className="field-label">{tx(lang, 'العنوان', 'Title')}</span><input className="studio-input" disabled={projectCreated} value={scene.title} onChange={e => setManualScenes(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: e.target.value } : item))} maxLength={160} data-testid={`input-manual-scene-title-${index + 1}`} /></label>
              <label><span className="field-label">{tx(lang, 'وصف الأحداث والمكان', 'Action and setting')}</span><textarea className="studio-input" disabled={projectCreated} rows={2} value={scene.description} onChange={e => setManualScenes(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: e.target.value } : item))} maxLength={4000} data-testid={`input-manual-scene-description-${index + 1}`} /></label>
              <label><span className="field-label">{tx(lang, 'الحوار أو التعليق الصوتي', 'Dialogue or narration')}</span><textarea className="studio-input" disabled={projectCreated} rows={2} value={scene.narration} onChange={e => setManualScenes(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, narration: e.target.value } : item))} maxLength={12000} data-testid={`input-manual-scene-narration-${index + 1}`} /></label>
              <label><span className="field-label">{tx(lang, 'وصف الصورة (اختياري)', 'Image prompt (optional)')}</span><textarea className="studio-input" disabled={projectCreated} rows={2} value={scene.imagePrompt} onChange={e => setManualScenes(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, imagePrompt: e.target.value } : item))} maxLength={3000} /></label>
              <div className="form-two"><label><span className="field-label">{tx(lang, 'نوع اللقطة', 'Shot type')}</span><select className="studio-input" disabled={projectCreated} value={scene.shotType} onChange={e => setManualScenes(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, shotType: e.target.value } : item))}><option value="wide">{tx(lang, 'لقطة واسعة', 'Wide shot')}</option><option value="medium">{tx(lang, 'لقطة متوسطة', 'Medium shot')}</option><option value="close-up">{tx(lang, 'لقطة قريبة', 'Close-up')}</option><option value="establishing">{tx(lang, 'لقطة تأسيسية', 'Establishing shot')}</option><option value="over-the-shoulder">{tx(lang, 'من فوق الكتف', 'Over the shoulder')}</option></select></label><label><span className="field-label">{tx(lang, 'حركة الكاميرا', 'Camera movement')}</span><select className="studio-input" disabled={projectCreated} value={scene.cameraMovement} onChange={e => setManualScenes(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, cameraMovement: e.target.value } : item))}><option value="static">{tx(lang, 'ثابتة', 'Static')}</option><option value="pan">Pan</option><option value="tilt">Tilt</option><option value="tracking">Tracking</option><option value="dolly-in">Dolly in</option><option value="handheld">Handheld</option><option value="zoom">Zoom</option></select></label></div>
              <div className="form-two"><label><span className="field-label">{tx(lang, 'موقع المشهد (اختياري)', 'Scene location (optional)')}</span><input className="studio-input" disabled={projectCreated} maxLength={500} value={scene.location} onChange={e => setManualScenes(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, location: e.target.value } : item))} /></label><label><span className="field-label">{tx(lang, 'الإضاءة (اختياري)', 'Lighting (optional)')}</span><input className="studio-input" disabled={projectCreated} maxLength={2000} value={scene.lighting} onChange={e => setManualScenes(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, lighting: e.target.value } : item))} /></label></div>
              <label><span className="field-label">{tx(lang, 'صورة لهذا المشهد (اختياري)', 'Image for this scene (optional)')}</span><input className="studio-input file-input" type="file" accept="image/jpeg,image/png,image/webp" disabled={projectCreated} onChange={e => { const file = e.currentTarget.files?.[0] ?? null; if (file && (file.size > 8 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(imageUploadContentType(file)))) { setManualScenes(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, imageFile: null } : item)); setSubmitError(tx(lang, 'اختر صورة JPG أو PNG أو WebP بحجم أقل من 8 MB.', 'Choose a JPG, PNG, or WebP image smaller than 8 MB.')); e.currentTarget.value = ''; return; } setSubmitError(''); setManualScenes(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, imageFile: file } : item)); }} /><small className="field-hint">{scene.imageFile ? scene.imageFile.name : tx(lang, 'اختر صورة من الهاتف. JPG / PNG / WebP، حتى 8 MB.', 'Choose a photo from your phone. JPG / PNG / WebP, up to 8 MB.')}</small></label>
            </article>)}</div>
          </section>
          <div className="service-purpose-hint"><b>{tx(lang, 'رفع يدوي دون مفتاح', 'Manual upload, no API key')}</b><span>{tx(lang, 'تُحفظ الصور في مساحة ملفات الخادم الحالية. على Render قد يكون التخزين مؤقتًا ما لم يكن قرص دائم مفعّلًا.', 'Images use the server’s current file storage. On Render, files may be temporary unless a persistent disk is configured.')}</span></div>
        </>}
        {mode === 'auto' && <>
          <div className="section-heading"><div><span className="eyebrow">{tx(lang,'بداية سريعة','QUICK START')}</span><h3>{tx(lang,'اختر نقطة انطلاق','Choose a starting point')}</h3></div><span className="small-mono">{tx(lang,'إعداد بنقرة واحدة','One-click setup')}</span></div>
          <div className="workflow-mode-grid quick-preset-grid" role="group" aria-label={tx(lang,'إعدادات الفيديو السريعة','Quick video presets')}>
            <button type="button" className="workflow-mode-card" disabled={projectCreated} onClick={() => applyQuickPreset('shorts')}><Film size={18}/><strong>{tx(lang,'Shorts / TikTok','Shorts / TikTok')}</strong><span>9:16 · 6 {tx(lang,'مشاهد','scenes')}</span></button>
            <button type="button" className="workflow-mode-card" disabled={projectCreated} onClick={() => applyQuickPreset('youtube')}><Clapperboard size={18}/><strong>{tx(lang,'YouTube','YouTube')}</strong><span>16:9 · 8 {tx(lang,'مشاهد','scenes')}</span></button>
            <button type="button" className="workflow-mode-card" disabled={projectCreated} onClick={() => applyQuickPreset('ad')}><Sparkles size={18}/><strong>{tx(lang,'إعلان منتج','Product ad')}</strong><span>16:9 · 30 {tx(lang,'ثانية','seconds')}</span></button>
          </div>
          <label><span className="field-label">{tx(lang,'ابدأ بقالب مفصل (اختياري)','Start with a detailed template (optional)')}</span><select className="studio-input" value={template} disabled={projectCreated} onChange={e=>{const id=e.target.value;setTemplate(id);const preset=projectTemplates.find(item=>item.id===id);if(preset){setSceneCount(5);setSceneDurationSeconds(Math.max(1,Math.round(preset.durationSeconds/5)));setForm(old=>({...old,videoType:preset.videoType,aspectRatio:preset.aspectRatio,visualStyle:preset.visualStyle,audience:lang==='ar'?'الجمهور العام':preset.audience}));}}}><option value="">{tx(lang,'بدون قالب — اكتب فكرتك فقط','No template — just describe your idea')}</option>{projectTemplates.map(item=><option key={item.id} value={item.id}>{tx(lang,item.ar,item.en)}</option>)}</select></label>
        </>}
        <label><span className="field-label">{tx(lang,'فكرتك','Your idea')}</span><textarea required maxLength={1500} rows={5} className="studio-input resize-y" value={form.idea} onChange={e => update('idea',e.target.value)} placeholder={tx(lang,'مثال: طفل يجد رسالة قديمة تقوده إلى سرّ في قريته…','Example: A child finds an old letter that leads to a secret in their village…')} data-testid="input-project-idea" disabled={projectCreated} autoFocus /></label>
        {mode === 'auto' && <>
          <div className="form-two"><label><span className="field-label">{tx(lang,'نوع الفيديو','Video type')}</span><select className="studio-input" value={form.videoType} disabled={projectCreated} onChange={e=>update('videoType',e.target.value)}>{videoTypes.map(([value,ar,en])=><option key={value} value={value}>{tx(lang,ar,en)}</option>)}</select></label><label><span className="field-label">{tx(lang,'لغة الفيديو','Video language')}</span><select className="studio-input" value={form.language || (lang === 'ar' ? 'ar' : 'en')} disabled={projectCreated} onChange={e=>update('language',e.target.value)}><option value="ar">العربية</option><option value="en">English</option><option value="sv">Svenska</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="es">Español</option></select></label></div>
          <div className="form-two"><label><span className="field-label">{tx(lang,'عدد المشاهد','Number of scenes')}</span><input type="number" min="1" max="24" step="1" className="studio-input" value={sceneCount} disabled={projectCreated} onChange={e=>{const next=Math.max(1,Math.min(24,Number(e.target.value)||1));setSceneCount(next);setSceneDurationSeconds(value=>Math.min(Math.floor(3600/next),Math.max(Math.ceil(5/next),value)));}} data-testid="input-scene-count" /></label><label><span className="field-label">{tx(lang,'نسبة الأبعاد','Aspect ratio')}</span><select className="studio-input" value={form.aspectRatio || '16:9'} disabled={projectCreated} onChange={e=>update('aspectRatio',e.target.value)}><option>16:9</option><option>9:16</option><option>1:1</option><option>4:5</option></select></label></div>
          <div className="form-two"><label><span className="field-label">{tx(lang,'مدة كل مشهد بالثواني','Seconds per scene')}</span><input type="number" min={minSceneDuration} max={maxSceneDuration} step="1" className="studio-input" value={sceneDurationSeconds} disabled={projectCreated} onChange={e=>setSceneDurationSeconds(Math.max(minSceneDuration,Math.min(maxSceneDuration,Number(e.target.value)||minSceneDuration)))} data-testid="input-scene-duration" /></label><div className="service-purpose-hint"><b>{tx(lang,'المدة الإجمالية المحسوبة','Calculated total duration')}</b><span>{tx(lang,`${totalDurationSeconds} ثانية (${sceneCount} × ${sceneDurationSeconds})`,`${totalDurationSeconds} seconds (${sceneCount} × ${sceneDurationSeconds})`)}</span></div></div>
          <label className="rotation-row"><span><b>{tx(lang,'السماح بالمزوّدات الخارجية (قد تكون مدفوعة)','Allow external providers (may cost)')}</b><small>{tx(lang,'عند تشغيله يمكن استخدام مفاتيحك للنص والفيديو. سيطلب التطبيق موافقتك قبل إرسال كل طلب قد يكلّف.','When enabled, your text/video provider keys can be used. The app still asks before each request that may incur a charge.')}</small></span><input type="checkbox" checked={allowExternalProviders} disabled={pending||projectCreated} onChange={e=>setAllowExternalProviders(e.target.checked)} data-testid="checkbox-allow-external-providers" /></label>
          {selectedTemplate && <div className="service-purpose-hint"><b>{tx(lang,'Storyboard محلي','Local storyboard')}</b><span>{tx(lang,`سيُنشئ ${sceneCount} مشاهد قابلة للتعديل بمدة ${sceneDurationSeconds} ثوانٍ لكل مشهد، دون اتصال بمزوّد. أضف الصور أو ولّد الفيديو لاحقًا بعد إعداد المفاتيح.`,`Creates ${sceneCount} editable scenes at ${sceneDurationSeconds} seconds each without a provider call. Add images or generate videos later after setting up keys.`)}</span></div>}
          {!selectedTemplate && !useTextProvider && <div className="service-purpose-hint"><b>{tx(lang,'إنشاء تلقائي محلي','Automatic local storyboard')}</b><span>{tx(lang,'سيحوّل التطبيق فكرتك إلى مشاهد قابلة للتعديل دون طلب خارجي. هذا Storyboard أولي وليس فيديو AI مولّدًا. أضف مفتاح الكتابة لاحقًا لتأليف أذكى.','The app will turn your idea into editable scenes without an external request. This is a starter storyboard, not an AI-generated video. Add a text key later for AI writing.')}</span></div>}
          {allowExternalProviders && !selectedTemplate && checkingProvider && <Busy text={tx(lang,'جارٍ التحقق من مفتاح الكتابة…','Checking your writing key…')} />}
          {allowExternalProviders && !selectedTemplate && !checkingProvider && !textProviderReady && <div className="service-purpose-hint is-unavailable"><b>{tx(lang,'لا يوجد مفتاح كتابة جاهز بعد','No text-generation key is ready yet')}</b><span>{tx(lang,'يمكنك إنشاء Storyboard محلي الآن، أو إضافة مفتاح نص من الإعدادات لاحقًا.','You can create a local storyboard now, or add a text provider key in Settings later.')}</span><Link href="/settings/providers" className="text-link">{tx(lang,'إعداد مفاتيح الخدمات','Set up provider keys')}<ArrowLeft size={14}/></Link></div>}
          {useTextProvider && <label className="checkline charge-consent"><input type="checkbox" checked={approvePotentialCharges} disabled={projectCreated && !generationError} onChange={e=>setApprovePotentialCharges(e.target.checked)} data-testid="checkbox-story-charge-consent"/>{tx(lang,'أوافق على إرسال الفكرة إلى مزوّد نص واحد؛ قد تُحتسب رسوم حسب خطتي. لا يُفعّل تدوير المزوّدات، وكل إعادة محاولة تحتاج موافقة جديدة.','I approve sending this idea to one text provider; charges may apply. Provider rotation is off and every retry needs fresh approval.')}</label>}
        </>}
        {generationError && <div className="inline-error" role="alert">{mode === 'manual' ? tx(lang,'تم إنشاء المشروع، لكن تعذّر حفظ كل المشاهد أو الصور. افتح المشروع لمتابعة ما تم حفظه.','The project was created, but some scenes or images could not be saved. Open it to continue.') : tx(lang,'تم حفظ الفكرة، لكن تعذّر بدء تأليف القصة. أعد الموافقة قبل المحاولة أو افتح المشروع.','Your idea was saved, but story generation could not start. Approve again before retrying or open the project.')}{onOpenCreated && <button type="button" className="text-link mt-2" onClick={onOpenCreated}>{tx(lang,'فتح المشروع','Open project')}<ArrowLeft size={14}/></button>}</div>}
      </> : <>
        <label><span className="field-label">{tx(lang,'عنوان المشروع','Project title')}</span><input required maxLength={160} className="studio-input" value={form.title} onChange={e => update('title',e.target.value)} placeholder={tx(lang,'مثال: ذاكرة البحر','e.g. Memory of the sea')} data-testid="input-project-title" /></label>
        <label><span className="field-label">{tx(lang,'الفكرة','Concept')}</span><textarea required maxLength={12000} rows={3} className="studio-input resize-y" value={form.idea} onChange={e => update('idea',e.target.value)} placeholder={tx(lang,'ما القصة التي تريد روايتها؟','What story do you want to tell?')} data-testid="input-project-idea" /></label>
        <div className="form-two"><label><span className="field-label">{tx(lang,'نوع الفيديو','Format')}</span><select className="studio-input" value={form.videoType} onChange={e => update('videoType',e.target.value)}>{videoTypes.map(([value,ar,en])=><option key={value} value={value}>{tx(lang,ar,en)}</option>)}</select></label><label><span className="field-label">{tx(lang,'اللغة','Language')}</span><select className="studio-input" value={['ar','en','fr','de','sv','es'].includes(form.language)?form.language:'other'} onChange={e => {const value=e.target.value;if(value==='other'){update('language',customLanguage||'other');}else{setCustomLanguage('');update('language',value);}}}><option value="ar">العربية</option><option value="en">English</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="sv">Svenska</option><option value="es">Español</option><option value="other">{tx(lang,'لغة أخرى','Other language')}</option></select></label></div>
        {!['ar','en','fr','de','sv','es'].includes(form.language) && <label><span className="field-label">{tx(lang,'اسم اللغة','Language name')}</span><input required className="studio-input" value={form.language==='other'?customLanguage:form.language} onChange={e=>{setCustomLanguage(e.target.value);update('language',e.target.value);}} placeholder={tx(lang,'مثال: التركية','e.g. Turkish')} /></label>}
        <div className="form-two"><label><span className="field-label">{tx(lang,'المدة بالثواني','Duration in seconds')}</span><input type="number" min="5" max="3600" className="studio-input" value={form.durationSeconds} onChange={e => update('durationSeconds',Number(e.target.value))} /></label><label><span className="field-label">{tx(lang,'نسبة الأبعاد','Aspect ratio')}</span><select className="studio-input" value={form.aspectRatio} onChange={e => update('aspectRatio',e.target.value)}><option>16:9</option><option>9:16</option><option>1:1</option><option>4:5</option><option>4:3</option><option>3:2</option></select></label></div>
        <div className="form-two"><label><span className="field-label">{tx(lang,'الجمهور','Audience')}</span><input className="studio-input" value={form.audience} onChange={e => update('audience',e.target.value)} /></label><label><span className="field-label">{tx(lang,'الأسلوب البصري','Visual style')}</span><select className="studio-input" value={visualStyles.some(([value])=>value===form.visualStyle)?form.visualStyle:'custom'} onChange={e=>{if(e.target.value!=='custom')update('visualStyle',e.target.value);else if(visualStyles.some(([value])=>value===form.visualStyle))update('visualStyle','');}}><option value="custom">{tx(lang,'أسلوب مخصص','Custom style')}</option>{visualStyles.map(([value,ar])=><option key={value} value={value}>{lang==='ar'?ar:value}</option>)}</select>{!visualStyles.some(([value])=>value===form.visualStyle)&&<input className="studio-input mt-2" value={form.visualStyle} onChange={e=>update('visualStyle',e.target.value)} placeholder={tx(lang,'اكتب أسلوبك الخاص','Describe your own style')} />}</label></div>
      </>}
      {submitError && <p className="inline-error" role="alert">{submitError}</p>}
      {!plan && (!inline || experienceMode !== 'quick') && <div className="modal-actions">{!inline && <button type="button" className="btn btn-quiet" onClick={onClose}>{tx(lang,'إلغاء','Cancel')}</button>}{submitButton}</div>}
    </form>
  </Modal>;
}
function Modal({ title, subtitle, onClose, children, inline = false, className = '' }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; inline?: boolean; className?: string }) {
  const content = <><div className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{!inline && <button className="btn btn-ghost !p-2" onClick={onClose} aria-label="Close"><X size={18}/></button>}</div>{children}</>;
  if (inline) return <section className={`inline-project-form panel ${className}`}>{content}</section>;
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" className={`modal panel ${className}`}>{content}</section></div>;
}

function Projects({ homePage = false }: { homePage?: boolean }) {
  const { lang } = useApp();
  const [location, setLocation] = useLocation();
  const q = useListProjects();
  const keysQuery = useListProviderKeys();
  const settingsQuery = useGetProviderSettings();
  const updateProviderSettings = useUpdateProviderSettings();
  const qc = useQueryClient();
  const create = useCreateProject();
  const createScene = useCreateScene();
  const generate = useQueueProjectScript();
  const remove = useDeleteProject();
  const jobsQuery = useListStudioJobs(undefined, { query: { queryKey: getListStudioJobsQueryKey(), staleTime: 15000 } });
  const [open, setOpen] = useState(false);
  const [newTemplate, setNewTemplate] = useState<string | undefined>(undefined);
  const openNewProject = (templateId?: string) => { setNewTemplate(templateId); setOpen(true); };
  useEffect(() => { const params = new URLSearchParams(location.split('?')[1] || ''); const requestedMode = params.get('mode'); if (!homePage && params.get('new') === '1') setOpen(true); if (!homePage && (requestedMode === 'manual' || requestedMode === 'auto')) setOpen(true); }, [location, homePage]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'updated' | 'name' | 'status'>('updated');
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [projectSaveError, setProjectSaveError] = useState(false);
  const [savingManualScenes, setSavingManualScenes] = useState(false);
  const [backupExportingId, setBackupExportingId] = useState<string | null>(null);
  const [backupImporting, setBackupImporting] = useState(false);
  const [backupProgress, setBackupProgress] = useState('');
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const list = useMemo(() => {
    const filtered = (q.data || []).filter(p => `${p.title} ${p.idea}`.toLowerCase().includes(search.toLowerCase()));
    return [...filtered].sort((a, b) => sort === 'name'
      ? a.title.localeCompare(b.title, lang === 'ar' ? 'ar' : 'en')
      : sort === 'status'
        ? a.status.localeCompare(b.status)
        : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [q.data, search, sort, lang]);
  const textProviderReady = Boolean(keysQuery.data?.some(key => key.serviceType === 'text' && providerSupports(key.provider, 'text') && key.enabled && providerKeyIsUsable(key.provider,key.status,key.cooldownUntil)));
  const freeMode = settingsQuery.data?.freeMode ?? true;
  const afterChange = () => { qc.invalidateQueries({ queryKey: getListProjectsQueryKey() }); qc.invalidateQueries({ queryKey: getGetStudioSummaryQueryKey() }); };
  const exportBackup = async (projectId: string) => {
    setBackupExportingId(projectId);
    setBackupProgress('');
    try {
      const response = await fetch(`${basePath}/api/projects/${projectId}`, { credentials: 'include' });
      if (!response.ok) throw new Error(tx(lang, 'تعذر تحميل المشروع للنسخ.', 'Could not load the project for backup.'));
      const project = await response.json() as ProjectDetail;
      downloadProjectBackup(project);
      setBackupProgress(tx(lang, `بدأ تنزيل نسخة «${project.title}».`, `Backup download started for “${project.title}”.`));
    } catch (error) {
      setBackupProgress(error instanceof Error ? error.message : tx(lang, 'تعذر إنشاء النسخة الاحتياطية.', 'Could not create the backup.'));
    } finally {
      setBackupExportingId(null);
    }
  };
  const importBackupFile = async (file: File) => {
    setBackupImporting(true);
    setBackupProgress('');
    let importedProjectId: string | null = null;
    let unavailableLocalMediaCount = 0;
    try {
      if (file.size > PROJECT_BACKUP_MAX_BYTES) throw new Error(tx(lang, 'حجم ملف النسخة يتجاوز 10 MB.', 'The backup file exceeds 10 MB.'));
      const backup = parseProjectBackup(JSON.parse(await file.text()));
      const createdProject = await create.mutateAsync({ data: backup.project });
      importedProjectId = createdProject.id;
      for (const [index, scene] of backup.scenes.entries()) {
        setBackupProgress(tx(lang, `استيراد المشهد ${index + 1} من ${backup.scenes.length}…`, `Importing scene ${index + 1} of ${backup.scenes.length}…`));
        const { assetHistory, ...sceneFields } = scene;
        const sceneData: SceneInput = {
          ...sceneFields,
          assetUrl: scene.assetUrl?.startsWith('/api/projects/') ? null : scene.assetUrl,
          voiceUrl: scene.voiceUrl?.startsWith('/api/projects/') ? null : scene.voiceUrl,
        };
        const createdScene = await createScene.mutateAsync({ projectId: importedProjectId, data: sceneData });
        const hasLocalAsset = [scene.assetUrl, scene.voiceUrl, ...assetHistory.map((version) => version.url)]
          .some((url) => typeof url === 'string' && url.startsWith('/api/projects/'));
        if (hasLocalAsset || assetHistory.length) {
          const response = await fetch(`${basePath}/api/projects/${importedProjectId}/scenes/${createdScene.id}/assets/clone`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetUrl: scene.assetUrl, assetType: scene.assetType, voiceUrl: scene.voiceUrl, assetHistory }),
          });
          if (!response.ok) {
            const externalHistory = assetHistory.filter((version) => !version.url.startsWith('/api/projects/'));
            const retry = await fetch(`${basePath}/api/projects/${importedProjectId}/scenes/${createdScene.id}/assets/clone`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                assetUrl: scene.assetUrl?.startsWith('/api/projects/') ? null : scene.assetUrl,
                assetType: scene.assetType,
                voiceUrl: scene.voiceUrl?.startsWith('/api/projects/') ? null : scene.voiceUrl,
                assetHistory: externalHistory,
              }),
            });
            if (!retry.ok) {
              const result = await retry.json().catch(() => ({})) as { error?: string };
              throw new Error(result.error || tx(lang, 'تعذر استعادة أحد ملفات الوسائط.', 'A media file could not be restored.'));
            }
            unavailableLocalMediaCount++;
          }
        }
      }
      afterChange();
      setBackupProgress(unavailableLocalMediaCount
        ? tx(lang, `اكتمل الاستيراد، لكن لم تتوفر وسائط محلية في ${unavailableLocalMediaCount} مشهد؛ استُوردت هذه المشاهد دون رابط مكسور.`, `Import complete. Local media was unavailable for ${unavailableLocalMediaCount} scene(s), so those broken references were omitted.`)
        : tx(lang, 'اكتمل الاستيراد؛ فُتح المشروع الجديد.', 'Import complete; the new project is open.'));
      if (unavailableLocalMediaCount) window.alert(tx(lang, `تم استيراد المشروع، لكن بعض الوسائط المولّدة محليًا لم تعد موجودة على هذا الخادم. عدد المشاهد المتأثرة: ${unavailableLocalMediaCount}. تم استيرادها دون روابط مكسورة.`, `The project was imported, but some generated media is no longer available on this server. Affected scenes: ${unavailableLocalMediaCount}. They were imported without broken links.`));
      setLocation(`/projects/${importedProjectId}`);
    } catch (error) {
      if (importedProjectId) {
        try { await remove.mutateAsync({ projectId: importedProjectId }); } catch { /* keep the original error visible */ }
        afterChange();
      }
      setBackupProgress(error instanceof Error ? error.message : tx(lang, 'تعذر استيراد ملف النسخة.', 'Could not import the backup file.'));
    } finally {
      setBackupImporting(false);
    }
  };
  const startStory = (projectId: string, sceneCount: number, sceneDurationSeconds: number, sceneStyle: string) => generate.mutate({ projectId, data: { providerKeyId: null, allowRotation: false, approvePotentialCharges: true, sceneCount, sceneDurationSeconds, sceneStyle } }, {
    onSuccess: () => {
      afterChange();
      setOpen(false);
      setCreatedProjectId(null);
      setLocation(`/projects/${projectId}`);
    },
  });
  const uploadManualSceneImage = async (projectId: string, sceneId: string, file: File) => {
    const response = await fetch(`${basePath}/api/projects/${projectId}/scenes/${sceneId}/assets/upload`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': imageUploadContentType(file) },
      body: file,
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(result.error || tx(lang, 'تعذر رفع صورة المشهد.', 'Could not upload the scene image.'));
  };
  const saveProjectAndWriteStory = async (data: ProjectInput, approvePotentialCharges = false, templateId?: string, mode: 'auto' | 'manual' = 'auto', sceneCount = 5, sceneDurationSeconds = 8, allowExternalProviders?: boolean, manualScenes?: ManualSceneDraft[]) => {
    if (createdProjectId) {
      if (!approvePotentialCharges || allowExternalProviders !== true) throw new Error(tx(lang, 'أكّد السماح بالمزوّدات والموافقة على الرسوم المحتملة قبل إعادة المحاولة.', 'Confirm external providers and possible charges before retrying.'));
      startStory(createdProjectId, sceneCount, sceneDurationSeconds, data.visualStyle || 'Cinematic');
      return;
    }
    if (mode === 'auto' && allowExternalProviders !== undefined) {
      if (!settingsQuery.data) throw new Error(tx(lang, 'تعذر تحميل إعدادات المزوّدات. أعد المحاولة بعد لحظة.', 'Provider settings are not ready. Please try again in a moment.'));
      if (settingsQuery.data.freeMode !== !allowExternalProviders) {
        const saved = await updateProviderSettings.mutateAsync({ data: { ...settingsQuery.data, freeMode: !allowExternalProviders } });
        qc.setQueryData(getGetProviderSettingsQueryKey(), saved);
      }
    }
    const project = await create.mutateAsync({ data });
    afterChange();
    if (mode === 'manual') {
      setCreatedProjectId(project.id);
      setProjectSaveError(false);
      setSavingManualScenes(true);
      try {
        const createdScenes: { id: string; draft: ManualSceneDraft }[] = [];
        for (const [index, draft] of (manualScenes ?? []).entries()) {
          const scene = await createScene.mutateAsync({ projectId: project.id, data: {
            sortOrder: index,
            title: draft.title.trim() || tx(lang, `المشهد ${index + 1}`, `Scene ${index + 1}`),
            description: draft.description.trim(),
            imagePrompt: draft.imagePrompt.trim() || draft.description.trim(),
            narration: draft.narration.trim(),
            durationSeconds: sceneDurationSeconds,
            shotType: draft.shotType,
            cameraMovement: draft.cameraMovement,
            location: draft.location.trim(),
            lighting: draft.lighting.trim(),
            assetUrl: null,
            assetType: null,
          } });
          createdScenes.push({ id: scene.id, draft });
        }
        for (const { id, draft } of createdScenes) if (draft.imageFile) await uploadManualSceneImage(project.id, id, draft.imageFile);
      } catch (error) {
        setProjectSaveError(true);
        afterChange();
        throw new Error(error instanceof Error ? error.message : tx(lang, 'تعذر حفظ أحد المشاهد أو صوره. افتح المشروع لمتابعة ما تم حفظه.', 'A scene or image could not be saved. Open the project to continue with what was saved.'));
      } finally {
        setSavingManualScenes(false);
      }
      afterChange();
      setProjectSaveError(false);
      setCreatedProjectId(null);
      setOpen(false);
      setLocation(`/projects/${project.id}`);
      return;
    }
    const useTextProvider = !templateId && allowExternalProviders === true && textProviderReady && approvePotentialCharges;
    if (useTextProvider) {
      setCreatedProjectId(project.id);
      startStory(project.id, sceneCount, sceneDurationSeconds, data.visualStyle || 'Cinematic');
      return;
    }
    const seeds = buildFreeTemplateScenes(templateId ?? '', data.idea, lang, data.visualStyle, sceneCount, sceneDurationSeconds);
    try {
      for (const [index, seed] of seeds.entries()) await createScene.mutateAsync({ projectId: project.id, data: { ...seed, sortOrder: index } });
      afterChange();
      setOpen(false);
      setLocation(`/projects/${project.id}`);
    } catch {
      setOpen(false);
      setLocation(`/projects/${project.id}`);
    }
  };
  const readyProviderCount = (keysQuery.data ?? []).filter(key => key.enabled && providerSupports(key.provider, key.serviceType) && providerKeyIsUsable(key.provider, key.status, key.cooldownUntil)).length;
  const openCreatedProject = () => { if (createdProjectId) { setOpen(false); setCreatedProjectId(null); setProjectSaveError(false); setLocation(`/projects/${createdProjectId}`); } };
  const projectForm = (inline = false) => <ProjectForm inline={inline} onClose={() => { setOpen(false); setCreatedProjectId(null); setProjectSaveError(false); }} pending={create.isPending || generate.isPending || createScene.isPending || updateProviderSettings.isPending || savingManualScenes} freeMode={freeMode} textProviderReady={textProviderReady} checkingProvider={keysQuery.isLoading} generationError={projectSaveError || (generate.isError && Boolean(createdProjectId))} projectCreated={Boolean(createdProjectId)} onOpenCreated={createdProjectId ? openCreatedProject : undefined} onSave={saveProjectAndWriteStory} />;
  if (homePage) {
    const recentProjects = [...(q.data ?? [])].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 4);
    return <AppFrame title={tx(lang, 'استوديو الفيديو', 'Video Studio')}>
      <div className="studio-home-layout">
        <main className="studio-home-main">
          <header className="studio-home-hero"><span className="eyebrow">ONE IDEA → FULL MOVIE</span><h1>{tx(lang, 'فكرتك تبدأ هنا.', 'Your idea starts here.')}</h1><p>{tx(lang, 'اكتب الفكرة، اختر اتجاه الفيلم، ثم انتقل إلى المشاهد والصورة والصوت والتصدير.', 'Write the idea, set the film direction, then move into scenes, visuals, sound, and export.')}</p><div className="home-hero-actions"><button type="button" className="btn btn-primary" onClick={() => openNewProject()}><Clapperboard size={16}/>{tx(lang, 'إنشاء فيلم جديد', 'Create a new film')}</button>{recentProjects[0] && <Link href={`/projects/${recentProjects[0].id}`} className="btn btn-quiet"><Play size={15}/>{tx(lang, 'استكمال آخر مشروع', 'Continue last project')}</Link>}</div></header>
          {projectForm(true)}
          <section className="home-templates panel" aria-label={tx(lang, 'قوالب البداية', 'Starting templates')}><div className="home-section-head"><div><span className="eyebrow">{tx(lang, 'قوالب البداية', 'STARTING POINTS')}</span><h3>{tx(lang, 'ابدأ من شكل فيلمك.', 'Start from the shape of your film.')}</h3></div></div><div className="home-template-grid">{[{id:'ad',ar:'إعلان',en:'Advertisement',icon:Megaphone},{id:'shortfilm',ar:'فيلم قصير',en:'Short film',icon:Film},{id:'children',ar:'قصة أطفال',en:'Children’s story',icon:Sparkles},{id:'tiktok',ar:'TikTok',en:'TikTok',icon:Smartphone},{id:'documentary',ar:'وثائقي',en:'Documentary',icon:Globe2},{id:'lesson',ar:'شرح تعليمي',en:'Educational',icon:BookOpen}].map(item => {const Icon = item.icon; return <button type="button" key={item.id} className="home-template-card" onClick={() => openNewProject(item.id)}><span className="home-template-icon"><Icon size={17}/></span><b>{tx(lang, item.ar, item.en)}</b><small>{projectTemplates.find(template => template.id === item.id)?.durationSeconds}s</small></button>;})}</div></section>
        </main>
        <aside className="studio-home-side">
          <section className="home-status-card panel"><span className="eyebrow">{tx(lang, 'حالة الاستوديو', 'STUDIO STATUS')}</span><div className="home-status-number">{readyProviderCount}</div><h3>{tx(lang, 'مزوّدات جاهزة', 'Ready providers')}</h3><p>{freeMode ? tx(lang, 'الوضع الحالي يفضّل القوالب المحلية؛ لن يُرسل نص إلى مزوّد إلا بعد تفعيل الخيار والموافقة.', 'Local templates are preferred; text is not sent to a provider unless you enable it and approve.') : tx(lang, 'المزوّدات الخارجية مفعّلة؛ كل طلب مدفوع يتطلب موافقة مستقلة.', 'External providers are enabled; each potentially paid request requires separate approval.')}</p><div className="home-provider-list">{(keysQuery.data || []).slice(0, 4).map(key => <span key={key.id} className={`home-provider-chip is-${key.status}`}><i className={`status-dot status-${key.enabled && providerKeyIsUsable(key.provider, key.status, key.cooldownUntil) ? 'done' : 'error'}`}/>{key.label}</span>)}{!(keysQuery.data || []).length && <span className="home-provider-empty">{tx(lang, 'لا توجد مزوّدات مضافة بعد.', 'No providers added yet.')}</span>}</div><div className="home-status-foot"><span><i className={`status-dot ${freeMode ? 'status-done' : 'status-running'}`}/>{freeMode ? tx(lang, 'المسار المحلي مفضّل', 'Local path preferred') : tx(lang, 'المزوّدات الخارجية مفعّلة', 'External providers enabled')}</span><Link href="/settings/providers" className="text-link">{tx(lang, 'الإعدادات', 'Settings')}<ArrowLeft size={14}/></Link></div></section>
          <section className="panel home-recent-card"><div className="home-section-head"><div><span className="eyebrow">{tx(lang, 'آخر ما عملت عليه', 'RECENT WORK')}</span><h3>{tx(lang, 'مشاريعك الأخيرة', 'Recent projects')}</h3></div><Link href="/projects" className="text-link">{tx(lang, 'عرض الكل', 'View all')}<ArrowLeft size={14}/></Link></div>
            {q.isLoading ? <div className="home-recent-list"><SkeletonBlock className="h-12"/><SkeletonBlock className="h-12"/></div> : recentProjects.length ? <div className="home-recent-list">{recentProjects.map(project => <Link key={project.id} href={`/projects/${project.id}`} className="home-recent-row"><span className="home-recent-mark"><Film size={16}/></span><span className="home-recent-copy"><b>{project.title}</b><small>{tx(lang, `تحديث ${new Date(project.updatedAt).toLocaleDateString('ar')}`, `Updated ${new Date(project.updatedAt).toLocaleDateString()}`)}</small></span><span className="status-chip">{project.status}</span><ArrowLeft size={14}/></Link>)}</div> : <p className="home-recent-empty">{tx(lang, 'لا توجد مشاريع بعد. ابدأ من فكرتك.', 'No projects yet. Start with your idea.')}</p>}
          </section>
          <section className="panel home-recent-card"><div className="home-section-head"><div><span className="eyebrow">{tx(lang, 'آخر المهام', 'RECENT JOBS')}</span><h3>{tx(lang, 'حالة المعالجة', 'Processing status')}</h3></div><Link href="/jobs" className="text-link">{tx(lang, 'عرض الكل', 'View all')}<ArrowLeft size={14}/></Link></div>{jobsQuery.isLoading ? <div className="home-recent-list"><SkeletonBlock className="h-10"/><SkeletonBlock className="h-10"/></div> : (jobsQuery.data || []).length ? <div className="home-recent-list">{(jobsQuery.data || []).slice(0, 3).map(job => <Link key={job.id} href={`/projects/${job.projectId}`} className="home-recent-row"><span className={`home-job-mark is-${job.status}`}/><span className="home-recent-copy"><b>{tx(lang, ({script:'سيناريو',export:'تصدير',image:'صورة',video:'فيديو',voice:'صوت'})[job.jobType], ({script:'Script',export:'Export',image:'Image',video:'Video',voice:'Voice'})[job.jobType])}</b><small>{job.message}</small></span><span className={`status-chip is-${job.status}`}>{tx(lang, job.status==='queued'?'في الانتظار':job.status==='running'?'قيد التنفيذ':job.status==='completed'?'مكتملة':'فشلت', job.status)}</span></Link>)}</div> : <p className="home-recent-empty">{tx(lang, 'لا توجد مهام بعد. ابدأ من فكرتك.', 'No jobs yet. Start with your idea.')}</p>}</section>
          <section className="home-status-card panel home-flow-panel"><span className="eyebrow">{tx(lang, 'مسار الإنتاج', 'PRODUCTION FLOW')}</span><ol><li>{tx(lang, 'الفكرة والسيناريو', 'Idea & screenplay')}</li><li>{tx(lang, 'المشاهد والوسائط', 'Scenes & media')}</li><li>{tx(lang, 'الصوت والتركيب', 'Voice & composition')}</li><li>{tx(lang, 'المعاينة والتصدير', 'Preview & export')}</li></ol><Link href="/dashboard/overview" className="text-link">{tx(lang, 'فتح لوحة المتابعة الكاملة', 'Open full production overview')}<ArrowLeft size={14}/></Link></section>
        </aside>
      </div>
    </AppFrame>;
  }
  return <AppFrame title={tx(lang,'المشاريع','Projects')}><div className="page-toolbar"><div><span className="eyebrow">{tx(lang,'أرشيف الإنتاج','PRODUCTION ARCHIVE')}</span><h2>{tx(lang,'كل القصص التي بدأت.', 'Every story you started.')}</h2><p>{tx(lang,'مشاريعك وسيناريوهاتك محفوظة في مكان واحد.', 'Your projects and storyboards, kept in one place.')}</p></div><div className="flex flex-wrap gap-2"><input ref={importFileRef} className="sr-only" type="file" accept="application/json,.json" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void importBackupFile(file)}}/><button onClick={()=>importFileRef.current?.click()} className="btn btn-quiet" disabled={backupImporting} data-testid="button-import-project-backup">{backupImporting?<LoaderCircle size={16} className="animate-spin"/>:<FileUp size={16}/ >}{tx(lang,'استيراد JSON','Import JSON')}</button><button onClick={() => setOpen(true)} className="btn btn-primary" data-testid="button-new-project"><Plus size={17}/>{tx(lang,'مشروع جديد','New project')}</button></div></div>
    {backupProgress&&<p className="save-state mt-2" role="status">{backupProgress}</p>}
    <div className="list-controls"><label className="searchbox"><Search size={17}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder={tx(lang,'ابحث في مشاريعك','Search projects')} data-testid="input-project-search" /></label><label className="project-sort"><span className="field-label">{tx(lang,'ترتيب','Sort')}</span><select className="studio-input" value={sort} onChange={e => setSort(e.target.value as typeof sort)} data-testid="select-project-sort"><option value="updated">{tx(lang,'آخر تعديل','Recently updated')}</option><option value="name">{tx(lang,'الاسم','Name')}</option><option value="status">{tx(lang,'الحالة','Status')}</option></select></label><span className="result-count">{list.length} {tx(lang,'مشروع','projects')}</span></div>
    {q.isLoading ? <div className="project-grid">{[1,2,3].map(n=><SkeletonBlock key={n} className="h-52" />)}</div> : q.isError ? <StateError lang={lang} retry={() => q.refetch()} /> : list.length ? <div className="project-grid">{list.map(p=><ProjectCard key={p.id} project={p} onExport={exportBackup} exporting={backupExportingId===p.id} onDelete={id => { if (window.confirm(tx(lang,'هل تريد حذف المشروع وكل مشاهده؟','Delete this project and all its scenes?'))) remove.mutate({projectId:id},{onSuccess:()=>{afterChange();qc.invalidateQueries({queryKey:getGetProjectQueryKey(id)});}}); }} />)}</div> : <Empty title={search ? tx(lang,'لا توجد مطابقة','No matching projects') : tx(lang,'ابدأ بمشهد أول','Start with a first frame')} body={search ? tx(lang,'جرّب كلمات بحث أخرى.','Try another search term.') : tx(lang,'أنشئ مشروعًا ليصبح لديك مكان لصياغة الفكرة وبناء المشاهد.','Create a project to shape the idea and build your scenes.')} action={!search && <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16}/>{tx(lang,'إنشاء أول مشروع','Create your first project')}</button>} />}
    {open && <ProjectForm initialTemplateId={newTemplate} initialMode={new URLSearchParams(location.split('?')[1] || '').get('mode') === 'manual' ? 'manual' : 'auto'} onClose={() => { setOpen(false); setNewTemplate(undefined); setCreatedProjectId(null); setProjectSaveError(false); }} pending={create.isPending || generate.isPending || createScene.isPending || updateProviderSettings.isPending || savingManualScenes} freeMode={freeMode} textProviderReady={textProviderReady} checkingProvider={keysQuery.isLoading} generationError={projectSaveError || (generate.isError && Boolean(createdProjectId))} projectCreated={Boolean(createdProjectId)} onOpenCreated={createdProjectId ? openCreatedProject : undefined} onSave={saveProjectAndWriteStory} />}
  </AppFrame>;
}

function buildExportPreflight(scenes:Scene[],targetDuration:number,includeSubtitles:boolean,lang:Lang) {
  const errors:string[]=[];const warnings:string[]=[];
  const isValidLink=(value:string)=>{try{const parsed=new URL(value,window.location.origin);return (parsed.protocol==='https:'||parsed.origin===window.location.origin)&&!parsed.username&&!parsed.password;}catch{return false}};
  if(!scenes.length)errors.push(tx(lang,'أضف مشهدًا واحدًا على الأقل.','Add at least one scene.'));
  const sortOrders = new Set<number>();
  const totalSceneDuration=scenes.reduce((sum,scene)=>sum+scene.durationSeconds,0);
  if(targetDuration>0&&totalSceneDuration>targetDuration)warnings.push(tx(lang,`مجموع مدد المشاهد ${formatTime(totalSceneDuration)} يتجاوز الهدف ${formatTime(targetDuration)}.`,`Scene duration ${formatTime(totalSceneDuration)} exceeds the target ${formatTime(targetDuration)}.`));
  scenes.forEach((scene,index)=>{
    const label=tx(lang,`المشهد ${index+1}`,`Scene ${index+1}`);
    if(sortOrders.has(scene.sortOrder))errors.push(`${label}: ${tx(lang,'ترتيب المشاهد مكرر؛ أعد ترتيب الخط الزمني.','Scene order is duplicated; reorder the timeline.')}`);
    sortOrders.add(scene.sortOrder);
    if(!scene.title.trim())warnings.push(`${label}: ${tx(lang,'أدخل عنوانًا لتسهيل التعرف عليه.','Add a title to make it easier to identify.')}`);
    if(!Number.isInteger(scene.durationSeconds)||scene.durationSeconds<1||scene.durationSeconds>600)errors.push(`${label}: ${tx(lang,'المدة يجب أن تكون بين 1 و600 ثانية.','Duration must be from 1 to 600 seconds.')}`);
    if(!scene.assetUrl||!['image','video'].includes(scene.assetType||''))errors.push(`${label}: ${tx(lang,'أرفق صورة أو فيديو.','Attach an image or video.')}`);
    else if(!isValidLink(scene.assetUrl))errors.push(`${label}: ${tx(lang,'رابط الصورة/الفيديو غير صالح.','The image/video URL is invalid.')}`);
    if(scene.voiceUrl&&!isValidLink(scene.voiceUrl))errors.push(`${label}: ${tx(lang,'رابط الصوت غير صالح.','The audio URL is invalid.')}`);
    if(scene.narration.trim()&&!scene.voiceUrl)warnings.push(`${label}: ${tx(lang,'يوجد تعليق مكتوب بلا ملف صوتي؛ سيظهر كنص فقط.','Narration text has no voice asset; it will appear as text only.')}`);
    if(scene.assetType==='video'&&scene.clipStartSeconds<0)errors.push(`${label}: ${tx(lang,'بداية قص الفيديو لا يمكن أن تكون سالبة.','Video clip start cannot be negative.')}`);
    if(scene.assetType==='video'&&scene.clipEndSeconds!==null&&scene.clipEndSeconds<=scene.clipStartSeconds)errors.push(`${label}: ${tx(lang,'نهاية قص الفيديو يجب أن تكون بعد البداية.','Video clip end must be after its start.')}`);
    if(includeSubtitles){
      const caption=(scene.subtitleText??scene.narration).trim();
      const rawRange=scene.assetType==='video'&&scene.clipEndSeconds!==null?scene.clipEndSeconds-scene.clipStartSeconds:scene.durationSeconds;
      const effectiveDuration=Math.max(1,Math.min(600,rawRange/Math.max(.25,Math.min(4,scene.playbackSpeed||1))));
      const start=scene.subtitleStartSeconds??0;const end=scene.subtitleEndSeconds??effectiveDuration;
      if(!caption)warnings.push(`${label}: ${tx(lang,'نص الترجمة فارغ.','Subtitle text is empty.')}`);
      else if(caption.length>220)warnings.push(`${label}: ${tx(lang,'نص طويل؛ جرّب تقسيمه إلى عبارات أقصر.','Caption is long; consider splitting it into shorter lines.')}`);
      if(start<0||start>=effectiveDuration||end<=start||end>effectiveDuration)errors.push(`${label}: ${tx(lang,'توقيت الترجمة خارج مدة المشهد أو غير مرتب.','Subtitle timing is outside the scene or not in order.')}`);
    }
  });
  return {errors,warnings};
}

function ProductionStages({ lang, scenes, jobs, hasExport, onSelectScene }: { lang: Lang; scenes: Scene[]; jobs: StudioJob[]; hasExport: boolean; onSelectScene: (sceneId: string) => void }) {
  const hasJob = (type: StudioJob['jobType']) => jobs.some(job => job.jobType === type && job.status === 'completed');
  const missingAssets = scenes.filter(scene => !scene.assetUrl || !['image', 'video'].includes(scene.assetType || ''));
  const missingVoices = scenes.filter(scene => scene.narration.trim() && !scene.voiceUrl);
  const failedJobs = jobs.filter(job => job.status === 'failed');
  const activeJob = jobs.find(job => job.status === 'queued' || job.status === 'running');
  const blockers = [...missingAssets.map(scene => ({ scene, label: tx(lang, 'أضف صورة أو فيديو', 'Attach image or video') })), ...missingVoices.map(scene => ({ scene, label: tx(lang, 'أضف الصوت أو أفرغ التعليق', 'Add voice or clear narration') }))].slice(0, 6);
  const stages = [
    { ar: 'الفكرة', en: 'Idea', done: true },
    { ar: 'السيناريو', en: 'Script', done: scenes.length > 0 || hasJob('script') },
    { ar: 'Storyboard', en: 'Storyboard', done: scenes.length > 0 },
    { ar: 'الصور', en: 'Images', done: scenes.length > 0 && scenes.every(scene => Boolean(scene.assetUrl) && (scene.assetType === 'image' || scene.assetType === 'video')) },
    { ar: 'الفيديو والصوت', en: 'Video & voice', done: scenes.length > 0 && scenes.every(scene => scene.assetType === 'video' && Boolean(scene.assetUrl) && (!scene.narration.trim() || Boolean(scene.voiceUrl))) },
    { ar: 'التصدير', en: 'Export', done: hasExport },
  ];
  const completed = stages.filter(stage => stage.done).length;
  return <section className="panel production-stages" aria-label={tx(lang, 'مراحل إنتاج الفيلم', 'Film production stages')}>
    <div className="production-stages-head"><div><span className="eyebrow">{tx(lang, 'ONE IDEA TO FULL MOVIE', 'ONE IDEA TO FULL MOVIE')}</span><h3>{tx(lang, 'خريطة إنتاج الفيلم', 'Film production map')}</h3></div><span className="small-mono">{completed}/{stages.length} {tx(lang, 'مراحل مكتملة', 'stages complete')}</span></div>
    <div className="production-stage-list">{stages.map((stage, index) => <div className={`production-stage ${stage.done ? 'is-done' : ''}`} key={stage.en}><span className="production-stage-mark">{stage.done ? <Check size={13}/> : String(index + 1).padStart(2, '0')}</span><span>{tx(lang, stage.ar, stage.en)}</span></div>)}</div>
    <div className="production-dashboard-summary"><div><span className="field-label">{tx(lang, 'عوائق حالية', 'Current blockers')}</span><strong className={blockers.length ? 'text-destructive' : 'is-ready'}>{blockers.length}</strong></div><div><span className="field-label">{tx(lang, 'مهام فاشلة', 'Failed jobs')}</span><strong className={failedJobs.length ? 'text-destructive' : 'is-ready'}>{failedJobs.length}</strong></div><div><span className="field-label">{tx(lang, 'المهمة الحالية', 'Active job')}</span><strong>{activeJob ? `${activeJob.progress}%` : tx(lang, 'لا توجد', 'None')}</strong></div></div>
    {blockers.length > 0 && <div className="production-blockers"><span className="field-label">{tx(lang, 'إجراءات مطلوبة', 'Required actions')}</span>{blockers.map(({ scene, label }) => <button type="button" className="production-blocker" key={`${scene.id}-${label}`} onClick={() => onSelectScene(scene.id)}><span>{scene.title || tx(lang, 'مشهد بلا عنوان', 'Untitled scene')}</span><small>{label}<ArrowLeft size={13}/></small></button>)}</div>}
    {failedJobs.length > 0 && <div className="production-job-alert" role="status"><AlertTriangle size={15}/><span>{tx(lang, `هناك ${failedJobs.length} مهمة فشلت. افتح صفحة المهام للمحاولة مجددًا.`, `${failedJobs.length} job(s) failed. Open Jobs to retry them.`)}</span><Link className="text-link" href="/jobs">{tx(lang, 'عرض المهام', 'View jobs')}<ArrowLeft size={13}/></Link></div>}
    <p className="production-stage-note">{tx(lang, 'الأرقام هنا مبنية على المشاهد والمهام المحفوظة فعلًا. لا يبدأ أي مزوّد خارجي أو خدمة مدفوعة تلقائيًا.', 'These numbers come from saved scenes and jobs. No external or paid provider starts automatically.')}</p>
  </section>;
}

function StoryboardBoard({ lang, scenes, selectedId, onOpen, onGenerate, onDuplicate, onDelete, deleting = false, jobs = [], imageProviderReady = false }: { lang: Lang; scenes: Scene[]; selectedId: string | null; onOpen: (sceneId: string) => void; onGenerate: (sceneId: string) => void; onDuplicate: (sceneId: string) => void; onDelete: (sceneId: string) => void; deleting?: boolean; jobs?: StudioJob[]; imageProviderReady?: boolean }) {
  const sceneStatus = (scene: Scene): { key: string; ar: string; en: string } => {
    const sceneJobs = jobs.filter(job => job.sceneId === scene.id);
    const active = sceneJobs.find(job => job.status === 'queued' || job.status === 'running');
    if (active) return { key: 'running', ar: active.status === 'queued' ? 'في الانتظار' : 'قيد التوليد', en: active.status === 'queued' ? 'Queued' : 'Generating' };
    if (scene.assetUrl) return { key: 'done', ar: 'أصل جاهز', en: 'Asset ready' };
    if (sceneJobs.some(job => job.status === 'failed')) return { key: 'review', ar: 'تحتاج مراجعة', en: 'Needs review' };
    if (!imageProviderReady) return { key: 'blocked', ar: 'لا يوجد مزوّد صور', en: 'No image provider' };
    return { key: 'todo', ar: 'بانتظار أصل حقيقي', en: 'Waiting for real asset' };
  };
  return <section className="panel storyboard-board" aria-label={tx(lang, 'لوحة Storyboard البصرية', 'Visual storyboard board')}>
    <div className="storyboard-board-head"><div><span className="eyebrow">{tx(lang, 'STORYBOARD', 'STORYBOARD')}</span><h3>{tx(lang, 'لوحة اللقطات', 'Shot board')}</h3></div><span className="small-mono">{scenes.length} {tx(lang, 'لقطات', 'shots')}</span></div>
    {!scenes.length ? <div className="storyboard-empty"><Film size={18}/><span>{tx(lang, 'أنشئ المشاهد لتظهر هنا لوحة اللقطات المرئية.', 'Create scenes to populate the visual shot board.')}</span></div> : <div className="storyboard-grid">{scenes.map((scene, index) => {
      const status = sceneStatus(scene);
      return <article className={`storyboard-card ${selectedId === scene.id ? 'is-selected' : ''}`} key={scene.id}>
        <button type="button" className="storyboard-card-main" onClick={() => onOpen(scene.id)} aria-label={`${tx(lang, 'فتح المشهد', 'Open scene')} ${index + 1}: ${scene.title}`}>
          <div className="storyboard-thumb">{scene.assetUrl && scene.assetType === 'image' ? <img src={scene.assetUrl} alt="" loading="lazy" decoding="async" /> : scene.assetUrl && scene.assetType === 'video' ? <video src={scene.assetUrl} muted preload="metadata" /> : <div className="storyboard-placeholder"><Film size={18}/><span>{tx(lang, 'بدون أصل', 'No asset')}</span></div>}<span className="storyboard-number">{String(index + 1).padStart(2, '0')}</span></div>
          <div className="storyboard-card-copy"><b>{scene.title || tx(lang, `مشهد ${index + 1}`, `Scene ${index + 1}`)}</b><span>{scene.shotType || tx(lang, 'لقطة غير محددة', 'Shot unspecified')} · {scene.durationSeconds}{tx(lang, 'ث', 's')}</span><small className={`storyboard-status is-${status.key}`}>{tx(lang, status.ar, status.en)}</small></div>
        </button>
        <div className="storyboard-card-actions">
          <button type="button" onClick={() => onOpen(scene.id)} title={tx(lang, 'فتح التفاصيل', 'Open details')} aria-label={tx(lang, 'فتح تفاصيل المشهد', 'Open scene details')}><Settings2 size={13} /></button>
          <button type="button" onClick={() => onGenerate(scene.id)} title={tx(lang, 'توليد أصل لهذا المشهد', 'Generate an asset for this scene')} aria-label={tx(lang, 'توليد أصل لهذا المشهد', 'Generate an asset for this scene')}><WandSparkles size={13} /></button>
          <button type="button" onClick={() => onDuplicate(scene.id)} title={tx(lang, 'نسخ المشهد', 'Duplicate scene')} aria-label={tx(lang, 'نسخ المشهد', 'Duplicate scene')}><Copy size={13} /></button>
          <button type="button" className="is-danger" onClick={() => onDelete(scene.id)} disabled={deleting} title={tx(lang, 'حذف المشهد', 'Delete scene')} aria-label={tx(lang, 'حذف المشهد', 'Delete scene')}><Trash2 size={13} /></button>
        </div>
      </article>;
    })}</div>}
  </section>;
}
function ProjectWorkspace({ projectId }: { projectId: string }) {
  const { lang } = useApp();
  const [, navigate] = useLocation();
  const projectQuery = useGetProject(projectId);
  const keysQuery = useListProviderKeys();
  const settingsQuery = useGetProviderSettings();
  const qc = useQueryClient();
  const projectJobsQuery = useListStudioJobs({ projectId }, { query: { queryKey: getListStudioJobsQueryKey({ projectId }), refetchInterval: query => query.state.data?.some(job => job.status === 'queued' || job.status === 'running') ? 3000 : false, staleTime: 15000 } });
  const createScene = useCreateScene(), updateScene = useUpdateScene(), deleteScene = useDeleteScene(), generate = useQueueProjectScript(), updateProject = useUpdateProject(), exportProject = useQueueProjectExport(), retryJob = useRetryStudioJob();
  const project = projectQuery.data;
  const [selected, setSelected] = useState<string | null>(null);
  const [chargeApproved, setChargeApproved] = useState(false);
  const [scriptSettings, setScriptSettings] = useState({ sceneCount: 6, sceneDurationSeconds: 8, sceneStyle: 'Cinematic' });
  const [editProjectOpen, setEditProjectOpen] = useState(false);
  const [previewPlaying,setPreviewPlaying]=useState(false);
  const previewVideo=useRef<HTMLVideoElement|null>(null);
  const [exportSettings,setExportSettings]=useState<{resolution:480|720|1080|2160;fps:24|25|30|60;includeSubtitles:boolean;format:'mp4'|'webm';codec:'h264'|'hevc';subtitleStyle:'classic'|'outline'|'pill'}>({resolution:1080,fps:30,includeSubtitles:true,format:'mp4',codec:'h264',subtitleStyle:'classic'});
  const [previewUrl,setPreviewUrl]=useState<string|null>(null);
  const [previewing,setPreviewing]=useState(false);
  const [previewError,setPreviewError]=useState('');
  useEffect(()=>()=>{if(previewUrl)URL.revokeObjectURL(previewUrl)},[previewUrl]);
  const requestPreview=async()=>{
    if(!scenesReadyForExport||previewing)return;
    setPreviewing(true);setPreviewError('');
    try{
      const response=await fetch(`${basePath}/api/projects/${projectId}/preview`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(exportSettings)});
      if(!response.ok){const body=await response.json().catch(()=>null);throw new Error(body?.error||'Preview failed');}
      const nextUrl=URL.createObjectURL(await response.blob());
      setPreviewUrl(previous=>{if(previous)URL.revokeObjectURL(previous);return nextUrl});
    }catch(error){setPreviewError(error instanceof Error?error.message:tx(lang,'تعذرت معاينة الفيديو.','Video preview failed.'))}
    finally{setPreviewing(false)}
  };
  const completedJobsRef = useRef<Set<string>>(new Set());
  useEffect(() => { if (project?.scenes?.length && !selected) setSelected(project.scenes[0].id); }, [project, selected]);
  const scenes = [...(project?.scenes || [])].sort((a,b) => a.sortOrder-b.sortOrder);
  const activeScene = scenes.find(s => s.id === selected) || scenes[0];
  const downloadScript = () => {
    if (!project) return;
    const safeName = project.title.replace(/[^a-z0-9\u0600-\u06ff]+/gi, '-').replace(/^-|-$/g, '') || 'ella-script';
    const content = [`${project.title}`, '='.repeat(project.title.length), '', project.idea, '', ...scenes.flatMap((scene, index) => [
      `${index + 1}. ${scene.title || tx(lang, `المشهد ${index + 1}`, `Scene ${index + 1}`)} (${scene.durationSeconds}s)`,
      scene.description || '',
      scene.narration ? `${tx(lang, 'التعليق', 'Narration')}: ${scene.narration}` : '',
      scene.subtitleText && scene.subtitleText !== scene.narration ? `${tx(lang, 'الترجمة', 'Subtitle')}: ${scene.subtitleText}` : '',
      '',
    ])].join('\n');
    downloadTextFile(`${safeName}.txt`, content);
  };
  const downloadSubtitles = () => {
    if (!project) return;
    let offset = 0;
    const blocks = scenes.flatMap((scene, index) => {
      const start = offset + (scene.subtitleStartSeconds ?? 0);
      const end = offset + (scene.subtitleEndSeconds ?? scene.durationSeconds);
      offset += scene.durationSeconds;
      const text = (scene.subtitleText || scene.narration || '').trim();
      return text ? [`${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}\n`] : [];
    });
    if (blocks.length) {
      const safeName = project.title.replace(/[^a-z0-9\u0600-\u06ff]+/gi, '-').replace(/^-|-$/g, '') || 'ella-subtitles';
      downloadTextFile(`${safeName}.srt`, blocks.join('\n'), 'application/x-subrip;charset=utf-8');
    }
  };
  const textProviderReady=Boolean(keysQuery.data?.some(key=>key.serviceType==='text'&&providerSupports(key.provider,'text')&&key.enabled&&providerKeyIsUsable(key.provider,key.status,key.cooldownUntil)));
  const chargeSignature=JSON.stringify({service:'text',scenes:scriptSettings.sceneCount,duration:scriptSettings.sceneDurationSeconds,style:scriptSettings.sceneStyle,provider:textProviderReady});
  useEffect(()=>{setChargeApproved(false)},[chargeSignature]);
  const generationKeys=[...(keysQuery.data||[]),...FREE_TEST_KEYS];
  const freeMode=settingsQuery.data?.freeMode??true;
  const refresh = () => { qc.invalidateQueries({queryKey:getGetProjectQueryKey(projectId)}); qc.invalidateQueries({queryKey:getListProjectsQueryKey()}); qc.invalidateQueries({queryKey:getGetStudioSummaryQueryKey()}); qc.invalidateQueries({queryKey:getListStudioJobsQueryKey()}); };
  useEffect(() => {
    const finished = projectJobsQuery.data?.filter(job => job.status === 'completed' && job.jobType !== 'export') || [];
    if (finished.some(job => !completedJobsRef.current.has(job.id))) {
      finished.forEach(job => completedJobsRef.current.add(job.id));
      refresh();
    }
  }, [projectJobsQuery.data]);
  const currentJob = projectJobsQuery.data?.find(job => job.status === 'queued' || job.status === 'running') ?? projectJobsQuery.data?.[0];
  const latestExportJob = projectJobsQuery.data?.find(job => job.jobType === 'export');
  const [applyingLocalTemplate,setApplyingLocalTemplate]=useState(false);
  const [localTemplateError,setLocalTemplateError]=useState('');
  const localTemplateLock=useRef(false);
  const applyLocalTemplate=async(templateId:string)=>{
    if(!project||localTemplateLock.current||currentJob?.status==='queued'||currentJob?.status==='running')return;
    localTemplateLock.current=true;
    setApplyingLocalTemplate(true);setLocalTemplateError('');
    try{
      const perScene=Math.max(1,Math.floor(project.durationSeconds/5));
      const seeds=buildFreeTemplateScenes(templateId,project.idea,lang,project.visualStyle,5,perScene);
      for(const [index,seed] of seeds.entries())await createScene.mutateAsync({projectId,data:{...seed,sortOrder:index}});
      refresh();
    }catch(error){
      await projectQuery.refetch();
      setLocalTemplateError(error instanceof Error?error.message:tx(lang,'تعذّر حفظ القالب؛ أعد المحاولة.','Could not save the template; try again.'));
    }finally{localTemplateLock.current=false;setApplyingLocalTemplate(false);}
  };
  const duration = scenes.reduce((sum,s)=>sum+s.durationSeconds,0);
  const exportPreflight=buildExportPreflight(scenes,project?.durationSeconds??0,exportSettings.includeSubtitles,lang);
  const scenesReadyForExport=exportPreflight.errors.length===0;
  if (projectQuery.isLoading) return <AppFrame title={tx(lang,'تحميل المشروع','Loading project')}><div className="workspace-skeleton"><SkeletonBlock className="h-20"/><SkeletonBlock className="h-72"/><SkeletonBlock className="h-48"/></div></AppFrame>;
  if (projectQuery.isError || !project) return <AppFrame title={tx(lang,'المشروع','Project')}><StateError lang={lang} retry={()=>projectQuery.refetch()} /></AppFrame>;
  const updateCurrent = async (field: keyof Scene, value: string | number | string[] | null) => {
    if (!activeScene) return;
    await updateScene.mutateAsync({projectId,sceneId:activeScene.id,data:{[field]:value} as SceneUpdate});
    refresh();
  };
  const reorder = (scene: Scene, step: number) => {
    const target = scenes.find(s=>s.sortOrder===scene.sortOrder+step) || scenes[scenes.indexOf(scene)+step];
    if (!target) return;
    const temporaryOrder = Math.max(...scenes.map(s=>s.sortOrder),0)+1;
    updateScene.mutate({projectId,sceneId:scene.id,data:{sortOrder:temporaryOrder}},{onSuccess:()=>updateScene.mutate({projectId,sceneId:target.id,data:{sortOrder:scene.sortOrder}},{onSuccess:()=>updateScene.mutate({projectId,sceneId:scene.id,data:{sortOrder:target.sortOrder}},{onSuccess:refresh})})});
  };
  const reorderDrop = async (sourceId:string,targetId:string) => {
    if(sourceId===targetId)return;
    const ordered=[...scenes];
    const from=ordered.findIndex(scene=>scene.id===sourceId),to=ordered.findIndex(scene=>scene.id===targetId);
    if(from<0||to<0)return;
    ordered.splice(to,0,...ordered.splice(from,1));
    try {
      const offset=Math.max(...scenes.map(scene=>scene.sortOrder),0)+ordered.length+1;
      for(const [index,scene] of ordered.entries())await updateScene.mutateAsync({projectId,sceneId:scene.id,data:{sortOrder:offset+index}});
      for(const [index,scene] of ordered.entries())await updateScene.mutateAsync({projectId,sceneId:scene.id,data:{sortOrder:index}});
      refresh();
    } catch { projectQuery.refetch(); }
  };
  const duplicateScene = async () => {
    if (!activeScene || createScene.isPending) return;
    const copy = await createScene.mutateAsync({ projectId, data: {
      sortOrder: Math.max(...scenes.map(scene => scene.sortOrder), 0) + 1,
      title: `${activeScene.title || tx(lang, 'مشهد', 'Scene')} ${tx(lang, 'نسخة', 'copy')}`,
      description: activeScene.description,
      imagePrompt: activeScene.imagePrompt,
      narration: activeScene.narration,
      subtitleText: activeScene.subtitleText,
      subtitleStartSeconds: activeScene.subtitleStartSeconds,
      subtitleEndSeconds: activeScene.subtitleEndSeconds,
      durationSeconds: activeScene.durationSeconds,
      assetUrl: activeScene.assetUrl,
      assetType: activeScene.assetType as SceneInput['assetType'],
      shotType: activeScene.shotType,
      cameraMovement: activeScene.cameraMovement,
      location: activeScene.location,
      lighting: activeScene.lighting,
      characterIds: activeScene.characterIds,
      voiceUrl: activeScene.voiceUrl,
      voiceVolume: activeScene.voiceVolume,
      clipStartSeconds: activeScene.clipStartSeconds,
      clipEndSeconds: activeScene.clipEndSeconds,
      playbackSpeed: activeScene.playbackSpeed,
      transition: activeScene.transition,
    }});
    refresh();
    setSelected(copy.id);
  };
  const [stage,setStage]=useState<StudioStageId>('storyboard');
  const [mobilePane,setMobilePane]=useState<'preview'|'tools'>('preview');
  const hasActiveProductionJob=(projectJobsQuery.data??[]).some(job=>job.status==='queued'||job.status==='running');
  const jobRunning=(type:StudioJob['jobType'])=>(projectJobsQuery.data??[]).some(job=>job.jobType===type&&(job.status==='queued'||job.status==='running'));
  const keyReady=(service:'image'|'video'|'voice')=>generationKeys.some(key=>key.enabled&&key.serviceType===service&&providerSupports(key.provider,service)&&providerKeyIsUsable(key.provider,key.status,key.cooldownUntil));
  const imageReadyCount=scenes.filter(scene=>scene.assetUrl&&(scene.assetType==='image'||scene.assetType==='video')).length;
  const videoReadyCount=scenes.filter(scene=>scene.assetUrl&&scene.assetType==='video').length;
  const narratedScenes=scenes.filter(scene=>scene.narration.trim());
  const voicedCount=narratedScenes.filter(scene=>Boolean(scene.voiceUrl)).length;
  const allImagesReady=scenes.length>0&&imageReadyCount===scenes.length;
  const allVideosReady=scenes.length>0&&videoReadyCount===scenes.length;
  const allVoicesReady=narratedScenes.length>0&&voicedCount===narratedScenes.length;
  const hasExport=latestExportJob?.status==='completed'||Boolean(project.exportUrl);
  const stages:ProductionStage[]=[
    {id:'idea',ar:'الفكرة',en:'Idea',status:'done',detailAr:'فكرة المشروع محفوظة',detailEn:'Project idea saved'},
    {id:'script',ar:'السيناريو',en:'Script',status:scenes.length?'done':'current',detailAr:scenes.length?`${scenes.length} مشاهد محفوظة`:'ابدأ التأليف أو أضف مشهدًا',detailEn:scenes.length?`${scenes.length} saved scenes`:'Write the script or add a scene'},
    {id:'storyboard',ar:'Storyboard',en:'Storyboard',status:scenes.length?'done':'todo',detailAr:scenes.length?'ترتيب اللقطات جاهز':'لم تُنشأ لقطات بعد',detailEn:scenes.length?'Shot order is ready':'No shots yet'},
    {id:'images',ar:'الصور',en:'Images',status:allImagesReady?'done':jobRunning('image')?'running':scenes.length&&imageReadyCount<scenes.length?(keyReady('image')?'review':'blocked'):'todo',detailAr:scenes.length?`${imageReadyCount}/${scenes.length} لقطات بأصل بصري`:'يبدأ بعد إنشاء المشاهد',detailEn:scenes.length?`${imageReadyCount}/${scenes.length} scenes with visuals`:'Starts after scenes exist'},
    {id:'video',ar:'الفيديو',en:'Video',status:allVideosReady?'done':jobRunning('video')?'running':scenes.length&&videoReadyCount<scenes.length?(keyReady('video')?(imageReadyCount?'review':'todo'):'blocked'):'todo',detailAr:scenes.length?`${videoReadyCount}/${scenes.length} مقاطع فيديو`:'يحتاج صورة أو وصفًا لكل مشهد',detailEn:scenes.length?`${videoReadyCount}/${scenes.length} video clips`:'Needs an image or prompt per scene'},
    {id:'voice',ar:'الصوت',en:'Voice',status:allVoicesReady?'done':jobRunning('voice')?'running':narratedScenes.length?(keyReady('voice')?'review':'blocked'):'todo',detailAr:narratedScenes.length?`${voicedCount}/${narratedScenes.length} تعليقات صوتية`:'أضف نص التعليق أولًا',detailEn:narratedScenes.length?`${voicedCount}/${narratedScenes.length} voice tracks`:'Add narration text first'},
    {id:'export',ar:'التصدير',en:'Export',status:hasExport?'done':jobRunning('export')?'running':scenesReadyForExport?'current':'blocked',detailAr:hasExport?'ملف الفيلم متاح':scenesReadyForExport?'جاهز للتصدير':'أكمل أصول المشاهد أولًا',detailEn:hasExport?'Film file available':scenesReadyForExport?'Ready to export':'Complete scene assets first'},
  ];
  const currentStage=stages.find(item=>item.id===stage)??stages[0];
  const completedStages=stages.filter(item=>item.status==='done').length;
  const studioProgress=Math.round((completedStages/stages.length)*100);
  const scenePicker=scenes.length?<label className="studio-scene-picker"><span className="field-label">{tx(lang,'المشهد النشط','Active scene')}</span><select className="studio-input" value={activeScene?.id??''} onChange={event=>setSelected(event.target.value)}>{scenes.map((scene,index)=><option key={scene.id} value={scene.id}>{String(index+1).padStart(2,'0')} · {scene.title||tx(lang,'مشهد بلا عنوان','Untitled scene')}</option>)}</select></label>:null;
  const sceneListTools=<div className="scene-action-list">{scenes.map((scene,index)=><div className={`scene-action-row ${scene.id===activeScene?.id?'is-selected':''}`} key={scene.id}><button type="button" className="scene-action-main" onClick={()=>setSelected(scene.id)}><span className="scene-action-number">{String(index+1).padStart(2,'0')}</span><span className="scene-action-copy"><b>{scene.title||tx(lang,`مشهد ${index+1}`,`Scene ${index+1}`)}</b><small>{scene.durationSeconds}{tx(lang,'ث','s')} · {scene.assetUrl?tx(lang,'أصل جاهز','Asset ready'):tx(lang,'بانتظار أصل','Waiting for asset')}</small></span></button><div className="scene-action-buttons"><button type="button" className="btn btn-ghost !p-1.5" onClick={()=>reorder(scene,-1)} disabled={index===0} title={tx(lang,'تحريك للأعلى','Move up')} aria-label={tx(lang,'تحريك للأعلى','Move up')}><ArrowUp size={14}/></button><button type="button" className="btn btn-ghost !p-1.5" onClick={()=>reorder(scene,1)} disabled={index===scenes.length-1} title={tx(lang,'تحريك للأسفل','Move down')} aria-label={tx(lang,'تحريك للأسفل','Move down')}><ArrowDown size={14}/></button><button type="button" className="btn btn-ghost !p-1.5" onClick={()=>{setSelected(scene.id);void duplicateScene();}} disabled={createScene.isPending||scene.id!==activeScene?.id} title={tx(lang,'نسخ المشهد','Duplicate scene')} aria-label={tx(lang,'نسخ المشهد','Duplicate scene')}><Copy size={14}/></button><button type="button" className="btn btn-ghost !p-1.5 text-destructive" onClick={()=>{if(window.confirm(tx(lang,'حذف هذا المشهد؟','Delete this scene?')))deleteScene.mutate({projectId,sceneId:scene.id},{onSuccess:()=>{if(scene.id===activeScene?.id)setSelected(null);refresh()}})}} title={tx(lang,'حذف','Delete')} aria-label={tx(lang,'حذف المشهد','Delete scene')}><Trash2 size={14}/></button></div></div>)}<button type="button" className="btn btn-quiet w-full" onClick={()=>createScene.mutate({projectId,data:{sortOrder:scenes.length,title:tx(lang,`مشهد ${scenes.length+1}`,`Scene ${scenes.length+1}`),description:'',imagePrompt:'',narration:'',durationSeconds:6,assetUrl:null,assetType:null}},{onSuccess:s=>{refresh();setSelected(s.id)}})} disabled={createScene.isPending}><Plus size={16}/>{tx(lang,'إضافة مشهد','Add scene')}</button></div>;
  const scriptGeneration=!scenes.length?<>{!freeMode?<><div className="script-bar panel"><div className="script-symbol"><WandSparkles size={18}/></div><div className="script-copy"><b>{tx(lang,'حوّل الفكرة إلى سيناريو','Turn the idea into a storyboard')}</b><p>{textProviderReady ? tx(lang,'أنشئ مسودة مشاهد باستخدام مزوّد نص مضبوط.','Generate a scene draft using a configured text provider.') : tx(lang,'لا يوجد مفتاح نص جاهز؛ أضف مفتاحًا صالحًا قبل التوليد.','No available text provider. Add an enabled key before generating.')}</p><ChargeApprovalCard lang={lang} service="text" providerLabel={tx(lang,'المزوّد النصي المضبوط (مع بديل احتياطي)','Configured text provider (with fallback)')} scenes={scriptSettings.sceneCount} approved={chargeApproved} onChange={setChargeApproved}/><div className="form-two mt-3"><label><span className="field-label">{tx(lang,'عدد المشاهد','Number of scenes')}</span><input className="studio-input" type="number" min="1" max="24" value={scriptSettings.sceneCount} onChange={e=>setScriptSettings(v=>({...v,sceneCount:Math.max(1,Math.min(24,Number(e.target.value)||1))}))} /></label><label><span className="field-label">{tx(lang,'مدة كل مشهد (ثانية)','Seconds per scene')}</span><input className="studio-input" type="number" min="1" max="600" value={scriptSettings.sceneDurationSeconds} onChange={e=>setScriptSettings(v=>({...v,sceneDurationSeconds:Math.max(1,Math.min(600,Number(e.target.value)||1))}))} /></label><label><span className="field-label">{tx(lang,'أسلوب المشاهد','Scene style')}</span><select className="studio-input" value={scriptSettings.sceneStyle} onChange={e=>setScriptSettings(v=>({...v,sceneStyle:e.target.value}))}>{visualStyles.map(([value,ar])=><option key={value} value={value}>{tx(lang,ar,value)}</option>)}</select></label></div></div><button disabled={!textProviderReady || generate.isPending || !chargeApproved || Boolean(currentJob?.status === 'running' || currentJob?.status === 'queued')} className="btn btn-primary" onClick={()=>generate.mutate({projectId,data:{providerKeyId:null,allowRotation:true,approvePotentialCharges:chargeApproved,...scriptSettings}},{onSuccess:refresh})} data-testid="button-generate-script">{generate.isPending ? <LoaderCircle size={16} className="animate-spin"/> : <WandSparkles size={16}/ >}{tx(lang,'توليد المشاهد','Generate scenes')}</button></div>{generate.isError && <ErrorRecoveryPanel compact lang={lang} message={generate.error instanceof Error?generate.error.message:''} />}</>:<div className="script-bar panel"><div className="script-symbol"><ShieldCheck size={18}/></div><div className="script-copy"><b>{tx(lang,'المزوّدات الخارجية متوقفة','External providers are off')}</b><p>{tx(lang,'يمكنك إنشاء مشاهد محلية من قوالب جاهزة دون مزوّد، أو تشغيل المزوّدات من الإعدادات.','Create local scenes from templates without a provider, or enable providers in Settings.')}</p></div></div>}<div className="script-bar panel"><div className="script-symbol"><Film size={18}/></div><div className="script-copy"><b>{tx(lang,'قوالب سيناريو مجانية — ليست ذكاءً اصطناعيًا','Free script templates — not AI-generated')}</b><p>{tx(lang,'اختر قالبًا لإضافة خمسة مشاهد محفوظة وقابلة للتحرير دون مفتاح أو اتصال بمزوّد. هذه بنية ثابتة وليست كتابة ذكية.','Choose a template to add five saved, editable scenes without a key or provider call. These are fixed templates, not AI writing.')}</p><div className="flex flex-wrap gap-2 mt-3">{projectTemplates.map(item=><button key={item.id} className="btn btn-quiet" disabled={applyingLocalTemplate||createScene.isPending||hasActiveProductionJob} onClick={()=>void applyLocalTemplate(item.id)}>{applyingLocalTemplate?<LoaderCircle size={15} className="animate-spin"/>:null}{tx(lang,item.ar,item.en)}</button>)}</div>{localTemplateError&&<p className="inline-error" role="alert">{localTemplateError}</p>}</div></div></>:<div className="script-bar panel" role="status" data-testid="story-scenes-ready"><div className="script-symbol"><Check size={18}/></div><div className="script-copy"><b>{tx(lang,'المشاهد موجودة بالفعل','Scenes already exist')}</b><p>{tx(lang,'تابع تعديل المشاهد من لوحة Storyboard. لا يمكن بدء تأليف جديد فوق مشاهد موجودة.','Continue editing scenes in the storyboard board. A new storyboard cannot be generated over existing scenes.')}</p></div></div>;
  const exportTools=<div className="studio-export-tools"><div className="export-settings"><label><span className="field-label">{tx(lang,'الدقة','Resolution')}</span><select className="studio-input" value={exportSettings.resolution} onChange={e=>setExportSettings(v=>({...v,resolution:Number(e.target.value) as 480|720|1080|2160}))}><option value={480}>480p</option><option value={720}>720p</option><option value={1080}>1080p</option><option value={2160}>4K UHD (3840×2160)</option></select></label><label><span className="field-label">{tx(lang,'معدل الإطارات','Frame rate')}</span><select className="studio-input" value={exportSettings.fps} onChange={e=>setExportSettings(v=>({...v,fps:Number(e.target.value) as 24|25|30|60}))}><option value={24}>24 fps</option><option value={25}>25 fps</option><option value={30}>30 fps</option><option value={60}>60 fps</option></select></label><label><span className="field-label">{tx(lang,'الصيغة','Format')}</span><select className="studio-input" value={exportSettings.format} onChange={e=>setExportSettings(v=>({...v,format:e.target.value as 'mp4'|'webm'}))}><option value="mp4">MP4</option><option value="webm">WebM</option></select></label><label><span className="field-label">{tx(lang,'ترميز الفيديو','Video codec')}</span><select className="studio-input" value={exportSettings.codec} onChange={e=>setExportSettings(v=>({...v,codec:e.target.value as 'h264'|'hevc'}))}><option value="h264">H.264 — {tx(lang,'متوافق مع معظم الهواتف','Most compatible')}</option><option value="hevc" disabled={exportSettings.format!=='mp4'}>HEVC/H.265 — {tx(lang,'حجم أصغر','Smaller file')}</option></select></label></div>{exportSettings.resolution===2160&&<p className="export-quality-note">{tx(lang,'4K UHD فعلي (3840×2160) — قد يستغرق التصدير وقتًا أطول ويحتاج مساحة تخزين أكبر.','True 4K UHD (3840×2160) — export takes longer and needs more storage.')}</p>}<div className="preview-actions"><button onClick={()=>void requestPreview()} className="btn btn-quiet w-full" disabled={previewing||!scenesReadyForExport}><Eye size={16}/>{previewing?tx(lang,'جارٍ تجهيز المعاينة...','Preparing preview...'):tx(lang,'معاينة قبل التصدير','Preview before export')}</button>{previewError&&<span className="inline-error">{previewError}</span>}{previewUrl&&<div className="preview-player"><video controls playsInline preload="metadata" src={previewUrl} aria-label={tx(lang,'معاينة الفيديو مع الصوت','Video preview with audio')}/><small>{tx(lang,'هذه معاينة منخفضة الدقة من نفس مسار الدمج.','This is a low-resolution preview using the same media mix.')}</small></div>}</div><label className="checkline export-subtitles"><input type="checkbox" checked={exportSettings.includeSubtitles} onChange={e=>setExportSettings(v=>({...v,includeSubtitles:e.target.checked}))}/>{tx(lang,'تضمين نص الترجمة لكل مشهد','Include each scene’s subtitle text')}</label><label className="inspector-field"><span className="field-label">{tx(lang,'نمط الترجمة','Subtitle style')}</span><select className="studio-input" disabled={!exportSettings.includeSubtitles} value={exportSettings.subtitleStyle} onChange={e=>setExportSettings(v=>({...v,subtitleStyle:e.target.value as 'classic'|'outline'|'pill'}))}><option value="classic">{tx(lang,'كلاسيكي واضح','Classic')}</option><option value="outline">{tx(lang,'عريض بحد خارجي','Bold outline')}</option><option value="pill">{tx(lang,'خلفية داكنة','Dark pill')}</option></select></label>
    <div className={`resource-notice panel ${exportPreflight.errors.length?'is-unavailable':''}`} role="status"><ShieldCheck size={18}/><div><b>{exportPreflight.errors.length?tx(lang,'الفحص يحتاج إصلاحًا قبل التصدير','Preflight found issues'):tx(lang,'جاهز للتصدير','Ready to export')}</b><p>{tx(lang,`المدة التقريبية ${formatTime(duration)} · فحص الروابط شكلي؛ يتأكد الخادم من نوع الملف عند التصدير.`,`Estimated duration ${formatTime(duration)} · URLs are checked for valid format; the server verifies file type during export.`)}</p>{[...exportPreflight.errors,...exportPreflight.warnings].map((issue,index)=><p key={index} className={index<exportPreflight.errors.length?'text-destructive':''}>{issue}</p>)}</div></div><button onClick={()=>{if(window.confirm(tx(lang,'سيُرسل طلب تصدير إلى قائمة المهام. تابع؟','This queues a video export. Continue?')))exportProject.mutate({projectId,data:exportSettings},{onSuccess:refresh})}} className="btn btn-primary w-full" disabled={exportProject.isPending || !scenesReadyForExport || Boolean(currentJob?.status === 'running' || currentJob?.status === 'queued')} data-testid="button-export"><Clapperboard size={16}/>{exportProject.isPending ? tx(lang,'جارٍ تجهيز التصدير...','Queueing export...') : tx(lang,'تصدير الفيديو','Export video')}</button><p>{!scenesReadyForExport && scenes.length > 0 ? tx(lang,'أضف صورة أو فيديو لكل مشهد قبل تصدير الفيلم.','Add an image or video to every scene before exporting.') : tx(lang,'هذا تركيب عبر FFmpeg وليس توليد فيديو AI: يجمع المشاهد مع انتقالات وحركة zoom بسيطة للصور، والتعليق الصوتي والموسيقى/المؤثرات والترجمة الاختيارية. اختر MP4/H.264 لتنزيل أسهل على iPhone.','This is FFmpeg compositing, not AI video generation: it combines scenes with transitions, gentle zoom on still images, narration, music/effects, and optional subtitles. Choose MP4/H.264 for easier iPhone downloads.')}</p>{exportProject.isError && <span className="inline-error">{tx(lang,'تعذر بدء التصدير. تحقق من أن كل مشهد يحتوي صورة أو فيديو.','Could not start export. Make sure each scene has an image or video.')}</span>}</div>;
  const openScene=(sceneId:string)=>{setSelected(sceneId);setStage('storyboard');setMobilePane('tools')};
  const generateScene=(sceneId:string)=>{setSelected(sceneId);setStage('images');setMobilePane('tools')};
  const duplicateSceneById=(sceneId:string)=>{const source=scenes.find(scene=>scene.id===sceneId);if(!source)return;createScene.mutate({projectId,data:{sortOrder:scenes.length,title:`${source.title||tx(lang,'مشهد','Scene')} · ${tx(lang,'نسخة','Copy')}`,description:source.description,imagePrompt:source.imagePrompt,narration:source.narration,durationSeconds:source.durationSeconds,shotType:source.shotType,cameraMovement:source.cameraMovement,location:source.location,lighting:source.lighting,transition:source.transition,subtitleText:source.subtitleText}},{onSuccess:created=>{refresh();setSelected(created.id)}})};
  const deleteSceneById=(sceneId:string)=>{if(!window.confirm(tx(lang,'حذف هذا المشهد؟ لا يمكن التراجع.','Delete this scene? This cannot be undone.')))return;deleteScene.mutate({projectId,sceneId},{onSuccess:()=>{if(sceneId===activeScene?.id)setSelected(null);refresh()}})};
  return <AppFrame title={project.title} crumb={tx(lang,'استوديو المشروع','PROJECT STUDIO')}>
    <div className="workspace-head"><div><Link href="/projects" className="back-link"><ArrowRight size={15}/>{tx(lang,'كل المشاريع','All projects')}</Link><h2>{project.title}</h2><p>{project.idea}</p></div><div className="workspace-actions"><Link href={`/media?projectId=${projectId}${activeScene ? `&sceneId=${activeScene.id}` : ''}`} className="btn btn-quiet"><ImagePlus size={16}/>{tx(lang,'إضافة وسائط','Add media')}</Link><button className="btn btn-quiet" onClick={downloadScript} disabled={!scenes.length}><Download size={16}/>{tx(lang,'تنزيل السيناريو','Download script')}</button><button className="btn btn-quiet" onClick={downloadSubtitles} disabled={!scenes.some(scene => (scene.subtitleText || scene.narration || '').trim())}><Download size={16}/>{tx(lang,'تنزيل SRT','Download SRT')}</button><button className="btn btn-quiet" onClick={()=>setEditProjectOpen(true)}><Settings2 size={16}/>{tx(lang,'تفاصيل','Details')}</button></div></div>
    <StudioStatusBoard lang={lang} stages={stages} scenes={scenes} jobs={projectJobsQuery.data || []} readyProviders={(keysQuery.data || []).filter(key => key.enabled && providerSupports(key.provider, key.serviceType) && providerKeyIsUsable(key.provider, key.status, key.cooldownUntil)).length} totalProviders={(keysQuery.data || []).length} externalOn={!freeMode} saving={updateScene.isPending || updateProject.isPending || createScene.isPending} updatedAt={project.updatedAt} onStage={setStage} onSelectScene={setSelected} onOpenJobs={() => navigate('/jobs')} />
    <div className="studio-mobile-tabs" role="tablist" aria-label={tx(lang,'أقسام الاستوديو','Studio sections')}>
      <button type="button" role="tab" aria-selected={mobilePane==='preview'} className={mobilePane==='preview'?'is-active':''} onClick={()=>setMobilePane('preview')}>{tx(lang,'المعاينة والـ Storyboard','Preview & storyboard')}</button>
      <button type="button" role="tab" aria-selected={mobilePane==='tools'} className={mobilePane==='tools'?'is-active':''} onClick={()=>setMobilePane('tools')}>{tx(lang,`أدوات ${currentStage.ar}`,`${currentStage.en} tools`)}</button>
    </div>
    <div className="studio-grid">
      <ProductionRail lang={lang} stages={stages} active={stage} onSelect={next=>{setStage(next);setMobilePane('tools')}} />
      <section className={`studio-center ${mobilePane==='tools'?'is-hidden-mobile':''}`}>
        <div className="preview-panel panel"><div className="preview-top"><span className="eyebrow">{tx(lang,'معاينة المشهد','SCENE PREVIEW')}</span><span className="small-mono">{activeScene ? `${String(activeScene.sortOrder+1).padStart(2,'0')} / ${String(scenes.length).padStart(2,'0')}` : '00 / 00'}</span></div>
          <div className={`preview-stage ratio-${project.aspectRatio.replace(':','-')}`} style={{aspectRatio:project.aspectRatio.replace(':',' / ')}}>{activeScene?.assetUrl ? activeScene.assetType==='video' ? <video ref={previewVideo} src={activeScene.assetUrl} controls playsInline className="h-full w-full object-contain" onPlay={()=>setPreviewPlaying(true)} onPause={()=>setPreviewPlaying(false)} /> : activeScene.assetType==='audio' ? <div className="stage-empty"><Languages size={26}/><p>{tx(lang,'ملف صوتي للمشهد','Scene audio asset')}</p><audio src={activeScene.assetUrl} controls /></div> : <img src={activeScene.assetUrl} alt={activeScene.title} /> : <div className="stage-empty"><div className="stage-cross"><span/><span/></div><Film size={26}/><p>{tx(lang,'أضف صورة أو فيديو للمشهد','Add an image or video to this scene')}</p>{activeScene && <Link className="text-link" href={`/media?projectId=${projectId}&sceneId=${activeScene.id}`}>{tx(lang,'استكشف الوسائط المرخّصة','Browse licensed media')}</Link>}</div>}<span className="stage-ratio">{project.aspectRatio}</span></div>
          <div className="preview-controls"><button className="play-button" aria-label={previewPlaying?tx(lang,'إيقاف المعاينة','Pause preview'):tx(lang,'تشغيل المعاينة','Play preview')} disabled={activeScene?.assetType!=='video'} onClick={()=>{const player=previewVideo.current;if(!player)return;if(player.paused)void player.play();else player.pause()}}>{previewPlaying?<Pause size={12}/>:<span />}</button><span className="small-mono">{tx(lang,'المشهد','Scene')} {activeScene?String(activeScene.sortOrder+1).padStart(2,'0'):'—'} / {String(scenes.length).padStart(2,'0')} · {formatTime(duration)}</span><div className="control-spacer"/><span className="eyebrow">{scenes.length} {tx(lang,'مشاهد','SCENES')}</span></div>
        </div>
        <StoryboardBoard lang={lang} scenes={scenes} selectedId={activeScene?.id ?? null} onOpen={openScene} onGenerate={generateScene} onDuplicate={duplicateSceneById} onDelete={deleteSceneById} deleting={deleteScene.isPending} jobs={projectJobsQuery.data || []} imageProviderReady={keyReady('image')} />
        <div className="timeline-panel panel"><div className="section-heading !mb-4"><div><span className="eyebrow">{tx(lang,'خط الإنتاج','EDIT TIMELINE')}</span><h3>{tx(lang,'ترتيب المشاهد','Scene sequence')}</h3></div><button className="btn btn-quiet" onClick={()=>createScene.mutate({projectId,data:{sortOrder:scenes.length,title:tx(lang,`مشهد ${scenes.length+1}`,`Scene ${scenes.length+1}`),description:'',imagePrompt:'',narration:'',durationSeconds:6,assetUrl:null,assetType:null}},{onSuccess:s=>{refresh();setSelected(s.id)}})} disabled={createScene.isPending}><Plus size={16}/>{tx(lang,'إضافة مشهد','Add scene')}</button></div>
           {scenes.length === 0 ? <div className="timeline-empty"><span className="timeline-empty-line"/><span>{tx(lang,'لم تُنشأ مشاهد بعد','No scenes yet')}</span><button className="text-link" onClick={()=>createScene.mutate({projectId,data:{sortOrder:0,title:tx(lang,'المشهد الأول','Scene one'),description:'',imagePrompt:'',narration:'',durationSeconds:6}},{onSuccess:s=>{refresh();setSelected(s.id)}})}>{tx(lang,'أضف أول مشهد','Add the first scene')}</button></div> : <FilmTimeline scenes={scenes} selectedId={activeScene?.id ?? null} musicUrl={project.musicUrl} musicVolume={project.musicVolume} lang={lang} previewing={previewing} onPreview={()=>void requestPreview()} onSelect={setSelected} onReorder={(source,target)=>void reorderDrop(source,target)} onSaveScene={(sceneId,data)=>updateScene.mutateAsync({projectId,sceneId,data}).then(()=>{refresh()})} onSaveProject={data=>updateProject.mutateAsync({projectId,data}).then(()=>{refresh()})} />}
        </div>
        {currentJob && <div className="job-progress panel" role="status"><div className="job-progress-head"><div><b>{tx(lang,({script:'توليد السيناريو',export:'تصدير الفيديو',image:'توليد صورة',video:'توليد فيديو',voice:'توليد صوت'})[currentJob.jobType],({script:'Script generation',export:'Video export',image:'Image generation',video:'Video generation',voice:'Voice generation'})[currentJob.jobType])}</b><span className={`job-state job-${currentJob.status}`}>{tx(lang,currentJob.status==='queued'?'في الانتظار':currentJob.status==='running'?'قيد التنفيذ':currentJob.status==='completed'?'مكتملة':'فشلت',currentJob.status)}</span></div><Link href="/jobs" className="text-link">{tx(lang,'عرض المهام','View jobs')}</Link></div>{(currentJob.status==='queued'||currentJob.status==='running')&&<div className="job-progress-track"><span style={{width:`${currentJob.progress}%`}}/></div>}{currentJob.error ? <ErrorRecoveryPanel compact lang={lang} message={currentJob.error} sceneTitle={scenes.find(scene=>scene.id===currentJob.sceneId)?.title} retrying={retryJob.isPending} onRetry={()=>{if(!window.confirm(tx(lang,'ستُرسل المهمة مجددًا إلى مزوّد خارجي وقد تُحتسب رسوم. هل تريد المتابعة؟','This resubmits the job to an external provider and may incur charges. Continue?')))return;retryJob.mutate({jobId:currentJob.id,data:{approvePotentialCharges:currentJob.jobType!=='export'}},{onSuccess:refresh})}} freeAlternative={currentJob.jobType==='script'?{ar:'استخدام قالب محلي مجاني',en:'Use a free local template',onClick:()=>{setStage('script');setMobilePane('tools')}}:currentJob.jobType==='image'&&generationKeys.some(key=>key.provider==='ai-horde'&&key.enabled)?{ar:'استخدام AI Horde المجاني',en:'Use free AI Horde',onClick:()=>{setStage('images');setMobilePane('tools')}}:currentJob.jobType==='voice'&&generationKeys.some(key=>key.provider==='piper-local'&&key.enabled)?{ar:'استخدام صوت Piper المحلي',en:'Use local Piper voice',onClick:()=>{setStage('voice');setMobilePane('tools')}}:undefined} /> : <p>{currentJob.message}</p>}{latestExportJob?.status==='completed'&&<ExportActions projectId={projectId} lang={lang}/>}</div>}
      </section>
      <StageTools lang={lang} stage={currentStage} className={mobilePane==='preview'?'is-hidden-mobile':''} titleAr={currentStage.ar} titleEn={currentStage.en}
        hintAr={stage==='video'?'أدوات الفيديو لا تظهر إلا بعد توفر صورة أو وصف للمشهد. كل طلب قد يكلّف ينتظر موافقتك.':stage==='voice'?'أدوات الصوت لا تظهر إلا للمشاهد التي تحتوي نص تعليق. لا يُرسل صوت قبل الموافقة.':stage==='images'?'ولّد صورًا أو ارفع صورة مرجعية لكل مشهد. النسخ تُحفظ للمقارنة لاحقًا.':stage==='export'?'إعدادات التصدير والفحص المسبق للمشاهد والصوت والترجمة.':stage==='idea'?'تفاصيل الفكرة والقالب الأساسي للمشروع.':stage==='script'?'اكتب السيناريو يدويًا أو ولّده بمزوّد نص بعد الموافقة.':'حرّر اللقطة المحددة ورتّب المشاهد من هنا.'}
        hintEn={stage==='video'?'Video tools appear only after the scene has an image or prompt. Every cost-bearing request waits for approval.':stage==='voice'?'Voice tools appear only for scenes with narration text. Nothing is sent without approval.':stage==='images'?'Generate images or upload a reference image per scene. Variants stay saved for comparison.':stage==='export'?'Export settings and a preflight for scenes, audio, and subtitles.':stage==='idea'?'Project idea details and the base template.':stage==='script'?'Write the script manually or generate it with a text provider after approval.':'Edit the selected shot and reorder scenes here.'}>
        {scenePicker}
        {stage==='idea'&&<div className="stage-tool-stack"><div className="stage-tool-summary"><span className="eyebrow">{tx(lang,'ملخص الفكرة','IDEA SUMMARY')}</span><h4>{project.title}</h4><p>{project.idea||tx(lang,'لا يوجد ملخص بعد.','No summary yet.')}</p><dl><div><dt>{tx(lang,'النوع','Format')}</dt><dd>{project.videoType}</dd></div><div><dt>{tx(lang,'المدة','Duration')}</dt><dd>{formatTime(project.durationSeconds)}</dd></div><div><dt>{tx(lang,'الأبعاد','Aspect')}</dt><dd>{project.aspectRatio}</dd></div><div><dt>{tx(lang,'الأسلوب','Style')}</dt><dd>{project.visualStyle}</dd></div></dl></div><button className="btn btn-primary w-full" onClick={()=>setEditProjectOpen(true)}><Settings2 size={16}/>{tx(lang,'تعديل تفاصيل المشروع','Edit project details')}</button><button className="btn btn-quiet w-full" onClick={()=>setStage('script')}><WandSparkles size={16}/>{tx(lang,'الانتقال إلى السيناريو','Go to script')}</button></div>}
        {stage==='script'&&<div className="stage-tool-stack">{scriptGeneration}{scenes.length>0&&sceneListTools}</div>}
        {stage==='storyboard'&&<div className="stage-tool-stack">{activeScene?<><SceneFields key={activeScene.id} projectId={projectId} scene={activeScene} characters={project.characters||[]} lang={lang} onSave={(field,value)=>updateCurrent(field,value)} pending={updateScene.isPending}/>{sceneListTools}</>:<><div className="inspector-blank"><Film size={22}/><span>{tx(lang,'اختر مشهدًا من الخط الزمني أو أنشئ واحدًا.','Select a scene from the timeline or create one.')}</span></div>{sceneListTools}</>}</div>}
        {stage==='images'&&<div className="stage-tool-stack">{activeScene?<><GenerationPanel projectId={projectId} scene={activeScene} keys={generationKeys} lang={lang} freeMode={freeMode} onQueued={refresh} services={['image']}/><AssetVersionCompare projectId={projectId} scene={activeScene} keys={generationKeys} lang={lang} onQueued={refresh}/><Link href={`/media?projectId=${projectId}&sceneId=${activeScene.id}`} className="btn btn-quiet w-full"><ImagePlus size={16}/>{tx(lang,'اختيار صورة مرخّصة','Choose licensed media')}</Link></>:<div className="inspector-blank"><ImagePlus size={22}/><span>{tx(lang,'اختر مشهدًا لتوليد صورته.','Select a scene to generate its image.')}</span></div>}</div>}
        {stage==='video'&&<div className="stage-tool-stack">{!activeScene?<div className="inspector-blank"><Film size={22}/><span>{tx(lang,'اختر مشهدًا لتوليد الفيديو.','Select a scene to generate video.')}</span></div>:!activeScene.assetUrl&&!activeScene.description.trim()&&!activeScene.imagePrompt.trim()?<div className="service-purpose-hint is-unavailable"><b>{tx(lang,'مدخلات الفيديو غير متوفرة','Video inputs are missing')}</b><span>{tx(lang,'أضف وصفًا أو صورة للمشهد أولًا، ثم ستظهر أدوات توليد الفيديو.','Add a scene description or image first; video tools will appear after that.')}</span><button className="btn btn-quiet" onClick={()=>setStage('storyboard')}>{tx(lang,'فتح محرر المشهد','Open scene editor')}</button></div>:<><GenerationPanel projectId={projectId} scene={activeScene} keys={generationKeys} lang={lang} freeMode={freeMode} onQueued={refresh} services={['video']}/><BatchVideoGeneration projectId={projectId} scenes={scenes} keys={generationKeys} lang={lang} freeMode={freeMode} hasActiveJob={Boolean(currentJob && (currentJob.status === 'queued' || currentJob.status === 'running'))} onQueued={refresh}/></>}</div>}
        {stage==='voice'&&<div className="stage-tool-stack">{!narratedScenes.length?<div className="service-purpose-hint is-unavailable"><b>{tx(lang,'لا يوجد نص تعليق بعد','No narration text yet')}</b><span>{tx(lang,'اكتب الحوار أو التعليق في محرر المشهد، ثم ستظهر أدوات الصوت.','Write dialogue or narration in the scene editor; voice tools will appear after that.')}</span><button className="btn btn-quiet" onClick={()=>setStage('storyboard')}>{tx(lang,'فتح محرر المشهد','Open scene editor')}</button></div>:<>{activeScene&&activeScene.narration.trim()&&<GenerationPanel projectId={projectId} scene={activeScene} keys={generationKeys} lang={lang} freeMode={freeMode} onQueued={refresh} services={['voice']}/>}<BatchVoiceGeneration projectId={projectId} scenes={scenes} keys={generationKeys} lang={lang} freeMode={freeMode} hasActiveJob={Boolean(currentJob && (currentJob.status === 'queued' || currentJob.status === 'running'))} onQueued={refresh}/>{activeScene&&<TranscriptionPanel projectId={projectId} sceneId={activeScene.id} language={project.language} keys={keysQuery.data || []} lang={lang} freeMode={freeMode}/>}</>}</div>}
        {stage==='export'&&exportTools}
      </StageTools>
    </div>
    <CharacterProfiles projectId={projectId} characters={project.characters || []} onSave={data=>updateProject.mutateAsync({projectId,data}).then(()=>{refresh()})} pending={updateProject.isPending}/>
    <BrandKitEditor brandKit={project.brandKit} pending={updateProject.isPending} onSave={data=>updateProject.mutateAsync({projectId,data}).then(()=>{refresh()})}/>
    <ProjectSoundtrack url={project.musicUrl} volume={project.musicVolume} pending={updateProject.isPending} onSave={data=>updateProject.mutateAsync({projectId,data}).then(()=>{refresh()})}/>
    <ProjectSoundEffects url={project.soundEffectsUrl} volume={project.soundEffectsVolume} pending={updateProject.isPending} onSave={data=>updateProject.mutateAsync({projectId,data}).then(()=>{refresh()})}/>
    {updateProject.isError&&<p className="inline-error">{tx(lang,'تعذر حفظ تفاصيل المشروع. لم تُفقد التغييرات؛ أعد المحاولة.','Could not save project details. Your edits remain available; try again.')}</p>}
    {editProjectOpen && <ProjectForm initial={{title:project.title,idea:project.idea,videoType:project.videoType,language:project.language,durationSeconds:project.durationSeconds,audience:project.audience,visualStyle:project.visualStyle,aspectRatio:project.aspectRatio as ProjectInput['aspectRatio']}} onClose={()=>setEditProjectOpen(false)} pending={updateProject.isPending} onSave={data=>updateProject.mutate({projectId,data},{onSuccess:()=>{refresh();setEditProjectOpen(false)}})} />}
  </AppFrame>;
}
function JobsPage() {
  const { lang } = useApp();
  const qc = useQueryClient();
  const jobsQuery = useListStudioJobs(undefined, { query: { queryKey: getListStudioJobsQueryKey(), refetchInterval: query => query.state.data?.some(job => job.status === 'queued' || job.status === 'running') ? 3000 : false, staleTime: 15000 } });
  const retry = useRetryStudioJob();
  const jobs = jobsQuery.data ?? [];
  return <AppFrame title={tx(lang,'المهام','Jobs')} crumb={tx(lang,'طابور المعالجة','PROCESSING QUEUE')}>
    <div className="page-toolbar"><div><span className="eyebrow">{tx(lang,'حالة المعالجة','JOB STATUS')}</span><h2>{tx(lang,'مهامك المحفوظة.','Your saved jobs.')}</h2><p>{tx(lang,'تستأنف المهام من آخر مرحلة محفوظة بعد إعادة تشغيل الخادم.','Jobs resume from the last saved stage after a server restart.')}</p></div><button className="btn btn-quiet" onClick={()=>jobsQuery.refetch()}><Clock3 size={16}/>{tx(lang,'تحديث','Refresh')}</button></div>
    {jobsQuery.isLoading ? <div className="workspace-skeleton"><SkeletonBlock className="h-24"/><SkeletonBlock className="h-24"/></div> : jobsQuery.isError ? <StateError lang={lang} retry={()=>jobsQuery.refetch()} /> : jobs.length ? <div className="job-list">{jobs.map(job=><JobCard key={job.id} job={job} lang={lang} retrying={retry.isPending} onRetry={()=>{
       if(job.jobType!=='export'&&!window.confirm(tx(lang,'ستُرسل المهمة مجددًا إلى مزوّد خارجي وقد تُحتسب رسوم. هل تريد المتابعة؟','This resubmits the job to an external provider and may incur charges. Continue?')))return;
       retry.mutate({jobId:job.id,data:{approvePotentialCharges:job.jobType!=='export'}},{onSuccess:()=>qc.invalidateQueries({queryKey:getListStudioJobsQueryKey()})});
    }} />)}</div> : <Empty title={tx(lang,'لا توجد مهام بعد','No jobs yet')} body={tx(lang,'ستظهر هنا مهام إنشاء السيناريو وتصدير الفيديو مع تقدمها وأي أخطاء.','Script and video export jobs will appear here with their progress and any errors.')} />}
    {retry.isError&&<div className="inline-error">{tx(lang,'تعذرت إعادة المهمة. حدّث الصفحة وحاول مجددًا.','Could not retry this job. Refresh and try again.')}</div>}
  </AppFrame>;
}

function ExportActions({ projectId, lang }: { projectId: string; lang: Lang }) {
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState('');
  const url = `${basePath}/api/projects/${projectId}/export/file`;
  const downloadVideo = async () => {
    setSharing(true);
    setMessage('');
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('download');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = blob.type.includes('webm') ? 'ella-video.webm' : 'ella-video.mp4';
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      setMessage(tx(lang, 'بدأ تنزيل الفيديو على الهاتف.', 'Video download started.'));
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
      setMessage(tx(lang, 'تم فتح الفيديو؛ استخدم حفظ/تنزيل من الهاتف.', 'Video opened; use your phone’s Save/Download action.'));
    } finally {
      setSharing(false);
    }
  };
  const share = async () => {
    setSharing(true);
    setMessage('');
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('download');
      const blob = await response.blob();
      const file = new File([blob], blob.type.includes('webm') ? 'video.webm' : 'video.mp4', { type: blob.type || 'video/mp4' });
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ title: 'Ella2027 video', files: [file] });
        setMessage(tx(lang, 'تم فتح المشاركة.', 'Share sheet opened.'));
      } else {
        await navigator.clipboard.writeText(new URL(url, window.location.origin).toString());
        setMessage(tx(lang, 'تم نسخ رابط الفيديو للمشاركة.', 'Video link copied for sharing.'));
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage(tx(lang, 'تعذرت المشاركة؛ استخدم زر التنزيل.', 'Sharing failed; use Download instead.'));
    } finally {
      setSharing(false);
    }
  };
  return <div className="flex flex-wrap gap-2 mt-3"><button className="btn btn-primary" onClick={() => void downloadVideo()} disabled={sharing}><ArrowDown size={15}/>{tx(lang, 'تنزيل على الهاتف', 'Download to phone')}</button><button className="btn btn-quiet" onClick={() => void share()} disabled={sharing}><Share2 size={15}/>{sharing ? tx(lang, 'جارٍ تجهيز المشاركة…', 'Preparing share…') : tx(lang, 'إرسال / مشاركة', 'Send / Share')}</button>{message && <small className="provider-message" role="status">{message}</small>}</div>;
}

function JobCard({ job, lang, retrying, onRetry }: { job: StudioJob; lang: Lang; retrying: boolean; onRetry: () => void }) {
  const typeLabel = tx(lang,({script:'سيناريو وStoryboard',export:'تصدير فيديو',image:'توليد صورة',video:'توليد فيديو',voice:'توليد صوت'})[job.jobType],({script:'Script and storyboard',export:'Video export',image:'Image generation',video:'Video generation',voice:'Voice generation'})[job.jobType]);
  const statusLabel = tx(lang,job.status==='queued'?'في الانتظار':job.status==='running'?'قيد التنفيذ':job.status==='completed'?'مكتملة':'فشلت',job.status);
  return <article className="job-card panel"><div className="job-progress-head"><div><b>{typeLabel}</b><span className={`job-state job-${job.status}`}>{statusLabel}</span></div><Link className="text-link" href={`/projects/${job.projectId}`}>{tx(lang,'فتح المشروع','Open project')}<ArrowLeft size={14}/></Link></div>
    {(job.status==='queued'||job.status==='running')&&<div className="job-progress-track"><span style={{width:`${job.progress}%`}}/></div>}
    <div className="job-card-meta"><span>{job.message}</span><time>{new Date(job.createdAt).toLocaleString(lang==='ar'?'ar':'en')}</time></div>
    {job.error&&<ErrorRecoveryPanel compact lang={lang} message={job.error}/>}
    {job.status==='completed'&&job.jobType==='export'&&<ExportActions projectId={job.projectId} lang={lang}/>}
    {job.status==='failed'&&<button className="btn btn-quiet mt-3" onClick={onRetry} disabled={retrying}><Clock3 size={15}/>{retrying?tx(lang,'جارٍ الإرسال...','Retrying...'):tx(lang,'إعادة المحاولة','Retry')}</button>}
  </article>;
}

type SceneTemplate = { id:string; name:string; nameAr:string; title:string; description:string; imagePrompt:string; narration:string; durationSeconds:number; shotType:string; cameraMovement:string; location:string; lighting:string; transition:string; };
const sceneTemplates: SceneTemplate[] = [
 {id:'establishing',name:'Cinematic establishing shot',nameAr:'لقطة افتتاحية سينمائية',title:'Establishing shot',description:'Introduce the world and emotional tone before the action begins.',imagePrompt:'Wide cinematic establishing shot, layered foreground and background, rich production design, anamorphic composition, subtle film grain',narration:'The story begins in a place where every detail hints at what is about to happen.',durationSeconds:8,shotType:'establishing',cameraMovement:'slow push-in',location:'A striking location that defines the world of the story',lighting:'soft golden-hour light with cinematic contrast',transition:'fade'},
 {id:'dialogue',name:'Intimate dialogue',nameAr:'حوار درامي قريب',title:'Intimate dialogue',description:'Two characters exchange a meaningful line with emotional tension.',imagePrompt:'Cinematic shot-reverse-shot dialogue setup, expressive faces, shallow depth of field, 50mm lens, restrained composition',narration:'“We both know this changes everything,” one of them says quietly.',durationSeconds:7,shotType:'over-the-shoulder',cameraMovement:'subtle handheld',location:'A quiet interior with visual tension between the characters',lighting:'motivated window light with a soft shadow falloff',transition:'cut'},
 {id:'chase',name:'Dynamic pursuit',nameAr:'مطاردة حركية',title:'The pursuit',description:'A fast, visually clear action beat that moves the story forward.',imagePrompt:'Dynamic cinematic pursuit, strong leading lines, controlled motion blur, low-angle action framing, high production value',narration:'Footsteps echo behind them as the distance closes.',durationSeconds:6,shotType:'tracking',cameraMovement:'fast tracking',location:'A dangerous route through a visually distinctive environment',lighting:'hard directional light with flashing practical sources',transition:'wipe'},
 {id:'flashback',name:'Memory / flashback',nameAr:'استرجاع من الذاكرة',title:'A memory returns',description:'Reveal backstory through a softer, dreamlike visual language.',imagePrompt:'Dreamlike cinematic flashback, diffused highlights, gentle halation, nostalgic color palette, poetic composition',narration:'For a moment, the past feels close enough to touch.',durationSeconds:8,shotType:'medium',cameraMovement:'slow orbit',location:'A meaningful place from the character’s past',lighting:'diffused backlight, hazy atmosphere, warm highlights',transition:'dissolve'},
 {id:'reveal',name:'Dramatic reveal',nameAr:'كشف درامي',title:'The reveal',description:'Hold the frame long enough for a new truth to land.',imagePrompt:'Dramatic cinematic reveal, silhouette resolving into clear detail, carefully staged negative space, high contrast',narration:'Then the truth steps out of the darkness.',durationSeconds:7,shotType:'close-up',cameraMovement:'slow dolly-in',location:'A location with a concealed detail ready to be revealed',lighting:'single motivated key light with deep shadows',transition:'fade'},
 {id:'horror',name:'Suspense / horror',nameAr:'تشويق ورعب',title:'Something in the dark',description:'Build suspense with stillness, negative space, and an unseen threat.',imagePrompt:'Atmospheric cinematic suspense frame, deep negative space, unsettling practical light, subtle fog, psychological horror mood',narration:'Nothing moves, yet the room no longer feels empty.',durationSeconds:8,shotType:'extreme-close-up',cameraMovement:'very slow push-in',location:'An isolated place where sound and shadow carry the danger',lighting:'cold moonlight with a single flickering practical light',transition:'dissolve'},
];
function SceneTemplatePicker({lang,onApply}:{lang:Lang;onApply:(template:SceneTemplate)=>void}) {
 const [selected,setSelected]=useState(sceneTemplates[0].id); const template=sceneTemplates.find(item=>item.id===selected)||sceneTemplates[0];
 return <div className="scene-template-picker panel"><div><span className="eyebrow">{tx(lang,'قوالب جاهزة','READY TEMPLATES')}</span><p>{tx(lang,'اختر بنية سينمائية لتعبئة حقول المشهد بسرعة، ثم عدّل النص كما تريد.','Choose a cinematic structure to fill the scene quickly, then customize the text.')}</p></div><div className="form-two"><select className="studio-input" value={selected} onChange={e=>setSelected(e.target.value)}>{sceneTemplates.map(item=><option key={item.id} value={item.id}>{tx(lang,item.nameAr,item.name)}</option>)}</select><button className="btn btn-quiet" onClick={()=>onApply(template)}>{tx(lang,'تطبيق القالب','Apply template')}</button></div></div>;
}
function SceneFields({ projectId, scene, characters, lang, onSave, pending }: { projectId: string; scene: Scene; characters:CharacterProfile[]; lang: Lang; onSave: (field: keyof Scene, value: string | number | string[] | null) => Promise<void>; pending: boolean }) {
  const [form,setForm] = useState({title:scene.title,description:scene.description,imagePrompt:scene.imagePrompt,narration:scene.narration,subtitleText:scene.subtitleText,subtitleStartSeconds:scene.subtitleStartSeconds,subtitleEndSeconds:scene.subtitleEndSeconds,durationSeconds:scene.durationSeconds,shotType:scene.shotType,cameraMovement:scene.cameraMovement,location:scene.location,lighting:scene.lighting,clipStartSeconds:scene.clipStartSeconds,clipEndSeconds:scene.clipEndSeconds,playbackSpeed:scene.playbackSpeed,transition:scene.transition,voiceUrl:scene.voiceUrl||'',voiceVolume:scene.voiceVolume});
  const [characterIds,setCharacterIds]=useState(scene.characterIds);
  const [saveState,setSaveState]=useState<'saved'|'saving'|'error'>('saved');
  const [trimError,setTrimError]=useState(false);
  const [subtitleRangeError,setSubtitleRangeError]=useState(false);
  const [uploadingReference,setUploadingReference]=useState(false);
  const [referenceError,setReferenceError]=useState('');
  const pendingFields=useRef<Partial<Record<keyof Scene,string|number|string[]|null>>>({});
  const applyTemplate=(template:SceneTemplate)=>{
    const values:Record<string,string|number>={title:template.title,description:template.description,imagePrompt:template.imagePrompt,narration:template.narration,durationSeconds:template.durationSeconds,shotType:template.shotType,cameraMovement:template.cameraMovement,location:template.location,lighting:template.lighting,transition:template.transition};
    setForm(current=>({...current,...values}));
    for(const [key,value] of Object.entries(values)) queueSave(key as keyof Scene,value as string|number);
  };

  const saveTimer=useRef<number|null>(null);
  const saveInFlight=useRef(false);
  const saveHandler=useRef(onSave);
  useEffect(()=>{saveHandler.current=onSave},[onSave]);
  useEffect(()=>{
    setForm({title:scene.title,description:scene.description,imagePrompt:scene.imagePrompt,narration:scene.narration,subtitleText:scene.subtitleText,subtitleStartSeconds:scene.subtitleStartSeconds,subtitleEndSeconds:scene.subtitleEndSeconds,durationSeconds:scene.durationSeconds,shotType:scene.shotType,cameraMovement:scene.cameraMovement,location:scene.location,lighting:scene.lighting,clipStartSeconds:scene.clipStartSeconds,clipEndSeconds:scene.clipEndSeconds,playbackSpeed:scene.playbackSpeed,transition:scene.transition,voiceUrl:scene.voiceUrl||'',voiceVolume:scene.voiceVolume});
    setCharacterIds(scene.characterIds);
    setSaveState('saved');
     setTrimError(false);
     setSubtitleRangeError(false);
  },[scene.id]);
  const flushSave=async()=>{
    if(saveTimer.current!==null){window.clearTimeout(saveTimer.current);saveTimer.current=null}
    if(saveInFlight.current||!Object.keys(pendingFields.current).length)return;
    saveInFlight.current=true;
    const changes=pendingFields.current;
    pendingFields.current={};
    setSaveState('saving');
    let failed=false;
    try{
      await Promise.all((Object.entries(changes) as [keyof Scene,string|number|string[]|null][]).map(([key,value])=>saveHandler.current(key,value)));
      setSaveState('saved');
    }catch{
      failed=true;
      pendingFields.current={...changes,...pendingFields.current};
      setSaveState('error');
    }finally{
      saveInFlight.current=false;
      if(Object.keys(pendingFields.current).length&&!failed){
        saveTimer.current=window.setTimeout(()=>void flushSave(),300);
      }
    }
  };
  const queueSave=(key:keyof Scene,value:string|number|string[]|null)=>{
    pendingFields.current={...pendingFields.current,[key]:value};
    setSaveState('saving');
    if(saveTimer.current!==null)window.clearTimeout(saveTimer.current);
    saveTimer.current=window.setTimeout(()=>void flushSave(),700);
  };
  const uploadReference=async(file:File|null)=>{
    if(!file)return;
    if(!['image/png','image/jpeg','image/webp','image/svg+xml'].includes(file.type)||file.size>20*1024*1024){setReferenceError(tx(lang,'اختر PNG أو JPEG أو WebP أو SVG بحجم أقل من 20MB.','Choose a PNG, JPEG, WebP, or SVG image smaller than 20MB.'));return;}
    setUploadingReference(true);setReferenceError('');
    try{
      const response=await fetch(`${basePath}/api/projects/${projectId}/scenes/${scene.id}/assets/upload`,{method:'POST',credentials:'include',headers:{'Content-Type':file.type},body:file});
      const body=await response.json().catch(()=>({})) as {assetUrl?:string;assetType?:string;error?:string};
      if(!response.ok||!body.assetUrl)throw new Error(body.error||tx(lang,'تعذر حفظ الصورة المرجعية.','Could not save the reference image.'));
      await onSave('assetUrl',body.assetUrl);await onSave('assetType','image');
    }catch(error){setReferenceError(error instanceof Error?error.message:tx(lang,'تعذر رفع الصورة المرجعية.','Could not upload the reference image.'));}
    finally{setUploadingReference(false);}
  };
  useEffect(()=>()=>{if(saveTimer.current!==null)window.clearTimeout(saveTimer.current);if(Object.keys(pendingFields.current).length)void flushSave()},[]);
  const field = (key: keyof typeof form, label: string, multiline = false) => <label className="inspector-field"><span className="field-label">{label}</span>{multiline ? <textarea className="studio-input" rows={key==='narration'?3:2} value={form[key] as string} onChange={e=>{setForm(v=>({...v,[key]:e.target.value}));queueSave(key as keyof Scene,e.target.value)}} onBlur={()=>void flushSave()} data-testid={`input-scene-${key}`} /> : <input className="studio-input" value={form[key] as string} onChange={e=>{setForm(v=>({...v,[key]:e.target.value}));queueSave(key as keyof Scene,e.target.value)}} onBlur={()=>void flushSave()} data-testid={`input-scene-${key}`} />}</label>;
  const captionRange=scene.assetType==='video'&&form.clipEndSeconds!==null?form.clipEndSeconds-form.clipStartSeconds:form.durationSeconds;
  const captionDuration=Math.max(1,Math.min(600,captionRange/Math.max(.25,Math.min(4,form.playbackSpeed||1))));
  const captionTimeField=(key:'subtitleStartSeconds'|'subtitleEndSeconds',label:string)=> <label className="inspector-field"><span className="field-label">{label}</span><input type="number" min={key==='subtitleEndSeconds'?form.subtitleStartSeconds+0.1:0} max={captionDuration} step="0.1" className="studio-input" value={form[key]??''} onChange={e=>{const value=e.target.value===''&&key==='subtitleEndSeconds'?null:Number(e.target.value);const invalid=key==='subtitleStartSeconds'&&form.subtitleEndSeconds!==null&&typeof value==='number'&&value>=form.subtitleEndSeconds||key==='subtitleEndSeconds'&&typeof value==='number'&&value<=form.subtitleStartSeconds;if(invalid){setSubtitleRangeError(true);return;}setSubtitleRangeError(false);setForm(v=>({...v,[key]:value}));queueSave(key,value)}} onBlur={()=>void flushSave()} /></label>;
  const numberField=(key:'durationSeconds'|'clipStartSeconds'|'clipEndSeconds'|'playbackSpeed'|'voiceVolume',label:string,min:number,max?:number,step=1)=>{
    const isTrimField=key==='clipStartSeconds'||key==='clipEndSeconds';
    const inputMin=key==='clipEndSeconds'?form.clipStartSeconds+1:min;
    const inputMax=key==='clipStartSeconds'&&form.clipEndSeconds!==null?form.clipEndSeconds-1:max;
    return <label className="inspector-field"><span className="field-label">{label}</span><input type="number" min={inputMin} max={inputMax} step={isTrimField?1:step} className="studio-input" value={form[key]??''} onChange={e=>{
      const value=e.target.value===''&&key==='clipEndSeconds'?null:Number(e.target.value);
      const invalidPrecision=isTrimField&&value!==null&&!Number.isInteger(value);
      const invalidRange=key==='clipStartSeconds'&&form.clipEndSeconds!==null&&typeof value==='number'&&value>=form.clipEndSeconds
        ||key==='clipEndSeconds'&&typeof value==='number'&&value<=form.clipStartSeconds;
      if(invalidPrecision||invalidRange){setTrimError(true);return}
      if(isTrimField)setTrimError(false);
      setForm(v=>({...v,[key]:value}));
      queueSave(key,value);
    }} onBlur={()=>void flushSave()} /></label>;
  };
  return <div className="inspector-fields"><SceneTemplatePicker lang={lang} onApply={applyTemplate}/><div className="inspector-section-title"><span className="eyebrow">{tx(lang,'القصة والحركة','STORY & ACTION')}</span><b>{tx(lang,'ماذا يحدث في المشهد؟','What happens in the scene?')}</b></div>{field('title',tx(lang,'اسم المشهد','Scene title'))}{numberField('durationSeconds',tx(lang,'المدة بالثواني','Duration (seconds)'),1,600)}{field('description',tx(lang,'وصف الأحداث والحركة','Action and movement description'),true)}{field('imagePrompt',tx(lang,'موجّه الصورة والألوان والجو','Visual prompt, colors, and mood'),true)}{field('narration',tx(lang,'الحوار أو التعليق الصوتي','Dialogue or narration'),true)}<WritingAssistant lang={lang} values={{description:form.description,imagePrompt:form.imagePrompt,narration:form.narration,cameraMovement:form.cameraMovement}} onApply={(field,value)=>{setForm(v=>({...v,[field]:value}));queueSave(field as keyof Scene,value)}} />
    <label className="inspector-field"><span className="field-label">{tx(lang,'نص الترجمة (مستقل عن التعليق)','Subtitle text (independent from narration)')}</span><textarea className="studio-input" rows={3} value={form.subtitleText??form.narration} onChange={e=>{setForm(v=>({...v,subtitleText:e.target.value}));queueSave('subtitleText',e.target.value)}} onBlur={()=>void flushSave()} data-testid="input-scene-subtitleText"/><button type="button" className="text-link mt-2" onClick={()=>{setForm(v=>({...v,subtitleText:null}));queueSave('subtitleText',null)}}>{tx(lang,'استخدم نص التعليق بدلًا منه','Use narration as the subtitle')}</button></label>
    <div className="form-two">{captionTimeField('subtitleStartSeconds',tx(lang,'بداية الترجمة (ث)','Subtitle start (s)'))}{captionTimeField('subtitleEndSeconds',tx(lang,'نهاية الترجمة (ث) — فارغ = نهاية المشهد','Subtitle end (s) — blank = scene end'))}</div>{subtitleRangeError&&<p className="inline-error" role="alert">{tx(lang,'اجعل نهاية الترجمة بعد بدايتها وضمن مدة المشهد.','Set the subtitle end after its start and within the scene.')}</p>}
    <div className="inspector-section-title"><span className="eyebrow">{tx(lang,'المكان والزمن','SETTING & TIME')}</span><b>{tx(lang,'أين ومتى؟','Where and when?')}</b></div>{field('location',tx(lang,'الموقع والزمن','Location and time'))}{field('lighting',tx(lang,'الإضاءة والألوان','Lighting and color treatment'))}
    <div className="inspector-section-title"><span className="eyebrow">{tx(lang,'الكاميرا واللقطة','CAMERA & SHOT')}</span><b>{tx(lang,'كيف نرى المشهد؟','How do we see it?')}</b></div><div className="form-two"><label><span className="field-label">{tx(lang,'نوع اللقطة','Shot type')}</span><select className="studio-input" value={form.shotType} onChange={e=>{setForm(v=>({...v,shotType:e.target.value}));queueSave('shotType',e.target.value)}} onBlur={()=>void flushSave()}><option value="">{tx(lang,'غير محدد','Unspecified')}</option>{['establishing','wide','medium','close-up','extreme-close-up','over-the-shoulder','POV','aerial'].map(x=><option key={x}>{x}</option>)}</select></label><label><span className="field-label">{tx(lang,'حركة الكاميرا','Camera movement')}</span><select className="studio-input" value={form.cameraMovement} onChange={e=>{setForm(v=>({...v,cameraMovement:e.target.value}));queueSave('cameraMovement',e.target.value)}} onBlur={()=>void flushSave()}><option value="">{tx(lang,'ثابتة','Static')}</option>{['pan','tilt','dolly-in','dolly-out','tracking','handheld','crane','orbit','zoom'].map(x=><option key={x}>{x}</option>)}</select></label></div>
    <div className="reference-image-field"><div className="inspector-section-title"><span className="eyebrow">{tx(lang,'الصورة المرجعية','REFERENCE IMAGE')}</span><b>{tx(lang,'صورة حقيقية محفوظة مع المشهد','A durable image saved with this scene')}</b></div>{scene.assetUrl&&scene.assetType==='image'&&<img className="reference-image-preview" src={scene.assetUrl} alt={scene.title}/>}<label className="inspector-field"><span className="field-label">{scene.assetUrl&&scene.assetType==='image'?tx(lang,'استبدال الصورة','Replace image'):tx(lang,'رفع صورة من الهاتف','Upload from phone')}</span><input className="studio-input" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" disabled={uploadingReference} onChange={e=>{void uploadReference(e.target.files?.[0]||null);e.target.value=''}} data-testid="input-scene-reference-image" /></label>{uploadingReference&&<p className="save-state"><Busy text={tx(lang,'جارٍ رفع الصورة وحفظها…','Uploading and saving…')} /></p>}{scene.assetUrl&&scene.assetType==='image'&&<button type="button" className="text-link text-destructive" onClick={()=>{void onSave('assetUrl',null);void onSave('assetType',null)}} disabled={uploadingReference}>{tx(lang,'فصل الصورة عن المشهد','Remove image from scene')}</button>}{referenceError&&<p className="inline-error" role="alert">{referenceError}</p>}</div>
    {characters.length>0&&<fieldset className="character-assign"><legend className="field-label">{tx(lang,'الشخصيات في المشهد','Characters in scene')}</legend><div>{characters.map(c=><label className="checkline" key={c.id}><input type="checkbox" checked={characterIds.includes(c.id)} onChange={e=>{const next=e.target.checked?[...characterIds,c.id]:characterIds.filter(id=>id!==c.id);setCharacterIds(next);queueSave('characterIds',next)}}/>{c.name||tx(lang,'شخصية بلا اسم','Unnamed character')}</label>)}</div></fieldset>}
    <div className="form-two">{numberField('clipStartSeconds',tx(lang,'بداية المقطع','Clip in (s)'),0)}{numberField('clipEndSeconds',tx(lang,'نهاية المقطع','Clip out (s)'),0)}{numberField('playbackSpeed',tx(lang,'سرعة التشغيل','Playback speed'),.25,4,.05)}<label className="inspector-field"><span className="field-label">{tx(lang,'مستوى التعليق الصوتي','Voice volume')} · {form.voiceVolume}%</span><input type="range" min="0" max="100" value={form.voiceVolume} onChange={e=>{const value=Number(e.target.value);setForm(v=>({...v,voiceVolume:value}));queueSave('voiceVolume',value)}} onBlur={()=>void flushSave()} aria-label={tx(lang,'مستوى التعليق الصوتي','Voice volume')} /></label></div>{trimError&&<p className="inline-error" role="alert">{tx(lang,'استخدم أرقامًا صحيحة بالثواني، واجعل نهاية المقطع بعد بدايته.','Use whole seconds and set clip out after clip in.')}</p>}
    <label className="inspector-field"><span className="field-label">{tx(lang,'الانتقال','Transition')}</span><select className="studio-input" value={form.transition||'cut'} onChange={e=>{setForm(v=>({...v,transition:e.target.value}));queueSave('transition',e.target.value)}} onBlur={()=>void flushSave()}><option value="cut">{tx(lang,'قطع مباشر','Cut')}</option><option value="fade">{tx(lang,'تلاشي','Fade')}</option><option value="dissolve">{tx(lang,'تداخل','Dissolve')}</option><option value="wipe">{tx(lang,'مسح جانبي','Wipe')}</option><option value="slide">{tx(lang,'انزلاق','Slide')}</option></select></label>{field('voiceUrl',tx(lang,'رابط التعليق الصوتي','Voice asset URL'))}{scene.voiceUrl&&<audio className="audio-preview" src={scene.voiceUrl} controls aria-label={tx(lang,'معاينة التعليق الصوتي','Voice narration preview')}/>}
    <div className={`save-state ${saveState==='error'?'text-destructive':''}`}>{pending||saveState==='saving' ? <Busy text={tx(lang,'جارٍ الحفظ','Saving')} /> : saveState==='error' ? <><span>{tx(lang,'تعذر الحفظ تلقائيًا.','Auto-save failed.')}</span><button className="text-link" onClick={()=>void flushSave()}>{tx(lang,'أعد المحاولة','Retry')}</button></> : <><span className="signal-dot"/>{tx(lang,'تم الحفظ تلقائيًا','Saved automatically')}</>}</div></div>;
}
function CharacterProfiles({projectId,characters,onSave,pending}:{projectId:string;characters:CharacterProfile[];onSave:(data:{characters:CharacterProfile[]})=>Promise<void>;pending:boolean}) {
  const {lang}=useApp();
  const [draft,setDraft]=useState(characters);
  const [library,setLibrary]=useState<Array<CharacterProfile & {savedId:string}>>([]);
  const [libraryBusy,setLibraryBusy]=useState(false);
  const [libraryError,setLibraryError]=useState('');
  const [dirty,setDirty]=useState(false);
  const [saveError,setSaveError]=useState(false);
  const editVersion=useRef(0);
  const saveHandler=useRef(onSave);
  useEffect(()=>{saveHandler.current=onSave},[onSave]);
  useEffect(()=>{if(!dirty)setDraft(characters)},[characters,dirty]);
  useEffect(()=>{let cancelled=false;void fetch(`${basePath}/api/characters/library`,{credentials:'include'}).then(async response=>{if(!response.ok)throw new Error('library');return response.json() as Promise<Array<CharacterProfile & {id:string}>>}).then(rows=>{if(!cancelled)setLibrary(rows.map(row=>({...row,savedId:row.id}))) }).catch(()=>{if(!cancelled)setLibraryError(tx(lang,'تعذر تحميل مكتبة الشخصيات.','Could not load the character library.'))});return()=>{cancelled=true}},[lang]);
  useEffect(()=>{
    if(!dirty||pending||saveError||draft.some(character=>!character.name.trim()))return;
    const revision=editVersion.current;
    const timer=window.setTimeout(()=>{
      void saveHandler.current({characters:draft}).then(()=>{
        if(editVersion.current===revision)setDirty(false);
      }).catch(()=>{
        if(editVersion.current===revision)setSaveError(true);
      });
    },900);
    return()=>window.clearTimeout(timer);
  },[draft,dirty,pending,saveError]);
  const saveDraft=()=>{const revision=editVersion.current;setSaveError(false);return onSave({characters:draft}).then(()=>{if(editVersion.current===revision)setDirty(false)}).catch(error=>{if(editVersion.current===revision)setSaveError(true);throw error})};
  const update=(id:string,key:keyof CharacterProfile,value:string)=>{editVersion.current++;setSaveError(false);setDirty(true);setDraft(rows=>rows.map(row=>row.id===id?{...row,[key]:value}:row))};
  const add=()=>{editVersion.current++;setSaveError(false);setDirty(true);setDraft(rows=>[...rows,{id:`character-${crypto.randomUUID()}`,name:'',description:'',costume:'',voiceDescription:'',referenceImageUrl:null}])};
  const remove=(id:string)=>{editVersion.current++;setSaveError(false);setDirty(true);setDraft(rows=>rows.filter(row=>row.id!==id))};
  const saveToLibrary=async(character:CharacterProfile)=>{if(!character.name.trim())return;setLibraryBusy(true);setLibraryError('');try{const response=await fetch(`${basePath}/api/characters/library`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(character)});if(!response.ok)throw new Error('save');const saved=await response.json() as CharacterProfile & {id:string};setLibrary(rows=>[{...saved,savedId:saved.id},...rows.filter(row=>row.savedId!==saved.id)]);}catch{setLibraryError(tx(lang,'تعذر حفظ الشخصية في المكتبة.','Could not save the character to the library.'))}finally{setLibraryBusy(false)}};
  const importFromLibrary=(character:CharacterProfile)=>{editVersion.current++;setSaveError(false);setDirty(true);setDraft(rows=>[...rows,{...character,id:`character-${crypto.randomUUID()}`}])};
  const removeFromLibrary=async(savedId:string)=>{setLibraryBusy(true);try{const response=await fetch(`${basePath}/api/characters/library/${savedId}`,{method:'DELETE',credentials:'include'});if(!response.ok)throw new Error('delete');setLibrary(rows=>rows.filter(row=>row.savedId!==savedId));}catch{setLibraryError(tx(lang,'تعذر حذف الشخصية المحفوظة.','Could not delete the saved character.'))}finally{setLibraryBusy(false)}};
  return <section className="character-section panel"><div className="section-heading"><div><span className="eyebrow">{tx(lang,'استمرارية الشخصيات','CAST CONTINUITY')}</span><h3>{tx(lang,'ملفات الشخصيات','Character profiles')}</h3></div><button className="btn btn-quiet" onClick={add}><Plus size={15}/>{tx(lang,'إضافة شخصية','Add character')}</button></div>
    <div className="character-library"><div className="section-heading"><div><span className="eyebrow">{tx(lang,'مكتبة الحساب','ACCOUNT LIBRARY')}</span><h4>{tx(lang,'الشخصيات المحفوظة','Saved characters')}</h4></div><span className="result-count">{library.length}</span></div>{libraryError&&<p className="inline-error">{libraryError}</p>}{library.length?<div className="character-library-list">{library.map(character=><div className="character-library-item" key={character.savedId}><div><b>{character.name}</b><small>{character.voiceDescription||tx(lang,'بدون مرجع صوتي','No voice reference')}</small></div><div className="flex gap-1"><button type="button" className="btn btn-quiet !p-1.5" onClick={()=>importFromLibrary(character)} disabled={libraryBusy} title={tx(lang,'إضافة إلى المشروع','Add to project')}><Plus size={14}/></button><button type="button" className="btn btn-ghost !p-1.5 text-destructive" onClick={()=>void removeFromLibrary(character.savedId)} disabled={libraryBusy} title={tx(lang,'حذف من المكتبة','Delete from library')}><Trash2 size={14}/></button></div></div>)}</div>:<p className="provider-purpose-description">{tx(lang,'احفظ شخصية من المشروع لتظهر هنا وتعيد استخدامها في مشاريع لاحقة.','Save a character from this project to reuse it in later projects.')}</p>}</div>
    {!draft.length?<div className="character-empty">{tx(lang,'لا توجد ملفات شخصيات. أضف وصفًا مرجعيًا للحفاظ على اتساق المظهر والصوت بين المشاهد.','No character profiles yet. Add visual and voice references to keep scenes consistent.')}</div>:<div className="character-grid">{draft.map((character,index)=><article className="character-card" key={character.id}><div className="character-card-head"><span className="character-index">{String(index+1).padStart(2,'0')}</span><div className="flex gap-1"><button type="button" className="btn btn-ghost !p-1.5" onClick={()=>void saveToLibrary(character)} disabled={libraryBusy||!character.name.trim()} title={tx(lang,'حفظ في المكتبة','Save to library')}><Heart size={14}/></button><button className="btn btn-ghost !p-2 text-destructive" onClick={()=>remove(character.id)} aria-label={tx(lang,'حذف الشخصية','Remove character')}><Trash2 size={15}/></button></div></div><label><span className="field-label">{tx(lang,'الاسم','Name')}</span><input className="studio-input" value={character.name} onChange={e=>update(character.id,'name',e.target.value)} /></label><label><span className="field-label">{tx(lang,'الوصف والسمات','Appearance')}</span><textarea rows={2} className="studio-input" value={character.description} onChange={e=>update(character.id,'description',e.target.value)} /></label><label><span className="field-label">{tx(lang,'الملابس','Costume')}</span><input className="studio-input" value={character.costume} onChange={e=>update(character.id,'costume',e.target.value)} /></label><label><span className="field-label">{tx(lang,'وصف الصوت','Voice reference')}</span><input className="studio-input" value={character.voiceDescription} onChange={e=>update(character.id,'voiceDescription',e.target.value)} /></label><label><span className="field-label">{tx(lang,'رابط الصورة المرجعية','Reference image URL')}</span><input className="studio-input" type="url" value={character.referenceImageUrl||''} onChange={e=>update(character.id,'referenceImageUrl',e.target.value)} /></label></article>)}</div>}
    <div className="character-save"><span className={`save-state ${saveError?'text-destructive':''}`}>{saveError?tx(lang,'تعذر الحفظ تلقائيًا؛ أعد المحاولة.','Auto-save failed; retry the save.'):pending?tx(lang,'جارٍ الحفظ...','Saving...'):dirty?tx(lang,'سيتم الحفظ تلقائيًا بعد التوقف عن الكتابة.','Changes auto-save when you stop typing.'):tx(lang,'ملفات الشخصيات محفوظة تلقائيًا.','Character profiles are saved automatically.')}</span><button className="btn btn-primary" disabled={!dirty||pending||draft.some(c=>!c.name.trim())} onClick={()=>void saveDraft().catch(()=>{})}>{pending?<LoaderCircle size={15} className="animate-spin"/>:<Check size={15}/ >}{tx(lang,'حفظ الآن','Save now')}</button></div>
  </section>;
}
function CostEstimate({ provider, service, units, lang }: { provider?: string; service: 'image' | 'video' | 'voice'; units: number; lang: Lang }) {
  const amount = estimateCostText(provider, service, units, lang);
  const note = provider === 'piper-local' ? tx(lang, 'يعمل صوت Piper العربي على الخادم؛ لا يستخدم API أو رصيد مزوّد خارجي.', 'Piper Arabic runs on the app server; no provider API or external inference credits are used.') : provider === 'ai-horde' ? tx(lang, 'لا يلزم حساب أو مفتاح شخصي. قد يطول الانتظار أو يتوقف الاستخدام عند الضغط؛ الطلبات المجهولة بأقل أولوية وتُشارك المطالبات/الصور مع LAION وفق توثيق Horde.', 'No account or personal key is needed. Anonymous requests have the lowest priority, may be restricted under load, and prompts/images are shared with LAION per Horde documentation.') : tx(lang, `تقدير إرشادي لـ ${units} طلب؛ السعر النهائي يحدده النموذج والمزوّد وقد يختلف.`, `Guidance for ${units} request(s); final pricing depends on the model and provider and may vary.`);
  return <div className="cost-estimate" role="note"><div><b>{tx(lang, 'تقدير تقريبي قبل الإرسال', 'Preflight cost estimate')}</b><span>{amount}</span></div><small>{note}</small></div>;
}
type AiHordeModelOption = { name: string; workers: number; etaSeconds: number };
function GenerationPanel({projectId,scene,keys,lang,onQueued,freeMode,services}:{projectId:string;scene:Scene;keys:ProviderKey[];lang:Lang;onQueued:()=>void;freeMode:boolean;services?:('image'|'video'|'voice')[]}) {
  const imageJob=useQueueSceneImageGeneration(),videoJob=useQueueSceneVideoGeneration(),voiceJob=useQueueSceneVoiceGeneration();
  const allowedServices=services&&services.length?services:(['image','video','voice'] as const);
  const [action,setAction]=useState<'image'|'video'|'voice'|null>(allowedServices.length===1?allowedServices[0]:null);
  const [providerId,setProviderId]=useState('');
  const [model,setModel]=useState('');
  const [voiceId,setVoiceId]=useState('');
  const [mode,setMode]=useState<'text'|'image'>('image');
  const [outputs,setOutputs]=useState<SceneImageGenerationInputOutputs>(1);
  const [proMode,setProMode]=useState(false);
  const [resolution,setResolution]=useState<512|768|1024>(1024);
  const [seed,setSeed]=useState('');
  const [negativePrompt,setNegativePrompt]=useState('');
  const service=action==='image'?'image':action==='video'?'video':action==='voice'?'voice':null;
  const readyKeys=keys.filter(key=>key.enabled&&key.serviceType===service&&providerSupports(key.provider,service||'')&&providerKeyIsUsable(key.provider,key.status,key.cooldownUntil)).sort((a,b)=>Number(b.provider==='ai-horde')-Number(a.provider==='ai-horde')||Number(b.provider==='piper-local')-Number(a.provider==='piper-local'));
  const activeKey=readyKeys.find(key=>key.id===providerId)||readyKeys[0];
  const aiHordeSelected=action==='image'&&activeKey?.provider==='ai-horde';
  const supportsSeed=action==='image'&&(activeKey?.provider==='stability'||activeKey?.provider==='huggingface');
  const supportsNegative=supportsSeed;
  const supportsResolution=action==='image'&&!aiHordeSelected&&activeKey?.provider!=='replicate';
  const approvalSignature=JSON.stringify({scene:scene.id,action,provider:activeKey?.id||'',model,outputs:proMode?outputs:1,resolution,seed:supportsSeed?seed:'',negativePrompt:supportsNegative?negativePrompt:'',mode,voiceId});
  const [approved,setApproved]=useRequestApproval(approvalSignature);
  const aiHordeModelsQuery=useQuery({queryKey:['ai-horde-active-image-models'],enabled:Boolean(aiHordeSelected),staleTime:60_000,retry:false,queryFn:async()=>{const response=await fetch(`${basePath}/api/providers/ai-horde/models`,{credentials:'include'});const body=await response.json().catch(()=>({})) as {models?:AiHordeModelOption[];error?:string};if(!response.ok)throw new Error(body.error||'AI Horde models are temporarily unavailable.');return Array.isArray(body.models)?body.models:[];}});
  const aiHordeModels=aiHordeModelsQuery.data||[];
  useEffect(()=>{if(aiHordeSelected&&aiHordeModels.length&&!aiHordeModels.some(item=>item.name===model))setModel(aiHordeModels[0].name);},[aiHordeSelected,aiHordeModels,model]);
  useEffect(()=>{if(action==='video'&&!model.trim())setModel(defaultVideoModel(activeKey?.provider,mode));if(action==='voice'&&!voiceId.trim())setVoiceId(defaultVoiceId(activeKey?.provider));},[action,activeKey?.provider,mode]);
  const busy=imageJob.isPending||videoJob.isPending||voiceJob.isPending;
  const close=()=>{setAction(allowedServices.length===1?allowedServices[0]:null);setApproved(false);setModel('');setVoiceId('');setOutputs(1);setSeed('');setNegativePrompt('');};
  const submit=()=>{
    if(!action||!activeKey||!approved)return;
    const done=()=>{onQueued();close()};
    if(action==='image'){const parsedSeed=seed.trim()===''?null:Number(seed);if(parsedSeed!==null&&(!Number.isInteger(parsedSeed)||parsedSeed<0||parsedSeed>2147483647)){return}imageJob.mutate({projectId,sceneId:scene.id,data:{providerKeyId:activeKey.id,model:model.trim(),outputs:aiHordeSelected?1:proMode?outputs:1,resolution:aiHordeSelected?512:supportsResolution?resolution:1024,seed:supportsSeed?parsedSeed:null,negativePrompt:supportsNegative&&negativePrompt.trim()?negativePrompt.trim():null,approvePotentialCharges:true}},{onSuccess:done});}
    if(action==='video')videoJob.mutate({projectId,sceneId:scene.id,data:{providerKeyId:activeKey.id,model:model.trim(),mode,approvePotentialCharges:true}},{onSuccess:done});
    if(action==='voice')voiceJob.mutate({projectId,sceneId:scene.id,data:{providerKeyId:activeKey.id,voiceId:voiceId.trim(),approvePotentialCharges:true}},{onSuccess:done});
  };
  const modelValid=action==='voice'?voiceId.trim().length>0:aiHordeSelected?Boolean(model&&aiHordeModels.some(item=>item.name===model)):model.trim().length>0;
  if(freeMode&&!keys.some(key=>key.provider==='free-test'))return <div className="service-purpose-hint is-unavailable"><b>{tx(lang,'المزوّدات الخارجية متوقفة','External providers are off')}</b><span>{tx(lang,'شغّل السماح بالمزوّدات من الإعدادات عند الاستعداد. لا يُرسل طلب فيديو قبل موافقتك على احتمال الرسوم.','Enable external providers in Settings when ready. No video request is sent before you approve possible charges.')} <Link href="/settings/providers" className="text-link">{tx(lang,'فتح الإعدادات','Open settings')}<ArrowLeft size={13}/></Link></span></div>;
  return <div className="generation-tools"><div className="generation-heading"><span className="eyebrow">{tx(lang,'توليد الأصول','GENERATE ASSETS')}</span><Link href="/settings/providers" className="text-link">{tx(lang,'إعداد المزوّدين','Provider setup')}<ArrowLeft size={13}/></Link></div><div className="generation-buttons">
    {allowedServices.map(kind=>{const availableKeys=keys.filter(key=>key.enabled&&key.serviceType===kind&&providerSupports(key.provider,kind)&&providerKeyIsUsable(key.provider,key.status,key.cooldownUntil));const available=availableKeys.length>0;return <button key={kind} className="btn btn-quiet" disabled={!available} onClick={()=>{setAction(kind);setProviderId('');setApproved(false);if(kind==='voice')setVoiceId(defaultVoiceId(availableKeys[0]?.provider));if(kind==='video'){const nextMode=scene.assetType==='image'?'image':'text';setMode(nextMode);setModel(defaultVideoModel(availableKeys[0]?.provider,nextMode));}}} title={!available?tx(lang,'لا يوجد مزوّد متاح لهذه المهمة','No provider is available for this task'):undefined}>{kind==='image'?<ImagePlus size={15}/>:kind==='video'?<Film size={15}/>:<Languages size={15}/ >}{tx(lang,kind==='image'?'صورة':kind==='video'?'فيديو':'صوت',kind)}</button>})}
  </div><p className="generation-note">{tx(lang,'المخرجات تظهر هنا بعد اكتمال المهمة؛ لا توجد نتائج تجريبية.','Completed outputs appear here after the job finishes. No sample assets are shown.')}</p>
  {(imageJob.isError||videoJob.isError||voiceJob.isError)&&<ErrorRecoveryPanel compact lang={lang} sceneTitle={scene.title} message={(videoJob.error instanceof Error&&videoJob.error.message)||(imageJob.error instanceof Error&&imageJob.error.message)||(voiceJob.error instanceof Error&&voiceJob.error.message)||tx(lang,'تعذر إرسال طلب التوليد. تحقّق من المفتاح وإعدادات المزوّد.','Could not queue generation. Check the provider key and settings.')} />}
      {action&&<Modal className="generation-modal" title={tx(lang,'تأكيد طلب التوليد','Confirm generation request')} subtitle={aiHordeSelected?tx(lang,'AI Horde مجهول ومجاني بلا حساب أو مفتاح شخصي؛ أولوية الانتظار منخفضة وقد يتوقف عند الضغط.','AI Horde anonymous use is free with no account or personal key; queue priority is low and access may be restricted under load.'):activeKey?.provider==='piper-local'?tx(lang,'Piper صوت عربي مجاني يُولّد محليًا على خادم التطبيق، دون اتصال بمزوّد صوت مدفوع.','Piper generates free Arabic narration locally on the app server; no paid voice provider is contacted.'):tx(lang,'قد تُحتسب رسوم على هذا الطلب، وقد يجرّب النظام مزوّدًا احتياطيًا آخر عند التعطل أو نفاد الحصة.','This request may incur charges. Automatic failover may also use another configured provider.')} onClose={close}><div className="form-stack">
    {!readyKeys.length?<div className="export-confirm"><ShieldCheck size={17}/>{tx(lang,'لا يوجد مفتاح مفعّل لهذه الخدمة. أضف مفتاحًا صالحًا من إعدادات المزوّدين.','No enabled key is available for this service. Add a working key in provider settings.')}</div>:<>
      {readyKeys.length>1&&<label><span className="field-label">{tx(lang,action==='voice'?'مزوّد الصوت':'مزوّد الخدمة',action==='voice'?'Voice provider':'Service provider')}</span><select className="studio-input" value={activeKey?.id||''} onChange={e=>{setProviderId(e.target.value);const selected=readyKeys.find(key=>key.id===e.target.value);if(action==='video')setModel(defaultVideoModel(selected?.provider,mode));if(action==='voice')setVoiceId(defaultVoiceId(selected?.provider));}}>{readyKeys.map(key=><option value={key.id} key={key.id}>{key.label} · {key.provider}</option>)}</select></label>}
      {aiHordeSelected&&<div className="export-confirm" role="note"><ShieldCheck size={17}/><div><b>{tx(lang,'تنبيه: طلب مجهول إلى AI Horde','Notice: anonymous request to AI Horde')}</b><p>{tx(lang,'لأن الاستخدام مجهول، يوضح توثيق Horde أن المطالبات والصور تُشارك مع LAION. استخدم وصفًا تقبل مشاركته. الطلب له أقل أولوية وقد يطول انتظاره أو يُقيّد عند الازدحام.','Horde documentation says anonymous prompts and images are shared with LAION. Only use prompts you are comfortable sharing. Anonymous requests have the lowest priority; waiting may be long or access may be restricted under load.')}</p></div></div>}
      {action!=='voice'&&(aiHordeSelected?<div><label><span className="field-label">{tx(lang,'نموذج صورة نشط على AI Horde','Active AI Horde image model')}</span>{aiHordeModels.length>0&&<select className="studio-input" value={model} onChange={e=>setModel(e.target.value)}>{aiHordeModels.map(item=><option key={item.name} value={item.name}>{item.name} · {item.workers} {tx(lang,'عمّال','workers')} · {item.etaSeconds>0?`~${Math.ceil(item.etaSeconds/60)} ${tx(lang,'دقيقة','min')}`:tx(lang,'وقت انتظار غير متاح','ETA n/a')}</option>)}</select>}</label>{aiHordeModelsQuery.isLoading&&<p className="generation-note">{tx(lang,'جارٍ تحميل النماذج النشطة مرة واحدة...','Loading currently active models…')}</p>}{aiHordeModelsQuery.isError&&<div className="inline-error" role="alert">{aiHordeModelsQuery.error instanceof Error?aiHordeModelsQuery.error.message:tx(lang,'تعذر الوصول إلى قائمة نماذج AI Horde.','Could not load AI Horde models.')} <button type="button" className="text-link" onClick={()=>void aiHordeModelsQuery.refetch()} disabled={aiHordeModelsQuery.isFetching}>{tx(lang,'إعادة المحاولة','Retry')}</button></div>}{!aiHordeModelsQuery.isLoading&&!aiHordeModelsQuery.isError&&!aiHordeModels.length&&<p className="inline-error">{tx(lang,'لا توجد نماذج صور نشطة الآن؛ جرّب لاحقًا.','No active image models are available right now; try again later.')}</p>}</div>:<label><span className="field-label">{tx(lang,'معرّف النموذج لدى المزوّد','Provider model ID')}</span><input required className="studio-input" value={model} onChange={e=>setModel(e.target.value)} placeholder={action==='image'&&activeKey?.provider==='huggingface'?'black-forest-labs/FLUX.1-schnell':action==='video'&&activeKey?.provider==='fal'?'minimax/h3-max/text-to-video':tx(lang,'أدخل معرّف النموذج المتاح لحسابك','Enter a model ID available to your account')} /></label>)}
      <div className="generation-mode-switch" role="group" aria-label={tx(lang,'وضع التوليد','Generation mode')}><button type="button" className={!proMode?'is-active':''} onClick={()=>{setProMode(false);setApproved(false)}}>{tx(lang,'سريع','Quick')}</button><button type="button" className={proMode?'is-active':''} onClick={()=>{setProMode(true);setApproved(false)}}>{tx(lang,'احترافي','Professional')}</button></div>
      {proMode&&action==='image'&&supportsResolution&&!aiHordeSelected&&<label><span className="field-label">{tx(lang,'الدقة','Resolution')}</span><select className="studio-input" value={resolution} onChange={e=>{setResolution(Number(e.target.value) as 512|768|1024);setApproved(false)}}><option value={512}>512 × 512</option><option value={768}>768 × 768</option><option value={1024}>1024 × 1024</option></select></label>}
      {proMode&&supportsSeed&&<label><span className="field-label">{tx(lang,'Seed (اختياري)','Seed (optional)')}</span><input className="studio-input" inputMode="numeric" value={seed} onChange={e=>{setSeed(e.target.value);setApproved(false)}} placeholder={tx(lang,'اتركه فارغًا لعشوائية جديدة','Leave empty for a random seed')} /></label>}
      {proMode&&supportsNegative&&<label><span className="field-label">{tx(lang,'Negative prompt (اختياري)','Negative prompt (optional)')}</span><textarea rows={2} className="studio-input" maxLength={2000} value={negativePrompt} onChange={e=>{setNegativePrompt(e.target.value);setApproved(false)}} placeholder={tx(lang,'ما لا تريد ظهوره في الصورة','What you do not want in the image')} /></label>}
      {!proMode&&action==='image'&&!aiHordeSelected&&<p className="generation-note">{tx(lang,'الوضع السريع: نسخة واحدة بدقة 1024. افتح الاحترافي للتحكم في النسخ والدقة وseed وnegative prompt حيث يدعمها المزوّد.','Quick mode: one variant at 1024. Switch to Professional for variants, resolution, seed, and negative prompt where the provider supports them.')}</p>}
      {action==='image'&&!aiHordeSelected&&proMode&&<label><span className="field-label">{tx(lang,'عدد النسخ','Number of variants')}</span><select className="studio-input" value={outputs} onChange={e=>setOutputs(Number(e.target.value) as SceneImageGenerationInputOutputs)}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option></select><small className="generation-note">{tx(lang,'سيحفظ الخادم كل نسخة فعلية في سجل أصول المشهد لتختار بينها لاحقًا.','The server will save every generated variant in the scene asset history so you can choose later.')}</small></label>}
      {action==='video'&&<><label><span className="field-label">{tx(lang,'مصدر الفيديو','Video input')}</span><select className="studio-input" value={mode} onChange={e=>{const nextMode=e.target.value as 'text'|'image';setMode(nextMode);setModel(defaultVideoModel(activeKey?.provider,nextMode));}}><option value="image">{tx(lang,'من صورة المشهد','Use scene image')}</option><option value="text">{tx(lang,'من النص','Use text prompt')}</option></select></label><p className="generation-note">{tx(lang,'يُملأ معرّف النموذج تلقائيًا حسب المزوّد. مفاتيح الفيديو المستضافة ليست مجانية؛ ستحتاج موافقتك قبل كل طلب.','The model endpoint is filled in for your provider. Hosted video APIs are not free; each request still needs your approval.')}</p></>}
      {action==='voice'&&activeKey?.provider==='piper-local'&&<p className="generation-note">{tx(lang,'الصوت المحدد: Kareem — لهجة عربية أردنية. لا يلزم مفتاح أو معرّف صوت.','Selected voice: Kareem — Jordanian Arabic. No API key or voice ID is needed.')}</p>}
      {action==='voice'&&activeKey?.provider!=='piper-local'&&<label><span className="field-label">{tx(lang,'معرّف الصوت','Voice ID')}</span><input required className="studio-input" value={voiceId} onChange={e=>setVoiceId(e.target.value)} placeholder={tx(lang,'أدخل معرّفًا يقدّمه مزوّدك','Enter a voice ID from your provider')} /></label>}
      {activeKey && action && <ChargeApprovalCard lang={lang} service={action} provider={activeKey.provider} providerLabel={activeKey.label} model={action==='voice'?(activeKey.provider==='piper-local'?'Kareem — Piper local':voiceId):model} scenes={1} variants={action==='image'&&proMode?outputs:1} approved={approved} onChange={setApproved} />}
    </>}
    <div className="modal-actions"><button className="btn btn-quiet" onClick={close}>{tx(lang,'إلغاء','Cancel')}</button><button className="btn btn-primary" disabled={!readyKeys.length||busy||!approved||!modelValid} onClick={submit}>{busy?<LoaderCircle size={15} className="animate-spin"/>:<WandSparkles size={15}/ >}{tx(lang,'إرسال إلى قائمة المهام','Queue generation')}</button></div>
  </div></Modal>}
  </div>;
}

function BatchVideoGeneration({projectId,scenes,keys,lang,hasActiveJob,onQueued,freeMode}:{projectId:string;scenes:Scene[];keys:ProviderKey[];lang:Lang;hasActiveJob:boolean;onQueued:()=>void;freeMode:boolean}) {
  const videoJob=useQueueSceneVideoGeneration();
  const videoKeys=keys.filter(key=>key.enabled&&key.serviceType==='video'&&providerSupports(key.provider,'video')&&providerKeyIsUsable(key.provider,key.status,key.cooldownUntil));
  const firstVideoProvider=videoKeys[0]?.provider;
  const scenesWithoutVideo=scenes.filter(scene=>scene.assetType!=='video'||!scene.assetUrl);
  const allHaveImages=scenesWithoutVideo.every(scene=>scene.assetType==='image'&&Boolean(scene.assetUrl));
  const [open,setOpen]=useState(false);
  const [providerId,setProviderId]=useState('');
  const [model,setModel]=useState('');
  const [mode,setMode]=useState<'text'|'image'>('text');
  const [queueing,setQueueing]=useState(false);
  const [progress,setProgress]=useState<{queued:number;failed:number;total:number;processed:number}|null>(null);
  const [summary,setSummary]=useState<{queued:number;failed:number;total:number}|null>(null);
  const activeKey=videoKeys.find(key=>key.id===providerId)||videoKeys[0];
  useEffect(()=>{if(!providerId)setModel(defaultVideoModel(firstVideoProvider,mode));},[providerId,firstVideoProvider,mode]);
  const scenesToQueue=mode==='image'?scenesWithoutVideo.filter(scene=>scene.assetType==='image'&&Boolean(scene.assetUrl)):scenesWithoutVideo;
  const [approved,setApproved]=useRequestApproval(JSON.stringify({provider:activeKey?.id||'',model,mode,scenes:scenesToQueue.map(scene=>scene.id)}));
  const close=()=>{if(queueing)return;setOpen(false);setApproved(false)};
  const begin=async()=>{
    if(!activeKey||!model.trim()||!approved||!scenesToQueue.length||queueing||hasActiveJob)return;
    setQueueing(true);
    setProgress({queued:0,failed:0,total:scenesToQueue.length,processed:0});
    let queued=0,failed=0;
    for(const scene of scenesToQueue){
      try{
        await videoJob.mutateAsync({projectId,sceneId:scene.id,data:{providerKeyId:activeKey.id,model:model.trim(),mode,approvePotentialCharges:true}});
        queued++;
      }catch{
        failed++;
      }
      setProgress({queued,failed,total:scenesToQueue.length,processed:queued+failed});
    }
    setQueueing(false);
    setApproved(false);
    if(queued){
      setSummary({queued,failed,total:scenesToQueue.length});
      setOpen(false);
      onQueued();
    }
  };
  if(!scenes.length)return null;
  if(freeMode)return <div className="script-bar panel mt-4"><div className="script-symbol"><ShieldCheck size={18}/></div><div className="script-copy"><b>{tx(lang,'المزوّدات الخارجية متوقفة','External providers are off')}</b><p>{tx(lang,'شغّل السماح بالمزوّدات من الإعدادات لإرسال مقاطع المشاهد. ستحتاج موافقة واحدة على الدفعة، وقد تُحتسب رسوم لكل مشهد.','Enable external providers in Settings to send scene clips. One approval is required for the batch; each scene may incur a charge.')} <Link href="/settings/providers" className="text-link">{tx(lang,'فتح الإعدادات','Open settings')}<ArrowLeft size={14}/></Link></p></div></div>;
  return <>
    <section className="script-bar panel mt-4" data-testid="batch-video-panel">
      <div className="script-symbol"><Film size={18}/></div>
      <div className="script-copy"><b>{tx(lang,'حوّل المشاهد إلى فيديو','Turn scenes into video')}</b><p>{scenesWithoutVideo.length?tx(lang,'ولّد مقطعًا لكل مشهد ناقص دفعة واحدة، أو اختر كل مشهد وولّده وحده.','Generate clips for all scenes without video, or generate each scene individually.'):tx(lang,'كل المشاهد لديها فيديو بالفعل.','Every scene already has a video.')}</p>
        {videoKeys.length===0&&scenesWithoutVideo.length>0&&<Link href="/settings/providers" className="text-link" data-testid="link-batch-video-provider-settings">{tx(lang,'أضف مفتاح Replicate أو fal.ai لخدمة الفيديو','Add a Replicate or fal.ai video key')}<ArrowLeft size={14}/></Link>}
        {hasActiveJob&&<small className="provider-purpose-description">{tx(lang,'انتظر انتهاء المهمة الحالية قبل بدء دفعة فيديو جديدة.','Wait for the current job to finish before starting a video batch.')}</small>}
        {summary&&<p role="status" data-testid="batch-video-result">{summary.failed?tx(lang,`أُرسل ${summary.queued} من ${summary.total} طلبات الفيديو؛ تعذّر إرسال ${summary.failed}.`,`${summary.queued} of ${summary.total} video requests were queued; ${summary.failed} could not be queued.`):tx(lang,`تم إرسال ${summary.queued} طلبات فيديو إلى قائمة المهام.`,`Queued ${summary.queued} video requests.`)} <Link href="/jobs" className="text-link">{tx(lang,'عرض المهام','View jobs')}<ArrowLeft size={13}/></Link></p>}
      </div>
      {scenesWithoutVideo.length>0&&<button className="btn btn-primary" disabled={!videoKeys.length||hasActiveJob} onClick={()=>{setProgress(null);setSummary(null);setApproved(false);setProviderId('');setMode('text');setModel(defaultVideoModel(firstVideoProvider,'text'));setOpen(true)}} data-testid="button-batch-video">{tx(lang,'توليد فيديو لكل المشاهد','Generate all scene videos')}</button>}
    </section>
    {open&&<Modal title={tx(lang,'توليد فيديو للمشاهد','Generate scene videos')} subtitle={tx(lang,`سيتم إرسال ${scenesToQueue.length} طلب فيديو. قد تُحتسب رسوم لكل مشهد.`,`This will send ${scenesToQueue.length} video requests. Each scene may incur a charge.`)} onClose={close}>
      <div className="form-stack">
        {videoKeys.length>1&&<label><span className="field-label">{tx(lang,'مفتاح الفيديو','Video key')}</span><select className="studio-input" value={activeKey?.id||''} onChange={e=>{setProviderId(e.target.value);const selected=videoKeys.find(key=>key.id===e.target.value);setModel(defaultVideoModel(selected?.provider,mode));}} data-testid="select-batch-video-key">{videoKeys.map(key=><option key={key.id} value={key.id}>{key.label} · {key.provider}</option>)}</select></label>}
        <label><span className="field-label">{tx(lang,'معرّف نموذج الفيديو','Video model endpoint')}</span><input required className="studio-input" value={model} onChange={e=>setModel(e.target.value)} placeholder={activeKey?.provider==='fal'?'minimax/h3-max/text-to-video':'minimax/video-01'} data-testid="input-batch-video-model"/></label>
        <label><span className="field-label">{tx(lang,'طريقة إنشاء الفيديو','Video source')}</span><select className="studio-input" value={mode} onChange={e=>{const nextMode=e.target.value as 'text'|'image';setMode(nextMode);setModel(defaultVideoModel(activeKey?.provider,nextMode));}} data-testid="select-batch-video-mode"><option value="text">{tx(lang,'من وصف المشهد','From each scene prompt')}</option><option value="image" disabled={!allHaveImages}>{tx(lang,'من صورة كل مشهد','From each scene image')}</option></select></label>
        {!allHaveImages&&<p className="generation-note">{tx(lang,'خيار الصورة يحتاج صورة مرفقة بكل مشهد؛ استخدم وصف المشهد إذا لم تتوفر الصور.','Image mode needs an attached image on every scene. Use scene prompts when images are missing.')}</p>}
        {activeKey&&<ChargeApprovalCard lang={lang} service="video" provider={activeKey.provider} providerLabel={activeKey.label} model={model} scenes={scenesToQueue.length} approved={approved} onChange={setApproved}/>}
        {progress&&<div className="export-confirm" role="status" data-testid="batch-video-progress">{queueing?tx(lang,`جارٍ إرسال الطلب ${progress.processed} من ${progress.total}…`,`Sending request ${progress.processed} of ${progress.total}…`):progress.queued?tx(lang,`أُرسل ${progress.queued} طلبات وتعذّر ${progress.failed}.`,`Queued ${progress.queued}; ${progress.failed} failed.`):tx(lang,'تعذّر إرسال الطلبات. تحقّق من مفتاح الفيديو والنموذج.','Requests could not be queued. Check the video key and model.')}</div>}
        <div className="modal-actions"><button type="button" className="btn btn-quiet" onClick={close} disabled={queueing}>{tx(lang,'إلغاء','Cancel')}</button><button type="button" className="btn btn-primary" disabled={!activeKey||!model.trim()||!approved||!scenesToQueue.length||queueing||hasActiveJob} onClick={()=>void begin()} data-testid="button-submit-batch-video">{queueing?<LoaderCircle size={15} className="animate-spin"/>:<Film size={15}/ >}{queueing?tx(lang,'جارٍ إرسال الطلبات…','Queueing videos…'):tx(lang,'ابدأ توليد الفيديو','Start video generation')}</button></div>
      </div>
    </Modal>}
  </>;
}

function BatchVoiceGeneration({projectId,scenes,keys,lang,hasActiveJob,onQueued,freeMode}:{projectId:string;scenes:Scene[];keys:ProviderKey[];lang:Lang;hasActiveJob:boolean;onQueued:()=>void;freeMode:boolean}) {
  const voiceJob=useQueueSceneVoiceGeneration();
  const voiceKeys=keys.filter(key=>key.enabled&&key.serviceType==='voice'&&providerSupports(key.provider,'voice')&&providerKeyIsUsable(key.provider,key.status,key.cooldownUntil)).sort((a,b)=>Number(b.provider==='piper-local')-Number(a.provider==='piper-local'));
  const scenesWithoutVoice=scenes.filter(scene=>scene.narration.trim()&&!scene.voiceUrl);
  const [open,setOpen]=useState(false);
  const [providerId,setProviderId]=useState('');
  const [voiceId,setVoiceId]=useState('');
  const [queueing,setQueueing]=useState(false);
  const [progress,setProgress]=useState<{queued:number;failed:number;total:number;processed:number;error?:string}|null>(null);
  const [summary,setSummary]=useState<{queued:number;failed:number;total:number}|null>(null);
  const activeKey=voiceKeys.find(key=>key.id===providerId)||voiceKeys[0];
  const firstVoiceProvider=voiceKeys[0]?.provider;
  const [approved,setApproved]=useRequestApproval(JSON.stringify({provider:activeKey?.id||'',voiceId,scenes:scenesWithoutVoice.map(scene=>scene.id)}));
  useEffect(()=>{if(!providerId&&firstVoiceProvider)setVoiceId(defaultVoiceId(firstVoiceProvider));},[providerId,firstVoiceProvider]);
  const close=()=>{if(queueing)return;setOpen(false);setApproved(false)};
  const begin=async()=>{
    if(!activeKey||!voiceId.trim()||!approved||!scenesWithoutVoice.length||queueing||hasActiveJob)return;
    setQueueing(true);
    setProgress({queued:0,failed:0,total:scenesWithoutVoice.length,processed:0});
    let queued=0,failed=0,lastError='';
    for(const scene of scenesWithoutVoice){
      try{
        await voiceJob.mutateAsync({projectId,sceneId:scene.id,data:{providerKeyId:activeKey.id,voiceId:voiceId.trim(),approvePotentialCharges:true}});
        queued++;
      }catch(error){
        failed++;
        lastError=error instanceof Error?error.message:String(error);
      }
      setProgress({queued,failed,total:scenesWithoutVoice.length,processed:queued+failed});
    }
    setQueueing(false);
    setApproved(false);
    setProgress({queued,failed,total:scenesWithoutVoice.length,processed:queued+failed,error:lastError});
    setSummary({queued,failed,total:scenesWithoutVoice.length});
    if(queued){setOpen(false);onQueued();}
  };
  if(!scenes.length)return null;
  if(freeMode&&scenesWithoutVoice.length>0&&!voiceKeys.some(key=>['free-test','piper-local'].includes(key.provider)))return <div className="script-bar panel mt-4"><div className="script-symbol"><Languages size={18}/></div><div className="script-copy"><b>{tx(lang,'نص التعليق جاهز؛ الصوت لم يُولّد بعد','Narration text is ready; audio has not been generated')}</b><p>{tx(lang,'فعّل المزوّدات الخارجية وأضف مفتاحًا لخدمة الصوت. لن يُرسل أي طلب قبل موافقتك على الدفعة.','Enable external providers and add a voice-service key. No request is sent before you approve the batch.')} <Link href="/settings/providers" className="text-link">{tx(lang,'إعداد مفتاح الصوت','Set up a voice key')}<ArrowLeft size={14}/></Link></p></div></div>;
  return <>
    <section className="script-bar panel mt-4" data-testid="batch-voice-panel">
      <div className="script-symbol"><Languages size={18}/></div>
      <div className="script-copy"><b>{tx(lang,'إضافة تعليق صوتي للمشاهد','Add voice narration to scenes')}</b><p>{scenesWithoutVoice.length?tx(lang,'يوجد نص سرد بلا صوت. أنشئ ملفًا صوتيًا لكل مشهد ناقص دفعة واحدة.','Narration text has no audio yet. Generate an audio file for every scene missing one in a single batch.'):scenes.some(scene=>scene.narration.trim())?tx(lang,'كل المشاهد التي لديها سرد تحتوي على ملف صوت.','Every scene with narration already has an audio file.'):tx(lang,'أضف نص السرد للمشاهد أولًا ثم أنشئ الصوت.','Add narration text to scenes before generating audio.')}</p>
        {voiceKeys.length===0&&scenesWithoutVoice.length>0&&<Link href="/settings/providers" className="text-link" data-testid="link-batch-voice-provider-settings">{tx(lang,'أضف مفتاح ElevenLabs أو OpenAI أو Google TTS لخدمة الصوت','Add an ElevenLabs, OpenAI, or Google TTS voice key')}<ArrowLeft size={14}/></Link>}
        {hasActiveJob&&<small className="provider-purpose-description">{tx(lang,'انتظر انتهاء المهمة الحالية قبل بدء دفعة صوت جديدة.','Wait for the current job to finish before starting a voice batch.')}</small>}
        {summary&&<p role="status" data-testid="batch-voice-result">{summary.failed?tx(lang,`أُرسل ${summary.queued} من ${summary.total} طلبات الصوت؛ تعذّر إرسال ${summary.failed}.`,`${summary.queued} of ${summary.total} voice requests were queued; ${summary.failed} could not be queued.`):tx(lang,`تم إرسال ${summary.queued} طلبات صوت إلى قائمة المهام.`,`Queued ${summary.queued} voice requests.`)} <Link href="/jobs" className="text-link">{tx(lang,'عرض المهام','View jobs')}<ArrowLeft size={13}/></Link></p>}
      </div>
      {scenesWithoutVoice.length>0&&<button className="btn btn-primary" disabled={!voiceKeys.length||hasActiveJob} onClick={()=>{setProgress(null);setSummary(null);setApproved(false);setProviderId('');setVoiceId(defaultVoiceId(firstVoiceProvider));setOpen(true)}} data-testid="button-batch-voice">{tx(lang,'توليد صوت لكل المشاهد','Generate voice for all scenes')}</button>}
    </section>
    {open&&<Modal title={tx(lang,'توليد التعليق الصوتي للمشاهد','Generate scene narration')} subtitle={activeKey?.provider==='piper-local'?tx(lang,`سيولّد Piper الصوت العربي محليًا للمشاهد الـ ${scenesWithoutVoice.length}؛ لا توجد رسوم مزوّد خارجي.`,`Piper will generate local Arabic narration for ${scenesWithoutVoice.length} scene(s); no external provider fees.`):tx(lang,`سيتم إرسال ${scenesWithoutVoice.length} طلب صوت. قد تُحتسب رسوم لكل مشهد.`,`This will send ${scenesWithoutVoice.length} voice requests. Each scene may incur a charge.`)} onClose={close}>
      <div className="form-stack">
        {voiceKeys.length>1&&<label><span className="field-label">{tx(lang,'مفتاح الصوت','Voice key')}</span><select className="studio-input" value={activeKey?.id||''} onChange={e=>{const selected=voiceKeys.find(key=>key.id===e.target.value);setProviderId(e.target.value);setVoiceId(defaultVoiceId(selected?.provider));}} data-testid="select-batch-voice-key">{voiceKeys.map(key=><option key={key.id} value={key.id}>{key.label} · {key.provider}</option>)}</select></label>}
        {activeKey?.provider==='piper-local'?<p className="generation-note">{tx(lang,'الصوت المحدد: Kareem — لهجة عربية أردنية. يعمل على الخادم دون مفتاح API.','Selected voice: Kareem — Jordanian Arabic. Runs on the server without an API key.')}</p>:<><label><span className="field-label">{tx(lang,'معرّف الصوت','Voice ID')}</span><input required className="studio-input" value={voiceId} onChange={e=>setVoiceId(e.target.value)} placeholder={tx(lang,'معرّف صوت من حساب المزوّد','A voice ID from your provider account')} data-testid="input-batch-voice-id"/></label>
        <p className="generation-note">{tx(lang,'القيمة الافتراضية تناسب المزوّد المختار؛ يمكنك تغييرها إلى صوت عربي متاح في حسابك.','The default matches the selected provider; you can change it to an Arabic voice available in your account.')}</p></>}
        {activeKey&&<ChargeApprovalCard lang={lang} service="voice" provider={activeKey.provider} providerLabel={activeKey.label} model={activeKey.provider==='piper-local'?'Kareem — Piper local':voiceId} scenes={scenesWithoutVoice.length} approved={approved} onChange={setApproved}/>}
        {progress&&<div className="export-confirm" role="status" data-testid="batch-voice-progress">{queueing?tx(lang,`جارٍ إرسال الطلب ${progress.processed} من ${progress.total}…`,`Sending request ${progress.processed} of ${progress.total}…`):progress.queued?tx(lang,`أُرسل ${progress.queued} طلبات وتعذّر ${progress.failed}.`,`Queued ${progress.queued}; ${progress.failed} failed.`):progress.error||tx(lang,'تعذّر إرسال الطلبات.','The server could not queue the requests.')}</div>}
        <div className="modal-actions"><button type="button" className="btn btn-quiet" onClick={close} disabled={queueing}>{tx(lang,'إلغاء','Cancel')}</button><button type="button" className="btn btn-primary" disabled={!activeKey||!voiceId.trim()||!approved||!scenesWithoutVoice.length||queueing||hasActiveJob} onClick={()=>void begin()} data-testid="button-submit-batch-voice">{queueing?<LoaderCircle size={15} className="animate-spin"/>:<Languages size={15}/ >}{queueing?tx(lang,'جارٍ إرسال الطلبات…','Queueing narration…'):tx(lang,'ابدأ توليد الصوت','Start voice generation')}</button></div>
      </div>
    </Modal>}
  </>;
}

function TranscriptionPanel({projectId,sceneId,language,keys,lang,freeMode}:{projectId:string;sceneId:string;language:string;keys:ProviderKey[];lang:Lang;freeMode:boolean}) {
  const qc=useQueryClient();
  const updateScene=useUpdateScene();
  const [file,setFile]=useState<File|null>(null);
  const [providerId,setProviderId]=useState('');
  const [mode,setMode]=useState<'transcribe'|'translate'>('transcribe');
  const [approved,setApproved]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [draft,setDraft]=useState('');
  const [providerUsed,setProviderUsed]=useState('');
  const readyKeys=keys.filter(key=>key.enabled&&key.serviceType==='transcription'&&providerSupports(key.provider,'transcription')&&providerKeyIsUsable(key.provider,key.status,key.cooldownUntil));
  const activeKey=readyKeys.find(key=>key.id===providerId)||readyKeys[0];
  const canTranslate=activeKey?.provider==='openai'||activeKey?.provider==='whisper';

  useEffect(()=>{if(mode==='translate'&&!canTranslate)setMode('transcribe')},[mode,canTranslate]);
  if(freeMode)return <div className="service-purpose-hint is-unavailable"><b>{tx(lang,'التفريغ الخارجي متوقف','External transcription is blocked')}</b><span>{tx(lang,'اكتب نص الترجمة يدويًا في حقل السرد؛ لن يُرسل الملف إلى مزوّد.','Enter captions manually in the narration field; no audio is sent to a provider.')}</span></div>;

  async function submit() {
    if(!file||!activeKey||!approved||file.size>20*1024*1024)return;
    setBusy(true);setError('');setDraft('');setProviderUsed('');
    try {
      const response=await fetch(`${basePath}/api/projects/${projectId}/scenes/${sceneId}/transcriptions`,{
        method:'POST',
        credentials:'same-origin',
        headers:{'Content-Type':file.type||'application/octet-stream','X-Provider-Key-ID':activeKey.id,'X-Transcription-Mode':mode,'X-Approve-Potential-Charges':'true'},
        body:file,
      });
      const result=await response.json().catch(()=>({})) as {text?:string;provider?:string;model?:string;error?:string};
      if(!response.ok)throw new Error(result.error||tx(lang,'تعذرت معالجة الملف.','The audio could not be processed.'));
      if(!result.text?.trim())throw new Error(tx(lang,'لم يُرجع المزوّد نصًا.','The provider returned no transcript.'));
      setDraft(result.text);setProviderUsed(`${result.provider||activeKey.provider} · ${result.model||''}`);
    } catch(caught) {
      setError(caught instanceof Error?caught.message:tx(lang,'حدث خطأ غير متوقع.','An unexpected error occurred.'));
    } finally {setBusy(false)}
  }

  async function saveTranscript() {
    try {
      await updateScene.mutateAsync({projectId,sceneId,data:{narration:draft}});
      await qc.invalidateQueries({queryKey:getGetProjectQueryKey(projectId)});
      setDraft('');
      setFile(null);
    } catch {
      setError(tx(lang,'تعذر حفظ النص في المشهد. أعد المحاولة.','Could not save the transcript to this scene. Try again.'));
    }
  }

  return <section className="transcription-panel">
    <div className="generation-heading"><span className="eyebrow">{tx(lang,'تفريغ الصوت والترجمة','WHISPER TRANSCRIPTION')}</span><Mic size={15}/></div>
    <p className="generation-note">{tx(lang,'ارفع مقطعًا صوتيًا لتحويله إلى نص مراجَع. لا يُحفَظ الملف الصوتي هنا؛ يُرسَل مباشرةً إلى المزوّد الذي تختاره.','Upload audio to create editable text. The audio is not stored here; it is sent directly to the provider you choose.')}</p>
    {!readyKeys.length?<div className="transcription-empty"><span>{tx(lang,'أضف مفتاح Whisper أو Hugging Face في نوع خدمة التفريغ.','Add a Whisper or Hugging Face key with the transcription service type.')}</span><Link className="text-link" href="/settings/providers">{tx(lang,'إعداد المفاتيح','Set up keys')}<ArrowLeft size={13}/></Link></div>:<>
      <label className="inspector-field"><span className="field-label">{tx(lang,'ملف صوتي · حد 20 MB','Audio file · 20 MB limit')}</span><input className="studio-input" type="file" accept="audio/*" onChange={event=>{setFile(event.target.files?.[0]||null);setDraft('');setError('')}} /></label>
      {readyKeys.length>1&&<label className="inspector-field"><span className="field-label">{tx(lang,'مزوّد التفريغ','Transcription provider')}</span><select className="studio-input" value={activeKey?.id||''} onChange={event=>setProviderId(event.target.value)}>{readyKeys.map(key=><option value={key.id} key={key.id}>{key.label} · {key.provider}</option>)}</select></label>}
      <label className="inspector-field"><span className="field-label">{tx(lang,'العملية','Action')}</span><select className="studio-input" value={mode} onChange={event=>setMode(event.target.value as 'transcribe'|'translate')}><option value="transcribe">{tx(lang,`تفريغ باللغة: ${language}`,`Transcribe: ${language}`)}</option><option value="translate" disabled={!canTranslate}>{tx(lang,'ترجمة الصوت إلى الإنجليزية','Translate audio to English')}</option></select></label>
      <label className="checkline charge-consent"><input type="checkbox" checked={approved} onChange={event=>setApproved(event.target.checked)}/>{tx(lang,'أوافق على إرسال الصوت للمزوّد المحدد، وقد يُرسل لمزوّد احتياطي عند تفعيل التدوير. قد تُحتسب رسوم.','I approve sending audio to this provider and, if rotation is enabled, a fallback provider. Charges may apply.')}</label>
      <button className="btn btn-quiet w-full" onClick={()=>void submit()} disabled={!file||!approved||busy||!activeKey||file.size>20*1024*1024}>{busy?<LoaderCircle size={15} className="animate-spin"/>:<Mic size={15}/ >}{tx(lang,'تفريغ الصوت','Transcribe audio')}</button>
      {file&&file.size>20*1024*1024&&<p className="inline-error">{tx(lang,'حجم الملف يتجاوز حد 20 MB.','The file exceeds the 20 MB limit.')}</p>}
      {error&&<p className="inline-error">{error}</p>}
      {draft&&<div className="transcript-result"><label className="inspector-field"><span className="field-label">{tx(lang,'راجع النص قبل إضافته للترجمة','Review before using as subtitles')}</span><textarea className="studio-input" rows={5} value={draft} onChange={event=>setDraft(event.target.value)}/></label><small>{providerUsed}</small><button className="btn btn-primary w-full" onClick={()=>void saveTranscript()} disabled={updateScene.isPending||!draft.trim()}>{updateScene.isPending?<LoaderCircle size={15} className="animate-spin"/>:<Check size={15}/ >}{tx(lang,'حفظ النص في ترجمة المشهد','Save as scene subtitles')}</button></div>}
    </>}
  </section>;
}

function SceneAssetHistory({projectId,scene,lang}:{projectId:string;scene:Scene;lang:Lang}) {
  const qc=useQueryClient(),restore=useUpdateScene();
  const versions=scene.assetHistory||[];
  if(!versions.length)return null;
  return <div className="asset-history"><div className="eyebrow">{tx(lang,'نسخ الأصول','ASSET VERSIONS')}</div><div className="asset-history-list">{versions.map((version,index)=><button key={version.id} className="asset-version" onClick={()=>{if(!window.confirm(tx(lang,'استعادة هذه النسخة إلى المشهد؟','Restore this version to the scene?')))return;restore.mutate({projectId,sceneId:scene.id,data:{assetUrl:version.url,assetType:version.type}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getGetProjectQueryKey(projectId)})}})}} disabled={restore.isPending} title={version.prompt}><span className="asset-version-preview">{version.type==='image'?<img src={version.url} alt=""/>:<Film size={16}/>}</span><span><b>{tx(lang,'نسخة','Version')} {versions.length-index}</b><small>{version.type} · {new Date(version.createdAt).toLocaleDateString(lang==='ar'?'ar':'en')}</small></span><ArrowUp size={14}/></button>)}</div></div>;
}
function BrandKitEditor({brandKit,pending,onSave}:{brandKit:StudioBrandKit;pending:boolean;onSave:(data:{brandKit:StudioBrandKit})=>Promise<void>}) {
  const {lang}=useApp();
  const [draft,setDraft]=useState(brandKit);
  const [dirty,setDirty]=useState(false);
  const [saveError,setSaveError]=useState(false);
  useEffect(()=>{if(!dirty)setDraft(brandKit)},[brandKit,dirty]);
  const update=(patch:Partial<StudioBrandKit>)=>{setDraft(current=>({...current,...patch}));setDirty(true);setSaveError(false)};
  const save=()=>onSave({brandKit:draft}).then(()=>setDirty(false)).catch(error=>{setSaveError(true);throw error});
  return <section className="brand-kit-panel panel"><div><span className="eyebrow">{tx(lang,'هوية الفيلم','BRAND KIT')}</span><h3>{tx(lang,'ثبّت مظهر الفيلم','Make the film unmistakably yours')}</h3><p>{tx(lang,'هذه الإعدادات تُحفظ مع المشروع وتدخل فعليًا في ألوان الترجمة والعلامة المائية أثناء التصدير.', 'These settings are saved with the project and are applied to subtitle colors and the watermark during export.')}</p></div><div className="brand-kit-grid"><label><span className="field-label">{tx(lang,'اللون الأساسي','Primary color')}</span><span className="color-control"><input type="color" value={draft.primaryColor} onChange={e=>update({primaryColor:e.target.value})}/><input className="studio-input" value={draft.primaryColor} onChange={e=>update({primaryColor:e.target.value})} pattern="^#[0-9a-fA-F]{6}$"/></span></label><label><span className="field-label">{tx(lang,'لون العلامة','Accent color')}</span><span className="color-control"><input type="color" value={draft.accentColor} onChange={e=>update({accentColor:e.target.value})}/><input className="studio-input" value={draft.accentColor} onChange={e=>update({accentColor:e.target.value})} pattern="^#[0-9a-fA-F]{6}$"/></span></label><label><span className="field-label">{tx(lang,'الخط','Font')}</span><select className="studio-input" value={draft.fontFamily} onChange={e=>update({fontFamily:e.target.value as StudioBrandKit['fontFamily']})}><option value="sans">{tx(lang,'بسيط Sans','Clean sans')}</option><option value="serif">{tx(lang,'كلاسيكي Serif','Classic serif')}</option><option value="mono">{tx(lang,'تقني Mono','Technical mono')}</option></select></label><label><span className="field-label">{tx(lang,'نص العلامة المائية (اختياري)','Watermark text (optional)')}</span><input className="studio-input" maxLength={160} value={draft.watermarkText} onChange={e=>update({watermarkText:e.target.value})} placeholder={tx(lang,'اسم الاستوديو أو الحساب','Studio or account name')}/></label><label><span className="field-label">{tx(lang,'موقع العلامة المائية','Watermark position')}</span><select className="studio-input" value={draft.watermarkPosition} onChange={e=>update({watermarkPosition:e.target.value as StudioBrandKit['watermarkPosition']})}><option value="top-left">{tx(lang,'أعلى اليسار','Top left')}</option><option value="top-right">{tx(lang,'أعلى اليمين','Top right')}</option><option value="bottom-left">{tx(lang,'أسفل اليسار','Bottom left')}</option><option value="bottom-right">{tx(lang,'أسفل اليمين','Bottom right')}</option></select></label></div><div className="brand-kit-preview" style={{borderColor:draft.accentColor, color:draft.primaryColor, fontFamily:draft.fontFamily==='serif'?'Georgia,serif':draft.fontFamily==='mono'?'monospace':'inherit'}}><span>{tx(lang,'معاينة الهوية','Brand preview')}</span>{draft.watermarkText&&<b style={{color:draft.accentColor}}>{draft.watermarkText}</b>}</div><div className="brand-kit-actions"><span className={`save-state ${saveError?'text-destructive':''}`}>{saveError?tx(lang,'تعذر حفظ الهوية.','Could not save brand kit.'):pending?tx(lang,'جارٍ الحفظ…','Saving…'):dirty?tx(lang,'تغييرات غير محفوظة','Unsaved changes'):tx(lang,'تم الحفظ','Saved')}</span><button className="btn btn-primary" disabled={!dirty||pending||!/^#[0-9a-fA-F]{6}$/.test(draft.primaryColor)||!/^#[0-9a-fA-F]{6}$/.test(draft.accentColor)} onClick={()=>void save().catch(()=>{})}>{pending?<LoaderCircle size={15} className="animate-spin"/>:<Check size={15}/ >}{tx(lang,'حفظ الهوية','Save brand kit')}</button></div></section>;
}

function ProjectSoundtrack({url,volume,pending,onSave}:{url:string|null;volume:number;pending:boolean;onSave:(data:{musicUrl:string|null;musicVolume:number})=>Promise<void>}) {
  const {lang}=useApp();
  const [draftUrl,setDraftUrl]=useState(url||''),[draftVolume,setDraftVolume]=useState(volume),[dirty,setDirty]=useState(false);
  const [saveError,setSaveError]=useState(false);
  const editVersion=useRef(0);
  const saveHandler=useRef(onSave);
  useEffect(()=>{saveHandler.current=onSave},[onSave]);
  useEffect(()=>{if(!dirty){setDraftUrl(url||'');setDraftVolume(volume)}},[url,volume,dirty]);
  const validUrl=()=>{if(!draftUrl.trim())return true;try{const parsed=new URL(draftUrl.trim());return parsed.protocol==='https:'||parsed.protocol==='http:'}catch{return false}};
  const saveDraft=()=>{const revision=editVersion.current;setSaveError(false);return onSave({musicUrl:draftUrl.trim()||null,musicVolume:draftVolume}).then(()=>{if(editVersion.current===revision)setDirty(false)}).catch(error=>{if(editVersion.current===revision)setSaveError(true);throw error})};
  useEffect(()=>{
    if(!dirty||pending||saveError||!validUrl())return;
    const revision=editVersion.current;
    const timer=window.setTimeout(()=>{void saveHandler.current({musicUrl:draftUrl.trim()||null,musicVolume:draftVolume}).then(()=>{if(editVersion.current===revision)setDirty(false)}).catch(()=>{if(editVersion.current===revision)setSaveError(true)})},900);
    return()=>window.clearTimeout(timer);
  },[dirty,draftUrl,draftVolume,pending,saveError]);
  return <section className="soundtrack-panel panel"><div><span className="eyebrow">{tx(lang,'الموسيقى والخلفية','SOUNDTRACK')}</span><h3>{tx(lang,'مسار المشروع','Project audio')}</h3><p>{tx(lang,'أضف رابطًا لملف موسيقى ووازن مستواه في التصدير. تُحفظ التغييرات تلقائيًا.','Add a music asset URL and set its mix level for export. Changes save automatically.')}</p></div><div className="soundtrack-controls"><label className="soundtrack-url"><span className="field-label">{tx(lang,'رابط ملف الموسيقى','Music asset URL')}</span><input className="studio-input" type="url" value={draftUrl} onChange={e=>{editVersion.current++;setSaveError(false);setDraftUrl(e.target.value);setDirty(true)}} placeholder="https://" /></label><label className="soundtrack-volume"><span className="field-label">{tx(lang,'مستوى الموسيقى','Music volume')} · {draftVolume}%</span><input type="range" min="0" max="100" value={draftVolume} onChange={e=>{editVersion.current++;setSaveError(false);setDraftVolume(Number(e.target.value));setDirty(true)}} /></label><span className={`save-state ${saveError?'text-destructive':''}`}>{saveError?tx(lang,'تعذر الحفظ تلقائيًا؛ أعد المحاولة.','Auto-save failed; retry the save.'):pending?tx(lang,'جارٍ الحفظ...','Saving...'):dirty?tx(lang,'سيتم الحفظ تلقائيًا بعد التوقف عن التعديل.','Changes auto-save when you stop editing.'):tx(lang,'تم الحفظ تلقائيًا.','Saved automatically.')}</span><button className="btn btn-primary" disabled={!dirty||pending||!validUrl()} onClick={()=>void saveDraft().catch(()=>{})}>{pending?<LoaderCircle size={15} className="animate-spin"/>:<Check size={15}/ >}{tx(lang,'حفظ الآن','Save now')}</button>{url&&<audio className="audio-preview soundtrack-preview" src={url} controls aria-label={tx(lang,'معاينة موسيقى المشروع','Project music preview')}/>}</div></section>;
}
function ProjectSoundEffects({url,volume,pending,onSave}:{url:string|null;volume:number;pending:boolean;onSave:(data:{soundEffectsUrl:string|null;soundEffectsVolume:number})=>Promise<void>}) {
  const {lang}=useApp();
  const [draftUrl,setDraftUrl]=useState(url||''),[draftVolume,setDraftVolume]=useState(volume),[dirty,setDirty]=useState(false),[saveError,setSaveError]=useState(false);
  useEffect(()=>{if(!dirty){setDraftUrl(url||'');setDraftVolume(volume)}},[url,volume,dirty]);
  const validUrl=()=>{if(!draftUrl.trim())return true;try{const parsed=new URL(draftUrl.trim());return parsed.protocol==='https:'||parsed.protocol==='http:'}catch{return false}};
  const save=()=>{setSaveError(false);return onSave({soundEffectsUrl:draftUrl.trim()||null,soundEffectsVolume:draftVolume}).then(()=>setDirty(false)).catch(error=>{setSaveError(true);throw error})};
  return <section className="soundtrack-panel panel sound-effects-panel"><div><span className="eyebrow">{tx(lang,'المؤثرات الصوتية','SOUND EFFECTS')}</span><h3>{tx(lang,'مسار المؤثرات','Sound effects track')}</h3><p>{tx(lang,'اربط ملف مؤثرات مرخّصًا لمزجه أثناء التصدير. لا يتم توليد أو تشغيل أي خدمة تلقائيًا.','Attach a licensed sound-effects asset for export mixing. No provider runs automatically.')}</p></div><div className="soundtrack-controls"><label className="soundtrack-url"><span className="field-label">{tx(lang,'رابط ملف المؤثرات','Sound-effects asset URL')}</span><input className="studio-input" type="url" value={draftUrl} onChange={e=>{setDraftUrl(e.target.value);setDirty(true);setSaveError(false)}} placeholder="https://" /></label><label className="soundtrack-volume"><span className="field-label">{tx(lang,'مستوى المؤثرات','Effects volume')} · {draftVolume}%</span><input type="range" min="0" max="100" value={draftVolume} onChange={e=>{setDraftVolume(Number(e.target.value));setDirty(true);setSaveError(false)}} /></label><span className={`save-state ${saveError?'text-destructive':''}`}>{saveError?tx(lang,'تعذر الحفظ؛ أعد المحاولة.','Could not save; retry.'):pending?tx(lang,'جارٍ الحفظ...','Saving...'):dirty?tx(lang,'توجد تغييرات غير محفوظة.','Unsaved changes.'):tx(lang,'تم الحفظ.','Saved.')}</span><button className="btn btn-primary" disabled={!dirty||pending||!validUrl()} onClick={()=>void save().catch(()=>{})}>{pending?<LoaderCircle size={15} className="animate-spin"/>:<Check size={15}/ >}{tx(lang,'حفظ المؤثرات','Save effects')}</button>{url&&<audio className="audio-preview soundtrack-preview" src={url} controls aria-label={tx(lang,'معاينة المؤثرات','Sound-effects preview')}/>}</div></section>;
}
function formatTime(seconds:number) { const s=Math.max(0,Math.floor(seconds)); return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
function formatSrtTime(seconds:number) { const total=Math.max(0,Math.round(seconds*1000)); const ms=total%1000; const whole=Math.floor(total/1000); const sec=whole%60; const min=Math.floor(whole/60)%60; const hour=Math.floor(whole/3600); return `${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')},${String(ms).padStart(3,'0')}`; }
function downloadTextFile(filename:string, content:string, mime='text/plain;charset=utf-8') { const url=URL.createObjectURL(new Blob([content],{type:mime})); const anchor=document.createElement('a'); anchor.href=url; anchor.download=filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url); }

function MediaPage() {
  const { lang } = useApp();
  const qc=useQueryClient();
  const initial = new URLSearchParams(window.location.search);
  const [term,setTerm] = useState('');
  const [search,setSearch] = useState('');
  const [type,setType] = useState<'image'|'video'|'audio'>('image');
  const [source,setSource] = useState<'openverse'|'wikimedia'|'archive'|'pexels'|'pixabay'|'unsplash'>('openverse');
  const [orientation,setOrientation] = useState<'landscape'|'portrait'|'square'|''>('');
  const [page,setPage] = useState(1);
  const [added,setAdded] = useState<string | null>(null);
  const projectId = initial.get('projectId') || '';
  const sceneId = initial.get('sceneId') || '';
  const params = {q:search,mediaType:type,source,orientation:orientation||undefined,page};
  const q = useSearchFreeMedia(params,{query:{enabled:search.length>0,queryKey:getSearchFreeMediaQueryKey(params)}});
  const updateScene=useUpdateScene();
  const updateProject=useUpdateProject();
  const favorites=useListFavoriteMedia();
  const createFavorite=useCreateFavoriteMedia(),deleteFavorite=useDeleteFavoriteMedia();
  const refreshFavorites=()=>qc.invalidateQueries({queryKey:getListFavoriteMediaQueryKey()});
  const favoriteFor=(item:MediaResult)=>favorites.data?.find(f=>f.mediaId===item.id&&f.source===item.source);
  function toggleFavorite(item:MediaResult) {
    const saved=favoriteFor(item);
    if(saved)deleteFavorite.mutate({favoriteId:saved.id},{onSuccess:refreshFavorites});
    else createFavorite.mutate({data:{mediaId:item.id,source:item.source,title:item.title,url:item.url,thumbnailUrl:item.thumbnailUrl,mediaType:item.mediaType,license:item.license,licenseUrl:item.licenseUrl,creator:item.creator}},{onSuccess:refreshFavorites});
  }
  function add(result:MediaResult) {
    if(!projectId||!sceneId) { setAdded(tx(lang,'اختر مشهدًا من مساحة المشروع لإضافة الوسيط.','Open a project scene to attach this media.')); return; }
    updateScene.mutate({projectId,sceneId,data:{assetUrl:result.url,assetType:result.mediaType}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getGetProjectQueryKey(projectId)});setAdded(tx(lang,`تم ربط «${result.title}» بالمشهد.`,`“${result.title}” is attached to the scene.`));},onError:()=>setAdded(tx(lang,'تعذرت إضافة الوسيط. حاول مجددًا.','Could not attach this media. Try again.'))});
  }
  function addSaved(item:MediaFavorite) {
    if(!projectId||!sceneId){setAdded(tx(lang,'افتح مشهدًا من المشروع لإضافة الوسائط.','Open a project scene to attach media.'));return}
    updateScene.mutate({projectId,sceneId,data:{assetUrl:item.url,assetType:item.mediaType}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getGetProjectQueryKey(projectId)});setAdded(tx(lang,`تم ربط «${item.title}» بالمشهد.`,`“${item.title}” is attached to the scene.`))},onError:()=>setAdded(tx(lang,'تعذرت إضافة الوسيط. حاول مجددًا.','Could not attach this media. Try again.'))});
  }
  function useProjectAudio(url:string, kind:'music'|'effects', title:string) {
    if(!projectId){setAdded(tx(lang,'افتح المشروع أولًا لاستخدام ملف الصوت.','Open a project first to use an audio file.'));return;}
    const data = kind === 'music' ? { musicUrl:url, musicVolume:20 } : { soundEffectsUrl:url, soundEffectsVolume:35 };
    updateProject.mutate({projectId,data},{onSuccess:()=>{qc.invalidateQueries({queryKey:getGetProjectQueryKey(projectId)});setAdded(tx(lang,`تم تعيين «${title}» ك${kind==='music'?'موسيقى':'مؤثرات صوتية'} للمشروع.`,`“${title}” is now the project ${kind==='music'?'music':'sound-effects'} track.`))},onError:()=>setAdded(tx(lang,'تعذر حفظ مسار الصوت للمشروع.','Could not save the project audio track.'))});
  }
  const audioActions=(item:{url:string;title:string;mediaType:string})=>item.mediaType==='audio'&&projectId?<><button className="btn btn-quiet" onClick={()=>useProjectAudio(item.url,'music',item.title)} disabled={updateProject.isPending}><Music2 size={14}/>{tx(lang,'كموسيقى','Use as music')}</button><button className="btn btn-quiet" onClick={()=>useProjectAudio(item.url,'effects',item.title)} disabled={updateProject.isPending}><AudioLines size={14}/>{tx(lang,'كمؤثرات','Use as effects')}</button></>:null;
  return <AppFrame title={tx(lang,'مكتبة الوسائط','Media library')} crumb="OPENVERSE SEARCH"><div className="page-toolbar"><div><span className="eyebrow">{tx(lang,'بحث مفتوح الترخيص','OPEN-LICENSED SEARCH')}</span><h2>{tx(lang,'لقطة مناسبة تغيّر كل شيء.', 'The right frame changes everything.')}</h2><p>{tx(lang,'ابحث في نتائج Openverse مع إظهار المصدر والترخيص لكل ملف.', 'Search Openverse and review the source and license for every result.')}</p></div></div>
    <form className="media-search panel" onSubmit={e=>{e.preventDefault();setSearch(term.trim());setPage(1);setAdded(null);}}><label className="media-query-field"><span className="media-query-title"><Search size={17}/>{tx(lang,'اكتب وصف الصورة أو الصوت الذي تبحث عنه','Describe the image or sound you need')}</span><textarea value={term} onChange={e=>setTerm(e.target.value)} rows={2} maxLength={500} placeholder={tx(lang,'مثال: غابة ليلية تحت المطر، أو صوت مطر هادئ...','Example: a forest at night in the rain, or soft rainfall audio...')} data-testid="input-media-query" /></label><select aria-label={tx(lang,'نوع الوسائط','Media type')} className="studio-input media-type" value={type} onChange={e=>{const nextType=e.target.value as typeof type;setType(nextType);if(nextType!=='image'&&source==='wikimedia')setSource('openverse')}}><option value="image">{tx(lang,'صور','Images')}</option><option value="video">{tx(lang,'فيديو','Video')}</option><option value="audio">{tx(lang,'صوت','Audio')}</option></select><select aria-label={tx(lang,'المصدر','Source')} className="studio-input media-type" value={source} onChange={e=>setSource(e.target.value as typeof source)}><option value="openverse">Openverse · {tx(lang,'بلا مفتاح','no key')}</option><option value="wikimedia" disabled={type!=='image'}>Wikimedia · {tx(lang,'بلا مفتاح · صور فقط','no key · images only')}</option><option value="archive">Internet Archive · {tx(lang,'بلا مفتاح','no key')}</option><option value="pexels">Pexels · {tx(lang,'مفتاح','key')}</option><option value="pixabay">Pixabay · {tx(lang,'مفتاح','key')}</option><option value="unsplash">Unsplash · {tx(lang,'مفتاح','key')}</option></select><select aria-label={tx(lang,'الاتجاه','Orientation')} className="studio-input media-type" value={orientation} onChange={e=>setOrientation(e.target.value as typeof orientation)}><option value="">{tx(lang,'كل الاتجاهات','Any orientation')}</option><option value="landscape">{tx(lang,'أفقي','Landscape')}</option><option value="portrait">{tx(lang,'عمودي','Portrait')}</option><option value="square">{tx(lang,'مربع','Square')}</option></select><button className="btn btn-primary" disabled={!term.trim()} data-testid="button-search-media"><Search size={16}/>{tx(lang,'ابحث عن الوسائط','Search media')}</button></form><p className="media-keyless-note">{tx(lang,'Openverse وInternet Archive يعملان بلا مفاتيح. اختَر نوع الوسائط، واكتب وصفًا ثم اضغط «ابحث عن الوسائط».','Openverse and Internet Archive work without API keys. Choose a media type, describe what you need, then select Search media.')}</p>
    {added && <div className="media-notice"><Check size={16}/>{added}<button onClick={()=>setAdded(null)} className="btn btn-ghost !p-1"><X size={15}/></button></div>}
     {q.isLoading ? <div className="media-results">{[1,2,3,4].map(n=><SkeletonBlock key={n} className="h-64"/>)}</div> : q.isError ? <MediaSearchError error={q.error} lang={lang} retry={()=>q.refetch()} /> : q.data ? q.data.results.length ? <><div className="results-label"><span>{q.data.total} {tx(lang,'نتيجة','results')} · {q.data.source}</span><span>{tx(lang,'تحقق من الترخيص قبل الاستخدام','Review license before use')}</span></div><div className="media-results">{q.data.results.map(item=><article className="media-card panel" key={item.id}><MediaPreview item={item} lang={lang}/><div className="media-card-content"><h3>{item.title}</h3>{item.creator && <p className="media-creator">{tx(lang,'بواسطة','by')} {item.creator}</p>}<div className="license-line"><span>{item.source}</span><a href={item.licenseUrl || item.url} target="_blank" rel="noreferrer">{item.license}</a></div><div className="media-card-actions">{audioActions(item)}<button className="btn btn-quiet" onClick={()=>add(item)} disabled={updateScene.isPending||!projectId||!sceneId} data-testid={`button-add-media-${item.id}`}><Plus size={15}/>{tx(lang,'إضافة للمشهد','Attach')}</button><button className={`btn btn-quiet favorite-button ${favoriteFor(item)?'is-favorite':''}`} onClick={()=>toggleFavorite(item)} disabled={createFavorite.isPending||deleteFavorite.isPending} aria-label={favoriteFor(item)?tx(lang,'إزالة من المفضلة','Remove favorite'):tx(lang,'حفظ في المفضلة','Save favorite')} title={favoriteFor(item)?tx(lang,'إزالة من المفضلة','Remove favorite'):tx(lang,'حفظ في المفضلة','Save favorite')}><Heart size={16} fill={favoriteFor(item)?'currentColor':'none'}/></button></div></div></article>)}</div><div className="pager"><button className="btn btn-quiet" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}><ArrowRight size={15}/>{tx(lang,'السابق','Previous')}</button><span>{tx(lang,`صفحة ${page}`,`Page ${page}`)}</span><button className="btn btn-quiet" onClick={()=>setPage(p=>p+1)}>{tx(lang,'التالي','Next')}<ArrowLeft size={15}/></button></div></> : <Empty title={tx(lang,'لم نعثر على نتائج','No results found')} body={tx(lang,'جرّب عبارة بحث مختلفة أو بدّل نوع الوسائط.','Try a different phrase or switch the media type.')} /> : <Empty title={tx(lang,'ابحث عن الوسيط التالي','Find your next asset')} body={tx(lang,'ابحث في المصدر المحدد، ثم راجع الترخيص قبل الاستخدام.','Search the selected source, then review its license before use.')} />}
     <section className="section-block saved-media"><div className="section-heading"><div><span className="eyebrow">{tx(lang,'مجموعتك المحفوظة','YOUR COLLECTION')}</span><h3>{tx(lang,'المفضلة','Favorites')}</h3></div><span className="result-count">{favorites.data?.length ?? 0}</span></div>{favorites.isLoading?<div className="media-results">{[1,2].map(i=><SkeletonBlock key={i} className="h-48"/>)}</div>:favorites.isError?<StateError lang={lang} retry={()=>favorites.refetch()}/>:favorites.data?.length?<div className="media-results">{favorites.data.map(item=><article className="media-card panel" key={item.id}><a className="media-image" href={item.url} target="_blank" rel="noreferrer">{item.thumbnailUrl?<img src={item.thumbnailUrl} alt={item.title} loading="lazy" decoding="async"/>:<div className="media-placeholder"><ImagePlus size={26}/><span>{item.mediaType}</span></div>}<span className="media-type-tag">{item.mediaType}</span></a><div className="media-card-content"><h3>{item.title}</h3><div className="license-line"><span>{item.source}</span><a href={item.licenseUrl||item.url} target="_blank" rel="noreferrer">{item.license}</a></div><div className="media-card-actions">{audioActions(item)}<button className="btn btn-quiet" onClick={()=>addSaved(item)} disabled={updateScene.isPending||!projectId||!sceneId}><Plus size={15}/>{tx(lang,'إضافة للمشهد','Attach')}</button><button className="btn btn-quiet favorite-button is-favorite" onClick={()=>deleteFavorite.mutate({favoriteId:item.id},{onSuccess:refreshFavorites})} disabled={deleteFavorite.isPending} aria-label={tx(lang,'إزالة من المفضلة','Remove favorite')}><Heart size={16} fill="currentColor"/></button></div></div></article>)}</div>:<Empty title={tx(lang,'لا توجد عناصر محفوظة','No saved media')} body={tx(lang,'احفظ الأصول المرخّصة من نتائج البحث لتعود إليها هنا.','Save licensed assets from search results to find them here later.')}/>}</section>
  </AppFrame>;
}

function ProvidersPage() {
  const { lang } = useApp();
  const qc = useQueryClient();
  const keys = useListProviderKeys(), settingsQ = useGetProviderSettings();
  const create=useCreateProviderKey(),update=useUpdateProviderKey(),remove=useDeleteProviderKey(),test=useTestProviderKey(),saveSettings=useUpdateProviderSettings();
  const [dialog,setDialog]=useState(false);
  const [editing,setEditing]=useState<ProviderKey|null>(null);
  const [restrictToSection,setRestrictToSection]=useState(false);
  const [initialService,setInitialService]=useState<ProviderKey['serviceType']>('text');
  const invalidate=()=>{qc.invalidateQueries({queryKey:getListProviderKeysQueryKey()});qc.invalidateQueries({queryKey:getGetStudioSummaryQueryKey()});};
  const [prefs,setPrefs]=useState<ProviderSettings|null>(null);
  const fallbackProviders=Array.from(new Set((keys.data??[]).map(key=>key.provider))).sort();
  const serviceSections=[
    {value:'text',label:tx(lang,'الكتابة والسيناريو','Writing & scripts')},
    {value:'image',label:tx(lang,'توليد الصور','Image generation')},
    {value:'video',label:tx(lang,'توليد الفيديو','Video generation')},
    {value:'voice',label:tx(lang,'التعليق الصوتي','Voice narration')},
    {value:'transcription',label:tx(lang,'تفريغ الصوت والترجمة','Transcription & translation')},
    {value:'music',label:tx(lang,'الموسيقى','Music')},
    {value:'media',label:tx(lang,'البحث عن الوسائط','Media search')},
  ] as const;
  const openAdd=(service:ProviderKey['serviceType'],fromSection=false)=>{setEditing(null);setInitialService(service);setRestrictToSection(fromSection);setDialog(true)};
  const renderProviderRow=(key:ProviderKey)=><ProviderRow key={key.id} item={key}
    onEdit={()=>{setEditing(key);setRestrictToSection(false);setDialog(true)}}
    onToggle={enabled=>update.mutate({keyId:key.id,data:{enabled}},{onSuccess:invalidate})}
    onPriority={priority=>update.mutate({keyId:key.id,data:{priority}},{onSuccess:invalidate})}
    onTest={()=>{if(!window.confirm(tx(lang,'سيُختبر الاتصال فقط دون إنشاء فيديو. قد تختلف شروط مزوّدك. هل تريد المتابعة؟','This checks the connection without generating a video. Provider terms may vary. Continue?')))return;test.mutate({keyId:key.id},{onSuccess:invalidate})}}
    testing={test.isPending}
    freeMode={prefs?.freeMode ?? true}
    onDelete={()=>{if(window.confirm(tx(lang,'حذف هذا المفتاح؟','Delete this key?')))remove.mutate({keyId:key.id},{onSuccess:invalidate})}}
    lang={lang}/>;
  useEffect(()=>{if(settingsQ.data)setPrefs(settingsQ.data)},[settingsQ.data]);
  return <AppFrame title={tx(lang,'مزوّدو الخدمة','Provider settings')} crumb="CREDENTIALS & ROTATION">
    <div className="page-toolbar"><div><span className="eyebrow">{tx(lang,'المفاتيح والاعتمادية','KEYS & RELIABILITY')}</span><h2>{tx(lang,'أدواتك، تحت سيطرتك.', 'Your tools, on your terms.')}</h2><p>{tx(lang,'المفاتيح لا تظهر مجددًا بعد حفظها؛ تُرسل للخادم مباشرة ولا تُخزّن في المتصفح. كل مفتاح يظهر تحت نوع الخدمة المخصص له.', 'Keys are never shown again after saving. They are sent directly to the server and never stored in browser storage. Each key appears under its assigned service.')}</p></div><button className="btn btn-primary" onClick={()=>openAdd('text')} data-testid="button-add-provider"><Plus size={16}/>{tx(lang,'إضافة مفتاح','Add a key')}</button></div>
    <div className="resource-notice panel"><ShieldCheck size={18}/><p>{tx(lang,'أضفنا NVIDIA NIM وCohere للكتابة بمستويات تجريبية مجانية وحدود استخدام. توليد الفيديو ليس مجانياً عبر واجهات API المستضافة؛ مزوّدا fal.ai وReplicate قد يحاسبان حسب النموذج، ويظل كل طلب فيديو خلف موافقتك الصريحة.', 'NVIDIA NIM and Cohere are available for script writing with free prototype/trial limits. Hosted video-generation APIs are not free: fal.ai and Replicate may charge by model, and every video request remains behind your explicit approval.')}</p></div>
    <div className={`resource-notice panel ${prefs?.freeMode !== false ? 'is-unavailable' : ''}`} role="status"><ShieldCheck size={18}/><p>{prefs?.freeMode !== false ? tx(lang,'المزوّدات الخارجية متوقفة حاليًا. يمكنك تشغيلها من المفتاح أدناه عند إضافة مفاتيحك؛ وسيظل كل طلب محتمل الرسوم بحاجة إلى موافقتك.','External providers are currently off. You can enable them using the control below after adding keys; each request that may incur charges still needs your approval.') : tx(lang,'المزوّدات الخارجية مسموحة. قد يستهلك استخدامها رصيدًا أو يسبب رسومًا، لكن التطبيق سيطلب موافقتك قبل كل مهمة مولّدة.','External providers are enabled. They may use credits or incur charges, but the app asks before every generation job.')}</p></div>
    {keys.isError&&<StateError lang={lang} retry={()=>keys.refetch()} />}
    <div className="provider-category-list grid gap-3">
      {serviceSections.map(section=>{
        const sectionKeys=(keys.data??[]).filter(key=>key.serviceType===section.value);
        return <section className="panel provider-list" key={section.value} data-testid={`provider-section-${section.value}`}>
          <div className="section-heading"><div><span className="eyebrow">{tx(lang,'قسم المفاتيح','KEY CATEGORY')}</span><h3>{section.label}</h3></div><div className="flex items-center gap-3"><span className="result-count">{sectionKeys.length} {tx(lang,'مفاتيح','keys')}</span><button className="btn btn-quiet" onClick={()=>openAdd(section.value,true)}><Plus size={15}/>{tx(lang,'إضافة لهذا القسم','Add to section')}</button></div></div>
          {keys.isLoading?<div className="provider-rows">{[1,2].map(n=><SkeletonBlock key={n} className="h-20"/>)}</div>
            :sectionKeys.length?<div className="provider-rows">{sectionKeys.map(renderProviderRow)}</div>
            :<p className="provider-purpose-description">{tx(lang,'لا توجد مفاتيح في هذا القسم بعد.','No keys in this section yet.')}</p>}
        </section>;
      })}
    </div>
    <section className="panel rotation-panel"><div className="section-heading"><div><span className="eyebrow">{tx(lang,'التعامل مع التعطّل','FAILOVER BEHAVIOR')}</span><h3>{tx(lang,'تدوير المفاتيح وإعادة المحاولة','Key rotation & retries')}</h3></div><ShieldCheck size={20} className="text-primary"/></div>
      {settingsQ.isLoading ? <SkeletonBlock className="h-48"/> : settingsQ.isError ? <StateError lang={lang} retry={()=>settingsQ.refetch()}/> : prefs && <><div className="rotation-options">
        <label className="rotation-row"><span><b>{tx(lang,'السماح بالمزوّدات الخارجية (قد تكون مدفوعة)','Allow external providers (may cost)')}</b><small>{tx(lang,'عند إيقافه يمنع الخادم مهام التوليد والتفريغ المدفوعة؛ تبقى اختبارات المصادقة للقراءة فقط متاحة ولا تولّد محتوى.','When off, the server blocks generation and paid transcription tasks. Read-only authentication checks remain available and do not generate content.')}</small></span><input aria-label={tx(lang,'السماح بالمزوّدات الخارجية','Allow external providers')} type="checkbox" checked={!prefs.freeMode} onChange={e=>setPrefs({...prefs,freeMode:!e.target.checked})} data-testid="checkbox-provider-external-access" /></label>
        {[
        ['autoRotate',tx(lang,'التدوير التلقائي','Automatic rotation'),tx(lang,'استخدم المفتاح التالي عند الحاجة.','Move to another key when needed.')],
        ['rotateOnQuota',tx(lang,'عند تجاوز الحصة','On quota limits'),tx(lang,'انتقل لمفتاح آخر عند نفاد الحصة.','Switch when a provider quota is reached.')],
        ['rotateOnRateLimit',tx(lang,'عند تحديد المعدل','On rate limits'),tx(lang,'أعد المحاولة على مفتاح آخر عند تقييد المعدل.','Retry with another key when rate limited.')],
        ['rotateOnConnectionFailure',tx(lang,'عند فشل الاتصال','On connection failures'),tx(lang,'بدّل المزوّد عند تعذّر الاتصال.','Fail over when a provider cannot be reached.')],
      ].map(([field,title,desc])=><label className="rotation-row" key={field}><span><b>{title}</b><small>{desc}</small></span><input aria-label={title} type="checkbox" checked={Boolean(prefs[field as keyof ProviderSettings])} onChange={e=>setPrefs(p=>p?({...p,[field]:e.target.checked}):p)} /></label>)}</div>
      <div className="rotation-advanced"><label><span className="field-label">{tx(lang,'أقصى عدد للمحاولات','Maximum attempts')}</span><input className="studio-input" type="number" min="1" max="10" value={prefs.maxAttempts} onChange={e=>setPrefs({...prefs,maxAttempts:Number(e.target.value)})}/></label><label><span className="field-label">{tx(lang,'تأخير إعادة المحاولة بالثواني','Retry delay (seconds)')}</span><input className="studio-input" type="number" min="0" max="300" value={prefs.retryDelaySeconds} onChange={e=>setPrefs({...prefs,retryDelaySeconds:Number(e.target.value)})}/></label><label><span className="field-label">{tx(lang,'المزوّد الاحتياطي','Fallback provider')}</span><select className="studio-input" value={prefs.fallbackProvider || ''} onChange={e=>setPrefs({...prefs,fallbackProvider:e.target.value||null})}><option value="">{tx(lang,'حسب الأولوية فقط','Use priority order')}</option>{fallbackProviders.map(provider=><option key={provider} value={provider}>{provider}</option>)}</select></label></div>
      <div className="modal-actions"><span className="save-state">{saveSettings.isSuccess && <><Check size={14}/>{tx(lang,'حُفظت الإعدادات','Settings saved')}</>}</span><button className="btn btn-primary" disabled={saveSettings.isPending} onClick={()=>saveSettings.mutate({data:prefs},{onSuccess:()=>qc.invalidateQueries({queryKey:getGetProviderSettingsQueryKey()})})}>{saveSettings.isPending?tx(lang,'جارٍ الحفظ...','Saving...'):tx(lang,'حفظ الإعدادات','Save settings')}</button></div></>}
    </section>
    {dialog && <ProviderForm initial={editing} initialService={initialService} restrictToSection={!editing&&restrictToSection} onClose={()=>setDialog(false)} pending={create.isPending||update.isPending} onSave={data=>{if(editing){const {apiKey,...safe}=data;update.mutate({keyId:editing.id,data:{...safe,...(apiKey?{apiKey}:{})}},{onSuccess:()=>{invalidate();setDialog(false)}})}else create.mutate({data},{onSuccess:()=>{invalidate();setDialog(false)}})}} />}
  </AppFrame>;
}
function ProviderRow({item,onEdit,onToggle,onPriority,onTest,onDelete,testing,freeMode,lang}:{item:ProviderKey;onEdit:()=>void;onToggle:(v:boolean)=>void;onPriority:(v:number)=>void;onTest:()=>void;onDelete:()=>void;testing:boolean;freeMode:boolean;lang:Lang}) {
  const officialUrl=providerOfficialUrls[item.provider];
  const testedAt=item.lastTestAt?new Date(item.lastTestAt).toLocaleString(lang==='ar'?'ar':'en') : tx(lang,'لم يُختبر بعد','Not tested yet');
  const purpose=providerServicePurpose(item.serviceType,lang,item.provider);
  const serviceConnected=providerServiceIsConnected(item.provider,item.serviceType);
  const serviceReady=serviceConnected && item.status==='valid';
  const plan=providerPlanInfo[item.provider];
  const statusLabel=item.status==='quota_limited'?tx(lang,'الحصة مستنفدة','quota limited'):item.status==='rate_limited'?tx(lang,'طلبات كثيرة مؤقتًا','rate limited'):item.status.replace('_',' ');
  return <div className="provider-row">
    <div className="provider-avatar">{item.provider.slice(0,2).toUpperCase()}</div>
    <div className="provider-ident"><b>{item.label}</b><span>{item.provider}</span><span className={`provider-purpose ${serviceReady?'':'is-unavailable'}`}>{tx(lang,'وظيفته:','Purpose:')} {purpose.label}</span><small className="provider-purpose-description">{purpose.description}</small>{!serviceReady&&<small className="provider-purpose-warning">{item.status==='quota_limited'?tx(lang,'المفتاح محفوظ ومفعّل، لكن حساب المزوّد لا يملك حاليًا حصة/رصيدًا متاحًا؛ هذا لا يعني بالضرورة أن المفتاح خطأ.','The key is saved and enabled, but the provider account currently has no quota/credits available; this does not necessarily mean the key is invalid.'):item.status==='rate_limited'?tx(lang,'المفتاح محفوظ ومفعّل؛ المزوّد يقيّد الطلبات مؤقتًا. انتظر انتهاء المهلة ثم أعد المحاولة.','The key is saved and enabled; the provider is temporarily rate-limiting requests. Wait for cooldown, then retry.'):serviceConnected?tx(lang,'المفتاح غير جاهز للاستخدام حتى ينجح اختبار الاتصال.','The key is not ready for use until its connection test succeeds.'):tx(lang,'هذا الاستخدام غير موصول حاليًا لهذا المزوّد.','This task is not currently connected for this provider.')}</small>}{item.provider==='stability'&&item.status==='untested'&&<small className="provider-purpose-warning">{tx(lang,'لا توثّق Stability AI فحص مصادقة آمنًا عبر API؛ لم يُرسل طلب توليد.','Stability AI does not document a safe API auth check; no generation request was used as a test.')}</small>}{plan&&<small className="provider-purpose-description"><b>{tx(lang,'التصنيف:','Plan:')} {tx(lang,plan.kind==='trial'?'رصيد تجريبي محدود':plan.kind==='free-quota'?'حصة مجانية مستمرة':'مدفوع',plan.kind==='trial'?'Limited trial credits':plan.kind==='free-quota'?'Ongoing free quota':'Paid')}</b> — {tx(lang,plan.ar,plan.en)} <a className="text-link" href={plan.url} target="_blank" rel="noopener noreferrer">{tx(lang,'المصدر الرسمي','Official source')}</a></small>}</div>
    <span className={`key-status ${item.status}`}>{statusLabel}</span>
    <label className="priority-control"><span>{tx(lang,'الأولوية','Priority')}</span><input type="number" min="0" value={item.priority} aria-label={tx(lang,'أولوية المفتاح','Key priority')} onChange={e=>onPriority(Number(e.target.value))}/></label>
    <label className="switch-control" title={tx(lang,'مفعّل','Enabled')}><input type="checkbox" checked={item.enabled} onChange={e=>onToggle(e.target.checked)}/><span /></label>
    <div className="provider-actions">
      {officialUrl&&<a className="btn btn-ghost !p-2" title={tx(lang,'الموقع الرسمي للمزوّد','Provider official site')} href={officialUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/></a>}
      <button className="btn btn-ghost !p-2" title={freeMode?tx(lang,'اختبار قراءة فقط؛ لا يولّد محتوى ولا يستهلك رصيد توليد','Read-only check; does not generate content or use inference credits'):tx(lang,'اختبار مصادقة للقراءة فقط؛ لا يولّد محتوى','Read-only authentication check; no content generation')} onClick={onTest} disabled={testing}>{testing?<LoaderCircle size={15} className="animate-spin"/>:<Check size={15}/>}</button>
      <button className="btn btn-ghost !p-2" title={tx(lang,'تعديل','Edit')} onClick={onEdit}><Settings2 size={15}/></button>
      <button className="btn btn-ghost !p-2 text-destructive" title={tx(lang,'حذف','Delete')} onClick={onDelete}><Trash2 size={15}/></button>
    </div>
    <small className="provider-message">{userFacingProviderTestMessage(item.testMessage,item.label,lang)} · {testedAt} · {tx(lang,`استخدامات مسجلة: ${item.usedCount}`,`Recorded uses: ${item.usedCount}`)}</small>
  </div>;
}
function ProviderForm({initial,initialService,restrictToSection,onClose,onSave,pending}:{initial:ProviderKey|null;initialService:ProviderKey['serviceType'];restrictToSection:boolean;onClose:()=>void;onSave:(data:{provider:string;label:string;apiKey:string;serviceType:'text'|'image'|'video'|'voice'|'transcription'|'music'|'media';enabled:boolean;priority:number})=>void;pending:boolean}) {
  const {lang}=useApp();
  const initialServiceProvider=initialService==='video'?'fal':initialService==='image'?'replicate':initialService==='voice'?'elevenlabs':initialService==='transcription'?'whisper':initialService==='media'?'pexels':initialService==='music'?'musicgen':'huggingface';
  const [provider,setProvider]=useState(initial?.provider||initialServiceProvider),[label,setLabel]=useState(initial?.label||''),[apiKey,setApiKey]=useState(''),[serviceType,setServiceType]=useState<'text'|'image'|'video'|'voice'|'transcription'|'music'|'media'>(initial?.serviceType||initialService||'text'),[enabled,setEnabled]=useState(initial?.enabled??true),[priority,setPriority]=useState(initial?.priority??0);
  const [revealed,setRevealed]=useState(false),[copied,setCopied]=useState(false);
  const providerOptions=[
    ['openai','OpenAI','https://platform.openai.com/api-keys','text'],['gemini','Google AI Studio (GOOGLE_AI_API_KEY)','https://aistudio.google.com/app/apikey','text'],['anthropic','Anthropic Claude','https://console.anthropic.com/settings/keys','text'],['groq','Groq (GROQ_API_KEY)','https://console.groq.com/keys','text'],['cloudflare','Cloudflare Workers AI (CLOUDFLARE_API_TOKEN)','https://dash.cloudflare.com/profile/api-tokens','text'],['openrouter','OpenRouter','https://openrouter.ai/keys','text'],['huggingface','Hugging Face (HF_TOKEN)','https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained','text'],['colab-t5',tx(lang,'Google Colab T5 — مجاني','Google Colab T5 — free'),'https://colab.research.google.com/','text'],['mistral','Mistral','https://console.mistral.ai/api-keys/','text'],['cerebras','Cerebras','https://cloud.cerebras.ai/','text'],['together','Together AI','https://api.together.ai/settings/api-keys','text'],['sambanova','SambaNova','https://cloud.sambanova.ai/','text'],['nvidia',tx(lang,'NVIDIA NIM — مجاني للتجربة','NVIDIA NIM — free prototype tier'),'https://build.nvidia.com/settings','text'],['cohere',tx(lang,'Cohere — مفتاح تجريبي مجاني محدود','Cohere — limited free trial'),'https://dashboard.cohere.com/api-keys','text'],['deepseek','DeepSeek','https://platform.deepseek.com/api_keys','text'],['stability','Stability AI (STABILITY_API_KEY)','https://platform.stability.ai/dashboard/api-keys','image'],['replicate','Replicate','https://replicate.com/account/api-tokens','image'],['segmind','Segmind (SEGMIND_API_KEY)','https://www.segmind.com/console/api-keys','image'],['fal','fal.ai (FAL_KEY)','https://fal.ai/dashboard/keys','video'],['runway','Runway (RUNWAY_API_KEY)','https://dev.runwayml.com/','video'],['luma','Luma AI (LUMA_API_KEY)','https://lumalabs.ai/dream-machine/api','video'],['wan22','Wan 2.2 — سيرفر GPU محلي','https://github.com/Wan-Video/Wan2.2','video'],['cogvideox','CogVideoX — سيرفر GPU محلي','https://github.com/zai-org/CogVideo','video'],['ltx-video','LTX-Video — سيرفر GPU محلي','https://github.com/Lightricks/ltx-video','video'],['hunyuan-video','HunyuanVideo 1.5 — سيرفر GPU محلي','https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5','video'],['elevenlabs','ElevenLabs','https://elevenlabs.io/app/settings/api-keys','voice'],['cartesia','Cartesia (CARTESIA_API_KEY)','https://play.cartesia.ai/keys','voice'],['google-tts','Google Cloud Text-to-Speech (GOOGLE_CLOUD_API_KEY)','https://console.cloud.google.com/apis/credentials','voice'],['azure-speech','Azure Speech (AZURE_SPEECH_KEY)','https://portal.azure.com/','voice'],['openai-audio','OpenAI Audio','https://platform.openai.com/api-keys','voice'],['whisper','Whisper','https://platform.openai.com/api-keys','transcription'],['deepgram','Deepgram (DEEPGRAM_API_KEY)','https://console.deepgram.com/signup?jump=keys','transcription'],['assemblyai','AssemblyAI (ASSEMBLYAI_API_KEY)','https://www.assemblyai.com/dashboard/home','transcription'],['google-speech','Google Speech-to-Text','https://console.cloud.google.com/apis/credentials','transcription'],['musicgen','MusicGen','https://github.com/facebookresearch/audiocraft','music'],['openverse','Openverse (public search; no key required)','https://openverse.org/','media'],['pexels','Pexels','https://www.pexels.com/api/','media'],['pixabay','Pixabay','https://pixabay.com/api/docs/','media'],['unsplash','Unsplash','https://unsplash.com/developers','media'],
  ] as const;
  const availableProviders=providerOptions.filter(item=>!restrictToSection||item[3]===initialService||providerSupports(item[0],initialService)||(initialService==='image'&&['gemini','fal'].includes(item[0])));
  const currentProvider=availableProviders.find(item=>item[0]===provider);
  const localVideoProvider=['wan22','cogvideox','ltx-video','hunyuan-video'].includes(provider);
  const serviceTypes=[
    {value:'text',label:tx(lang,'الكتابة والسيناريو','Writing & scripts')},
    {value:'image',label:tx(lang,'توليد الصور','Image generation')},
    {value:'video',label:tx(lang,'توليد الفيديو','Video generation')},
    {value:'voice',label:tx(lang,'التعليق الصوتي','Voice narration')},
    {value:'transcription',label:tx(lang,'تفريغ الصوت والترجمة','Transcription & translation')},
    {value:'music',label:tx(lang,'الموسيقى','Music')},
    {value:'media',label:tx(lang,'البحث عن الوسائط','Media search')},
  ];
  const effectiveServiceType=restrictToSection?initialService:serviceType;
  const purpose=providerServicePurpose(effectiveServiceType,lang,provider);
  const serviceConnected=providerServiceIsConnected(provider,effectiveServiceType);
  return <Modal title={initial?tx(lang,'تعديل المفتاح','Edit provider key'):tx(lang,'إضافة مفتاح مزوّد','Add provider key')} subtitle={tx(lang,'لن يُعرض المفتاح بعد حفظه. الأسماء بين قوسين مراجع شائعة فقط؛ تُحفظ القيمة مشفّرة لحسابك ولا تُضاف تلقائيًا إلى بيئة الخادم.','The key is hidden after saving. Names in parentheses are common references only; the value is encrypted for your account and is not injected into the server environment.')} onClose={onClose}><form className="form-stack" onSubmit={e=>{e.preventDefault();onSave({provider,label,apiKey: localVideoProvider && !apiKey ? 'local' : apiKey,serviceType:effectiveServiceType,enabled,priority})}}>
    <label><span className="field-label">{tx(lang,'اسم المزوّد','Provider')}</span><select className="studio-input" value={provider} onChange={e=>{const value=e.target.value;setProvider(value);const selected=availableProviders.find(item=>item[0]===value);if(selected)setServiceType(restrictToSection?initialService:selected[3]);}}>{availableProviders.map(item=><option key={item[0]} value={item[0]}>{item[1]}</option>)}</select></label>
    {currentProvider && <a className="text-link provider-official-link" href={currentProvider[2]} target="_blank" rel="noopener noreferrer">{tx(lang,'زيارة الموقع الرسمي للحصول على المفتاح','Visit the official site to get a key')}<ExternalLink size={14}/></a>}
    {providerPlanInfo[provider]&&<div className="service-purpose-hint"><b>{tx(lang,'حصة وتسعير الخدمة','Plan and usage classification')}</b><span>{tx(lang,providerPlanInfo[provider].ar,providerPlanInfo[provider].en)}</span><a className="text-link" href={providerPlanInfo[provider].url} target="_blank" rel="noopener noreferrer">{tx(lang,'التحقق من المصدر الرسمي','Check official source')}<ExternalLink size={14}/></a></div>}
    {provider==='cloudflare'&&<div className="service-purpose-hint is-unavailable"><b>{tx(lang,'إعداد إضافي مطلوب','Additional setup required')}</b><span>{tx(lang,'يتطلب الخادم CLOUDFLARE_ACCOUNT_ID (معرّف الحساب من 32 خانة) لاختبار صلاحية Workers AI وتشغيله. أضفه كإعداد خادم غير سري.','The server needs CLOUDFLARE_ACCOUNT_ID (your 32-character account ID) to test Workers AI access and use it. Configure it as a non-secret server setting.')}</span></div>}
    {provider==='stability'&&<div className="service-purpose-hint is-unavailable"><b>{tx(lang,'التحقق الآمن غير متاح رسميًا','Safe verification is not officially available')}</b><span>{tx(lang,'توثيق Stability AI الحالي لا يوفّر نقطة GET مستقلة للتحقق من المفتاح؛ لذلك لن يتم إرسال طلب توليد كاختبار، وسيبقى المفتاح غير موثّق.','Current Stability AI docs do not provide a standalone GET key-validation endpoint; no generation request will be used as a test, so the key remains unverified.')}</span></div>}
    <label><span className="field-label">{tx(lang,'تسمية المفتاح','Key label')}</span><input required className="studio-input" value={label} onChange={e=>setLabel(e.target.value)} placeholder={tx(lang,'مثال: مفتاح الإنتاج','e.g. Production key')} /></label>
    <label><span className="field-label">{tx(lang,'مفتاح API أو معرّف محلي','API key or local marker')}</span><div className="secret-input-row"><input required={!initial && !localVideoProvider} type={revealed?'text':'password'} autoComplete="new-password" className="studio-input" value={apiKey} onChange={e=>{setApiKey(e.target.value);setCopied(false);}} placeholder={provider==='colab-t5'?tx(lang,'الصق رابط Colab العام https://...trycloudflare.com','Paste the public Colab URL https://...trycloudflare.com'):localVideoProvider?tx(lang,'لا يحتاج مفتاحًا؛ سيُستخدم معرّف local','No key required; a local marker will be used'):initial?tx(lang,'اتركه فارغًا للإبقاء على المفتاح الحالي','Leave blank to keep the current key'):'API key'} data-testid="input-provider-secret" />{apiKey && <button type="button" className="btn btn-ghost !p-2" aria-label={revealed?tx(lang,'إخفاء المفتاح','Hide key'):tx(lang,'إظهار المفتاح','Show key')} onClick={()=>setRevealed(v=>!v)}>{revealed?<EyeOff size={16}/>:<Eye size={16}/>}</button>}{apiKey && <button type="button" className="btn btn-ghost !p-2" aria-label={tx(lang,'نسخ المفتاح غير المحفوظ','Copy unsaved key')} onClick={()=>{void navigator.clipboard.writeText(apiKey).then(()=>{setCopied(true);window.setTimeout(()=>setCopied(false),1500);});}}>{copied?<Check size={16}/>:<Copy size={16}/>}</button>}</div></label>
    <div className="form-two">{restrictToSection?<div><span className="field-label">{tx(lang,'وظيفة المفتاح','Key purpose')}</span><div className="studio-input" aria-readonly="true">{purpose.label}</div></div>:<label><span className="field-label">{tx(lang,'وظيفة المفتاح','Key purpose')}</span><select className="studio-input" value={serviceType} onChange={e=>setServiceType(e.target.value as typeof serviceType)}>{serviceTypes.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}<label><span className="field-label">{tx(lang,'الأولوية','Priority')}</span><input type="number" min="0" className="studio-input" value={priority} onChange={e=>setPriority(Number(e.target.value))}/></label></div>
    <div className={`service-purpose-hint ${serviceConnected?'':'is-unavailable'}`} aria-live="polite"><b>{tx(lang,'هذا المفتاح مخصّص لـ','This key is for')}: {purpose.label}</b><span>{purpose.description}</span>{!serviceConnected&&<small>{tx(lang,'لن يعمل هذا المفتاح لهذه المهمة حتى يتصل بها المزوّد داخل التطبيق.','This key will not work for this task until the provider is connected in the app.')}</small>}</div>
    <label className="checkline"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>{tx(lang,'تفعيل هذا المفتاح','Enable this key')}</label><div className="modal-actions"><button className="btn btn-quiet" type="button" onClick={onClose}>{tx(lang,'إلغاء','Cancel')}</button><button className="btn btn-primary" disabled={pending}>{pending?<LoaderCircle size={16} className="animate-spin"/>:<KeyRound size={16}/ >}{tx(lang,'حفظ المفتاح','Save key')}</button></div>
  </form></Modal>;
}

function ToolsPage() {
  const {lang}=useApp(); const q=useListFreeTools();
  return <AppFrame title={tx(lang,'موارد مجانية','Free Resources')} crumb="FREE & OPEN-SOURCE RESOURCES"><div className="page-toolbar"><div><span className="eyebrow">{tx(lang,'موارد صناعة الأفلام','FILMMAKING RESOURCES')}</span><h2>{tx(lang,'ابدأ بالأدوات المجانية والمفتوحة.', 'Start with free and open tools.')}</h2><p>{tx(lang,'روابط رسمية، وملاحظات واضحة حول الترخيص والحدود والتكلفة.', 'Official links with clear notes about licenses, limits, and costs.')}</p></div></div>
    <div className="resource-notice panel"><ShieldCheck size={18}/><p>{tx(lang,'صوت Piper العربي متاح داخل التطبيق بلا مفتاح أو رسوم لمزوّد صوت؛ يُجهّز تلقائيًا عند أول طلب وينزّل نموذج Kareem (نحو 61 MB) على الخادم، ويستخدم المعالج دون GPU. Ollama وWhisper.cpp ليسا مهيئين هنا.','Piper Arabic is available in the app without a voice API key or provider fee. It installs on first use and downloads the Kareem model (about 61 MB) to the server; it runs on CPU without a GPU. Ollama and Whisper.cpp are not configured here.')}</p></div>
    {q.isLoading ? <div className="tools-grid">{[1,2,3].map(n=><SkeletonBlock key={n} className="h-48"/>)}</div> : q.isError ? <StateError lang={lang} retry={()=>q.refetch()}/> : q.data?.length ? <div className="tools-grid">{q.data.map((tool,i)=><article className="tool-card panel" key={`${tool.name}-${i}`}><div className="tool-head"><span className="tool-index">0{i+1}</span><span className="tool-category">{tool.category}</span></div><h3>{tool.name}</h3><p>{tool.pricingNote}</p><div className="tool-foot"><span>{tool.access}</span><a href={tool.officialUrl} target="_blank" rel="noreferrer" className="btn btn-quiet">{tx(lang,'الموقع الرسمي','Official site')}<ArrowLeft size={14}/></a></div></article>)}</div> : <Empty title={tx(lang,'لا توجد أدوات متاحة الآن','No tools available right now')} body={tx(lang,'لم تُرجع الخدمة قائمة أدوات. أعد المحاولة لاحقًا.','The service returned no tools. Check back later.')} />}
  </AppFrame>;
}

function AccountSettingsPage() {
  const { lang } = useApp();
  return <AppFrame title={tx(lang, 'إعدادات الحساب', 'Account settings')} crumb={tx(lang, 'الملف الشخصي والأمان', 'PROFILE & SECURITY')}>
    <div className="page-toolbar">
      <div>
        <span className="eyebrow">{tx(lang, 'حسابك في مشهد', 'YOUR MASHAHED ACCOUNT')}</span>
        <h2>{tx(lang, 'أدر ملفك الشخصي وأمان حسابك.', 'Manage your profile and account security.')}</h2>
        <p>{tx(lang, 'تُدار بيانات الدخول والأمان مباشرةً عبر خدمة تسجيل الدخول الآمنة.', 'Your sign-in details and account security are managed by the secure sign-in service.')}</p>
      </div>
    </div>
    <section className="account-profile-wrap" aria-label={tx(lang, 'الملف الشخصي', 'User profile')}>
      <UserProfile routing="path" path={`${basePath}/settings/account`} />
    </section>
  </AppFrame>;
}
function SettingsRedirect() { return <Redirect to="/settings/providers" />; }
function AdminDashboard() {
  const { lang } = useApp();
  const qc = useQueryClient();
  const access = useGetAdminAccess();
  const isAdmin = access.data?.isAdmin === true;
  const overview = useGetAdminOverview({ query: { enabled: isAdmin, queryKey: getGetAdminOverviewQueryKey() } });
  const users = useListAdminUsers({ query: { enabled: isAdmin, queryKey: getListAdminUsersQueryKey() } });
  const jobs = useListAdminJobs({ query: { enabled: isAdmin, queryKey: getListAdminJobsQueryKey() } });
  const keys = useListAdminProviderKeys({ query: { enabled: isAdmin, queryKey: getListAdminProviderKeysQueryKey() } });
  const updateUser = useUpdateAdminUser();
  const [search, setSearch] = useState('');
  const [jobFilter, setJobFilter] = useState('all');
  const [confirmation, setConfirmation] = useState<{ user: AdminUser; update: AdminUserUpdate; action: string } | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const t = (ar: string, en: string) => tx(lang, ar, en);
  const date = (value: string | null) => value
    ? new Date(value).toLocaleString(lang === 'ar' ? 'ar' : 'en', { dateStyle: 'medium', timeStyle: 'short' })
    : t('لم يسجل بعد', 'Not recorded');
  const refresh = () => {
    void access.refetch();
    void overview.refetch();
    void users.refetch();
    void jobs.refetch();
    void keys.refetch();
  };
  const submitUserUpdate = () => {
    if (!confirmation) return;
    updateUser.mutate({ userId: confirmation.user.id, data: confirmation.update }, {
      onSuccess: () => {
        setFeedback({ kind: 'success', text: t('تم تحديث الحساب بنجاح.', 'Account updated successfully.') });
        setConfirmation(null);
        void qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
      },
      onError: () => {
        setFeedback({ kind: 'error', text: t('تعذر تحديث الحساب. حاول مرة أخرى.', 'Could not update this account. Try again.') });
      },
    });
  };
  const queryFailed = overview.isError || users.isError || jobs.isError || keys.isError;
  const filteredUsers = (users.data ?? []).filter(user => `${user.displayName ?? ''} ${user.email ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const filteredJobs = (jobs.data ?? []).filter(job => jobFilter === 'all' || job.status === jobFilter);
  const statItems = [
    { label: t('الحسابات', 'Accounts'), value: overview.data?.userCount, icon: Users, note: t('إجمالي المستخدمين', 'Total studio users') },
    { label: t('المشاريع', 'Projects'), value: overview.data?.projectCount, icon: Clapperboard, note: `${overview.data?.sceneCount ?? '—'} ${t('مشهدًا', 'scenes')}` },
    { label: t('المهام في الانتظار', 'Queued jobs'), value: overview.data?.queuedJobs, icon: Clock3, note: `${overview.data?.jobCount ?? '—'} ${t('مهمة إجمالًا', 'jobs total')}` },
    { label: t('المهام الفاشلة', 'Failed jobs'), value: overview.data?.failedJobs, icon: AlertTriangle, note: t('تحتاج إلى مراجعة', 'Require attention') },
  ];

  return <AppFrame title={t('إدارة الاستوديو', 'Studio administration')} crumb={t('مساحة المالك', 'OWNER WORKSPACE')}>
    {access.isLoading ? <div className="admin-loading"><SkeletonBlock className="h-28" /><SkeletonBlock className="h-48" /><SkeletonBlock className="h-64" /></div>
      : access.isError ? <StateError lang={lang} retry={() => void access.refetch()} />
      : !isAdmin ? <section className="admin-denied panel" data-testid="status-admin-denied"><div className="admin-denied-mark"><Shield size={22}/></div><span className="eyebrow">{t('الوصول مقيّد', 'RESTRICTED AREA')}</span><h2>{t('هذه المساحة للمسؤولين فقط.', 'This workspace is for administrators only.')}</h2><p>{t('لم يتم عرض أي بيانات إدارية. إذا كنت تعتقد أن هذا خطأ، تواصل مع مالك الاستوديو.', 'No administrative data was loaded. If you believe this is a mistake, contact the studio owner.')}</p></section>
      : <div className="admin-page">
        <div className="admin-intro">
          <div><span className="eyebrow"><span className="signal-dot" />{t('مركز المراقبة', 'STUDIO CONTROL ROOM')}</span><h2>{t('كل شيء في مكانه.', 'A clear view of the studio.')}</h2><p>{t('راقب الوصول، استقرار الخدمات، وسير المعالجة من لوحة واحدة.', 'Monitor access, provider health, and processing reliability from one place.')}</p></div>
          <button className="btn btn-quiet admin-refresh" onClick={refresh} disabled={overview.isFetching || users.isFetching || jobs.isFetching || keys.isFetching} data-testid="button-admin-refresh"><RefreshCw size={15} className={(overview.isFetching || users.isFetching || jobs.isFetching || keys.isFetching) ? 'animate-spin' : ''}/>{t('تحديث البيانات', 'Refresh data')}</button>
        </div>
        {feedback && <div className={`admin-feedback ${feedback.kind}`} role="status" data-testid="status-admin-feedback"><span>{feedback.kind === 'success' ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}</span><p>{feedback.text}</p><button className="btn btn-ghost !p-1" onClick={() => setFeedback(null)} aria-label={t('إغلاق','Dismiss')}><X size={15}/></button></div>}
        {queryFailed && <div className="admin-query-error" role="alert"><AlertTriangle size={16}/><span>{t('تعذر تحميل جزء من بيانات الإدارة.', 'Some administration data could not be loaded.')}</span><button className="text-link" onClick={refresh}>{t('إعادة المحاولة', 'Retry')}</button></div>}

        <div className="admin-stats">
          {statItems.map(({ label, value, icon: Icon, note }) => <article className="admin-stat panel" key={label} data-testid={`admin-stat-${label}`}><div className="admin-stat-icon"><Icon size={17}/></div><span className="eyebrow">{label}</span>{overview.isLoading ? <SkeletonBlock className="h-8 w-20 mt-3"/> : overview.isError ? <strong className="admin-stat-unavailable">—</strong> : <strong>{value ?? 0}</strong>}<small>{note}</small></article>)}
        </div>

        <section className="admin-section" id="provider-health">
          <div className="admin-section-head"><div><span className="eyebrow">{t('استقرار الخدمات', 'SERVICE RELIABILITY')}</span><h3>{t('صحة مفاتيح المزودين', 'Provider health')}</h3><p>{t('بيانات وصفية فقط؛ لا تُعرض مفاتيح أو بيانات اعتماد محفوظة.', 'Metadata only. Saved credentials are never displayed.')}</p></div><div className="provider-health-count"><Activity size={16}/><b>{overview.data?.enabledProviderKeys ?? '—'}</b><span>{t('مفتاح مفعّل', 'enabled keys')}</span></div></div>
          <div className="health-summary">
            <div><span className="health-led limited"/><span>{t('تحديد المعدل', 'Rate limited')}</span><b>{overview.data?.rateLimitedKeys ?? '—'}</b></div>
            <div><span className="health-led quota"/><span>{t('حد الحصة', 'Quota limited')}</span><b>{overview.data?.quotaLimitedKeys ?? '—'}</b></div>
            <div><span className="health-led healthy"/><span>{t('مفاتيح مرصودة', 'Keys monitored')}</span><b>{keys.data?.length ?? (keys.isLoading ? '—' : 0)}</b></div>
          </div>
          {keys.isLoading ? <div className="admin-skeleton-list">{[1,2,3].map(n=><SkeletonBlock key={n} className="h-16"/>)}</div>
            : keys.isError ? <div className="admin-inline-error">{t('تعذر تحميل حالة المزودين.', 'Provider status could not be loaded.')}</div>
            : keys.data?.length ? <div className="admin-provider-list">{keys.data.map(key => <article className="admin-provider-row" key={key.id} data-testid={`provider-health-${key.id}`}><div className="provider-avatar">{key.provider.slice(0,2).toUpperCase()}</div><div className="admin-provider-name"><b>{key.label || key.provider}</b><span>{key.provider} · {providerServicePurpose(key.serviceType,lang).label} · {key.userEmail || t('حساب غير متاح','Account unavailable')}</span></div><span className={`key-status ${key.status}`}>{key.status.replaceAll('_',' ')}</span><span className={`admin-enabled ${key.enabled ? 'on' : ''}`}>{key.enabled ? t('مفعّل','Enabled') : t('متوقف','Disabled')}</span><small>{t('آخر اختبار','Last test')}: {date(key.lastTestAt)}</small></article>)}</div>
            : <div className="admin-empty"><KeyRound size={19}/><b>{t('لا توجد مفاتيح مزودين مسجلة.', 'No provider keys are registered.')}</b><span>{t('ستظهر هنا مؤشرات الصحة عند توفرها.', 'Health metadata will appear here when available.')}</span></div>}
        </section>

        <section className="admin-section" id="accounts">
          <div className="admin-section-head admin-users-head"><div><span className="eyebrow">{t('الوصول والحسابات', 'ACCESS & ACCOUNTS')}</span><h3>{t('المستخدمون', 'Users')}</h3><p>{t('إدارة الدور وإمكانية تسجيل الدخول. كل تغيير يتطلب تأكيدًا.', 'Manage roles and sign-in access. Every change requires confirmation.')}</p></div><label className="searchbox admin-search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={t('ابحث بالاسم أو البريد','Search name or email')} aria-label={t('ابحث عن مستخدم','Search users')} data-testid="input-admin-user-search"/></label></div>
          {users.isLoading ? <div className="admin-skeleton-list">{[1,2,3].map(n=><SkeletonBlock key={n} className="h-20"/>)}</div>
            : users.isError ? <div className="admin-inline-error">{t('تعذر تحميل المستخدمين.', 'Users could not be loaded.')}</div>
            : filteredUsers.length ? <div className="admin-user-list">{filteredUsers.map(user => <article className={`admin-user-row ${user.banned ? 'is-banned' : ''}`} key={user.id} data-testid={`admin-user-${user.id}`}><div className="admin-user-avatar">{(user.displayName || user.email || '?').slice(0,1).toLocaleUpperCase()}</div><div className="admin-user-main"><div className="admin-user-title"><b>{user.displayName || t('اسم غير متاح','Name unavailable')}</b><span className={`admin-role ${user.role}`}>{user.role === 'admin' ? t('مسؤول','Admin') : t('عضو','Member')}</span>{user.banned && <span className="admin-banned">{t('محظور','Blocked')}</span>}</div><span>{user.email || t('بريد غير متاح','Email unavailable')}</span><small>{t('آخر دخول','Last sign-in')}: {date(user.lastSignInAt)}</small></div><div className="admin-user-metrics"><span><b>{user.projectCount}</b>{t('مشروع','projects')}</span><span><b>{user.jobCount}</b>{t('مهمة','jobs')}</span><span><b>{user.providerKeyCount}</b>{t('مفتاح','keys')}</span></div><div className="admin-user-actions"><button className="btn btn-quiet" disabled={updateUser.isPending} onClick={()=>{setFeedback(null);setConfirmation({ user, update:{ role:user.role === 'admin' ? 'member' : 'admin' }, action:user.role === 'admin' ? t('إزالة صلاحية المسؤول','remove administrator access') : t('ترقية الحساب إلى مسؤول','grant administrator access') });}} data-testid={`button-role-${user.id}`}>{user.role === 'admin' ? t('إزالة المسؤول','Remove admin') : t('ترقية','Make admin')}</button><button className={`btn ${user.banned ? 'btn-quiet' : 'btn-danger'}`} disabled={updateUser.isPending} onClick={()=>{setFeedback(null);setConfirmation({ user, update:{ banned:!user.banned }, action:user.banned ? t('استعادة إمكانية الدخول','restore sign-in access') : t('حظر تسجيل الدخول','block sign-in access') });}} data-testid={`button-block-${user.id}`}>{user.banned ? <CheckCircle2 size={14}/> : <Ban size={14}/>} {user.banned ? t('رفع الحظر','Unblock') : t('حظر','Block')}</button></div></article>)}</div>
            : <div className="admin-empty"><CircleUserRound size={20}/><b>{search ? t('لا توجد نتائج مطابقة.', 'No matching accounts.') : t('لا يوجد مستخدمون بعد.', 'No users yet.')}</b><span>{search ? t('جرّب اسمًا أو بريدًا آخر.', 'Try another name or email.') : t('ستظهر الحسابات هنا عند إنشائها.', 'Accounts will appear here when created.')}</span></div>}
        </section>

        <section className="admin-section" id="jobs">
          <div className="admin-section-head admin-jobs-head"><div><span className="eyebrow">{t('المعالجة', 'PROCESSING')}</span><h3>{t('المهام الأخيرة', 'Recent jobs')}</h3><p>{t('حالة التنفيذ ومؤشرات الخطأ للمراجعة.', 'Execution status and error details for review.')}</p></div><select className="studio-input admin-filter" value={jobFilter} onChange={e=>setJobFilter(e.target.value)} aria-label={t('تصفية المهام','Filter jobs')} data-testid="select-admin-job-filter"><option value="all">{t('كل الحالات','All statuses')}</option><option value="queued">{t('في الانتظار','Queued')}</option><option value="running">{t('قيد التنفيذ','Running')}</option><option value="completed">{t('مكتملة','Completed')}</option><option value="failed">{t('فاشلة','Failed')}</option></select></div>
          {jobs.isLoading ? <div className="admin-skeleton-list">{[1,2,3].map(n=><SkeletonBlock key={n} className="h-24"/>)}</div>
            : jobs.isError ? <div className="admin-inline-error">{t('تعذر تحميل المهام.', 'Jobs could not be loaded.')}</div>
            : filteredJobs.length ? <div className="admin-job-list">{filteredJobs.map(job=><article className="admin-job-row" key={job.id} data-testid={`admin-job-${job.id}`}><div className="admin-job-symbol"><Film size={16}/></div><div className="admin-job-detail"><div className="admin-job-title"><b>{job.projectTitle}</b><span className={`job-state job-${job.status}`}>{job.status}</span></div><span>{job.jobType} · {job.stage} · {job.userEmail || t('حساب غير متاح','Account unavailable')}</span><p>{job.message}</p>{job.error && <p className="admin-job-error"><AlertTriangle size={13}/>{job.error}</p>}</div><div className="admin-job-progress"><div><span>{t('التقدم','Progress')}</span><b>{job.progress}%</b></div><div className="job-progress-track"><span style={{width:`${Math.max(0,Math.min(100,job.progress))}%`}}/></div><small>{t('المحاولات','Attempts')}: {job.attempts} · {date(job.updatedAt)}</small></div></article>)}</div>
            : <div className="admin-empty"><Activity size={20}/><b>{t('لا توجد مهام لهذه الحالة.', 'No jobs in this status.')}</b><span>{t('ستظهر هنا آخر عمليات الإنتاج عند توفرها.', 'Recent production runs will appear here when available.')}</span></div>}
        </section>
        <div className="admin-security-note"><ShieldCheck size={16}/><span>{t('بيانات المفاتيح الحساسة لا تُرسل إلى هذه الواجهة ولا تُخزّن في حالة الصفحة.', 'Credential secrets are never returned to this interface or stored in page state.')}</span></div>
      </div>}
    {confirmation && <div className="modal-backdrop admin-confirm-backdrop" role="presentation"><section className="modal panel admin-confirm" role="dialog" aria-modal="true" aria-labelledby="admin-confirm-title"><div className="modal-head"><div><span className="eyebrow">{t('تأكيد الإجراء','CONFIRM CHANGE')}</span><h2 id="admin-confirm-title">{t('هل تريد المتابعة؟','Proceed with this change?')}</h2><p>{confirmation.user.displayName || confirmation.user.email || confirmation.user.id}</p></div><button className="btn btn-ghost !p-1" onClick={()=>setConfirmation(null)} aria-label={t('إغلاق','Close')}><X size={18}/></button></div><div className="admin-confirm-copy"><AlertTriangle size={18}/><p>{t('سيتم', 'You are about to')} <b>{confirmation.action}</b> {t('لهذا الحساب. سيُحفظ التغيير فور التأكيد.', 'for this account. The change takes effect when confirmed.')}</p></div>{updateUser.isError && <p className="inline-error">{t('فشل التحديث. يمكنك إعادة المحاولة.', 'The update failed. You can try again.')}</p>}<div className="modal-actions"><button className="btn btn-quiet" onClick={()=>setConfirmation(null)} disabled={updateUser.isPending}>{t('إلغاء','Cancel')}</button><button className="btn btn-primary" onClick={submitUserUpdate} disabled={updateUser.isPending} data-testid="button-confirm-admin-change">{updateUser.isPending && <LoaderCircle size={15} className="animate-spin"/>}{updateUser.isPending ? t('جارٍ الحفظ','Saving') : t('تأكيد التغيير','Confirm change')}</button></div></section></div>}
  </AppFrame>;
}
function SignInPage() { return <div className="auth-page"><div className="auth-decoration"><Brand/><span className="eyebrow">YOUR NEXT FRAME</span><h2>من الفكرة<br/>إلى المشهد.</h2><div className="auth-orbit"><Aperture size={46}/></div></div><div className="auth-form"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}/></div></div>; }
function SignUpPage() { return <div className="auth-page"><div className="auth-decoration"><Brand/><span className="eyebrow">MAKE ROOM FOR STORIES</span><h2>قصتك<br/>تبدأ هنا.</h2><div className="auth-orbit"><Aperture size={46}/></div></div><div className="auth-form"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`}/></div></div>; }
function ClerkCacheInvalidator() {
  const { addListener } = useClerk(); const qc=useQueryClient(); const previous=useRef<string|null|undefined>(undefined);
  useEffect(()=>addListener(({user})=>{const id=user?.id??null;if(previous.current!==undefined&&previous.current!==id)qc.clear();previous.current=id}),[addListener,qc]);
  return null;
}
function AppUpdateNotice() {
  const { lang } = useApp();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    let lastCheckedAt = 0;
    let stopped = false;
    const currentAssetSignature = () => {
      const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute('src') || '';
      const style = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href]')?.getAttribute('href') || '';
      return `${script}|${style}`;
    };
    const currentSignature = currentAssetSignature();
    const checkForUpdate = async () => {
      if (stopped || document.visibilityState !== 'visible' || Date.now() - lastCheckedAt < 30_000) return;
      lastCheckedAt = Date.now();
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('__ella_build_check', String(lastCheckedAt));
        const response = await fetch(url.toString(), { cache: 'no-store', headers: { Accept: 'text/html' } });
        if (!response.ok) return;
        const html = await response.text();
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        const script = parsed.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute('src') || '';
        const style = parsed.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href]')?.getAttribute('href') || '';
        if (!stopped && script && `${script}|${style}` !== currentSignature) setUpdateAvailable(true);
      } catch {
        // Updates are checked again on the next resume; a temporary network failure is non-blocking.
      }
    };
    void checkForUpdate();
    const handleVisible = () => { if (document.visibilityState === 'visible') void checkForUpdate(); };
    const interval = window.setInterval(handleVisible, 120_000);
    window.addEventListener('focus', handleVisible);
    document.addEventListener('visibilitychange', handleVisible);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', handleVisible);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  }, []);
  if (!updateAvailable) return null;
  return <aside className="app-update-banner" role="status" aria-live="polite">
    <span><b>{tx(lang, 'تحديث جديد جاهز', 'A new update is ready')}</b><small>{tx(lang, 'حدّث التطبيق لرؤية آخر نسخة. لن نعيد تحميله قبل ضغطك.', 'Refresh to get the latest version. The app will not reload until you choose.')}</small></span>
    <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>{tx(lang, 'تحديث الآن', 'Update now')}</button>
    <button type="button" className="app-update-dismiss" aria-label={tx(lang, 'إغلاق', 'Dismiss')} onClick={() => setUpdateAvailable(false)}>×</button>
  </aside>;
}
function Router() {
  const [location,setLocation]=useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    localization={{signIn:{start:{title:'مرحبًا بعودتك',subtitle:'سجّل الدخول إلى مساحة إنتاجك'}},signUp:{start:{title:'ابدأ مساحة إنتاجك',subtitle:'أنشئ حسابك وابدأ بتحويل أفكارك إلى مشاهد'}}}}
    routerPush={to=>setLocation(stripBase(to))} routerReplace={to=>setLocation(stripBase(to),{replace:true})}>
    <QueryClientProvider client={queryClient}><ThemeLanguageProvider><ClerkCacheInvalidator/><AppUpdateNotice/>
      <Switch>
        <Route path="/" component={HomeRedirect}/>
        <Route path="/sign-in/*?" component={SignInPage}/>
        <Route path="/sign-up/*?" component={SignUpPage}/>
        <Route path="/dashboard" component={Dashboard}/>
        <Route path="/dashboard/overview" component={DashboardOverview}/>
        <Route path="/projects">{() => <Projects/>}</Route>
        <Route path="/projects/:projectId">{params=><ProjectWorkspace projectId={params.projectId}/>}</Route>
        <Route path="/jobs" component={JobsPage}/>
        <Route path="/media" component={MediaPage}/>
        <Route path="/settings/providers" component={ProvidersPage}/>
        <Route path="/settings/tools" component={ToolsPage}/>
        <Route path="/settings/account/*?" component={AccountSettingsPage}/>
        <Route path="/admin" component={AdminDashboard}/>
        <Route path="/settings" component={SettingsRedirect}/>
        <Route component={NotFound}/>
      </Switch>
    </ThemeLanguageProvider></QueryClientProvider>
  </ClerkProvider>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={basePath}><Router/></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>;
}
export default App;
