import { type ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, Show, SignIn, SignUp, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  useCreateProject, useListProjects, getListProjectsQueryKey, useGetStudioSummary,
  getGetStudioSummaryQueryKey, useDeleteProject, useGetProject, getGetProjectQueryKey,
  useUpdateProject, useCreateScene, useUpdateScene, useDeleteScene,
  useGenerateProjectScript, useListProviderKeys, getListProviderKeysQueryKey,
  useCreateProviderKey, useUpdateProviderKey, useDeleteProviderKey, useTestProviderKey,
  useGetProviderSettings, getGetProviderSettingsQueryKey, useUpdateProviderSettings,
  useSearchFreeMedia, getSearchFreeMediaQueryKey, useListFreeTools, getListFreeToolsQueryKey,
  useExportProject,
} from '@workspace/api-client-react';
import type { Project, ProjectInput, Scene, SceneUpdate, ProviderKey, ProviderSettings, MediaResult } from '@workspace/api-client-react';
import { Route, Switch, Link, Redirect, useLocation, Router as WouterRouter } from 'wouter';
import {
  Aperture, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, Clapperboard,
  Clock3, Film, Globe2, ImagePlus, KeyRound, Languages, LoaderCircle, LogOut, Moon,
  Plus, Search, Settings2, ShieldCheck, Sun, Trash2, WandSparkles, X,
} from 'lucide-react';
import NotFound from '@/pages/not-found';
import { ErrorBoundary } from '@/components/error-boundary';
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
  { href: '/media', icon: ImagePlus, ar: 'مكتبة الوسائط', en: 'Media library' },
  { href: '/settings/providers', icon: KeyRound, ar: 'مفاتيح الخدمات', en: 'Provider keys' },
  { href: '/settings/tools', icon: Globe2, ar: 'أدوات مفتوحة', en: 'Open tools' },
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
      <button className="profile-dot" title="Studio account" aria-label="Studio account">م</button>
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
        <h1>{tx(lang, 'اصنع فيلمك،<br/>مشهدًا بعد مشهد.', 'Make your film.<br/>One scene at a time.')}</h1>
        <p>{tx(lang, 'مساحة إنتاج عربية تجمع كتابة السيناريو، ترتيب المشاهد، والوسائط المرخّصة في خط زمني واحد قابل للتحرير.', 'An Arabic-first production desk for turning a concept into a script, a scene-by-scene storyboard, and an editable timeline.')}</p>
        <div className="mt-8 flex flex-wrap gap-3"><Link href="/sign-up" className="btn btn-primary px-5 py-3">{tx(lang, 'ابدأ من فكرتك', 'Start with your idea')}<ArrowLeft size={16} /></Link><Link href="/sign-in" className="btn btn-quiet px-5 py-3">{tx(lang, 'لديك حساب؟', 'Already have an account?')}</Link></div>
        <div className="hero-proof"><span><ShieldCheck size={16} />{tx(lang, 'مشاريعك تبقى ملكك', 'Your projects stay yours')}</span><span><Film size={16} />{tx(lang, 'خط زمني قابل للتحرير', 'An editable timeline')}</span></div>
      </div>
      <div className="hero-art" aria-hidden="true"><div className="hero-art-sun" /><div className="frame-top"><span>SCENE 01 / 06</span><span className="frame-rec">REC</span></div><div className="frame-landscape"><div className="ridge ridge-back" /><div className="ridge ridge-front" /><div className="film-orb" /></div><div className="frame-bottom"><span>00:00:08:12</span><span className="frame-wave"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></span><span>16:9</span></div><div className="hero-stamp">A<br/>V<br/>S</div></div>
    </section>
    <section className="landing-process"><div className="section-intro"><span className="eyebrow">A QUIETER WAY TO MAKE</span><h2>{tx(lang, 'من شرارة أولى<br/>إلى نسخة جاهزة.', 'From the first spark<br/>to a finished cut.')}</h2></div><div className="process-steps"><div><span>01</span><h3>{tx(lang, 'صِف فكرتك', 'Shape the premise')}</h3><p>{tx(lang, 'ابدأ بعنوان، جمهور، ونبرة بصرية واضحة.', 'Set a title, an audience, and a visual direction.')}</p></div><div><span>02</span><h3>{tx(lang, 'رتّب المشاهد', 'Build the storyboard')}</h3><p>{tx(lang, 'حرّر السرد، الصورة، والمدة لكل لقطة.', 'Edit the narration, image, and duration of every scene.')}</p></div><div><span>03</span><h3>{tx(lang, 'صدّر عملك', 'Render your cut')}</h3><p>{tx(lang, 'راجع الخط الزمني ونزّل الملف النهائي.', 'Review the timeline and download the rendered file.')}</p></div></div></section>
    <section className="landing-bottom"><div><span className="eyebrow">{tx(lang, 'ابدأ حين تكون جاهزًا', 'WHEN YOU ARE READY')}</span><h2>{tx(lang, 'كل فيلم يبدأ<br/>بلحظة انتباه.', 'Every film begins<br/>with a moment.')}</h2></div><Link href="/sign-up" className="btn btn-primary">{tx(lang, 'افتح مساحة العمل', 'Open your workspace')}<ArrowLeft size={16} /></Link></section>
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
function ProjectForm({ onClose, initial, onSave, pending }: { onClose: () => void; initial?: Partial<ProjectInput>; onSave: (data: ProjectInput) => void; pending: boolean }) {
  const { lang } = useApp();
  const [form, setForm] = useState<ProjectInput>({ ...blankProject, ...initial });
  const editing = Boolean(initial);
  const update = (key: keyof ProjectInput, val: string | number) => setForm(old => ({ ...old, [key]: val }));
  return <Modal onClose={onClose} title={editing ? tx(lang,'تعديل تفاصيل المشروع','Edit project details') : tx(lang, 'مشروع جديد', 'New project')} subtitle={tx(lang, 'ابدأ بوصف بسيط لما تريد صنعه.', 'Give your next film a starting point.')}>
    <form onSubmit={e => { e.preventDefault(); onSave(form); }} className="form-stack">
      <label><span className="field-label">{tx(lang,'عنوان المشروع','Project title')}</span><input required maxLength={160} className="studio-input" value={form.title} onChange={e => update('title',e.target.value)} placeholder={tx(lang,'مثال: ذاكرة البحر','e.g. Memory of the sea')} data-testid="input-project-title" /></label>
      <label><span className="field-label">{tx(lang,'الفكرة','Concept')}</span><textarea required maxLength={12000} rows={3} className="studio-input resize-y" value={form.idea} onChange={e => update('idea',e.target.value)} placeholder={tx(lang,'ما القصة التي تريد روايتها؟','What story do you want to tell?')} data-testid="input-project-idea" /></label>
      <div className="form-two"><label><span className="field-label">{tx(lang,'نوع الفيديو','Format')}</span><select className="studio-input" value={form.videoType} onChange={e => update('videoType',e.target.value)}><option value="documentary">{tx(lang,'وثائقي','Documentary')}</option><option value="short">{tx(lang,'فيلم قصير','Short film')}</option><option value="social">{tx(lang,'محتوى اجتماعي','Social video')}</option><option value="explainer">{tx(lang,'شرح وتفسير','Explainer')}</option><option value="ad">{tx(lang,'إعلان','Advertisement')}</option></select></label><label><span className="field-label">{tx(lang,'اللغة','Language')}</span><select className="studio-input" value={form.language} onChange={e => update('language',e.target.value)}><option value="ar">العربية</option><option value="en">English</option></select></label></div>
      <div className="form-two"><label><span className="field-label">{tx(lang,'المدة بالثواني','Duration in seconds')}</span><input type="number" min="5" max="3600" className="studio-input" value={form.durationSeconds} onChange={e => update('durationSeconds',Number(e.target.value))} /></label><label><span className="field-label">{tx(lang,'نسبة الأبعاد','Aspect ratio')}</span><select className="studio-input" value={form.aspectRatio} onChange={e => update('aspectRatio',e.target.value)}><option>16:9</option><option>9:16</option><option>1:1</option></select></label></div>
      <div className="form-two"><label><span className="field-label">{tx(lang,'الجمهور','Audience')}</span><input className="studio-input" value={form.audience} onChange={e => update('audience',e.target.value)} /></label><label><span className="field-label">{tx(lang,'الأسلوب البصري','Visual style')}</span><input className="studio-input" value={form.visualStyle} onChange={e => update('visualStyle',e.target.value)} /></label></div>
      <div className="modal-actions"><button type="button" className="btn btn-quiet" onClick={onClose}>{tx(lang,'إلغاء','Cancel')}</button><button disabled={pending} className="btn btn-primary" data-testid="button-create-project">{pending ? <LoaderCircle className="animate-spin" size={16}/> : editing ? <Check size={16}/> : <Plus size={16}/ >}{editing ? tx(lang,'حفظ التعديلات','Save changes') : tx(lang,'إنشاء المشروع','Create project')}</button></div>
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
  const qc = useQueryClient();
  const create = useCreateProject();
  const remove = useDeleteProject();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const list = useMemo(() => (q.data || []).filter(p => `${p.title} ${p.idea}`.toLowerCase().includes(search.toLowerCase())), [q.data, search]);
  const afterChange = () => { qc.invalidateQueries({ queryKey: getListProjectsQueryKey() }); qc.invalidateQueries({ queryKey: getGetStudioSummaryQueryKey() }); };
  return <AppFrame title={tx(lang,'المشاريع','Projects')}><div className="page-toolbar"><div><span className="eyebrow">{tx(lang,'أرشيف الإنتاج','PRODUCTION ARCHIVE')}</span><h2>{tx(lang,'كل القصص التي بدأت.', 'Every story you started.')}</h2><p>{tx(lang,'مشاريعك وسيناريوهاتك محفوظة في مكان واحد.', 'Your projects and storyboards, kept in one place.')}</p></div><button onClick={() => setOpen(true)} className="btn btn-primary" data-testid="button-new-project"><Plus size={17}/>{tx(lang,'مشروع جديد','New project')}</button></div>
    <div className="list-controls"><label className="searchbox"><Search size={17}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder={tx(lang,'ابحث في مشاريعك','Search projects')} data-testid="input-project-search" /></label><span className="result-count">{q.data?.length ?? '—'} {tx(lang,'مشروع','projects')}</span></div>
    {q.isLoading ? <div className="project-grid">{[1,2,3].map(n=><SkeletonBlock key={n} className="h-52" />)}</div> : q.isError ? <StateError lang={lang} retry={() => q.refetch()} /> : list.length ? <div className="project-grid">{list.map(p=><ProjectCard key={p.id} project={p} onDelete={id => { if (window.confirm(tx(lang,'هل تريد حذف المشروع وكل مشاهده؟','Delete this project and all its scenes?'))) remove.mutate({projectId:id},{onSuccess:()=>{afterChange();qc.invalidateQueries({queryKey:getGetProjectQueryKey(id)});}}); }} />)}</div> : <Empty title={search ? tx(lang,'لا توجد مطابقة','No matching projects') : tx(lang,'ابدأ بمشهد أول','Start with a first frame')} body={search ? tx(lang,'جرّب كلمات بحث أخرى.','Try another search term.') : tx(lang,'أنشئ مشروعًا ليصبح لديك مكان لصياغة الفكرة وبناء المشاهد.','Create a project to shape the idea and build your scenes.')} action={!search && <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16}/>{tx(lang,'إنشاء أول مشروع','Create your first project')}</button>} />}
    {open && <ProjectForm onClose={() => setOpen(false)} pending={create.isPending} onSave={data => create.mutate({data},{onSuccess: p => { afterChange(); setOpen(false); setLocation(`/projects/${p.id}`); }})} />}
  </AppFrame>;
}

function ProjectWorkspace({ projectId }: { projectId: string }) {
  const { lang } = useApp();
  const projectQuery = useGetProject(projectId);
  const keysQuery = useListProviderKeys();
  const qc = useQueryClient();
  const createScene = useCreateScene(), updateScene = useUpdateScene(), deleteScene = useDeleteScene(), generate = useGenerateProjectScript(), updateProject = useUpdateProject(), exportProject = useExportProject();
  const project = projectQuery.data;
  const [selected, setSelected] = useState<string | null>(null);
  const [exportInfo, setExportInfo] = useState('');
  const [editProjectOpen, setEditProjectOpen] = useState(false);
  useEffect(() => { if (project?.scenes?.length && !selected) setSelected(project.scenes[0].id); }, [project, selected]);
  const scenes = [...(project?.scenes || [])].sort((a,b) => a.sortOrder-b.sortOrder);
  const activeScene = scenes.find(s => s.id === selected) || scenes[0];
  const refresh = () => { qc.invalidateQueries({queryKey:getGetProjectQueryKey(projectId)}); qc.invalidateQueries({queryKey:getListProjectsQueryKey()}); qc.invalidateQueries({queryKey:getGetStudioSummaryQueryKey()}); };
  const duration = scenes.reduce((sum,s)=>sum+s.durationSeconds,0);
  if (projectQuery.isLoading) return <AppFrame title={tx(lang,'تحميل المشروع','Loading project')}><div className="workspace-skeleton"><SkeletonBlock className="h-20"/><SkeletonBlock className="h-72"/><SkeletonBlock className="h-48"/></div></AppFrame>;
  if (projectQuery.isError || !project) return <AppFrame title={tx(lang,'المشروع','Project')}><StateError lang={lang} retry={()=>projectQuery.refetch()} /></AppFrame>;
  const updateCurrent = (field: keyof Scene, value: string | number) => {
    if (!activeScene) return;
    updateScene.mutate({projectId,sceneId:activeScene.id,data:{[field]:value} as SceneUpdate},{onSuccess:refresh});
  };
  const reorder = (scene: Scene, step: number) => {
    const target = scenes.find(s=>s.sortOrder===scene.sortOrder+step) || scenes[scenes.indexOf(scene)+step];
    if (!target) return;
    const temporaryOrder = Math.max(...scenes.map(s=>s.sortOrder),0)+1;
    updateScene.mutate({projectId,sceneId:scene.id,data:{sortOrder:temporaryOrder}},{onSuccess:()=>updateScene.mutate({projectId,sceneId:target.id,data:{sortOrder:scene.sortOrder}},{onSuccess:()=>updateScene.mutate({projectId,sceneId:scene.id,data:{sortOrder:target.sortOrder}},{onSuccess:refresh})})});
  };
  return <AppFrame title={project.title} crumb={tx(lang,'استوديو المشروع','PROJECT STUDIO')}>
    <div className="workspace-head"><div><Link href="/projects" className="back-link"><ArrowRight size={15}/>{tx(lang,'كل المشاريع','All projects')}</Link><h2>{project.title}</h2><p>{project.idea}</p></div><div className="workspace-actions"><Link href={`/media?projectId=${projectId}${activeScene ? `&sceneId=${activeScene.id}` : ''}`} className="btn btn-quiet"><ImagePlus size={16}/>{tx(lang,'إضافة وسائط','Add media')}</Link><button className="btn btn-quiet" onClick={()=>setEditProjectOpen(true)}><Settings2 size={16}/>{tx(lang,'تفاصيل','Details')}</button></div></div>
    <div className="editor-grid">
      <section className="editor-main">
        <div className="preview-panel panel"><div className="preview-top"><span className="eyebrow">{tx(lang,'معاينة المشهد','SCENE PREVIEW')}</span><span className="small-mono">{activeScene ? `${String(activeScene.sortOrder+1).padStart(2,'0')} / ${String(scenes.length).padStart(2,'0')}` : '00 / 00'}</span></div>
          <div className={`preview-stage ratio-${project.aspectRatio.replace(':','-')}`}>{activeScene?.assetUrl ? <img src={activeScene.assetUrl} alt={activeScene.title} /> : <div className="stage-empty"><div className="stage-cross"><span/><span/></div><Film size={26}/><p>{tx(lang,'أضف صورة أو فيديو للمشهد','Add an image or video to this scene')}</p>{activeScene && <Link className="text-link" href={`/media?projectId=${projectId}&sceneId=${activeScene.id}`}>{tx(lang,'استكشف الوسائط المرخّصة','Browse licensed media')}</Link>}</div>}<span className="stage-ratio">{project.aspectRatio}</span></div>
          <div className="preview-controls"><button className="play-button" aria-label="Preview timeline"><span /></button><span className="small-mono">00:00 / {formatTime(duration)}</span><div className="control-spacer"/><span className="eyebrow">{scenes.length} {tx(lang,'مشاهد','SCENES')}</span></div>
        </div>
        <div className="timeline-panel panel"><div className="section-heading !mb-4"><div><span className="eyebrow">{tx(lang,'خط الإنتاج','EDIT TIMELINE')}</span><h3>{tx(lang,'ترتيب المشاهد','Scene sequence')}</h3></div><button className="btn btn-quiet" onClick={()=>createScene.mutate({projectId,data:{sortOrder:scenes.length,title:tx(lang,`مشهد ${scenes.length+1}`,`Scene ${scenes.length+1}`),description:'',imagePrompt:'',narration:'',durationSeconds:6,assetUrl:null,assetType:null}},{onSuccess:s=>{refresh();setSelected(s.id)}})} disabled={createScene.isPending}><Plus size={16}/>{tx(lang,'إضافة مشهد','Add scene')}</button></div>
          {scenes.length === 0 ? <div className="timeline-empty"><span className="timeline-empty-line"/><span>{tx(lang,'لم تُنشأ مشاهد بعد','No scenes yet')}</span><button className="text-link" onClick={()=>createScene.mutate({projectId,data:{sortOrder:0,title:tx(lang,'المشهد الأول','Scene one'),description:'',imagePrompt:'',narration:'',durationSeconds:6}},{onSuccess:s=>{refresh();setSelected(s.id)}})}>{tx(lang,'أضف أول مشهد','Add the first scene')}</button></div> : <div className="timeline-track">{scenes.map((s,i)=><button key={s.id} className={`timeline-scene ${activeScene?.id===s.id?'selected':''}`} onClick={()=>setSelected(s.id)} data-testid={`timeline-scene-${s.id}`}><span className="timeline-number">{String(i+1).padStart(2,'0')}</span><span className="timeline-preview">{s.assetUrl ? <img src={s.assetUrl} alt="" /> : <span className="mini-landscape"><i/><b/></span>}</span><span className="timeline-title">{s.title}</span><span className="timeline-duration">{s.durationSeconds}s</span></button>)}</div>}
          {scenes.length > 0 && <div className="timeline-ruler"><span>00:00</span><span>{formatTime(duration / 2)}</span><span>{formatTime(duration)}</span></div>}
        </div>
        <div className="script-bar panel"><div className="script-symbol"><WandSparkles size={18}/></div><div><b>{tx(lang,'حوّل الفكرة إلى سيناريو','Turn the idea into a storyboard')}</b><p>{keysQuery.data?.length ? tx(lang,'أنشئ مسودة مشاهد باستخدام مزوّد مضبوط.','Generate a scene draft using a configured provider.') : tx(lang,'لا يوجد مفتاح خدمة بعد؛ أضف مفتاحًا قبل توليد السيناريو.','No provider key is configured. Add one before generating a script.')}</p></div><button disabled={!keysQuery.data?.length || generate.isPending} className="btn btn-primary" onClick={()=>generate.mutate({projectId,data:{providerKeyId:null,allowRotation:true}},{onSuccess:refresh})} data-testid="button-generate-script">{generate.isPending ? <LoaderCircle size={16} className="animate-spin"/> : <WandSparkles size={16}/ >}{tx(lang,'توليد المشاهد','Generate scenes')}</button></div>
        {generate.isError && <div className="inline-error">{tx(lang,'لم ينجح التوليد. تحقق من مفاتيح الخدمة وإعدادات التدوير.','Generation failed. Check your provider keys and rotation settings.')}</div>}
        {exportInfo && <div className="export-confirm"><Check size={16}/><span>{exportInfo}</span><a className="btn btn-primary" href={`${basePath}/api/projects/${projectId}/export/file`} download>{tx(lang,'تنزيل الملف','Download file')}<ArrowDown size={15}/></a></div>}
      </section>
      <aside className="scene-inspector panel">
        <div className="inspector-heading"><div><span className="eyebrow">{tx(lang,'محرر اللقطة','SHOT EDITOR')}</span><h3>{activeScene?.title || tx(lang,'اختر مشهدًا','Select a scene')}</h3></div>{activeScene && <div className="flex gap-1"><button className="btn btn-ghost !p-2" onClick={()=>reorder(activeScene,-1)} title={tx(lang,'تحريك للأعلى','Move up')}><ArrowUp size={15}/></button><button className="btn btn-ghost !p-2" onClick={()=>reorder(activeScene,1)} title={tx(lang,'تحريك للأسفل','Move down')}><ArrowDown size={15}/></button><button className="btn btn-ghost !p-2 text-destructive" onClick={()=>{if(window.confirm(tx(lang,'حذف هذا المشهد؟','Delete this scene?')))deleteScene.mutate({projectId,sceneId:activeScene.id},{onSuccess:()=>{setSelected(null);refresh()}})}} title={tx(lang,'حذف','Delete')}><Trash2 size={15}/></button></div>}</div>
        {activeScene ? <SceneFields key={activeScene.id} scene={activeScene} lang={lang} onSave={(field,value)=>updateCurrent(field,value)} pending={updateScene.isPending}/> : <div className="inspector-blank"><Film size={22}/><span>{tx(lang,'اختر مشهدًا من الخط الزمني أو أنشئ واحدًا.','Select a scene from the timeline or create one.')}</span></div>}
        <div className="inspector-footer"><button onClick={()=>exportProject.mutate({projectId,data:{resolution:1080,fps:30,includeSubtitles:true}},{onSuccess:r=>{setExportInfo(r.message || `${r.status}: ${tx(lang,'الملف جاهز للتنزيل.','Your render is ready to download.')}`);refresh();}})} className="btn btn-primary w-full" disabled={exportProject.isPending || scenes.length===0} data-testid="button-export"><Clapperboard size={16}/>{exportProject.isPending ? tx(lang,'جارٍ تجهيز الرندر...','Rendering...') : tx(lang,'تصدير الفيديو','Export video')}</button><p>{tx(lang,'تصدير MP4 · 1080p · 30 إطار/ث','MP4 export · 1080p · 30 fps')}</p>{exportProject.isError && <span className="inline-error">{tx(lang,'تعذر التصدير. حاول مجددًا.','Export failed. Try again.')}</span>}</div>
      </aside>
    </div>
    {editProjectOpen && <ProjectForm initial={{title:project.title,idea:project.idea,videoType:project.videoType,language:project.language,durationSeconds:project.durationSeconds,audience:project.audience,visualStyle:project.visualStyle,aspectRatio:project.aspectRatio as ProjectInput['aspectRatio']}} onClose={()=>setEditProjectOpen(false)} pending={updateProject.isPending} onSave={data=>updateProject.mutate({projectId,data},{onSuccess:()=>{refresh();setEditProjectOpen(false)}})} />}
  </AppFrame>;
}
function SceneFields({ scene, lang, onSave, pending }: { scene: Scene; lang: Lang; onSave: (field: keyof Scene, value: string | number) => void; pending: boolean }) {
  const [form,setForm] = useState({title:scene.title,description:scene.description,imagePrompt:scene.imagePrompt,narration:scene.narration,durationSeconds:scene.durationSeconds});
  useEffect(()=>setForm({title:scene.title,description:scene.description,imagePrompt:scene.imagePrompt,narration:scene.narration,durationSeconds:scene.durationSeconds}),[scene.id]);
  const field = (key: keyof typeof form, label: string, multiline = false) => <label className="inspector-field"><span className="field-label">{label}</span>{multiline ? <textarea className="studio-input" rows={key==='narration'?3:2} value={form[key]} onChange={e=>setForm(v=>({...v,[key]:e.target.value}))} onBlur={()=>form[key]!==scene[key]&&onSave(key,form[key])} data-testid={`input-scene-${key}`} /> : <input className="studio-input" value={form[key]} onChange={e=>setForm(v=>({...v,[key]:e.target.value}))} onBlur={()=>form[key]!==scene[key]&&onSave(key,form[key])} data-testid={`input-scene-${key}`} />}</label>;
  return <div className="inspector-fields">{field('title',tx(lang,'اسم المشهد','Scene title'))}<label className="inspector-field"><span className="field-label">{tx(lang,'المدة بالثواني','Duration (seconds)')}</span><input type="number" min="1" max="600" className="studio-input" value={form.durationSeconds} onChange={e=>setForm(v=>({...v,durationSeconds:Number(e.target.value)}))} onBlur={()=>form.durationSeconds!==scene.durationSeconds&&onSave('durationSeconds',form.durationSeconds)} /></label>{field('description',tx(lang,'وصف المشهد','Scene description'),true)}{field('imagePrompt',tx(lang,'موجّه الصورة','Visual prompt'),true)}{field('narration',tx(lang,'التعليق الصوتي','Narration'),true)}<div className="save-state">{pending ? <Busy text={tx(lang,'جارٍ الحفظ','Saving')} /> : <><span className="signal-dot"/>{tx(lang,'تُحفظ التغييرات عند مغادرة الحقل','Changes save when you leave a field')}</>}</div></div>;
}
function formatTime(seconds:number) { const s=Math.max(0,Math.floor(seconds)); return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }

function MediaPage() {
  const { lang } = useApp();
  const qc=useQueryClient();
  const initial = new URLSearchParams(window.location.search);
  const [term,setTerm] = useState('');
  const [search,setSearch] = useState('');
  const [type,setType] = useState<'image'|'video'>('image');
  const [page,setPage] = useState(1);
  const [added,setAdded] = useState<string | null>(null);
  const projectId = initial.get('projectId') || '';
  const sceneId = initial.get('sceneId') || '';
  const params = {q:search,mediaType:type,page};
  const q = useSearchFreeMedia(params,{query:{enabled:search.length>0,queryKey:getSearchFreeMediaQueryKey(params)}});
  const updateScene=useUpdateScene();
  function add(result:MediaResult) {
    if(!projectId||!sceneId) { setAdded(tx(lang,'اختر مشهدًا من مساحة المشروع لإضافة الوسيط.','Open a project scene to attach this media.')); return; }
    updateScene.mutate({projectId,sceneId,data:{assetUrl:result.url,assetType:result.mediaType}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getGetProjectQueryKey(projectId)});setAdded(tx(lang,`تم ربط «${result.title}» بالمشهد.`,`“${result.title}” is attached to the scene.`));},onError:()=>setAdded(tx(lang,'تعذرت إضافة الوسيط. حاول مجددًا.','Could not attach this media. Try again.'))});
  }
  return <AppFrame title={tx(lang,'مكتبة الوسائط','Media library')} crumb="OPENVERSE SEARCH"><div className="page-toolbar"><div><span className="eyebrow">{tx(lang,'بحث مفتوح الترخيص','OPEN-LICENSED SEARCH')}</span><h2>{tx(lang,'لقطة مناسبة تغيّر كل شيء.', 'The right frame changes everything.')}</h2><p>{tx(lang,'ابحث في نتائج Openverse مع إظهار المصدر والترخيص لكل ملف.', 'Search Openverse and review the source and license for every result.')}</p></div></div>
    <form className="media-search panel" onSubmit={e=>{e.preventDefault();setSearch(term.trim());setPage(1);setAdded(null);}}><div className="searchbox"><Search size={18}/><input value={term} onChange={e=>setTerm(e.target.value)} placeholder={tx(lang,'ابحث عن مشهد، مكان، أو إحساس...','Search a scene, place, or feeling...')} data-testid="input-media-query" /></div><select className="studio-input media-type" value={type} onChange={e=>setType(e.target.value as 'image'|'video')}><option value="image">{tx(lang,'صور','Images')}</option><option value="video">{tx(lang,'فيديو','Video')}</option></select><button className="btn btn-primary" disabled={!term.trim()} data-testid="button-search-media"><Search size={16}/>{tx(lang,'بحث','Search')}</button></form>
    {added && <div className="media-notice"><Check size={16}/>{added}<button onClick={()=>setAdded(null)} className="btn btn-ghost !p-1"><X size={15}/></button></div>}
    {q.isLoading ? <div className="media-results">{[1,2,3,4].map(n=><SkeletonBlock key={n} className="h-64"/>)}</div> : q.isError ? <StateError lang={lang} retry={()=>q.refetch()} /> : q.data ? q.data.results.length ? <><div className="results-label"><span>{q.data.total} {tx(lang,'نتيجة','results')} · {q.data.source}</span><span>{tx(lang,'تحقق من الترخيص قبل الاستخدام','Review license before use')}</span></div><div className="media-results">{q.data.results.map(item=><article className="media-card panel" key={item.id}><a className="media-image" href={item.url} target="_blank" rel="noreferrer">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt={item.title}/> : <div className="media-placeholder"><ImagePlus size={28}/><span>{item.mediaType}</span></div>}<span className="media-type-tag">{item.mediaType}</span></a><div className="media-card-content"><h3>{item.title}</h3>{item.creator && <p className="media-creator">{tx(lang,'بواسطة','by')} {item.creator}</p>}<div className="license-line"><span>{item.source}</span><a href={item.licenseUrl || item.url} target="_blank" rel="noreferrer">{item.license}</a></div><button className="btn btn-quiet w-full mt-3" onClick={()=>add(item)} disabled={updateScene.isPending} data-testid={`button-add-media-${item.id}`}><Plus size={15}/>{tx(lang,'إضافة إلى المشهد','Add to scene')}</button></div></article>)}</div><div className="pager"><button className="btn btn-quiet" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}><ArrowRight size={15}/>{tx(lang,'السابق','Previous')}</button><span>{tx(lang,`صفحة ${page}`,`Page ${page}`)}</span><button className="btn btn-quiet" onClick={()=>setPage(p=>p+1)}>{tx(lang,'التالي','Next')}<ArrowLeft size={15}/></button></div></> : <Empty title={tx(lang,'لم نعثر على نتائج','No results found')} body={tx(lang,'جرّب عبارة بحث مختلفة أو بدّل نوع الوسائط.','Try a different phrase or switch the media type.')} /> : <Empty title={tx(lang,'ابحث عن الصورة التالية','Find your next frame')} body={tx(lang,'اكتب وصفًا للعثور على صور وفيديوهات مجانية مع تفاصيل المصدر والترخيص.','Search for free images and videos with source and license details.')} />}
  </AppFrame>;
}

function ProvidersPage() {
  const { lang } = useApp();
  const qc = useQueryClient();
  const keys = useListProviderKeys(), settingsQ = useGetProviderSettings();
  const create=useCreateProviderKey(),update=useUpdateProviderKey(),remove=useDeleteProviderKey(),test=useTestProviderKey(),saveSettings=useUpdateProviderSettings();
  const [dialog,setDialog]=useState(false);
  const [editing,setEditing]=useState<ProviderKey|null>(null);
  const invalidate=()=>{qc.invalidateQueries({queryKey:getListProviderKeysQueryKey()});qc.invalidateQueries({queryKey:getGetStudioSummaryQueryKey()});};
  const [prefs,setPrefs]=useState<ProviderSettings|null>(null);
  useEffect(()=>{if(settingsQ.data)setPrefs(settingsQ.data)},[settingsQ.data]);
  return <AppFrame title={tx(lang,'مزوّدو الخدمة','Provider settings')} crumb="CREDENTIALS & ROTATION">
    <div className="page-toolbar"><div><span className="eyebrow">{tx(lang,'المفاتيح والاعتمادية','KEYS & RELIABILITY')}</span><h2>{tx(lang,'أدواتك، تحت سيطرتك.', 'Your tools, on your terms.')}</h2><p>{tx(lang,'المفاتيح لا تظهر مجددًا بعد حفظها؛ تُرسل للخادم مباشرة ولا تُخزّن في المتصفح.', 'Keys are never shown again after saving. They are sent directly to the server and never stored in browser storage.')}</p></div><button className="btn btn-primary" onClick={()=>{setEditing(null);setDialog(true)}} data-testid="button-add-provider"><Plus size={16}/>{tx(lang,'إضافة مفتاح','Add a key')}</button></div>
    <section className="panel provider-list"><div className="section-heading"><div><span className="eyebrow">{tx(lang,'مفاتيح API','API KEYS')}</span><h3>{tx(lang,'المزوّدون المتصلون','Connected providers')}</h3></div><span className="result-count">{keys.data?.length ?? '—'} {tx(lang,'مفاتيح','keys')}</span></div>
      {keys.isLoading ? <div className="provider-rows">{[1,2].map(n=><SkeletonBlock key={n} className="h-20"/>)}</div> : keys.isError ? <StateError lang={lang} retry={()=>keys.refetch()} /> : keys.data?.length ? <div className="provider-rows">{keys.data.map(key=><ProviderRow key={key.id} item={key} onEdit={()=>{setEditing(key);setDialog(true)}} onToggle={enabled=>update.mutate({keyId:key.id,data:{enabled}},{onSuccess:invalidate})} onPriority={priority=>update.mutate({keyId:key.id,data:{priority}},{onSuccess:invalidate})} onTest={()=>test.mutate({keyId:key.id},{onSuccess:invalidate})} testing={test.isPending} onDelete={()=>{if(window.confirm(tx(lang,'حذف هذا المفتاح؟','Delete this key?')))remove.mutate({keyId:key.id},{onSuccess:invalidate})}} lang={lang}/>)}</div> : <Empty title={tx(lang,'لا توجد مفاتيح محفوظة','No keys configured')} body={tx(lang,'أضف مفتاح مزوّد قبل استخدام توليد السيناريو أو الخدمات المتصلة.','Add a provider key to enable script generation and connected services.')} action={<button className="btn btn-primary" onClick={()=>setDialog(true)}><Plus size={15}/>{tx(lang,'إضافة أول مفتاح','Add your first key')}</button>} />}
    </section>
    <section className="panel rotation-panel"><div className="section-heading"><div><span className="eyebrow">{tx(lang,'التعامل مع التعطّل','FAILOVER BEHAVIOR')}</span><h3>{tx(lang,'تدوير المفاتيح وإعادة المحاولة','Key rotation & retries')}</h3></div><ShieldCheck size={20} className="text-primary"/></div>
      {settingsQ.isLoading ? <SkeletonBlock className="h-48"/> : settingsQ.isError ? <StateError lang={lang} retry={()=>settingsQ.refetch()}/> : prefs && <><div className="rotation-options">{[
        ['autoRotate',tx(lang,'التدوير التلقائي','Automatic rotation'),tx(lang,'استخدم المفتاح التالي عند الحاجة.','Move to another key when needed.')],
        ['rotateOnQuota',tx(lang,'عند تجاوز الحصة','On quota limits'),tx(lang,'انتقل لمفتاح آخر عند نفاد الحصة.','Switch when a provider quota is reached.')],
        ['rotateOnRateLimit',tx(lang,'عند تحديد المعدل','On rate limits'),tx(lang,'أعد المحاولة على مفتاح آخر عند تقييد المعدل.','Retry with another key when rate limited.')],
        ['rotateOnConnectionFailure',tx(lang,'عند فشل الاتصال','On connection failures'),tx(lang,'بدّل المزوّد عند تعذّر الاتصال.','Fail over when a provider cannot be reached.')],
      ].map(([field,title,desc])=><label className="rotation-row" key={field}><span><b>{title}</b><small>{desc}</small></span><input aria-label={title} type="checkbox" checked={Boolean(prefs[field as keyof ProviderSettings])} onChange={e=>setPrefs(p=>p?({...p,[field]:e.target.checked}):p)} /></label>)}</div>
      <div className="rotation-advanced"><label><span className="field-label">{tx(lang,'أقصى عدد للمحاولات','Maximum attempts')}</span><input className="studio-input" type="number" min="1" max="10" value={prefs.maxAttempts} onChange={e=>setPrefs({...prefs,maxAttempts:Number(e.target.value)})}/></label><label><span className="field-label">{tx(lang,'تأخير إعادة المحاولة بالثواني','Retry delay (seconds)')}</span><input className="studio-input" type="number" min="0" max="300" value={prefs.retryDelaySeconds} onChange={e=>setPrefs({...prefs,retryDelaySeconds:Number(e.target.value)})}/></label><label><span className="field-label">{tx(lang,'المزوّد الاحتياطي','Fallback provider')}</span><input className="studio-input" value={prefs.fallbackProvider || ''} onChange={e=>setPrefs({...prefs,fallbackProvider:e.target.value||null})} placeholder={tx(lang,'اختياري','Optional')}/></label></div>
      <div className="modal-actions"><span className="save-state">{saveSettings.isSuccess && <><Check size={14}/>{tx(lang,'حُفظت الإعدادات','Settings saved')}</>}</span><button className="btn btn-primary" disabled={saveSettings.isPending} onClick={()=>saveSettings.mutate({data:prefs},{onSuccess:()=>qc.invalidateQueries({queryKey:getGetProviderSettingsQueryKey()})})}>{saveSettings.isPending?tx(lang,'جارٍ الحفظ...','Saving...'):tx(lang,'حفظ إعدادات التدوير','Save rotation settings')}</button></div></>}
    </section>
    {dialog && <ProviderForm initial={editing} onClose={()=>setDialog(false)} pending={create.isPending||update.isPending} onSave={data=>{if(editing){const {apiKey,...safe}=data;update.mutate({keyId:editing.id,data:{...safe,...(apiKey?{apiKey}:{})}},{onSuccess:()=>{invalidate();setDialog(false)}})}else create.mutate({data},{onSuccess:()=>{invalidate();setDialog(false)}})}} />}
  </AppFrame>;
}
function ProviderRow({item,onEdit,onToggle,onPriority,onTest,onDelete,testing,lang}:{item:ProviderKey;onEdit:()=>void;onToggle:(v:boolean)=>void;onPriority:(v:number)=>void;onTest:()=>void;onDelete:()=>void;testing:boolean;lang:Lang}) {
  return <div className="provider-row"><div className="provider-avatar">{item.provider.slice(0,2).toUpperCase()}</div><div className="provider-ident"><b>{item.label}</b><span>{item.provider} · {item.serviceType}</span></div><span className={`key-status ${item.status}`}>{item.status.replace('_',' ')}</span><label className="priority-control"><span>{tx(lang,'الأولوية','Priority')}</span><input type="number" min="0" value={item.priority} aria-label="Key priority" onChange={e=>onPriority(Number(e.target.value))}/></label><label className="switch-control" title={tx(lang,'مفعّل','Enabled')}><input type="checkbox" checked={item.enabled} onChange={e=>onToggle(e.target.checked)}/><span /></label><div className="provider-actions"><button className="btn btn-ghost !p-2" title={tx(lang,'اختبار المفتاح','Test key')} onClick={onTest} disabled={testing}>{testing?<LoaderCircle size={15} className="animate-spin"/>:<Check size={15}/>}</button><button className="btn btn-ghost !p-2" title={tx(lang,'تعديل','Edit')} onClick={onEdit}><Settings2 size={15}/></button><button className="btn btn-ghost !p-2 text-destructive" title={tx(lang,'حذف','Delete')} onClick={onDelete}><Trash2 size={15}/></button></div>{item.testMessage && <small className="provider-message">{item.testMessage}</small>}</div>;
}
function ProviderForm({initial,onClose,onSave,pending}:{initial:ProviderKey|null;onClose:()=>void;onSave:(data:{provider:string;label:string;apiKey:string;serviceType:'text'|'image'|'video'|'voice'|'transcription'|'music';enabled:boolean;priority:number})=>void;pending:boolean}) {
  const {lang}=useApp();
  const [provider,setProvider]=useState(initial?.provider||'openai'),[label,setLabel]=useState(initial?.label||''),[apiKey,setApiKey]=useState(''),[serviceType,setServiceType]=useState<'text'|'image'|'video'|'voice'|'transcription'|'music'>(initial?.serviceType||'text'),[enabled,setEnabled]=useState(initial?.enabled??true),[priority,setPriority]=useState(initial?.priority??0);
  return <Modal title={initial?tx(lang,'تعديل المفتاح','Edit provider key'):tx(lang,'إضافة مفتاح مزوّد','Add provider key')} subtitle={tx(lang,'لن يُعرض المفتاح بعد إرساله إلى الخادم.','The secret will not be displayed after it is sent to the server.')} onClose={onClose}><form className="form-stack" onSubmit={e=>{e.preventDefault();onSave({provider,label,apiKey,serviceType,enabled,priority})}}>
    <label><span className="field-label">{tx(lang,'اسم المزوّد','Provider')}</span><select className="studio-input" value={provider} onChange={e=>setProvider(e.target.value)}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="google">Google AI</option><option value="stability">Stability AI</option><option value="elevenlabs">ElevenLabs</option><option value="custom">{tx(lang,'مخصص','Custom')}</option></select></label>
    <label><span className="field-label">{tx(lang,'تسمية المفتاح','Key label')}</span><input required className="studio-input" value={label} onChange={e=>setLabel(e.target.value)} placeholder={tx(lang,'مثال: مفتاح الإنتاج','e.g. Production key')} /></label>
    <label><span className="field-label">{tx(lang,'مفتاح API','API key')}</span><input required={!initial} type="password" autoComplete="new-password" className="studio-input" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder={initial?tx(lang,'اتركه فارغًا للإبقاء على المفتاح الحالي','Leave blank to keep the current key'):'sk-…'} data-testid="input-provider-secret" /></label>
    <div className="form-two"><label><span className="field-label">{tx(lang,'نوع الخدمة','Service type')}</span><select className="studio-input" value={serviceType} onChange={e=>setServiceType(e.target.value as typeof serviceType)}>{['text','image','video','voice','transcription','music'].map(x=><option key={x}>{x}</option>)}</select></label><label><span className="field-label">{tx(lang,'الأولوية','Priority')}</span><input type="number" min="0" className="studio-input" value={priority} onChange={e=>setPriority(Number(e.target.value))}/></label></div>
    <label className="checkline"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>{tx(lang,'تفعيل هذا المفتاح','Enable this key')}</label><div className="modal-actions"><button className="btn btn-quiet" type="button" onClick={onClose}>{tx(lang,'إلغاء','Cancel')}</button><button className="btn btn-primary" disabled={pending}>{pending?<LoaderCircle size={16} className="animate-spin"/>:<KeyRound size={16}/ >}{tx(lang,'حفظ المفتاح','Save key')}</button></div>
  </form></Modal>;
}

function ToolsPage() {
  const {lang}=useApp(); const q=useListFreeTools();
  return <AppFrame title={tx(lang,'أدوات مفتوحة','Open tools')} crumb="FREE & OPEN SERVICES"><div className="page-toolbar"><div><span className="eyebrow">{tx(lang,'مختارة لصنّاع الفيديو','FOR VIDEO MAKERS')}</span><h2>{tx(lang,'أدوات تستحق مكانًا في سير عملك.', 'Good tools, without the guesswork.')}</h2><p>{tx(lang,'خدمات مجانية أو مفتوحة المصدر مع روابطها الرسمية وملاحظات الوصول.', 'Free and open services, with official links and access notes.')}</p></div></div>
    {q.isLoading ? <div className="tools-grid">{[1,2,3].map(n=><SkeletonBlock key={n} className="h-48"/>)}</div> : q.isError ? <StateError lang={lang} retry={()=>q.refetch()}/> : q.data?.length ? <div className="tools-grid">{q.data.map((tool,i)=><article className="tool-card panel" key={`${tool.name}-${i}`}><div className="tool-head"><span className="tool-index">0{i+1}</span><span className="tool-category">{tool.category}</span></div><h3>{tool.name}</h3><p>{tool.pricingNote}</p><div className="tool-foot"><span>{tool.access}</span><a href={tool.officialUrl} target="_blank" rel="noreferrer" className="btn btn-quiet">{tx(lang,'الموقع الرسمي','Official site')}<ArrowLeft size={14}/></a></div></article>)}</div> : <Empty title={tx(lang,'لا توجد أدوات متاحة الآن','No tools available right now')} body={tx(lang,'لم تُرجع الخدمة قائمة أدوات. أعد المحاولة لاحقًا.','The service returned no tools. Check back later.')} />}
  </AppFrame>;
}

function SettingsRedirect() { return <Redirect to="/settings/providers" />; }
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
        <Route path="/media" component={MediaPage}/>
        <Route path="/settings/providers" component={ProvidersPage}/>
        <Route path="/settings/tools" component={ToolsPage}/>
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
