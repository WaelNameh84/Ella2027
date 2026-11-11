import { type ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
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
import type { Project, ProjectInput, Scene, SceneUpdate, ProviderKey, ProviderSettings, MediaResult, MediaFavorite, StudioJob, CharacterProfile, AdminUser, AdminUserUpdate } from '@workspace/api-client-react';
import { Route, Switch, Link, Redirect, useLocation, Router as WouterRouter } from 'wouter';
import {
  Aperture, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, Clapperboard,
  Clock3, Copy, ExternalLink, Eye, EyeOff, Film, Globe2, Heart, ImagePlus, KeyRound, Languages,
  LoaderCircle, LogOut, Mic, Moon, Pause, Plus, Search, Settings2, ShieldCheck, Sun, Trash2, UserRound, WandSparkles, X,
  Activity, AlertTriangle, Ban, CheckCircle2, CircleUserRound, RefreshCw, Share2, Shield, Users,
} from 'lucide-react';
import NotFound from '@/pages/not-found';
import { ErrorBoundary } from '@/components/error-boundary';
import { FilmTimeline } from '@/components/film-timeline';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

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

function providerSupports(provider: string, service: string) {
  if (service === 'text') return ['openai','gemini','anthropic','groq','openrouter','huggingface','mistral','cerebras','together','sambanova','deepseek','nvidia','cohere'].includes(provider);
  if (service === 'image') return ['openai','stability','replicate','huggingface'].includes(provider);
  if (service === 'video') return ['replicate','fal'].includes(provider);
  if (service === 'voice') return ['elevenlabs','openai','openai-audio'].includes(provider);
  if (service === 'transcription') return ['openai','whisper','huggingface'].includes(provider);
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
  const [dark, setDark] = useState(() => localStorage.getItem('studio-theme') === 'dark');
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

function Dashboard() {
  const { lang } = useApp();
  const q = useGetStudioSummary();
  const summary = q.data;
  const label = tx(lang, 'نظرة عامة', 'Overview');
  const stats = [
    { name: tx(lang, 'كل المشاريع', 'Projects'), value: summary?.projectCount, icon: Clapperboard },
    { name: tx(lang, 'قيد الإنتاج', 'In production'), value: summary?.activeCount, icon: Clock3 },
    { name: tx(lang, 'المشاهد', 'Scenes'), value: summary?.sceneCount, icon: Film },
    { name: tx(lang, 'مفاتيح جاهزة', 'Provider keys'), value: summary?.providerCount, icon: KeyRound },
  ];
  return <AppFrame title={label}><div className="welcome-row"><div><span className="eyebrow">{tx(lang, 'لوحة المخرج', 'DIRECTOR’S DESK')}</span><h2>{tx(lang, 'صباح الإبداع.', 'Good to see you.')}</h2><p>{tx(lang, 'كل ما تحتاجه لمتابعة إنتاجك، في مكان واحد.', 'Your production work, gathered in one clear view.')}</p></div><Link href="/projects" className="btn btn-primary"><Plus size={17} />{tx(lang, 'مشروع جديد', 'New project')}</Link></div>
    {q.isLoading ? <div className="stats-grid">{stats.map((s) => <SkeletonBlock key={s.name} className="h-28" />)}</div> : q.isError ? <StateError lang={lang} retry={() => q.refetch()} /> : <div className="stats-grid">{stats.map(({ name, value, icon: Icon }, i) => <div key={name} className={`stat-card stat-${i}`}><div className="stat-icon"><Icon size={17} /></div><div className="eyebrow">{name}</div><strong>{value ?? 0}</strong><span>{i === 1 ? tx(lang, 'يحتاج متابعة', 'in progress') : tx(lang, 'في مساحة عملك', 'in your workspace')}</span></div>)}</div>}
    <section className="section-block"><div className="section-heading"><div><span className="eyebrow">{tx(lang, 'آخر ما عملت عليه', 'RECENT WORK')}</span><h3>{tx(lang, 'مشاريعك الأخيرة', 'Recent projects')}</h3></div><Link href="/projects" className="text-link">{tx(lang, 'عرض الكل', 'View all')} <ArrowLeft size={14} /></Link></div>
      {q.isLoading ? <div className="project-grid">{[1,2].map(n => <SkeletonBlock key={n} className="h-44" />)}</div> : q.isError ? null : summary?.recentProjects?.length ? <div className="project-grid">{summary.recentProjects.slice(0, 4).map(p => <ProjectCard key={p.id} project={p} />)}</div> : <Empty title={tx(lang, 'مساحة فارغة، وهذا جيد.', 'A blank slate, full of possibility.')} body={tx(lang, 'أنشئ مشروعك الأول وحوّل الفكرة إلى مشاهد.', 'Create your first project and turn a concept into scenes.')} action={<Link href="/projects" className="btn btn-primary"><Plus size={16} />{tx(lang, 'إنشاء مشروع', 'Create a project')}</Link>} />}
    </section>
    <div className="dashboard-footnote"><span className="signal-dot" />{tx(lang, 'لا توجد نتائج تجريبية هنا. ما تراه هو بيانات حسابك الفعلية.', 'No demo data here. Everything shown belongs to your account.')}</div>
  </AppFrame>;
}

function ProjectCard({ project, onDelete }: { project: Project; onDelete?: (id: string) => void }) {
  const { lang } = useApp();
  const date = new Date(project.updatedAt).toLocaleDateString(lang === 'ar' ? 'ar' : 'en', { month: 'short', day: 'numeric' });
  return <article className="project-card panel">
    <Link href={`/projects/${project.id}`} className="project-thumb"><div className="thumb-shape thumb-a" /><div className="thumb-shape thumb-b" /><span>{project.aspectRatio}</span><div className="thumb-count">{String(project.sceneCount).padStart(2,'0')} {tx(lang, 'مشاهد', 'SCENES')}</div></Link>
    <div className="project-card-content"><div className="flex items-start justify-between gap-2"><Link href={`/projects/${project.id}`} className="project-title">{project.title}</Link>{onDelete && <button className="btn btn-ghost !p-1.5 text-muted-foreground" onClick={() => onDelete(project.id)} title={tx(lang,'حذف','Delete')} data-testid={`delete-project-${project.id}`}><Trash2 size={15} /></button>}</div><p>{project.idea}</p><div className="project-meta"><span><i className={`status-dot status-${project.status}`} />{project.status}</span><span>{date}</span></div></div>
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
  gemini: 'https://aistudio.google.com/app/apikey',
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
  stability: 'https://platform.stability.ai/account/keys',
  replicate: 'https://replicate.com/account/api-tokens',
  fal: 'https://fal.ai/dashboard/keys',
  runway: 'https://dev.runwayml.com/',
  elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
  'google-tts': 'https://console.cloud.google.com/apis/credentials',
  'azure-speech': 'https://portal.azure.com/',
  'openai-audio': 'https://platform.openai.com/api-keys',
  whisper: 'https://platform.openai.com/api-keys',
  deepgram: 'https://console.deepgram.com/',
  assemblyai: 'https://www.assemblyai.com/dashboard/signup',
  'google-speech': 'https://console.cloud.google.com/apis/credentials',
  musicgen: 'https://github.com/facebookresearch/audiocraft',
  pexels: 'https://www.pexels.com/api/',
  pixabay: 'https://pixabay.com/api/docs/',
  unsplash: 'https://unsplash.com/developers',
  openverse: 'https://openverse.org/',
};
const projectTemplates = [
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
function buildFreeTemplateScenes(templateId:string,idea:string,lang:Lang,visualStyle:string,durationSeconds:number) {
  const ar=lang==='ar';
  const beats=ar?[
    ['الافتتاح','قدّم المكان أو اللحظة التي تبدأ منها الفكرة.','لقطة تأسيسية واسعة تُظهر عالم القصة وتفاصيله.','كل حكاية تبدأ من تفصيل صغير يستحق أن ننتبه له.'],
    ['السياق','عرّف المشاهد على الشخصية أو الحاجة الأساسية.','لقطة متوسطة لشخصية في بيئتها، بتكوين واضح.','هنا نلتقي بمن تقوده هذه الحكاية.'],
    ['التحدي','أظهر العقبة أو السؤال الذي يحرّك القصة.','لقطة قريبة تكشف توترًا أو قرارًا مهمًا.','لكن الطريق لا يخلو من سؤال أو تحدٍّ.'],
    ['التحوّل','قدّم لحظة اكتشاف أو خطوة إلى الأمام.','حركة كاميرا هادئة نحو لحظة اكتشاف ذات معنى.','تبدأ الأمور بالتغيّر عندما نجرؤ على المحاولة.'],
    ['الخاتمة','اختم بصورة أو فكرة تبقى في الذاكرة.','لقطة ختامية متوازنة تترك مساحة بصرية مريحة.','وهكذا تترك الفكرة أثرها بعد أن تنتهي الحكاية.'],
  ]:[
    ['Opening','Introduce the place or moment where the idea begins.','Wide establishing shot that reveals the story world and its details.','Every story begins with a small detail worth noticing.'],
    ['Context','Introduce the character or the central need.','Medium shot of a character in a clearly defined environment.','Here we meet the person this story follows.'],
    ['Challenge','Show the obstacle or question that drives the story.','Close shot revealing tension or an important decision.','But the path holds a question or a challenge.'],
    ['Turning point','Offer a discovery or a step forward.','Gentle camera move into a meaningful moment of discovery.','Things begin to change when we dare to try.'],
    ['Resolution','End on an image or idea that stays with the viewer.','Balanced closing shot with calm negative space.','And the idea leaves an impression after the story ends.'],
  ];
  const template=projectTemplates.find(item=>item.id===templateId);
  const base=Math.floor(durationSeconds/5),extra=durationSeconds%5;
  return beats.map((beat,index)=>({
    title:beat[0], description:`${beat[1]} ${ar?'فكرة المشروع':'Project idea'}: ${idea.trim()}`,
    imagePrompt:`${visualStyle||template?.visualStyle||'Cinematic'}; ${beat[2]} ${ar?'من دون نص مكتوب داخل الصورة.':'No text or lettering in the image.'} ${idea.trim()}`,
    narration:beat[3], durationSeconds:Math.max(1,base+(index<extra?1:0)),
  }));
}
function ProjectForm({ onClose, initial, onSave, pending, freeMode = true, textProviderReady = false, checkingProvider = false, generationError = false, projectCreated = false, onOpenCreated }: { onClose: () => void; initial?: Partial<ProjectInput>; onSave: (data: ProjectInput, approvePotentialCharges?: boolean, templateId?: string) => void; pending: boolean; freeMode?: boolean; textProviderReady?: boolean; checkingProvider?: boolean; generationError?: boolean; projectCreated?: boolean; onOpenCreated?: () => void }) {
  const { lang } = useApp();
  const [form, setForm] = useState<ProjectInput>({ ...blankProject, ...initial });
  const [template, setTemplate] = useState('');
  const [customLanguage, setCustomLanguage] = useState('');
  const [approvePotentialCharges, setApprovePotentialCharges] = useState(false);
  const selectedTemplate = projectTemplates.find(item => item.id === template);
  const editing = Boolean(initial);
  const update = (key: keyof ProjectInput, val: string | number) => setForm(old => ({ ...old, [key]: val }));
  const submit = () => {
    const idea = form.idea.trim();
    const firstLine = idea.split(/\r?\n/, 1)[0]?.trim() || idea;
    const firstSentence = firstLine.split(/[.!؟?]/, 1)[0]?.trim() || firstLine;
    const title = firstSentence.length > 72 ? `${firstSentence.slice(0, 71).trimEnd()}…` : firstSentence;
    onSave(editing ? { ...form, title: form.title.trim(), idea } : {
      ...form,
      title,
      idea,
      videoType: selectedTemplate?.videoType ?? 'story',
      language: lang === 'ar' ? 'ar' : 'en',
      durationSeconds: selectedTemplate?.durationSeconds ?? 60,
      audience: selectedTemplate ? (lang === 'ar' ? 'الجمهور العام' : selectedTemplate.audience) : (lang === 'ar' ? 'الجمهور العام' : 'General audience'),
      visualStyle: selectedTemplate?.visualStyle ?? (lang === 'ar' ? 'سينمائي' : 'Cinematic'),
      aspectRatio: selectedTemplate?.aspectRatio ?? '16:9',
    }, !editing && !selectedTemplate && approvePotentialCharges, !editing ? selectedTemplate?.id : undefined);
  };
  const canSubmit = editing || (Boolean(form.idea.trim()) && (Boolean(selectedTemplate) || (!freeMode && textProviderReady && approvePotentialCharges)));
  return <Modal onClose={onClose} title={editing ? tx(lang,'تعديل تفاصيل المشروع','Edit project details') : tx(lang, 'فكرتك إلى قصة', 'Turn your idea into a story')} subtitle={editing ? tx(lang, 'عدّل تفاصيل المشروع ومشاهده.', 'Update the project details.') : tx(lang, 'اكتب فكرة قصيرة، وسنؤلف منها القصة والمشاهد.', 'Write a short idea and we’ll turn it into a story and scenes.')}>
    <form onSubmit={e => { e.preventDefault(); submit(); }} className="form-stack">
      {!editing ? <>
        <label><span className="field-label">{tx(lang,'ابدأ بقالب مجاني','Start with a free template')}</span><select className="studio-input" value={template} onChange={e=>{const id=e.target.value;setTemplate(id);const preset=projectTemplates.find(item=>item.id===id);if(preset)setForm(old=>({...old,videoType:preset.videoType,durationSeconds:preset.durationSeconds,aspectRatio:preset.aspectRatio,visualStyle:preset.visualStyle,audience:lang==='ar'?'الجمهور العام':preset.audience}));}}><option value="">{tx(lang,'اختر قالبًا أو استخدم الكتابة بالذكاء الاصطناعي','Choose a template or use AI writing')}</option>{projectTemplates.map(item=><option key={item.id} value={item.id}>{tx(lang,item.ar,item.en)}</option>)}</select></label>
        {freeMode && !selectedTemplate && <div className="service-purpose-hint is-unavailable"><b>{tx(lang,'وضع صفر المصاريف مفعّل','Zero-spend mode is on')}</b><span>{tx(lang,'اختر قالبًا جاهزًا لإنشاء المشاهد دون أي طلب إلى مزوّد خارجي.','Choose a built-in template to create scenes without calling an external provider.')}</span></div>}
        {selectedTemplate && <div className="service-purpose-hint"><b>{tx(lang,'قالب محلي مجاني','Free local storyboard')}</b><span>{tx(lang,'سيُنشئ خمس مشاهد قابلة للتعديل محليًا. أضف صورك أو استخدم مصادر الوسائط العامة.','Creates five editable scenes locally. Add your own images or use public media sources.')}</span></div>}
        <label><span className="field-label">{tx(lang,'فكرتك','Your idea')}</span><textarea required maxLength={1500} rows={5} className="studio-input resize-y" value={form.idea} onChange={e => update('idea',e.target.value)} placeholder={tx(lang,'مثال: طفل يجد رسالة قديمة تقوده إلى سرّ في قريته…','Example: A child finds an old letter that leads to a secret in their village…')} data-testid="input-project-idea" disabled={projectCreated} autoFocus /></label>
        {!selectedTemplate && !freeMode && (checkingProvider ? <Busy text={tx(lang,'جارٍ التحقق من مفتاح الكتابة…','Checking your writing key…')} /> : !textProviderReady ? <div className="service-purpose-hint is-unavailable"><b>{tx(lang,'لا يوجد مفتاح كتابة جاهز','No text-generation key is ready')}</b><span>{tx(lang,'أضف مفتاحًا مفعّلًا لمزوّد نص، ثم ارجع لبدء القصة.','Enable a text provider key, then return to start the story.')}</span><Link href="/settings/providers" className="text-link">{tx(lang,'إعداد مفاتيح الخدمات','Set up provider keys')}<ArrowLeft size={14}/></Link></div> : <label className="checkline charge-consent"><input type="checkbox" checked={approvePotentialCharges} disabled={projectCreated} onChange={e=>setApprovePotentialCharges(e.target.checked)} data-testid="checkbox-story-charge-consent"/>{tx(lang,'أوافق على إرسال الفكرة لمزوّد النص؛ قد تُحتسب رسوم حسب خطتي.','I agree to send this idea to my text provider; charges may apply.')}</label>)}
        {generationError && <div className="inline-error" role="alert">{tx(lang,'تم حفظ الفكرة، لكن تعذّر بدء تأليف القصة. أعد المحاولة أو افتح المشروع.','Your idea was saved, but story generation could not start. Retry or open the project.')}{onOpenCreated && <button type="button" className="text-link mt-2" onClick={onOpenCreated}>{tx(lang,'فتح المشروع','Open project')}<ArrowLeft size={14}/></button>}</div>}
      </> : <>
        <label><span className="field-label">{tx(lang,'عنوان المشروع','Project title')}</span><input required maxLength={160} className="studio-input" value={form.title} onChange={e => update('title',e.target.value)} placeholder={tx(lang,'مثال: ذاكرة البحر','e.g. Memory of the sea')} data-testid="input-project-title" /></label>
        <label><span className="field-label">{tx(lang,'الفكرة','Concept')}</span><textarea required maxLength={12000} rows={3} className="studio-input resize-y" value={form.idea} onChange={e => update('idea',e.target.value)} placeholder={tx(lang,'ما القصة التي تريد روايتها؟','What story do you want to tell?')} data-testid="input-project-idea" /></label>
        <div className="form-two"><label><span className="field-label">{tx(lang,'نوع الفيديو','Format')}</span><select className="studio-input" value={form.videoType} onChange={e => update('videoType',e.target.value)}>{videoTypes.map(([value,ar,en])=><option key={value} value={value}>{tx(lang,ar,en)}</option>)}</select></label><label><span className="field-label">{tx(lang,'اللغة','Language')}</span><select className="studio-input" value={['ar','en','fr','de','sv','es'].includes(form.language)?form.language:'other'} onChange={e => {const value=e.target.value;if(value==='other'){update('language',customLanguage||'other');}else{setCustomLanguage('');update('language',value);}}}><option value="ar">العربية</option><option value="en">English</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="sv">Svenska</option><option value="es">Español</option><option value="other">{tx(lang,'لغة أخرى','Other language')}</option></select></label></div>
        {!['ar','en','fr','de','sv','es'].includes(form.language) && <label><span className="field-label">{tx(lang,'اسم اللغة','Language name')}</span><input required className="studio-input" value={form.language==='other'?customLanguage:form.language} onChange={e=>{setCustomLanguage(e.target.value);update('language',e.target.value);}} placeholder={tx(lang,'مثال: التركية','e.g. Turkish')} /></label>}
        <div className="form-two"><label><span className="field-label">{tx(lang,'المدة بالثواني','Duration in seconds')}</span><input type="number" min="5" max="3600" className="studio-input" value={form.durationSeconds} onChange={e => update('durationSeconds',Number(e.target.value))} /></label><label><span className="field-label">{tx(lang,'نسبة الأبعاد','Aspect ratio')}</span><select className="studio-input" value={form.aspectRatio} onChange={e => update('aspectRatio',e.target.value)}><option>16:9</option><option>9:16</option><option>1:1</option><option>4:5</option><option>4:3</option><option>3:2</option></select></label></div>
        <div className="form-two"><label><span className="field-label">{tx(lang,'الجمهور','Audience')}</span><input className="studio-input" value={form.audience} onChange={e => update('audience',e.target.value)} /></label><label><span className="field-label">{tx(lang,'الأسلوب البصري','Visual style')}</span><select className="studio-input" value={visualStyles.some(([value])=>value===form.visualStyle)?form.visualStyle:'custom'} onChange={e=>{if(e.target.value!=='custom')update('visualStyle',e.target.value);else if(visualStyles.some(([value])=>value===form.visualStyle))update('visualStyle','');}}><option value="custom">{tx(lang,'أسلوب مخصص','Custom style')}</option>{visualStyles.map(([value,ar])=><option key={value} value={value}>{lang==='ar'?ar:value}</option>)}</select>{!visualStyles.some(([value])=>value===form.visualStyle)&&<input className="studio-input mt-2" value={form.visualStyle} onChange={e=>update('visualStyle',e.target.value)} placeholder={tx(lang,'اكتب أسلوبك الخاص','Describe your own style')} />}</label></div>
      </>}
      <div className="modal-actions"><button type="button" className="btn btn-quiet" onClick={onClose}>{tx(lang,'إلغاء','Cancel')}</button><button disabled={pending || !canSubmit} className="btn btn-primary" data-testid="button-create-project">{pending ? <LoaderCircle className="animate-spin" size={16}/> : editing ? <Check size={16}/> : <WandSparkles size={16}/ >}{editing ? tx(lang,'حفظ التعديلات','Save changes') : pending ? projectCreated ? tx(lang,'جارٍ بدء كتابة القصة…','Starting story generation…') : tx(lang,'جارٍ إنشاء المشروع…','Creating project…') : selectedTemplate ? tx(lang,'إنشاء مشاهد القالب','Create template scenes') : generationError ? tx(lang,'إعادة محاولة التأليف','Retry story generation') : tx(lang,'اكتب القصة','Write the story')}</button></div>
    </form>
  </Modal>;
}
function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" className="modal panel"><div className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="btn btn-ghost !p-2" onClick={onClose} aria-label="Close"><X size={18}/></button></div>{children}</section></div>;
}

function Projects() {
  const { lang } = useApp();
  const [, setLocation] = useLocation();
  const q = useListProjects();
  const keysQuery = useListProviderKeys();
  const settingsQuery = useGetProviderSettings();
  const qc = useQueryClient();
  const create = useCreateProject();
  const createScene = useCreateScene();
  const generate = useQueueProjectScript();
  const remove = useDeleteProject();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const list = useMemo(() => (q.data || []).filter(p => `${p.title} ${p.idea}`.toLowerCase().includes(search.toLowerCase())), [q.data, search]);
  const textProviderReady = Boolean(keysQuery.data?.some(key => key.serviceType === 'text' && providerSupports(key.provider, 'text') && key.enabled && (key.status === 'valid' || key.status === 'untested')));
  const freeMode = settingsQuery.data?.freeMode ?? true;
  const afterChange = () => { qc.invalidateQueries({ queryKey: getListProjectsQueryKey() }); qc.invalidateQueries({ queryKey: getGetStudioSummaryQueryKey() }); };
  const startStory = (projectId: string) => generate.mutate({ projectId, data: { providerKeyId: null, allowRotation: true, approvePotentialCharges: true } }, {
    onSuccess: () => {
      afterChange();
      setOpen(false);
      setCreatedProjectId(null);
      setLocation(`/projects/${projectId}`);
    },
  });
  const saveProjectAndWriteStory = (data: ProjectInput, approvePotentialCharges = false, templateId?: string) => {
    if (createdProjectId) {
      startStory(createdProjectId);
      return;
    }
    create.mutate({ data }, { onSuccess: project => {
      afterChange();
      if (templateId) {
        const seeds = buildFreeTemplateScenes(templateId, data.idea, lang, data.visualStyle, data.durationSeconds);
        void (async () => {
          try {
            for (const [index, seed] of seeds.entries()) await createScene.mutateAsync({ projectId: project.id, data: { ...seed, sortOrder: index } });
            afterChange();
            setOpen(false);
            setLocation(`/projects/${project.id}`);
          } catch {
            setOpen(false);
            setLocation(`/projects/${project.id}`);
          }
        })();
        return;
      }
      setCreatedProjectId(project.id);
      if (approvePotentialCharges) startStory(project.id);
    } });
  };
  return <AppFrame title={tx(lang,'المشاريع','Projects')}><div className="page-toolbar"><div><span className="eyebrow">{tx(lang,'أرشيف الإنتاج','PRODUCTION ARCHIVE')}</span><h2>{tx(lang,'كل القصص التي بدأت.', 'Every story you started.')}</h2><p>{tx(lang,'مشاريعك وسيناريوهاتك محفوظة في مكان واحد.', 'Your projects and storyboards, kept in one place.')}</p></div><button onClick={() => setOpen(true)} className="btn btn-primary" data-testid="button-new-project"><Plus size={17}/>{tx(lang,'مشروع جديد','New project')}</button></div>
    <div className="list-controls"><label className="searchbox"><Search size={17}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder={tx(lang,'ابحث في مشاريعك','Search projects')} data-testid="input-project-search" /></label><span className="result-count">{q.data?.length ?? '—'} {tx(lang,'مشروع','projects')}</span></div>
    {q.isLoading ? <div className="project-grid">{[1,2,3].map(n=><SkeletonBlock key={n} className="h-52" />)}</div> : q.isError ? <StateError lang={lang} retry={() => q.refetch()} /> : list.length ? <div className="project-grid">{list.map(p=><ProjectCard key={p.id} project={p} onDelete={id => { if (window.confirm(tx(lang,'هل تريد حذف المشروع وكل مشاهده؟','Delete this project and all its scenes?'))) remove.mutate({projectId:id},{onSuccess:()=>{afterChange();qc.invalidateQueries({queryKey:getGetProjectQueryKey(id)});}}); }} />)}</div> : <Empty title={search ? tx(lang,'لا توجد مطابقة','No matching projects') : tx(lang,'ابدأ بمشهد أول','Start with a first frame')} body={search ? tx(lang,'جرّب كلمات بحث أخرى.','Try another search term.') : tx(lang,'أنشئ مشروعًا ليصبح لديك مكان لصياغة الفكرة وبناء المشاهد.','Create a project to shape the idea and build your scenes.')} action={!search && <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16}/>{tx(lang,'إنشاء أول مشروع','Create your first project')}</button>} />}
    {open && <ProjectForm onClose={() => { setOpen(false); setCreatedProjectId(null); }} pending={create.isPending || generate.isPending || createScene.isPending} freeMode={freeMode} textProviderReady={textProviderReady} checkingProvider={keysQuery.isLoading} generationError={generate.isError && Boolean(createdProjectId)} projectCreated={Boolean(createdProjectId)} onOpenCreated={createdProjectId ? () => { setOpen(false); setCreatedProjectId(null); setLocation(`/projects/${createdProjectId}`); } : undefined} onSave={saveProjectAndWriteStory} />}
  </AppFrame>;
}

function buildExportPreflight(scenes:Scene[],targetDuration:number,includeSubtitles:boolean,lang:Lang) {
  const errors:string[]=[];const warnings:string[]=[];
  const isValidLink=(value:string)=>{try{const parsed=new URL(value,window.location.origin);return (parsed.protocol==='https:'||parsed.origin===window.location.origin)&&!parsed.username&&!parsed.password;}catch{return false}};
  if(!scenes.length)errors.push(tx(lang,'أضف مشهدًا واحدًا على الأقل.','Add at least one scene.'));
  const totalSceneDuration=scenes.reduce((sum,scene)=>sum+scene.durationSeconds,0);
  if(targetDuration>0&&totalSceneDuration>targetDuration)warnings.push(tx(lang,`مجموع مدد المشاهد ${formatTime(totalSceneDuration)} يتجاوز الهدف ${formatTime(targetDuration)}.`,`Scene duration ${formatTime(totalSceneDuration)} exceeds the target ${formatTime(targetDuration)}.`));
  scenes.forEach((scene,index)=>{
    const label=tx(lang,`المشهد ${index+1}`,`Scene ${index+1}`);
    if(!scene.title.trim())warnings.push(`${label}: ${tx(lang,'أدخل عنوانًا لتسهيل التعرف عليه.','Add a title to make it easier to identify.')}`);
    if(!Number.isInteger(scene.durationSeconds)||scene.durationSeconds<1||scene.durationSeconds>600)errors.push(`${label}: ${tx(lang,'المدة يجب أن تكون بين 1 و600 ثانية.','Duration must be from 1 to 600 seconds.')}`);
    if(!scene.assetUrl||!['image','video'].includes(scene.assetType||''))errors.push(`${label}: ${tx(lang,'أرفق صورة أو فيديو.','Attach an image or video.')}`);
    else if(!isValidLink(scene.assetUrl))errors.push(`${label}: ${tx(lang,'رابط الصورة/الفيديو غير صالح.','The image/video URL is invalid.')}`);
    if(scene.voiceUrl&&!isValidLink(scene.voiceUrl))errors.push(`${label}: ${tx(lang,'رابط الصوت غير صالح.','The audio URL is invalid.')}`);
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

function ProjectWorkspace({ projectId }: { projectId: string }) {
  const { lang } = useApp();
  const projectQuery = useGetProject(projectId);
  const keysQuery = useListProviderKeys();
  const settingsQuery = useGetProviderSettings();
  const qc = useQueryClient();
  const projectJobsQuery = useListStudioJobs({ projectId }, { query: { queryKey: getListStudioJobsQueryKey({ projectId }), refetchInterval: query => query.state.data?.some(job => job.status === 'queued' || job.status === 'running') ? 1500 : false } });
  const createScene = useCreateScene(), updateScene = useUpdateScene(), deleteScene = useDeleteScene(), generate = useQueueProjectScript(), updateProject = useUpdateProject(), exportProject = useQueueProjectExport();
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
  const textProviderReady=Boolean(keysQuery.data?.some(key=>key.serviceType==='text'&&providerSupports(key.provider,'text')&&key.enabled&&(key.status==='valid'||key.status==='untested')));
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
  return <AppFrame title={project.title} crumb={tx(lang,'استوديو المشروع','PROJECT STUDIO')}>
    <div className="workspace-head"><div><Link href="/projects" className="back-link"><ArrowRight size={15}/>{tx(lang,'كل المشاريع','All projects')}</Link><h2>{project.title}</h2><p>{project.idea}</p></div><div className="workspace-actions"><Link href={`/media?projectId=${projectId}${activeScene ? `&sceneId=${activeScene.id}` : ''}`} className="btn btn-quiet"><ImagePlus size={16}/>{tx(lang,'إضافة وسائط','Add media')}</Link><button className="btn btn-quiet" onClick={()=>setEditProjectOpen(true)}><Settings2 size={16}/>{tx(lang,'تفاصيل','Details')}</button></div></div>
    <div className="editor-grid">
      <section className="editor-main">
        <div className="preview-panel panel"><div className="preview-top"><span className="eyebrow">{tx(lang,'معاينة المشهد','SCENE PREVIEW')}</span><span className="small-mono">{activeScene ? `${String(activeScene.sortOrder+1).padStart(2,'0')} / ${String(scenes.length).padStart(2,'0')}` : '00 / 00'}</span></div>
          <div className={`preview-stage ratio-${project.aspectRatio.replace(':','-')}`} style={{aspectRatio:project.aspectRatio.replace(':',' / ')}}>{activeScene?.assetUrl ? activeScene.assetType==='video' ? <video ref={previewVideo} src={activeScene.assetUrl} controls playsInline className="h-full w-full object-contain" onPlay={()=>setPreviewPlaying(true)} onPause={()=>setPreviewPlaying(false)} /> : activeScene.assetType==='audio' ? <div className="stage-empty"><Languages size={26}/><p>{tx(lang,'ملف صوتي للمشهد','Scene audio asset')}</p><audio src={activeScene.assetUrl} controls /></div> : <img src={activeScene.assetUrl} alt={activeScene.title} /> : <div className="stage-empty"><div className="stage-cross"><span/><span/></div><Film size={26}/><p>{tx(lang,'أضف صورة أو فيديو للمشهد','Add an image or video to this scene')}</p>{activeScene && <Link className="text-link" href={`/media?projectId=${projectId}&sceneId=${activeScene.id}`}>{tx(lang,'استكشف الوسائط المرخّصة','Browse licensed media')}</Link>}</div>}<span className="stage-ratio">{project.aspectRatio}</span></div>
          <div className="preview-controls"><button className="play-button" aria-label={previewPlaying?tx(lang,'إيقاف المعاينة','Pause preview'):tx(lang,'تشغيل المعاينة','Play preview')} disabled={activeScene?.assetType!=='video'} onClick={()=>{const player=previewVideo.current;if(!player)return;if(player.paused)void player.play();else player.pause()}}>{previewPlaying?<Pause size={12}/>:<span />}</button><span className="small-mono">{tx(lang,'المشهد','Scene')} {activeScene?String(activeScene.sortOrder+1).padStart(2,'0'):'—'} / {String(scenes.length).padStart(2,'0')} · {formatTime(duration)}</span><div className="control-spacer"/><span className="eyebrow">{scenes.length} {tx(lang,'مشاهد','SCENES')}</span></div>
        </div>
        <div className="timeline-panel panel"><div className="section-heading !mb-4"><div><span className="eyebrow">{tx(lang,'خط الإنتاج','EDIT TIMELINE')}</span><h3>{tx(lang,'ترتيب المشاهد','Scene sequence')}</h3></div><button className="btn btn-quiet" onClick={()=>createScene.mutate({projectId,data:{sortOrder:scenes.length,title:tx(lang,`مشهد ${scenes.length+1}`,`Scene ${scenes.length+1}`),description:'',imagePrompt:'',narration:'',durationSeconds:6,assetUrl:null,assetType:null}},{onSuccess:s=>{refresh();setSelected(s.id)}})} disabled={createScene.isPending}><Plus size={16}/>{tx(lang,'إضافة مشهد','Add scene')}</button></div>
           {scenes.length === 0 ? <div className="timeline-empty"><span className="timeline-empty-line"/><span>{tx(lang,'لم تُنشأ مشاهد بعد','No scenes yet')}</span><button className="text-link" onClick={()=>createScene.mutate({projectId,data:{sortOrder:0,title:tx(lang,'المشهد الأول','Scene one'),description:'',imagePrompt:'',narration:'',durationSeconds:6}},{onSuccess:s=>{refresh();setSelected(s.id)}})}>{tx(lang,'أضف أول مشهد','Add the first scene')}</button></div> : <FilmTimeline scenes={scenes} selectedId={activeScene?.id ?? null} musicUrl={project.musicUrl} lang={lang} onSelect={setSelected} onReorder={(source,target)=>void reorderDrop(source,target)} />}
        </div>
          {freeMode && scenes.length===0 && <div className="script-bar panel"><div className="script-symbol"><ShieldCheck size={18}/></div><div className="script-copy"><b>{tx(lang,'أنشئ Storyboard بلا تكلفة','Create a no-cost storyboard')}</b><p>{tx(lang,'اختر قالبًا محليًا لإضافة خمس مشاهد قابلة للتحرير دون استدعاء مزوّد.','Choose a local template to add five editable scenes without calling a provider.')}</p><div className="flex flex-wrap gap-2 mt-3">{projectTemplates.slice(0,5).map(item=><button key={item.id} className="btn btn-quiet" disabled={createScene.isPending} onClick={()=>{const seeds=buildFreeTemplateScenes(item.id,project.idea,lang,project.visualStyle,project.durationSeconds);void (async()=>{for(const [index,seed] of seeds.entries())await createScene.mutateAsync({projectId,data:{...seed,sortOrder:index}});refresh();})();}}>{tx(lang,item.ar,item.en)}</button>)}</div></div></div>}
         {scenes.length ? <div className="script-bar panel" role="status" data-testid="story-scenes-ready"><div className="script-symbol"><Check size={18}/></div><div className="script-copy"><b>{tx(lang,'المشاهد موجودة بالفعل','Scenes already exist')}</b><p>{tx(lang,'تابع تعديل المشاهد من الخط الزمني. لا يمكن بدء تأليف جديد فوق مشاهد موجودة.','Continue editing these scenes in the timeline. A new storyboard cannot be generated over existing scenes.')}</p></div></div> : !freeMode && <><div className="script-bar panel"><div className="script-symbol"><WandSparkles size={18}/></div><div className="script-copy"><b>{tx(lang,'حوّل الفكرة إلى سيناريو','Turn the idea into a storyboard')}</b><p>{textProviderReady ? tx(lang,'أنشئ مسودة مشاهد باستخدام مزوّد نص مضبوط.','Generate a scene draft using a configured text provider.') : tx(lang,'لا يوجد مفتاح نص جاهز؛ أضف مفتاحًا صالحًا قبل التوليد.','No available text provider. Add an enabled key before generating.')}</p><label className="checkline charge-consent"><input type="checkbox" checked={chargeApproved} onChange={e=>setChargeApproved(e.target.checked)}/>{tx(lang,'أوافق على احتمال احتساب رسوم من المزوّد الأساسي أو الاحتياطي.','I approve possible charges from the primary or fallback provider.')}</label><div className="form-two mt-3"><label><span className="field-label">{tx(lang,'عدد المشاهد','Number of scenes')}</span><input className="studio-input" type="number" min="1" max="24" value={scriptSettings.sceneCount} onChange={e=>setScriptSettings(v=>({...v,sceneCount:Math.max(1,Math.min(24,Number(e.target.value)||1))}))} /></label><label><span className="field-label">{tx(lang,'مدة كل مشهد (ثانية)','Seconds per scene')}</span><input className="studio-input" type="number" min="1" max="600" value={scriptSettings.sceneDurationSeconds} onChange={e=>setScriptSettings(v=>({...v,sceneDurationSeconds:Math.max(1,Math.min(600,Number(e.target.value)||1))}))} /></label><label><span className="field-label">{tx(lang,'أسلوب المشاهد','Scene style')}</span><select className="studio-input" value={scriptSettings.sceneStyle} onChange={e=>setScriptSettings(v=>({...v,sceneStyle:e.target.value}))}>{visualStyles.map(([value,ar])=><option key={value} value={value}>{tx(lang,ar,value)}</option>)}</select></label></div></div><button disabled={!textProviderReady || generate.isPending || !chargeApproved || Boolean(currentJob?.status === 'running' || currentJob?.status === 'queued')} className="btn btn-primary" onClick={()=>generate.mutate({projectId,data:{providerKeyId:null,allowRotation:true,approvePotentialCharges:chargeApproved,...scriptSettings}},{onSuccess:refresh})} data-testid="button-generate-script">{generate.isPending ? <LoaderCircle size={16} className="animate-spin"/> : <WandSparkles size={16}/ >}{tx(lang,'توليد المشاهد','Generate scenes')}</button></div>
         {generate.isError && <div className="inline-error">{tx(lang,'تعذّر بدء التوليد. تحقق من مفتاح النص أو أعد المحاولة.','Could not start generation. Check your text key or try again.')}</div>}</>}
         {scenes.length > 0 && <BatchVideoGeneration projectId={projectId} scenes={scenes} keys={keysQuery.data || []} lang={lang} freeMode={freeMode} hasActiveJob={Boolean(currentJob && (currentJob.status === 'queued' || currentJob.status === 'running'))} onQueued={refresh}/>}
         {currentJob && <div className="job-progress panel" role="status"><div className="job-progress-head"><div><b>{tx(lang,({script:'توليد السيناريو',export:'تصدير الفيديو',image:'توليد صورة',video:'توليد فيديو',voice:'توليد صوت'})[currentJob.jobType],({script:'Script generation',export:'Video export',image:'Image generation',video:'Video generation',voice:'Voice generation'})[currentJob.jobType])}</b><span className={`job-state job-${currentJob.status}`}>{tx(lang,currentJob.status==='queued'?'في الانتظار':currentJob.status==='running'?'قيد التنفيذ':currentJob.status==='completed'?'مكتملة':'فشلت',currentJob.status)}</span></div><Link href="/jobs" className="text-link">{tx(lang,'عرض المهام','View jobs')}</Link></div>{(currentJob.status==='queued'||currentJob.status==='running')&&<div className="job-progress-track"><span style={{width:`${currentJob.progress}%`}}/></div>}<p>{currentJob.error || currentJob.message}</p>{latestExportJob?.status==='completed'&&<ExportActions projectId={projectId} lang={lang}/>}</div>}
      </section>
      <aside className="scene-inspector panel">
        <div className="inspector-heading"><div><span className="eyebrow">{tx(lang,'محرر اللقطة','SHOT EDITOR')}</span><h3>{activeScene?.title || tx(lang,'اختر مشهدًا','Select a scene')}</h3></div>{activeScene && <div className="flex gap-1"><button className="btn btn-ghost !p-2" onClick={()=>reorder(activeScene,-1)} title={tx(lang,'تحريك للأعلى','Move up')}><ArrowUp size={15}/></button><button className="btn btn-ghost !p-2" onClick={()=>reorder(activeScene,1)} title={tx(lang,'تحريك للأسفل','Move down')}><ArrowDown size={15}/></button><button className="btn btn-ghost !p-2 text-destructive" onClick={()=>{if(window.confirm(tx(lang,'حذف هذا المشهد؟','Delete this scene?')))deleteScene.mutate({projectId,sceneId:activeScene.id},{onSuccess:()=>{setSelected(null);refresh()}})}} title={tx(lang,'حذف','Delete')}><Trash2 size={15}/></button></div>}</div>
         {activeScene ? <><SceneFields key={activeScene.id} scene={activeScene} characters={project.characters||[]} lang={lang} onSave={(field,value)=>updateCurrent(field,value)} pending={updateScene.isPending}/><TranscriptionPanel projectId={projectId} sceneId={activeScene.id} language={project.language} keys={keysQuery.data || []} lang={lang} freeMode={freeMode}/><GenerationPanel projectId={projectId} scene={activeScene} keys={keysQuery.data || []} lang={lang} freeMode={freeMode} onQueued={refresh}/><SceneAssetHistory projectId={projectId} scene={activeScene} lang={lang}/></> : <div className="inspector-blank"><Film size={22}/><span>{tx(lang,'اختر مشهدًا من الخط الزمني أو أنشئ واحدًا.','Select a scene from the timeline or create one.')}</span></div>}
          <div className="inspector-footer"><div className="export-settings"><label><span className="field-label">{tx(lang,'الدقة','Resolution')}</span><select className="studio-input" value={exportSettings.resolution} onChange={e=>setExportSettings(v=>({...v,resolution:Number(e.target.value) as 480|720|1080|2160}))}><option value={480}>480p</option><option value={720}>720p</option><option value={1080}>1080p</option><option value={2160}>4K UHD (3840×2160)</option></select></label><label><span className="field-label">{tx(lang,'معدل الإطارات','Frame rate')}</span><select className="studio-input" value={exportSettings.fps} onChange={e=>setExportSettings(v=>({...v,fps:Number(e.target.value) as 24|25|30|60}))}><option value={24}>24 fps</option><option value={25}>25 fps</option><option value={30}>30 fps</option><option value={60}>60 fps</option></select></label><label><span className="field-label">{tx(lang,'الصيغة','Format')}</span><select className="studio-input" value={exportSettings.format} onChange={e=>setExportSettings(v=>({...v,format:e.target.value as 'mp4'|'webm'}))}><option value="mp4">MP4</option><option value="webm">WebM</option></select></label><label><span className="field-label">{tx(lang,'ترميز الفيديو','Video codec')}</span><select className="studio-input" value={exportSettings.codec} onChange={e=>setExportSettings(v=>({...v,codec:e.target.value as 'h264'|'hevc'}))}><option value="h264">H.264 — {tx(lang,'متوافق مع معظم الهواتف','Most compatible')}</option><option value="hevc" disabled={exportSettings.format!=='mp4'}>HEVC/H.265 — {tx(lang,'حجم أصغر','Smaller file')}</option></select></label></div>{exportSettings.resolution===2160&&<p className="export-quality-note">{tx(lang,'4K UHD فعلي (3840×2160) — قد يستغرق التصدير وقتًا أطول ويحتاج مساحة تخزين أكبر.','True 4K UHD (3840×2160) — export takes longer and needs more storage.')}</p>}<div className="preview-actions"><button onClick={()=>void requestPreview()} className="btn btn-quiet w-full" disabled={previewing||!scenesReadyForExport}><Eye size={16}/>{previewing?tx(lang,'جارٍ تجهيز المعاينة...','Preparing preview...'):tx(lang,'معاينة قبل التصدير','Preview before export')}</button>{previewError&&<span className="inline-error">{previewError}</span>}{previewUrl&&<div className="preview-player"><video controls playsInline preload="metadata" src={previewUrl} aria-label={tx(lang,'معاينة الفيديو مع الصوت','Video preview with audio')}/><small>{tx(lang,'هذه معاينة منخفضة الدقة من نفس مسار الدمج.','This is a low-resolution preview using the same media mix.')}</small></div>}</div><label className="checkline export-subtitles"><input type="checkbox" checked={exportSettings.includeSubtitles} onChange={e=>setExportSettings(v=>({...v,includeSubtitles:e.target.checked}))}/>{tx(lang,'تضمين نص الترجمة لكل مشهد','Include each scene’s subtitle text')}</label><label className="inspector-field"><span className="field-label">{tx(lang,'نمط الترجمة','Subtitle style')}</span><select className="studio-input" disabled={!exportSettings.includeSubtitles} value={exportSettings.subtitleStyle} onChange={e=>setExportSettings(v=>({...v,subtitleStyle:e.target.value as 'classic'|'outline'|'pill'}))}><option value="classic">{tx(lang,'كلاسيكي واضح','Classic')}</option><option value="outline">{tx(lang,'عريض بحد خارجي','Bold outline')}</option><option value="pill">{tx(lang,'خلفية داكنة','Dark pill')}</option></select></label>
    <div className={`resource-notice panel ${exportPreflight.errors.length?'is-unavailable':''}`} role="status"><ShieldCheck size={18}/><div><b>{exportPreflight.errors.length?tx(lang,'الفحص يحتاج إصلاحًا قبل التصدير','Preflight found issues'):tx(lang,'جاهز للتصدير','Ready to export')}</b><p>{tx(lang,`المدة التقريبية ${formatTime(duration)} · فحص الروابط شكلي؛ يتأكد الخادم من نوع الملف عند التصدير.`,`Estimated duration ${formatTime(duration)} · URLs are checked for valid format; the server verifies file type during export.`)}</p>{[...exportPreflight.errors,...exportPreflight.warnings].map((issue,index)=><p key={index} className={index<exportPreflight.errors.length?'text-destructive':''}>{issue}</p>)}</div></div><button onClick={()=>{if(window.confirm(tx(lang,'سيُرسل طلب تصدير إلى قائمة المهام. تابع؟','This queues a video export. Continue?')))exportProject.mutate({projectId,data:exportSettings},{onSuccess:refresh})}} className="btn btn-primary w-full" disabled={exportProject.isPending || !scenesReadyForExport || Boolean(currentJob?.status === 'running' || currentJob?.status === 'queued')} data-testid="button-export"><Clapperboard size={16}/>{exportProject.isPending ? tx(lang,'جارٍ تجهيز التصدير...','Queueing export...') : tx(lang,'تصدير الفيديو','Export video')}</button><p>{!scenesReadyForExport && scenes.length > 0 ? tx(lang,'أضف صورة أو فيديو لكل مشهد قبل تصدير الفيلم.','Add an image or video to every scene before exporting.') : tx(lang,'التصدير بنسبة أبعاد المشروع، مع التعليق الصوتي والموسيقى. قد يستغرق WebM وقتًا أطول.','Exports at the project aspect ratio with narration and music. WebM may take longer.')}</p>{exportProject.isError && <span className="inline-error">{tx(lang,'تعذر بدء التصدير. تحقق من أن كل مشهد يحتوي صورة أو فيديو.','Could not start export. Make sure each scene has an image or video.')}</span>}</div>
      </aside>
    </div>
    <CharacterProfiles projectId={projectId} characters={project.characters || []} onSave={data=>updateProject.mutateAsync({projectId,data}).then(()=>{refresh()})} pending={updateProject.isPending}/>
    <ProjectSoundtrack url={project.musicUrl} volume={project.musicVolume} pending={updateProject.isPending} onSave={data=>updateProject.mutateAsync({projectId,data}).then(()=>{refresh()})}/>
    {updateProject.isError&&<p className="inline-error">{tx(lang,'تعذر حفظ تفاصيل المشروع. لم تُفقد التغييرات؛ أعد المحاولة.','Could not save project details. Your edits remain available; try again.')}</p>}
    {editProjectOpen && <ProjectForm initial={{title:project.title,idea:project.idea,videoType:project.videoType,language:project.language,durationSeconds:project.durationSeconds,audience:project.audience,visualStyle:project.visualStyle,aspectRatio:project.aspectRatio as ProjectInput['aspectRatio']}} onClose={()=>setEditProjectOpen(false)} pending={updateProject.isPending} onSave={data=>updateProject.mutate({projectId,data},{onSuccess:()=>{refresh();setEditProjectOpen(false)}})} />}
  </AppFrame>;
}

function JobsPage() {
  const { lang } = useApp();
  const qc = useQueryClient();
  const jobsQuery = useListStudioJobs(undefined, { query: { queryKey: getListStudioJobsQueryKey(), refetchInterval: query => query.state.data?.some(job => job.status === 'queued' || job.status === 'running') ? 1500 : false } });
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
    {job.error&&<p className="job-error">{job.error}</p>}
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
function SceneFields({ scene, characters, lang, onSave, pending }: { scene: Scene; characters:CharacterProfile[]; lang: Lang; onSave: (field: keyof Scene, value: string | number | string[] | null) => Promise<void>; pending: boolean }) {
  const [form,setForm] = useState({title:scene.title,description:scene.description,imagePrompt:scene.imagePrompt,narration:scene.narration,subtitleText:scene.subtitleText,subtitleStartSeconds:scene.subtitleStartSeconds,subtitleEndSeconds:scene.subtitleEndSeconds,durationSeconds:scene.durationSeconds,shotType:scene.shotType,cameraMovement:scene.cameraMovement,location:scene.location,lighting:scene.lighting,clipStartSeconds:scene.clipStartSeconds,clipEndSeconds:scene.clipEndSeconds,playbackSpeed:scene.playbackSpeed,transition:scene.transition,voiceUrl:scene.voiceUrl||'',voiceVolume:scene.voiceVolume});
  const [characterIds,setCharacterIds]=useState(scene.characterIds);
  const [saveState,setSaveState]=useState<'saved'|'saving'|'error'>('saved');
  const [trimError,setTrimError]=useState(false);
  const [subtitleRangeError,setSubtitleRangeError]=useState(false);
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
  return <div className="inspector-fields"><SceneTemplatePicker lang={lang} onApply={applyTemplate}/>{field('title',tx(lang,'اسم المشهد','Scene title'))}{numberField('durationSeconds',tx(lang,'المدة بالثواني','Duration (seconds)'),1,600)}{field('description',tx(lang,'وصف المشهد','Scene description'),true)}{field('imagePrompt',tx(lang,'موجّه الصورة','Visual prompt'),true)}{field('narration',tx(lang,'التعليق الصوتي','Narration'),true)}
    <label className="inspector-field"><span className="field-label">{tx(lang,'نص الترجمة (مستقل عن التعليق)','Subtitle text (independent from narration)')}</span><textarea className="studio-input" rows={3} value={form.subtitleText??form.narration} onChange={e=>{setForm(v=>({...v,subtitleText:e.target.value}));queueSave('subtitleText',e.target.value)}} onBlur={()=>void flushSave()} data-testid="input-scene-subtitleText"/><button type="button" className="text-link mt-2" onClick={()=>{setForm(v=>({...v,subtitleText:null}));queueSave('subtitleText',null)}}>{tx(lang,'استخدم نص التعليق بدلًا منه','Use narration as the subtitle')}</button></label>
    <div className="form-two">{captionTimeField('subtitleStartSeconds',tx(lang,'بداية الترجمة (ث)','Subtitle start (s)'))}{captionTimeField('subtitleEndSeconds',tx(lang,'نهاية الترجمة (ث) — فارغ = نهاية المشهد','Subtitle end (s) — blank = scene end'))}</div>{subtitleRangeError&&<p className="inline-error" role="alert">{tx(lang,'اجعل نهاية الترجمة بعد بدايتها وضمن مدة المشهد.','Set the subtitle end after its start and within the scene.')}</p>}
    <div className="form-two"><label><span className="field-label">{tx(lang,'نوع اللقطة','Shot type')}</span><select className="studio-input" value={form.shotType} onChange={e=>{setForm(v=>({...v,shotType:e.target.value}));queueSave('shotType',e.target.value)}} onBlur={()=>void flushSave()}><option value="">{tx(lang,'غير محدد','Unspecified')}</option>{['establishing','wide','medium','close-up','extreme-close-up','over-the-shoulder','POV','aerial'].map(x=><option key={x}>{x}</option>)}</select></label><label><span className="field-label">{tx(lang,'حركة الكاميرا','Camera movement')}</span><select className="studio-input" value={form.cameraMovement} onChange={e=>{setForm(v=>({...v,cameraMovement:e.target.value}));queueSave('cameraMovement',e.target.value)}} onBlur={()=>void flushSave()}><option value="">{tx(lang,'ثابتة','Static')}</option>{['pan','tilt','dolly-in','dolly-out','tracking','handheld','crane','orbit','zoom'].map(x=><option key={x}>{x}</option>)}</select></label></div>
    {field('location',tx(lang,'الموقع','Location'))}{field('lighting',tx(lang,'الإضاءة','Lighting'))}
    {characters.length>0&&<fieldset className="character-assign"><legend className="field-label">{tx(lang,'الشخصيات في المشهد','Characters in scene')}</legend><div>{characters.map(c=><label className="checkline" key={c.id}><input type="checkbox" checked={characterIds.includes(c.id)} onChange={e=>{const next=e.target.checked?[...characterIds,c.id]:characterIds.filter(id=>id!==c.id);setCharacterIds(next);queueSave('characterIds',next)}}/>{c.name||tx(lang,'شخصية بلا اسم','Unnamed character')}</label>)}</div></fieldset>}
    <div className="form-two">{numberField('clipStartSeconds',tx(lang,'بداية المقطع','Clip in (s)'),0)}{numberField('clipEndSeconds',tx(lang,'نهاية المقطع','Clip out (s)'),0)}{numberField('playbackSpeed',tx(lang,'سرعة التشغيل','Playback speed'),.25,4,.05)}<label className="inspector-field"><span className="field-label">{tx(lang,'مستوى التعليق الصوتي','Voice volume')} · {form.voiceVolume}%</span><input type="range" min="0" max="100" value={form.voiceVolume} onChange={e=>{const value=Number(e.target.value);setForm(v=>({...v,voiceVolume:value}));queueSave('voiceVolume',value)}} onBlur={()=>void flushSave()} aria-label={tx(lang,'مستوى التعليق الصوتي','Voice volume')} /></label></div>{trimError&&<p className="inline-error" role="alert">{tx(lang,'استخدم أرقامًا صحيحة بالثواني، واجعل نهاية المقطع بعد بدايته.','Use whole seconds and set clip out after clip in.')}</p>}
    <label className="inspector-field"><span className="field-label">{tx(lang,'الانتقال','Transition')}</span><select className="studio-input" value={form.transition||'cut'} onChange={e=>{setForm(v=>({...v,transition:e.target.value}));queueSave('transition',e.target.value)}} onBlur={()=>void flushSave()}><option value="cut">{tx(lang,'قطع مباشر','Cut')}</option><option value="fade">{tx(lang,'تلاشي','Fade')}</option><option value="dissolve">{tx(lang,'تداخل','Dissolve')}</option><option value="wipe">{tx(lang,'مسح جانبي','Wipe')}</option><option value="slide">{tx(lang,'انزلاق','Slide')}</option></select></label>{field('voiceUrl',tx(lang,'رابط التعليق الصوتي','Voice asset URL'))}{scene.voiceUrl&&<audio className="audio-preview" src={scene.voiceUrl} controls aria-label={tx(lang,'معاينة التعليق الصوتي','Voice narration preview')}/>}
    <div className={`save-state ${saveState==='error'?'text-destructive':''}`}>{pending||saveState==='saving' ? <Busy text={tx(lang,'جارٍ الحفظ','Saving')} /> : saveState==='error' ? <><span>{tx(lang,'تعذر الحفظ تلقائيًا.','Auto-save failed.')}</span><button className="text-link" onClick={()=>void flushSave()}>{tx(lang,'أعد المحاولة','Retry')}</button></> : <><span className="signal-dot"/>{tx(lang,'تم الحفظ تلقائيًا','Saved automatically')}</>}</div></div>;
}
function CharacterProfiles({projectId,characters,onSave,pending}:{projectId:string;characters:CharacterProfile[];onSave:(data:{characters:CharacterProfile[]})=>Promise<void>;pending:boolean}) {
  const {lang}=useApp();
  const [draft,setDraft]=useState(characters);
  const [dirty,setDirty]=useState(false);
  const [saveError,setSaveError]=useState(false);
  const editVersion=useRef(0);
  const saveHandler=useRef(onSave);
  useEffect(()=>{saveHandler.current=onSave},[onSave]);
  useEffect(()=>{if(!dirty)setDraft(characters)},[characters,dirty]);
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
  return <section className="character-section panel"><div className="section-heading"><div><span className="eyebrow">{tx(lang,'استمرارية الشخصيات','CAST CONTINUITY')}</span><h3>{tx(lang,'ملفات الشخصيات','Character profiles')}</h3></div><button className="btn btn-quiet" onClick={add}><Plus size={15}/>{tx(lang,'إضافة شخصية','Add character')}</button></div>
    {!draft.length?<div className="character-empty">{tx(lang,'لا توجد ملفات شخصيات. أضف وصفًا مرجعيًا للحفاظ على اتساق المظهر والصوت بين المشاهد.','No character profiles yet. Add visual and voice references to keep scenes consistent.')}</div>:<div className="character-grid">{draft.map((character,index)=><article className="character-card" key={character.id}><div className="character-card-head"><span className="character-index">{String(index+1).padStart(2,'0')}</span><button className="btn btn-ghost !p-2 text-destructive" onClick={()=>remove(character.id)} aria-label={tx(lang,'حذف الشخصية','Remove character')}><Trash2 size={15}/></button></div><label><span className="field-label">{tx(lang,'الاسم','Name')}</span><input className="studio-input" value={character.name} onChange={e=>update(character.id,'name',e.target.value)} /></label><label><span className="field-label">{tx(lang,'الوصف والسمات','Appearance')}</span><textarea rows={2} className="studio-input" value={character.description} onChange={e=>update(character.id,'description',e.target.value)} /></label><label><span className="field-label">{tx(lang,'الملابس','Costume')}</span><input className="studio-input" value={character.costume} onChange={e=>update(character.id,'costume',e.target.value)} /></label><label><span className="field-label">{tx(lang,'وصف الصوت','Voice reference')}</span><input className="studio-input" value={character.voiceDescription} onChange={e=>update(character.id,'voiceDescription',e.target.value)} /></label><label><span className="field-label">{tx(lang,'رابط الصورة المرجعية','Reference image URL')}</span><input className="studio-input" type="url" value={character.referenceImageUrl||''} onChange={e=>update(character.id,'referenceImageUrl',e.target.value)} /></label></article>)}</div>}
    <div className="character-save"><span className={`save-state ${saveError?'text-destructive':''}`}>{saveError?tx(lang,'تعذر الحفظ تلقائيًا؛ أعد المحاولة.','Auto-save failed; retry the save.'):pending?tx(lang,'جارٍ الحفظ...','Saving...'):dirty?tx(lang,'سيتم الحفظ تلقائيًا بعد التوقف عن الكتابة.','Changes auto-save when you stop typing.'):tx(lang,'ملفات الشخصيات محفوظة تلقائيًا.','Character profiles are saved automatically.')}</span><button className="btn btn-primary" disabled={!dirty||pending||draft.some(c=>!c.name.trim())} onClick={()=>void saveDraft().catch(()=>{})}>{pending?<LoaderCircle size={15} className="animate-spin"/>:<Check size={15}/ >}{tx(lang,'حفظ الآن','Save now')}</button></div>
  </section>;
}
function defaultVideoModel(provider:string|undefined,mode:'text'|'image') {
  if(provider==='fal')return mode==='image'?'minimax/h3-max/image-to-video':'minimax/h3-max/text-to-video';
  if(provider==='replicate')return 'minimax/video-01';
  return '';
}
function GenerationPanel({projectId,scene,keys,lang,onQueued,freeMode}:{projectId:string;scene:Scene;keys:ProviderKey[];lang:Lang;onQueued:()=>void;freeMode:boolean}) {
  const imageJob=useQueueSceneImageGeneration(),videoJob=useQueueSceneVideoGeneration(),voiceJob=useQueueSceneVoiceGeneration();
  const [action,setAction]=useState<'image'|'video'|'voice'|null>(null);
  const [providerId,setProviderId]=useState('');
  const [model,setModel]=useState('');
  const [voiceId,setVoiceId]=useState('');
  const [mode,setMode]=useState<'text'|'image'>('image');
  const [approved,setApproved]=useState(false);
  const service=action==='image'?'image':action==='video'?'video':action==='voice'?'voice':null;
  const readyKeys=keys.filter(key=>key.enabled&&key.serviceType===service&&providerSupports(key.provider,service||'')&&(key.status==='valid'||key.status==='untested'));
  const activeKey=readyKeys.find(key=>key.id===providerId)||readyKeys[0];
  const busy=imageJob.isPending||videoJob.isPending||voiceJob.isPending;
  const close=()=>{setAction(null);setApproved(false);setModel('');setVoiceId('')};
  const submit=()=>{
    if(!action||!activeKey||!approved)return;
    const done=()=>{onQueued();close()};
    if(action==='image')imageJob.mutate({projectId,sceneId:scene.id,data:{providerKeyId:activeKey.id,model:model.trim(),outputs:1,resolution:1024,approvePotentialCharges:true}},{onSuccess:done});
    if(action==='video')videoJob.mutate({projectId,sceneId:scene.id,data:{providerKeyId:activeKey.id,model:model.trim(),mode,approvePotentialCharges:true}},{onSuccess:done});
    if(action==='voice')voiceJob.mutate({projectId,sceneId:scene.id,data:{providerKeyId:activeKey.id,voiceId:voiceId.trim(),approvePotentialCharges:true}},{onSuccess:done});
  };
  const modelValid=action==='voice'?voiceId.trim().length>0:model.trim().length>0;
  if(freeMode)return <div className="service-purpose-hint is-unavailable"><b>{tx(lang,'التوليد الخارجي متوقف في وضع صفر المصاريف','External generation is blocked in zero-spend mode')}</b><span>{tx(lang,'استخدم صورك أو مكتبة الوسائط العامة ثم صدّر المشروع محليًا.','Use your own assets or public media catalogs, then export locally.')}</span></div>;
  return <div className="generation-tools"><div className="generation-heading"><span className="eyebrow">{tx(lang,'توليد الأصول','GENERATE ASSETS')}</span><Link href="/settings/providers" className="text-link">{tx(lang,'إعداد المزوّدين','Provider setup')}<ArrowLeft size={13}/></Link></div><div className="generation-buttons">
    {(['image','video','voice'] as const).map(kind=>{const availableKeys=keys.filter(key=>key.enabled&&key.serviceType===kind&&providerSupports(key.provider,kind)&&(key.status==='valid'||key.status==='untested'));const available=availableKeys.length>0;return <button key={kind} className="btn btn-quiet" disabled={!available} onClick={()=>{setAction(kind);setProviderId('');setApproved(false);if(kind==='video'){const nextMode=scene.assetType==='image'?'image':'text';setMode(nextMode);setModel(defaultVideoModel(availableKeys[0]?.provider,nextMode));}}} title={!available?tx(lang,'لا يوجد مفتاح مفعّل لمزوّد موصول بهذه المهمة','No enabled key for a provider currently connected to this task'):undefined}>{kind==='image'?<ImagePlus size={15}/>:kind==='video'?<Film size={15}/>:<Languages size={15}/ >}{tx(lang,kind==='image'?'صورة':kind==='video'?'فيديو':'صوت',kind)}</button>})}
  </div><p className="generation-note">{tx(lang,'المخرجات تظهر هنا بعد اكتمال المهمة؛ لا توجد نتائج تجريبية.','Completed outputs appear here after the job finishes. No sample assets are shown.')}</p>
  {(imageJob.isError||videoJob.isError||voiceJob.isError)&&<p className="inline-error" role="alert">{(videoJob.error instanceof Error&&videoJob.error.message)||(imageJob.error instanceof Error&&imageJob.error.message)||(voiceJob.error instanceof Error&&voiceJob.error.message)||tx(lang,'تعذر إرسال طلب التوليد. تحقّق من المفتاح وإعدادات المزوّد.','Could not queue generation. Check the provider key and settings.')}</p>}
  {action&&<Modal title={tx(lang,'تأكيد طلب التوليد','Confirm generation request')} subtitle={tx(lang,'قد تُحتسب رسوم على هذا الطلب، وقد يجرّب النظام مزوّدًا احتياطيًا آخر عند التعطل أو نفاد الحصة.','This request may incur charges. Automatic failover may also use another configured provider.')} onClose={close}><div className="form-stack">
    {!readyKeys.length?<div className="export-confirm"><ShieldCheck size={17}/>{tx(lang,'لا يوجد مفتاح مفعّل لهذه الخدمة. أضف مفتاحًا صالحًا من إعدادات المزوّدين.','No enabled key is available for this service. Add a working key in provider settings.')}</div>:<>
      {readyKeys.length>1&&<label><span className="field-label">{tx(lang,'مفتاح المزوّد','Provider key')}</span><select className="studio-input" value={activeKey?.id||''} onChange={e=>{setProviderId(e.target.value);const selected=readyKeys.find(key=>key.id===e.target.value);if(action==='video')setModel(defaultVideoModel(selected?.provider,mode));}}>{readyKeys.map(key=><option value={key.id} key={key.id}>{key.label} · {key.provider}</option>)}</select></label>}
      {action!=='voice'&&<label><span className="field-label">{tx(lang,'معرّف النموذج لدى المزوّد','Provider model ID')}</span><input required className="studio-input" value={model} onChange={e=>setModel(e.target.value)} placeholder={action==='image'&&activeKey?.provider==='huggingface'?'black-forest-labs/FLUX.1-schnell':action==='video'&&activeKey?.provider==='fal'?'minimax/h3-max/text-to-video':tx(lang,'أدخل معرّف النموذج المتاح لحسابك','Enter a model ID available to your account')} /></label>}
      {action==='video'&&<><label><span className="field-label">{tx(lang,'مصدر الفيديو','Video input')}</span><select className="studio-input" value={mode} onChange={e=>{const nextMode=e.target.value as 'text'|'image';setMode(nextMode);setModel(defaultVideoModel(activeKey?.provider,nextMode));}}><option value="image">{tx(lang,'من صورة المشهد','Use scene image')}</option><option value="text">{tx(lang,'من النص','Use text prompt')}</option></select></label><p className="generation-note">{tx(lang,'يُملأ معرّف النموذج تلقائيًا حسب المزوّد. مفاتيح الفيديو المستضافة ليست مجانية؛ ستحتاج موافقتك قبل كل طلب.','The model endpoint is filled in for your provider. Hosted video APIs are not free; each request still needs your approval.')}</p></>}
      {action==='voice'&&<label><span className="field-label">{tx(lang,'معرّف الصوت','Voice ID')}</span><input required className="studio-input" value={voiceId} onChange={e=>setVoiceId(e.target.value)} placeholder={tx(lang,'أدخل معرّفًا يقدّمه مزوّدك','Enter a voice ID from your provider')} /></label>}
      <label className="checkline charge-consent"><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/>{tx(lang,'أوافق صراحةً على إرسال الطلب واحتمال احتساب رسوم.','I approve sending this request and any potential provider charges.')}</label>
    </>}
    <div className="modal-actions"><button className="btn btn-quiet" onClick={close}>{tx(lang,'إلغاء','Cancel')}</button><button className="btn btn-primary" disabled={!readyKeys.length||busy||!approved||!modelValid} onClick={submit}>{busy?<LoaderCircle size={15} className="animate-spin"/>:<WandSparkles size={15}/ >}{tx(lang,'إرسال إلى قائمة المهام','Queue generation')}</button></div>
  </div></Modal>}
  </div>;
}

function BatchVideoGeneration({projectId,scenes,keys,lang,hasActiveJob,onQueued,freeMode}:{projectId:string;scenes:Scene[];keys:ProviderKey[];lang:Lang;hasActiveJob:boolean;onQueued:()=>void;freeMode:boolean}) {
  const videoJob=useQueueSceneVideoGeneration();
  const videoKeys=keys.filter(key=>key.enabled&&key.serviceType==='video'&&providerSupports(key.provider,'video')&&(key.status==='valid'||key.status==='untested'));
  const firstVideoProvider=videoKeys[0]?.provider;
  const scenesWithoutVideo=scenes.filter(scene=>scene.assetType!=='video'||!scene.assetUrl);
  const allHaveImages=scenesWithoutVideo.every(scene=>scene.assetType==='image'&&Boolean(scene.assetUrl));
  const [open,setOpen]=useState(false);
  const [providerId,setProviderId]=useState('');
  const [model,setModel]=useState('');
  const [mode,setMode]=useState<'text'|'image'>('text');
  const [approved,setApproved]=useState(false);
  const [queueing,setQueueing]=useState(false);
  const [progress,setProgress]=useState<{queued:number;failed:number;total:number;processed:number}|null>(null);
  const [summary,setSummary]=useState<{queued:number;failed:number;total:number}|null>(null);
  const activeKey=videoKeys.find(key=>key.id===providerId)||videoKeys[0];
  useEffect(()=>{if(!providerId)setModel(defaultVideoModel(firstVideoProvider,mode));},[providerId,firstVideoProvider,mode]);
  const scenesToQueue=mode==='image'?scenesWithoutVideo.filter(scene=>scene.assetType==='image'&&Boolean(scene.assetUrl)):scenesWithoutVideo;
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
  if(freeMode)return <div className="script-bar panel mt-4"><div className="script-symbol"><ShieldCheck size={18}/></div><div className="script-copy"><b>{tx(lang,'الإنفاق محمي','Spending is protected')}</b><p>{tx(lang,'توليد الفيديو الخارجي متوقف. أضف وسائط عامة مجانية أو ملفاتك الخاصة ثم صدّر محليًا.','External video generation is blocked. Use public media or your own files, then export locally.')}</p></div></div>;
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
        <label className="checkline charge-consent"><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)} data-testid="checkbox-batch-video-consent"/>{tx(lang,`أوافق على إرسال ${scenesToQueue.length} طلبات فيديو، وقد تُحتسب رسوم لكل مشهد.`,`I approve ${scenesToQueue.length} video requests; each scene may incur a charge.`)}</label>
        {progress&&<div className="export-confirm" role="status" data-testid="batch-video-progress">{queueing?tx(lang,`جارٍ إرسال الطلب ${progress.processed} من ${progress.total}…`,`Sending request ${progress.processed} of ${progress.total}…`):progress.queued?tx(lang,`أُرسل ${progress.queued} طلبات وتعذّر ${progress.failed}.`,`Queued ${progress.queued}; ${progress.failed} failed.`):tx(lang,'تعذّر إرسال الطلبات. تحقّق من مفتاح الفيديو والنموذج.','Requests could not be queued. Check the video key and model.')}</div>}
        <div className="modal-actions"><button type="button" className="btn btn-quiet" onClick={close} disabled={queueing}>{tx(lang,'إلغاء','Cancel')}</button><button type="button" className="btn btn-primary" disabled={!activeKey||!model.trim()||!approved||!scenesToQueue.length||queueing||hasActiveJob} onClick={()=>void begin()} data-testid="button-submit-batch-video">{queueing?<LoaderCircle size={15} className="animate-spin"/>:<Film size={15}/ >}{queueing?tx(lang,'جارٍ إرسال الطلبات…','Queueing videos…'):tx(lang,'ابدأ توليد الفيديو','Start video generation')}</button></div>
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
  const readyKeys=keys.filter(key=>key.enabled&&key.serviceType==='transcription'&&providerSupports(key.provider,'transcription')&&(key.status==='valid'||key.status==='untested'));
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
function formatTime(seconds:number) { const s=Math.max(0,Math.floor(seconds)); return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }

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
  return <AppFrame title={tx(lang,'مكتبة الوسائط','Media library')} crumb="OPENVERSE SEARCH"><div className="page-toolbar"><div><span className="eyebrow">{tx(lang,'بحث مفتوح الترخيص','OPEN-LICENSED SEARCH')}</span><h2>{tx(lang,'لقطة مناسبة تغيّر كل شيء.', 'The right frame changes everything.')}</h2><p>{tx(lang,'ابحث في نتائج Openverse مع إظهار المصدر والترخيص لكل ملف.', 'Search Openverse and review the source and license for every result.')}</p></div></div>
    <form className="media-search panel" onSubmit={e=>{e.preventDefault();setSearch(term.trim());setPage(1);setAdded(null);}}><div className="searchbox"><Search size={18}/><input value={term} onChange={e=>setTerm(e.target.value)} placeholder={tx(lang,'ابحث عن مشهد، مكان، أو إحساس...','Search a scene, place, or feeling...')} data-testid="input-media-query" /></div><select aria-label={tx(lang,'نوع الوسائط','Media type')} className="studio-input media-type" value={type} onChange={e=>setType(e.target.value as typeof type)}><option value="image">{tx(lang,'صور','Images')}</option><option value="video">{tx(lang,'فيديو','Video')}</option><option value="audio">{tx(lang,'صوت','Audio')}</option></select><select aria-label={tx(lang,'المصدر','Source')} className="studio-input media-type" value={source} onChange={e=>setSource(e.target.value as typeof source)}><option value="openverse">Openverse</option><option value="wikimedia">Wikimedia</option><option value="archive">Internet Archive</option><option value="pexels">Pexels</option><option value="pixabay">Pixabay</option><option value="unsplash">Unsplash</option></select><select aria-label={tx(lang,'الاتجاه','Orientation')} className="studio-input media-type" value={orientation} onChange={e=>setOrientation(e.target.value as typeof orientation)}><option value="">{tx(lang,'كل الاتجاهات','Any orientation')}</option><option value="landscape">{tx(lang,'أفقي','Landscape')}</option><option value="portrait">{tx(lang,'عمودي','Portrait')}</option><option value="square">{tx(lang,'مربع','Square')}</option></select><button className="btn btn-primary" disabled={!term.trim()} data-testid="button-search-media"><Search size={16}/>{tx(lang,'بحث','Search')}</button></form>
    {added && <div className="media-notice"><Check size={16}/>{added}<button onClick={()=>setAdded(null)} className="btn btn-ghost !p-1"><X size={15}/></button></div>}
     {q.isLoading ? <div className="media-results">{[1,2,3,4].map(n=><SkeletonBlock key={n} className="h-64"/>)}</div> : q.isError ? <StateError lang={lang} retry={()=>q.refetch()} /> : q.data ? q.data.results.length ? <><div className="results-label"><span>{q.data.total} {tx(lang,'نتيجة','results')} · {q.data.source}</span><span>{tx(lang,'تحقق من الترخيص قبل الاستخدام','Review license before use')}</span></div><div className="media-results">{q.data.results.map(item=><article className="media-card panel" key={item.id}><a className="media-image" href={item.url} target="_blank" rel="noreferrer">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt={item.title}/> : <div className="media-placeholder"><ImagePlus size={28}/><span>{item.mediaType}</span></div>}<span className="media-type-tag">{item.mediaType}</span></a><div className="media-card-content"><h3>{item.title}</h3>{item.creator && <p className="media-creator">{tx(lang,'بواسطة','by')} {item.creator}</p>}<div className="license-line"><span>{item.source}</span><a href={item.licenseUrl || item.url} target="_blank" rel="noreferrer">{item.license}</a></div><div className="media-card-actions"><button className="btn btn-quiet" onClick={()=>add(item)} disabled={updateScene.isPending||!projectId||!sceneId} data-testid={`button-add-media-${item.id}`}><Plus size={15}/>{tx(lang,'إضافة للمشهد','Attach')}</button><button className={`btn btn-quiet favorite-button ${favoriteFor(item)?'is-favorite':''}`} onClick={()=>toggleFavorite(item)} disabled={createFavorite.isPending||deleteFavorite.isPending} aria-label={favoriteFor(item)?tx(lang,'إزالة من المفضلة','Remove favorite'):tx(lang,'حفظ في المفضلة','Save favorite')} title={favoriteFor(item)?tx(lang,'إزالة من المفضلة','Remove favorite'):tx(lang,'حفظ في المفضلة','Save favorite')}><Heart size={16} fill={favoriteFor(item)?'currentColor':'none'}/></button></div></div></article>)}</div><div className="pager"><button className="btn btn-quiet" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}><ArrowRight size={15}/>{tx(lang,'السابق','Previous')}</button><span>{tx(lang,`صفحة ${page}`,`Page ${page}`)}</span><button className="btn btn-quiet" onClick={()=>setPage(p=>p+1)}>{tx(lang,'التالي','Next')}<ArrowLeft size={15}/></button></div></> : <Empty title={tx(lang,'لم نعثر على نتائج','No results found')} body={tx(lang,'جرّب عبارة بحث مختلفة أو بدّل نوع الوسائط.','Try a different phrase or switch the media type.')} /> : <Empty title={tx(lang,'ابحث عن الوسيط التالي','Find your next asset')} body={tx(lang,'ابحث في المصدر المحدد، ثم راجع الترخيص قبل الاستخدام.','Search the selected source, then review its license before use.')} />}
     <section className="section-block saved-media"><div className="section-heading"><div><span className="eyebrow">{tx(lang,'مجموعتك المحفوظة','YOUR COLLECTION')}</span><h3>{tx(lang,'المفضلة','Favorites')}</h3></div><span className="result-count">{favorites.data?.length ?? 0}</span></div>{favorites.isLoading?<div className="media-results">{[1,2].map(i=><SkeletonBlock key={i} className="h-48"/>)}</div>:favorites.isError?<StateError lang={lang} retry={()=>favorites.refetch()}/>:favorites.data?.length?<div className="media-results">{favorites.data.map(item=><article className="media-card panel" key={item.id}><a className="media-image" href={item.url} target="_blank" rel="noreferrer">{item.thumbnailUrl?<img src={item.thumbnailUrl} alt={item.title}/>:<div className="media-placeholder"><ImagePlus size={26}/><span>{item.mediaType}</span></div>}<span className="media-type-tag">{item.mediaType}</span></a><div className="media-card-content"><h3>{item.title}</h3><div className="license-line"><span>{item.source}</span><a href={item.licenseUrl||item.url} target="_blank" rel="noreferrer">{item.license}</a></div><div className="media-card-actions"><button className="btn btn-quiet" onClick={()=>addSaved(item)} disabled={updateScene.isPending||!projectId||!sceneId}><Plus size={15}/>{tx(lang,'إضافة للمشهد','Attach')}</button><button className="btn btn-quiet favorite-button is-favorite" onClick={()=>deleteFavorite.mutate({favoriteId:item.id},{onSuccess:refreshFavorites})} disabled={deleteFavorite.isPending} aria-label={tx(lang,'إزالة من المفضلة','Remove favorite')}><Heart size={16} fill="currentColor"/></button></div></div></article>)}</div>:<Empty title={tx(lang,'لا توجد عناصر محفوظة','No saved media')} body={tx(lang,'احفظ الأصول المرخّصة من نتائج البحث لتعود إليها هنا.','Save licensed assets from search results to find them here later.')}/>}</section>
  </AppFrame>;
}

function ProvidersPage() {
  const { lang } = useApp();
  const qc = useQueryClient();
  const keys = useListProviderKeys(), settingsQ = useGetProviderSettings();
  const create=useCreateProviderKey(),update=useUpdateProviderKey(),remove=useDeleteProviderKey(),test=useTestProviderKey(),saveSettings=useUpdateProviderSettings();
  const [dialog,setDialog]=useState(false);
  const [editing,setEditing]=useState<ProviderKey|null>(null);
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
  const openAdd=(service:ProviderKey['serviceType'])=>{setEditing(null);setInitialService(service);setDialog(true)};
  const renderProviderRow=(key:ProviderKey)=><ProviderRow key={key.id} item={key}
    onEdit={()=>{setEditing(key);setDialog(true)}}
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
    <div className={`resource-notice panel ${prefs?.freeMode !== false ? 'is-unavailable' : ''}`} role="status"><ShieldCheck size={18}/><p>{prefs?.freeMode !== false ? tx(lang,'وضع صفر المصاريف يعمل: سيمنع الخادم طلبات التوليد والتفريغ واختبار المفاتيح الخارجية. تبقى المشاريع والقوالب والمصادر العامة والمعاينة والتصدير المحلي متاحة. هذا لا يضمن مجانية الاستضافة نفسها.','Zero-spend mode is active: the server blocks external generation, transcription, and key tests. Projects, templates, public media sources, preview, and local export remain available. This does not guarantee hosting is free.') : tx(lang,'وضع صفر المصاريف متوقف؛ أي طلب لمزوّد خارجي قد يستهلك رصيدًا أو يسبب رسومًا.','Zero-spend mode is off; an external provider request may use credits or incur a charge.')}</p></div>
    {keys.isError&&<StateError lang={lang} retry={()=>keys.refetch()} />}
    <div className="provider-category-list grid gap-3">
      {serviceSections.map(section=>{
        const sectionKeys=(keys.data??[]).filter(key=>key.serviceType===section.value);
        return <section className="panel provider-list" key={section.value} data-testid={`provider-section-${section.value}`}>
          <div className="section-heading"><div><span className="eyebrow">{tx(lang,'قسم المفاتيح','KEY CATEGORY')}</span><h3>{section.label}</h3></div><div className="flex items-center gap-3"><span className="result-count">{sectionKeys.length} {tx(lang,'مفاتيح','keys')}</span><button className="btn btn-quiet" onClick={()=>openAdd(section.value)}><Plus size={15}/>{tx(lang,'إضافة لهذا القسم','Add to section')}</button></div></div>
          {keys.isLoading?<div className="provider-rows">{[1,2].map(n=><SkeletonBlock key={n} className="h-20"/>)}</div>
            :sectionKeys.length?<div className="provider-rows">{sectionKeys.map(renderProviderRow)}</div>
            :<p className="provider-purpose-description">{tx(lang,'لا توجد مفاتيح في هذا القسم بعد.','No keys in this section yet.')}</p>}
        </section>;
      })}
    </div>
    <section className="panel rotation-panel"><div className="section-heading"><div><span className="eyebrow">{tx(lang,'التعامل مع التعطّل','FAILOVER BEHAVIOR')}</span><h3>{tx(lang,'تدوير المفاتيح وإعادة المحاولة','Key rotation & retries')}</h3></div><ShieldCheck size={20} className="text-primary"/></div>
      {settingsQ.isLoading ? <SkeletonBlock className="h-48"/> : settingsQ.isError ? <StateError lang={lang} retry={()=>settingsQ.refetch()}/> : prefs && <><div className="rotation-options">{[
        ['freeMode',tx(lang,'وضع صفر المصاريف','Zero-spend mode'),tx(lang,'يمنع الخادم من الاتصال بمزوّدي التوليد أو التفريغ أو اختبار المفاتيح؛ تعطيله يتطلب موافقتك.','Blocks server calls to generation, transcription, and key-test providers; turn off only when you approve possible costs.')],
        ['autoRotate',tx(lang,'التدوير التلقائي','Automatic rotation'),tx(lang,'استخدم المفتاح التالي عند الحاجة.','Move to another key when needed.')],
        ['rotateOnQuota',tx(lang,'عند تجاوز الحصة','On quota limits'),tx(lang,'انتقل لمفتاح آخر عند نفاد الحصة.','Switch when a provider quota is reached.')],
        ['rotateOnRateLimit',tx(lang,'عند تحديد المعدل','On rate limits'),tx(lang,'أعد المحاولة على مفتاح آخر عند تقييد المعدل.','Retry with another key when rate limited.')],
        ['rotateOnConnectionFailure',tx(lang,'عند فشل الاتصال','On connection failures'),tx(lang,'بدّل المزوّد عند تعذّر الاتصال.','Fail over when a provider cannot be reached.')],
      ].map(([field,title,desc])=><label className="rotation-row" key={field}><span><b>{title}</b><small>{desc}</small></span><input aria-label={title} type="checkbox" checked={Boolean(prefs[field as keyof ProviderSettings])} onChange={e=>setPrefs(p=>p?({...p,[field]:e.target.checked}):p)} /></label>)}</div>
      <div className="rotation-advanced"><label><span className="field-label">{tx(lang,'أقصى عدد للمحاولات','Maximum attempts')}</span><input className="studio-input" type="number" min="1" max="10" value={prefs.maxAttempts} onChange={e=>setPrefs({...prefs,maxAttempts:Number(e.target.value)})}/></label><label><span className="field-label">{tx(lang,'تأخير إعادة المحاولة بالثواني','Retry delay (seconds)')}</span><input className="studio-input" type="number" min="0" max="300" value={prefs.retryDelaySeconds} onChange={e=>setPrefs({...prefs,retryDelaySeconds:Number(e.target.value)})}/></label><label><span className="field-label">{tx(lang,'المزوّد الاحتياطي','Fallback provider')}</span><select className="studio-input" value={prefs.fallbackProvider || ''} onChange={e=>setPrefs({...prefs,fallbackProvider:e.target.value||null})}><option value="">{tx(lang,'حسب الأولوية فقط','Use priority order')}</option>{fallbackProviders.map(provider=><option key={provider} value={provider}>{provider}</option>)}</select></label></div>
      <div className="modal-actions"><span className="save-state">{saveSettings.isSuccess && <><Check size={14}/>{tx(lang,'حُفظت الإعدادات','Settings saved')}</>}</span><button className="btn btn-primary" disabled={saveSettings.isPending} onClick={()=>saveSettings.mutate({data:prefs},{onSuccess:()=>qc.invalidateQueries({queryKey:getGetProviderSettingsQueryKey()})})}>{saveSettings.isPending?tx(lang,'جارٍ الحفظ...','Saving...'):tx(lang,'حفظ إعدادات التدوير','Save rotation settings')}</button></div></>}
    </section>
    {dialog && <ProviderForm initial={editing} initialService={initialService} onClose={()=>setDialog(false)} pending={create.isPending||update.isPending} onSave={data=>{if(editing){const {apiKey,...safe}=data;update.mutate({keyId:editing.id,data:{...safe,...(apiKey?{apiKey}:{})}},{onSuccess:()=>{invalidate();setDialog(false)}})}else create.mutate({data},{onSuccess:()=>{invalidate();setDialog(false)}})}} />}
  </AppFrame>;
}
function ProviderRow({item,onEdit,onToggle,onPriority,onTest,onDelete,testing,freeMode,lang}:{item:ProviderKey;onEdit:()=>void;onToggle:(v:boolean)=>void;onPriority:(v:number)=>void;onTest:()=>void;onDelete:()=>void;testing:boolean;freeMode:boolean;lang:Lang}) {
  const officialUrl=providerOfficialUrls[item.provider];
  const testedAt=item.lastTestAt?new Date(item.lastTestAt).toLocaleString(lang==='ar'?'ar':'en') : tx(lang,'لم يُختبر بعد','Not tested yet');
  const purpose=providerServicePurpose(item.serviceType,lang,item.provider);
  const serviceConnected=providerServiceIsConnected(item.provider,item.serviceType);
  return <div className="provider-row">
    <div className="provider-avatar">{item.provider.slice(0,2).toUpperCase()}</div>
    <div className="provider-ident"><b>{item.label}</b><span>{item.provider}</span><span className={`provider-purpose ${serviceConnected?'':'is-unavailable'}`}>{tx(lang,'وظيفته:','Purpose:')} {purpose.label}</span><small className="provider-purpose-description">{purpose.description}</small>{!serviceConnected&&<small className="provider-purpose-warning">{tx(lang,'هذا الاستخدام غير موصول حاليًا لهذا المزوّد.','This task is not currently connected for this provider.')}</small>}</div>
    <span className={`key-status ${item.status}`}>{item.status.replace('_',' ')}</span>
    <label className="priority-control"><span>{tx(lang,'الأولوية','Priority')}</span><input type="number" min="0" value={item.priority} aria-label={tx(lang,'أولوية المفتاح','Key priority')} onChange={e=>onPriority(Number(e.target.value))}/></label>
    <label className="switch-control" title={tx(lang,'مفعّل','Enabled')}><input type="checkbox" checked={item.enabled} onChange={e=>onToggle(e.target.checked)}/><span /></label>
    <div className="provider-actions">
      {officialUrl&&<a className="btn btn-ghost !p-2" title={tx(lang,'الموقع الرسمي للمزوّد','Provider official site')} href={officialUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/></a>}
      <button className="btn btn-ghost !p-2" title={freeMode?tx(lang,'عطّل وضع صفر المصاريف أولًا','Turn off zero-spend mode first'):tx(lang,'اختبار المفتاح','Test key')} onClick={onTest} disabled={testing||freeMode}>{testing?<LoaderCircle size={15} className="animate-spin"/>:<Check size={15}/>}</button>
      <button className="btn btn-ghost !p-2" title={tx(lang,'تعديل','Edit')} onClick={onEdit}><Settings2 size={15}/></button>
      <button className="btn btn-ghost !p-2 text-destructive" title={tx(lang,'حذف','Delete')} onClick={onDelete}><Trash2 size={15}/></button>
    </div>
    <small className="provider-message">{item.testMessage || tx(lang,'لا توجد نتيجة اختبار بعد.','No test result yet.')} · {testedAt} · {tx(lang,`استخدامات مسجلة: ${item.usedCount}`,`Recorded uses: ${item.usedCount}`)}</small>
  </div>;
}
function ProviderForm({initial,initialService,onClose,onSave,pending}:{initial:ProviderKey|null;initialService:ProviderKey['serviceType'];onClose:()=>void;onSave:(data:{provider:string;label:string;apiKey:string;serviceType:'text'|'image'|'video'|'voice'|'transcription'|'music'|'media';enabled:boolean;priority:number})=>void;pending:boolean}) {
  const {lang}=useApp();
  const initialServiceProvider=initialService==='video'?'fal':initialService==='image'?'replicate':initialService==='voice'?'elevenlabs':initialService==='transcription'?'whisper':initialService==='media'?'pexels':initialService==='music'?'musicgen':'huggingface';
  const [provider,setProvider]=useState(initial?.provider||initialServiceProvider),[label,setLabel]=useState(initial?.label||''),[apiKey,setApiKey]=useState(''),[serviceType,setServiceType]=useState<'text'|'image'|'video'|'voice'|'transcription'|'music'|'media'>(initial?.serviceType||initialService||'text'),[enabled,setEnabled]=useState(initial?.enabled??true),[priority,setPriority]=useState(initial?.priority??0);
  const [revealed,setRevealed]=useState(false),[copied,setCopied]=useState(false);
  const providerOptions=[
    ['openai','OpenAI','https://platform.openai.com/api-keys','text'],['gemini','Google Gemini','https://aistudio.google.com/app/apikey','text'],['anthropic','Anthropic Claude','https://console.anthropic.com/settings/keys','text'],['groq','Groq','https://console.groq.com/keys','text'],['openrouter','OpenRouter','https://openrouter.ai/keys','text'],['huggingface','Hugging Face (open models; limits vary)','https://huggingface.co/settings/tokens','text'],['mistral','Mistral','https://console.mistral.ai/api-keys/','text'],['cerebras','Cerebras','https://cloud.cerebras.ai/','text'],['together','Together AI','https://api.together.ai/settings/api-keys','text'],['sambanova','SambaNova','https://cloud.sambanova.ai/','text'],['nvidia',tx(lang,'NVIDIA NIM — مجاني للتجربة','NVIDIA NIM — free prototype tier'),'https://build.nvidia.com/settings','text'],['cohere',tx(lang,'Cohere — مفتاح تجريبي مجاني محدود','Cohere — limited free trial'),'https://dashboard.cohere.com/api-keys','text'],['deepseek','DeepSeek','https://platform.deepseek.com/api_keys','text'],['stability','Stability AI','https://platform.stability.ai/account/keys','image'],['replicate','Replicate','https://replicate.com/account/api-tokens','image'],['fal','fal.ai','https://fal.ai/dashboard/keys','video'],['runway','Runway','https://dev.runwayml.com/','video'],['elevenlabs','ElevenLabs','https://elevenlabs.io/app/settings/api-keys','voice'],['google-tts','Google Cloud Text-to-Speech','https://console.cloud.google.com/apis/credentials','voice'],['azure-speech','Azure Speech','https://portal.azure.com/','voice'],['openai-audio','OpenAI Audio','https://platform.openai.com/api-keys','voice'],['whisper','Whisper','https://platform.openai.com/api-keys','transcription'],['deepgram','Deepgram','https://console.deepgram.com/','transcription'],['assemblyai','AssemblyAI','https://www.assemblyai.com/dashboard/signup','transcription'],['google-speech','Google Speech-to-Text','https://console.cloud.google.com/apis/credentials','transcription'],['musicgen','MusicGen','https://github.com/facebookresearch/audiocraft','music'],['openverse','Openverse (public search; no key required)','https://openverse.org/','media'],['pexels','Pexels','https://www.pexels.com/api/','media'],['pixabay','Pixabay','https://pixabay.com/api/docs/','media'],['unsplash','Unsplash','https://unsplash.com/developers','media'],
  ] as const;
  const currentProvider=providerOptions.find(item=>item[0]===provider);
  const serviceTypes=[
    {value:'text',label:tx(lang,'الكتابة والسيناريو','Writing & scripts')},
    {value:'image',label:tx(lang,'توليد الصور','Image generation')},
    {value:'video',label:tx(lang,'توليد الفيديو','Video generation')},
    {value:'voice',label:tx(lang,'التعليق الصوتي','Voice narration')},
    {value:'transcription',label:tx(lang,'تفريغ الصوت والترجمة','Transcription & translation')},
    {value:'music',label:tx(lang,'الموسيقى','Music')},
    {value:'media',label:tx(lang,'البحث عن الوسائط','Media search')},
  ];
  const purpose=providerServicePurpose(serviceType,lang,provider);
  const serviceConnected=providerServiceIsConnected(provider,serviceType);
  return <Modal title={initial?tx(lang,'تعديل المفتاح','Edit provider key'):tx(lang,'إضافة مفتاح مزوّد','Add provider key')} subtitle={tx(lang,'لن يُعرض المفتاح بعد إرساله إلى الخادم.','The secret will not be displayed after it is sent to the server.')} onClose={onClose}><form className="form-stack" onSubmit={e=>{e.preventDefault();onSave({provider,label,apiKey,serviceType,enabled,priority})}}>
    <label><span className="field-label">{tx(lang,'اسم المزوّد','Provider')}</span><select className="studio-input" value={provider} onChange={e=>{const value=e.target.value;setProvider(value);const selected=providerOptions.find(item=>item[0]===value);if(selected)setServiceType(selected[3]);}}>{providerOptions.map(item=><option key={item[0]} value={item[0]}>{item[1]}</option>)}</select></label>
    {currentProvider && <a className="text-link provider-official-link" href={currentProvider[2]} target="_blank" rel="noopener noreferrer">{tx(lang,'زيارة الموقع الرسمي للحصول على المفتاح','Visit the official site to get a key')}<ExternalLink size={14}/></a>}
    <label><span className="field-label">{tx(lang,'تسمية المفتاح','Key label')}</span><input required className="studio-input" value={label} onChange={e=>setLabel(e.target.value)} placeholder={tx(lang,'مثال: مفتاح الإنتاج','e.g. Production key')} /></label>
    <label><span className="field-label">{tx(lang,'مفتاح API','API key')}</span><div className="secret-input-row"><input required={!initial} type={revealed?'text':'password'} autoComplete="new-password" className="studio-input" value={apiKey} onChange={e=>{setApiKey(e.target.value);setCopied(false);}} placeholder={initial?tx(lang,'اتركه فارغًا للإبقاء على المفتاح الحالي','Leave blank to keep the current key'):'API key'} data-testid="input-provider-secret" />{apiKey && <button type="button" className="btn btn-ghost !p-2" aria-label={revealed?tx(lang,'إخفاء المفتاح','Hide key'):tx(lang,'إظهار المفتاح','Show key')} onClick={()=>setRevealed(v=>!v)}>{revealed?<EyeOff size={16}/>:<Eye size={16}/>}</button>}{apiKey && <button type="button" className="btn btn-ghost !p-2" aria-label={tx(lang,'نسخ المفتاح غير المحفوظ','Copy unsaved key')} onClick={()=>{void navigator.clipboard.writeText(apiKey).then(()=>{setCopied(true);window.setTimeout(()=>setCopied(false),1500);});}}>{copied?<Check size={16}/>:<Copy size={16}/>}</button>}</div></label>
    <div className="form-two"><label><span className="field-label">{tx(lang,'وظيفة المفتاح','Key purpose')}</span><select className="studio-input" value={serviceType} onChange={e=>setServiceType(e.target.value as typeof serviceType)}>{serviceTypes.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label><span className="field-label">{tx(lang,'الأولوية','Priority')}</span><input type="number" min="0" className="studio-input" value={priority} onChange={e=>setPriority(Number(e.target.value))}/></label></div>
    <div className={`service-purpose-hint ${serviceConnected?'':'is-unavailable'}`} aria-live="polite"><b>{tx(lang,'هذا المفتاح مخصّص لـ','This key is for')}: {purpose.label}</b><span>{purpose.description}</span>{!serviceConnected&&<small>{tx(lang,'لن يعمل هذا المفتاح لهذه المهمة حتى يتصل بها المزوّد داخل التطبيق.','This key will not work for this task until the provider is connected in the app.')}</small>}</div>
    <label className="checkline"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>{tx(lang,'تفعيل هذا المفتاح','Enable this key')}</label><div className="modal-actions"><button className="btn btn-quiet" type="button" onClick={onClose}>{tx(lang,'إلغاء','Cancel')}</button><button className="btn btn-primary" disabled={pending}>{pending?<LoaderCircle size={16} className="animate-spin"/>:<KeyRound size={16}/ >}{tx(lang,'حفظ المفتاح','Save key')}</button></div>
  </form></Modal>;
}

function ToolsPage() {
  const {lang}=useApp(); const q=useListFreeTools();
  return <AppFrame title={tx(lang,'موارد مجانية','Free Resources')} crumb="FREE & OPEN-SOURCE RESOURCES"><div className="page-toolbar"><div><span className="eyebrow">{tx(lang,'موارد صناعة الأفلام','FILMMAKING RESOURCES')}</span><h2>{tx(lang,'ابدأ بالأدوات المجانية والمفتوحة.', 'Start with free and open tools.')}</h2><p>{tx(lang,'روابط رسمية، وملاحظات واضحة حول الترخيص والحدود والتكلفة.', 'Official links with clear notes about licenses, limits, and costs.')}</p></div></div>
    <div className="resource-notice panel"><ShieldCheck size={18}/><p>{tx(lang,'لا توجد نماذج Ollama أو Whisper.cpp أو Piper مثبتة على خادم المشروع حالياً، ولا توجد بطاقة GPU ظاهرة. هذه الموارد مجانية كبرمجيات لكنها تحتاج جهازاً أو خادماً مناسباً. لا تشغّل المنصة طلباً مدفوعاً دون موافقتك.','Ollama, Whisper.cpp, and Piper are not installed on this project server, and no GPU is available here. These tools are free software but require suitable compute. The app will not run paid requests without your approval.')}</p></div>
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
function Router() {
  const [location,setLocation]=useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    localization={{signIn:{start:{title:'مرحبًا بعودتك',subtitle:'سجّل الدخول إلى مساحة إنتاجك'}},signUp:{start:{title:'ابدأ مساحة إنتاجك',subtitle:'أنشئ حسابك وابدأ بتحويل أفكارك إلى مشاهد'}}}}
    routerPush={to=>setLocation(stripBase(to))} routerReplace={to=>setLocation(stripBase(to),{replace:true})}>
    <QueryClientProvider client={queryClient}><ThemeLanguageProvider><ClerkCacheInvalidator/>
      <Switch>
        <Route path="/" component={HomeRedirect}/>
        <Route path="/sign-in/*?" component={SignInPage}/>
        <Route path="/sign-up/*?" component={SignUpPage}/>
        <Route path="/dashboard" component={Dashboard}/>
        <Route path="/projects" component={Projects}/>
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
