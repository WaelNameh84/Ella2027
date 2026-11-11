import { useEffect, useMemo, useState } from "react";
import {
  AudioLines,
  Captions,
  Check,
  Clapperboard,
  Film,
  LoaderCircle,
  Music2,
  Play,
  Volume2,
} from "lucide-react";
import type { Project, Scene, SceneUpdate } from "@workspace/api-client-react";

type Lang = "ar" | "en";
type TrackName = "visual" | "voice" | "subtitles" | "music";
type FilmTimelineProps = {
  scenes: Scene[];
  selectedId: string | null;
  musicUrl: string | null;
  musicVolume: number;
  lang: Lang;
  previewing: boolean;
  onSelect: (sceneId: string) => void;
  onReorder: (sourceId: string, targetId: string) => void;
  onPreview: () => void;
  onSaveScene: (sceneId: string, data: SceneUpdate) => Promise<void>;
  onSaveProject: (
    data: Pick<Project, "musicUrl" | "musicVolume">,
  ) => Promise<void>;
};

const copy = {
  ar: {
    title: "محرر المسارات",
    visual: "الصورة والفيديو",
    voice: "التعليق والصوت",
    subtitles: "الترجمة",
    music: "الموسيقى",
    noVoice: "لا يوجد صوت",
    noSubtitle: "لا يوجد نص",
    soundtrack: "مسار الموسيقى",
    addSoundtrack: "أضف رابط موسيقى",
    dragHint:
      "اسحب مقاطع الصورة لتغيير ترتيب المشاهد؛ اختر أي مقطع لتحرير مساره.",
    preview: "معاينة المونتاج",
    seconds: "ث",
    playhead: "موضع المعاينة",
    selected: "تحرير المسار المحدد",
    selectScene: "اختر مقطعًا من الخط الزمني لبدء التحرير.",
    duration: "مدة المشهد (ث)",
    clipIn: "بداية قص الفيديو (ث)",
    clipOut: "نهاية قص الفيديو (ث) — فارغ = نهاية المقطع",
    speed: "سرعة التشغيل",
    transition: "الانتقال",
    cut: "قطع مباشر",
    fade: "تلاشي",
    dissolve: "تداخل",
    wipe: "مسح جانبي",
    slide: "انزلاق",
    voiceUrl: "رابط ملف التعليق الصوتي",
    volume: "مستوى الصوت",
    subtitleText: "نص الترجمة",
    useNarration: "استخدم التعليق الصوتي للترجمة",
    start: "بداية الترجمة (ث)",
    end: "نهاية الترجمة (ث) — فارغ = نهاية المشهد",
    musicUrl: "رابط ملف الموسيقى",
    save: "حفظ تلقائي عند مغادرة الحقل",
    saving: "جارٍ الحفظ…",
    saved: "تم الحفظ",
    saveError: "تعذر الحفظ؛ تحقق من القيم ثم أعد المحاولة.",
    badNumber: "أدخل قيمة ضمن المدى المحدد.",
    badUrl: "أدخل رابط HTTP أو HTTPS صالحًا، أو اتركه فارغًا.",
    noScene: "أضف مشهدًا لبدء تحرير المسارات.",
    scene: "مشهد",
    externalPreview:
      "المعاينة المدمجة تشمل الصوت والترجمة وفق إعدادات التصدير.",
  },
  en: {
    title: "Multitrack editor",
    visual: "Picture & video",
    voice: "Voice & audio",
    subtitles: "Subtitles",
    music: "Music",
    noVoice: "No audio",
    noSubtitle: "No text",
    soundtrack: "Soundtrack track",
    addSoundtrack: "Add a music URL",
    dragHint:
      "Drag picture clips to reorder scenes; select any clip to edit its track.",
    preview: "Preview edit",
    seconds: "s",
    playhead: "Preview position",
    selected: "Edit selected track",
    selectScene: "Choose a clip on the timeline to start editing.",
    duration: "Scene duration (s)",
    clipIn: "Video in (s)",
    clipOut: "Video out (s) — blank = clip end",
    speed: "Playback speed",
    transition: "Transition",
    cut: "Cut",
    fade: "Fade",
    dissolve: "Dissolve",
    wipe: "Wipe",
    slide: "Slide",
    voiceUrl: "Voice asset URL",
    volume: "Track volume",
    subtitleText: "Subtitle text",
    useNarration: "Use narration for subtitles",
    start: "Subtitle start (s)",
    end: "Subtitle end (s) — blank = scene end",
    musicUrl: "Music asset URL",
    save: "Changes save when you leave a field",
    saving: "Saving…",
    saved: "Saved",
    saveError: "Could not save; check the value and try again.",
    badNumber: "Enter a value within the allowed range.",
    badUrl: "Enter a valid HTTP or HTTPS URL, or leave it blank.",
    noScene: "Add a scene to start editing tracks.",
    scene: "Scene",
    externalPreview:
      "The rendered preview combines audio and subtitles using the export settings.",
  },
} as const;

function effectiveSceneDuration(scene: Scene): number {
  const speed = Math.max(0.25, Math.min(4, scene.playbackSpeed || 1));
  if (scene.assetType === "video" && scene.clipEndSeconds !== null) {
    return Math.max(
      0.25,
      (scene.clipEndSeconds - scene.clipStartSeconds) / speed,
    );
  }
  return Math.max(0.25, scene.durationSeconds / speed);
}

function clipWidth(scene: Scene): number {
  return Math.max(84, Math.round(effectiveSceneDuration(scene) * 18));
}

function TrackLabel({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="timeline-track-label">
      {icon}
      <span>{title}</span>
    </div>
  );
}

function validMediaUrl(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim(), window.location.origin);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function TrackEditor({
  scene,
  track,
  musicUrl,
  musicVolume,
  lang,
  onSaveScene,
  onSaveProject,
}: {
  scene: Scene;
  track: TrackName;
  musicUrl: string | null;
  musicVolume: number;
  lang: Lang;
  onSaveScene: FilmTimelineProps["onSaveScene"];
  onSaveProject: FilmTimelineProps["onSaveProject"];
}) {
  const text = copy[lang];
  const [duration, setDuration] = useState(String(scene.durationSeconds));
  const [clipIn, setClipIn] = useState(String(scene.clipStartSeconds));
  const [clipOut, setClipOut] = useState(
    scene.clipEndSeconds === null ? "" : String(scene.clipEndSeconds),
  );
  const [speed, setSpeed] = useState(String(scene.playbackSpeed));
  const [voiceUrl, setVoiceUrl] = useState(scene.voiceUrl ?? "");
  const [voiceVolume, setVoiceVolume] = useState(scene.voiceVolume);
  const [subtitle, setSubtitle] = useState(
    scene.subtitleText ?? scene.narration,
  );
  const [subtitleStart, setSubtitleStart] = useState(
    String(scene.subtitleStartSeconds),
  );
  const [subtitleEnd, setSubtitleEnd] = useState(
    scene.subtitleEndSeconds === null ? "" : String(scene.subtitleEndSeconds),
  );
  const [draftMusicUrl, setDraftMusicUrl] = useState(musicUrl ?? "");
  const [draftMusicVolume, setDraftMusicVolume] = useState(musicVolume);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setDuration(String(scene.durationSeconds));
    setClipIn(String(scene.clipStartSeconds));
    setClipOut(
      scene.clipEndSeconds === null ? "" : String(scene.clipEndSeconds),
    );
    setSpeed(String(scene.playbackSpeed));
    setVoiceUrl(scene.voiceUrl ?? "");
    setVoiceVolume(scene.voiceVolume);
    setSubtitle(scene.subtitleText ?? scene.narration);
    setSubtitleStart(String(scene.subtitleStartSeconds));
    setSubtitleEnd(
      scene.subtitleEndSeconds === null ? "" : String(scene.subtitleEndSeconds),
    );
    setDraftMusicUrl(musicUrl ?? "");
    setDraftMusicVolume(musicVolume);
    setMessage("");
  }, [scene.id, scene.updatedAt, musicUrl, musicVolume]);

  const saveScene = async (data: SceneUpdate) => {
    setSaving(true);
    setMessage("");
    try {
      await onSaveScene(scene.id, data);
      setMessage(text.saved);
    } catch {
      setMessage(text.saveError);
    } finally {
      setSaving(false);
    }
  };

  const saveNumber = (
    raw: string,
    key:
      | "durationSeconds"
      | "clipStartSeconds"
      | "clipEndSeconds"
      | "playbackSpeed"
      | "subtitleStartSeconds"
      | "subtitleEndSeconds",
    min: number,
    max: number,
    allowBlank = false,
  ) => {
    if (allowBlank && raw.trim() === "") {
      setMessage("");
      void saveScene({ [key]: null } as SceneUpdate);
      return;
    }
    const value = Number(raw);
    if (
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      ((key === "durationSeconds" ||
        key === "clipStartSeconds" ||
        key === "clipEndSeconds") &&
        !Number.isInteger(value))
    ) {
      setMessage(text.badNumber);
      return;
    }
    const currentStart =
      key === "clipStartSeconds" ? value : Number(clipIn || 0);
    const currentEnd =
      key === "clipEndSeconds" ? value : clipOut ? Number(clipOut) : null;
    if (
      (key === "clipStartSeconds" || key === "clipEndSeconds") &&
      currentEnd !== null &&
      currentEnd <= currentStart
    ) {
      setMessage(text.badNumber);
      return;
    }
    const subtitleIn =
      key === "subtitleStartSeconds" ? value : Number(subtitleStart || 0);
    const subtitleOut =
      key === "subtitleEndSeconds"
        ? value
        : subtitleEnd
          ? Number(subtitleEnd)
          : null;
    if (
      (key === "subtitleStartSeconds" || key === "subtitleEndSeconds") &&
      subtitleOut !== null &&
      subtitleOut <= subtitleIn
    ) {
      setMessage(text.badNumber);
      return;
    }
    setMessage("");
    void saveScene({ [key]: value } as SceneUpdate);
  };

  const textField = (
    label: string,
    value: string,
    setValue: (value: string) => void,
    onSave: () => void,
    type: "text" | "url" = "text",
  ) => (
    <label className="timeline-editor-field">
      <span className="field-label">{label}</span>
      <input
        className="studio-input"
        type={type}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={onSave}
      />
    </label>
  );

  const numberField = (
    label: string,
    value: string,
    setValue: (value: string) => void,
    key:
      | "durationSeconds"
      | "clipStartSeconds"
      | "clipEndSeconds"
      | "playbackSpeed"
      | "subtitleStartSeconds"
      | "subtitleEndSeconds",
    min: number,
    max: number,
    step = 1,
    allowBlank = false,
  ) => (
    <label className="timeline-editor-field">
      <span className="field-label">{label}</span>
      <input
        className="studio-input"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => saveNumber(value, key, min, max, allowBlank)}
      />
    </label>
  );

  let editor: React.ReactNode;
  if (track === "visual") {
    editor = (
      <div className="timeline-editor-grid">
        {numberField(
          text.duration,
          duration,
          setDuration,
          "durationSeconds",
          1,
          600,
        )}
        {numberField(
          text.clipIn,
          clipIn,
          setClipIn,
          "clipStartSeconds",
          0,
          600,
        )}
        {numberField(
          text.clipOut,
          clipOut,
          setClipOut,
          "clipEndSeconds",
          0,
          600,
          1,
          true,
        )}
        {numberField(
          text.speed,
          speed,
          setSpeed,
          "playbackSpeed",
          0.25,
          4,
          0.05,
        )}
        <label className="timeline-editor-field">
          <span className="field-label">{text.transition}</span>
          <select
            className="studio-input"
            value={scene.transition || "cut"}
            onChange={(event) =>
              void saveScene({ transition: event.target.value })
            }
          >
            <option value="cut">{text.cut}</option>
            <option value="fade">{text.fade}</option>
            <option value="dissolve">{text.dissolve}</option>
            <option value="wipe">{text.wipe}</option>
            <option value="slide">{text.slide}</option>
          </select>
        </label>
      </div>
    );
  } else if (track === "voice") {
    const saveVoiceUrl = () => {
      if (!validMediaUrl(voiceUrl)) {
        setMessage(text.badUrl);
        return;
      }
      void saveScene({ voiceUrl: voiceUrl.trim() || null });
    };
    editor = (
      <div className="timeline-editor-grid">
        {textField(text.voiceUrl, voiceUrl, setVoiceUrl, saveVoiceUrl, "url")}
        <label className="timeline-editor-field timeline-volume-field">
          <span className="field-label">
            {text.volume} · {voiceVolume}%
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={voiceVolume}
            onChange={(event) => setVoiceVolume(Number(event.target.value))}
            onPointerUp={() => void saveScene({ voiceVolume })}
            onKeyUp={() => void saveScene({ voiceVolume })}
            aria-label={text.volume}
          />
        </label>
        {scene.voiceUrl && (
          <audio
            className="timeline-audio-preview"
            controls
            preload="none"
            src={scene.voiceUrl}
            aria-label={text.voiceUrl}
          />
        )}
      </div>
    );
  } else if (track === "subtitles") {
    editor = (
      <div className="timeline-editor-grid">
        <label className="timeline-editor-field timeline-subtitle-text">
          <span className="field-label">{text.subtitleText}</span>
          <textarea
            className="studio-input"
            rows={2}
            value={subtitle}
            onChange={(event) => setSubtitle(event.target.value)}
            onBlur={() => void saveScene({ subtitleText: subtitle })}
          />
        </label>
        {numberField(
          text.start,
          subtitleStart,
          setSubtitleStart,
          "subtitleStartSeconds",
          0,
          600,
          0.1,
        )}
        {numberField(
          text.end,
          subtitleEnd,
          setSubtitleEnd,
          "subtitleEndSeconds",
          0,
          600,
          0.1,
          true,
        )}
        <button
          className="btn btn-quiet timeline-use-narration"
          type="button"
          onClick={() => {
            setSubtitle(scene.narration);
            void saveScene({ subtitleText: null });
          }}
        >
          {text.useNarration}
        </button>
      </div>
    );
  } else {
    const saveMusic = () => {
      if (!validMediaUrl(draftMusicUrl)) {
        setMessage(text.badUrl);
        return;
      }
      setSaving(true);
      setMessage("");
      void onSaveProject({
        musicUrl: draftMusicUrl.trim() || null,
        musicVolume: draftMusicVolume,
      })
        .then(() => setMessage(text.saved))
        .catch(() => setMessage(text.saveError))
        .finally(() => setSaving(false));
    };
    editor = (
      <div className="timeline-editor-grid">
        {textField(
          text.musicUrl,
          draftMusicUrl,
          setDraftMusicUrl,
          saveMusic,
          "url",
        )}
        <label className="timeline-editor-field timeline-volume-field">
          <span className="field-label">
            {text.volume} · {draftMusicVolume}%
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={draftMusicVolume}
            onChange={(event) =>
              setDraftMusicVolume(Number(event.target.value))
            }
            onPointerUp={saveMusic}
            onKeyUp={saveMusic}
            aria-label={text.volume}
          />
        </label>
        {musicUrl && (
          <audio
            className="timeline-audio-preview"
            controls
            preload="none"
            src={musicUrl}
            aria-label={text.musicUrl}
          />
        )}
      </div>
    );
  }

  return (
    <section className="timeline-editor" aria-label={text.selected}>
      <div className="timeline-editor-title">
        <div>
          <b>{text.selected}</b>
          <span>{scene.title}</span>
        </div>
        <small role="status">
          {saving ? (
            <>
              <LoaderCircle size={13} className="animate-spin" />
              {text.saving}
            </>
          ) : (
            message || text.save
          )}
        </small>
      </div>
      {editor}
    </section>
  );
}

export function FilmTimeline({
  scenes,
  selectedId,
  musicUrl,
  musicVolume,
  lang,
  previewing,
  onSelect,
  onReorder,
  onPreview,
  onSaveScene,
  onSaveProject,
}: FilmTimelineProps) {
  const [draggedScene, setDraggedScene] = useState<string | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<TrackName>("visual");
  const text = copy[lang];
  const totalWidth = Math.max(
    84,
    scenes.reduce((sum, scene) => sum + clipWidth(scene), 0) +
      Math.max(0, scenes.length - 1) * 6,
  );
  const totalDuration = scenes.reduce(
    (sum, scene) => sum + effectiveSceneDuration(scene),
    0,
  );
  const activeScene =
    scenes.find((scene) => scene.id === selectedId) ?? scenes[0];
  const tickStep = Math.max(5, Math.ceil(totalDuration / 12 / 5) * 5);
  const ticks = useMemo(() => {
    if (!totalDuration) return [0];
    const values: number[] = [];
    for (let time = 0; time < totalDuration; time += tickStep)
      values.push(time);
    if (values.at(-1) !== totalDuration) values.push(totalDuration);
    return values;
  }, [totalDuration, tickStep]);
  const activeStart = activeScene
    ? scenes
        .slice(0, scenes.indexOf(activeScene))
        .reduce((sum, scene) => sum + effectiveSceneDuration(scene), 0)
    : 0;
  const playheadPercent = totalDuration
    ? Math.min(100, (activeStart / totalDuration) * 100)
    : 0;

  const trackClip = (scene: Scene, track: TrackName, index: number) => {
    const width = clipWidth(scene);
    const selected = scene.id === selectedId && track === selectedTrack;
    const common = {
      key: `${track}-${scene.id}`,
      type: "button" as const,
      className: `film-clip ${selected ? "is-selected" : ""}`,
      style: { width: `${width}px` },
      onClick: () => {
        setSelectedTrack(track);
        onSelect(scene.id);
      },
      "aria-pressed": selected,
    };
    if (track === "visual") {
      return (
        <button
          {...common}
          draggable
          className={`${common.className} film-clip-visual ${draggedScene === scene.id ? "is-dragged" : ""}`}
          onDragStart={(event) => {
            setDraggedScene(scene.id);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", scene.id);
          }}
          onDragEnd={() => setDraggedScene(null)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const sourceId =
              event.dataTransfer.getData("text/plain") || draggedScene;
            if (sourceId) onReorder(sourceId, scene.id);
            setDraggedScene(null);
          }}
          aria-label={`${text.scene} ${index + 1}: ${scene.title}, ${effectiveSceneDuration(scene).toFixed(1)} ${text.seconds}`}
        >
          {scene.assetType === "image" && scene.assetUrl ? (
            <img src={scene.assetUrl} alt="" />
          ) : (
            <span className="film-clip-placeholder">
              <Clapperboard size={16} />
            </span>
          )}
          <span className="film-clip-copy">
            <b>
              {String(index + 1).padStart(2, "0")} · {scene.title}
            </b>
            <small>
              {effectiveSceneDuration(scene).toFixed(1)}
              {text.seconds}
            </small>
          </span>
        </button>
      );
    }
    if (track === "voice") {
      return (
        <button
          {...common}
          className={`${common.className} film-clip-audio ${scene.voiceUrl ? "has-media" : "is-empty"}`}
          aria-label={`${text.voice}: ${scene.title}`}
        >
          <AudioLines size={15} />
          <span>{scene.voiceUrl ? scene.title : text.noVoice}</span>
          <small>{scene.voiceUrl ? `${scene.voiceVolume}%` : "—"}</small>
        </button>
      );
    }
    if (track === "subtitles") {
      const sourceText = (scene.subtitleText ?? scene.narration).trim();
      const sceneDuration = Math.max(0.25, effectiveSceneDuration(scene));
      const start = Math.max(
        0,
        Math.min(sceneDuration, scene.subtitleStartSeconds ?? 0),
      );
      const end = Math.max(
        start,
        Math.min(sceneDuration, scene.subtitleEndSeconds ?? sceneDuration),
      );
      return (
        <button
          {...common}
          style={{
            width: `${Math.max(28, (width * Math.max(0, end - start)) / sceneDuration)}px`,
            insetInlineStart: `${(width * start) / sceneDuration}px`,
          }}
          className={`${common.className} film-clip-subtitle ${sourceText ? "has-media" : "is-empty"}`}
          aria-label={`${text.subtitles}: ${scene.title}`}
        >
          <span>{sourceText || text.noSubtitle}</span>
          <small>
            {start.toFixed(1)}–{end.toFixed(1)}
            {text.seconds}
          </small>
        </button>
      );
    }
    return null;
  };

  if (!scenes.length)
    return (
      <div className="timeline-empty">
        <span>{text.noScene}</span>
      </div>
    );

  return (
    <div className="film-timeline" dir={lang === "ar" ? "rtl" : "ltr"}>
      <div className="film-timeline-heading">
        <div>
          <b>{text.title}</b>
          <small>{text.dragHint}</small>
        </div>
        <button
          className="btn btn-quiet"
          type="button"
          onClick={onPreview}
          disabled={previewing}
        >
          {previewing ? (
            <LoaderCircle size={14} className="animate-spin" />
          ) : (
            <Play size={14} />
          )}
          {text.preview}
        </button>
      </div>
      <div className="film-timeline-scroll">
        <div
          className="film-timeline-grid"
          style={{ minWidth: `${totalWidth + 154}px` }}
        >
          <div className="timeline-track-label timeline-ruler-label">
            <span>{text.playhead}</span>
          </div>
          <div
            className="film-timeline-ruler"
            style={{ width: `${totalWidth}px` }}
          >
            {ticks.map((tick, index) => (
              <span
                key={tick}
                className="timeline-ruler-tick"
                style={{
                  left: `${totalDuration ? (tick / totalDuration) * 100 : 0}%`,
                }}
              >
                {index === ticks.length - 1
                  ? `${tick.toFixed(1)}${text.seconds}`
                  : `${Math.round(tick)}${text.seconds}`}
              </span>
            ))}
            <span
              className="timeline-playhead"
              style={{ left: `${playheadPercent}%` }}
              aria-hidden="true"
            />
          </div>
          <TrackLabel icon={<Clapperboard size={15} />} title={text.visual} />
          <div className="film-timeline-lane">
            {scenes.map((scene, index) => (
              <div
                className="film-timeline-segment"
                key={`visual-segment-${scene.id}`}
                style={{ width: `${clipWidth(scene)}px` }}
              >
                {trackClip(scene, "visual", index)}
              </div>
            ))}
          </div>
          <TrackLabel icon={<AudioLines size={15} />} title={text.voice} />
          <div className="film-timeline-lane">
            {scenes.map((scene, index) => (
              <div
                className="film-timeline-segment"
                key={`voice-segment-${scene.id}`}
                style={{ width: `${clipWidth(scene)}px` }}
              >
                {trackClip(scene, "voice", index)}
              </div>
            ))}
          </div>
          <TrackLabel icon={<Captions size={15} />} title={text.subtitles} />
          <div className="film-timeline-lane">
            {scenes.map((scene, index) => (
              <div
                className="film-timeline-segment"
                key={`subtitle-segment-${scene.id}`}
                style={{ width: `${clipWidth(scene)}px` }}
              >
                {trackClip(scene, "subtitles", index)}
              </div>
            ))}
          </div>
          <TrackLabel icon={<Music2 size={15} />} title={text.music} />
          <div className="film-timeline-lane">
            <button
              className={`film-clip film-clip-music ${selectedTrack === "music" ? "is-selected" : ""} ${musicUrl ? "" : "is-empty"}`}
              style={{ width: `${totalWidth}px` }}
              onClick={() => setSelectedTrack("music")}
              aria-pressed={selectedTrack === "music"}
            >
              <Music2 size={15} />
              <span>{musicUrl ? text.soundtrack : text.addSoundtrack}</span>
              <small>
                <Volume2 size={12} />
                {musicVolume}% · {totalDuration.toFixed(1)}
                {text.seconds}
              </small>
            </button>
          </div>
        </div>
      </div>
      <label className="timeline-scrubber">
        <span>{text.playhead}</span>
        <input
          type="range"
          min="0"
          max={Math.max(totalDuration, 0.1)}
          step="0.1"
          value={activeStart}
          onChange={(event) => {
            const time = Number(event.target.value);
            let elapsed = 0;
            const target =
              scenes.find((scene) => {
                elapsed += effectiveSceneDuration(scene);
                return time < elapsed;
              }) ?? scenes[scenes.length - 1];
            if (target) onSelect(target.id);
          }}
          aria-label={text.playhead}
        />
        <output>
          {activeStart.toFixed(1)} / {totalDuration.toFixed(1)}
          {text.seconds}
        </output>
      </label>
      <p className="timeline-preview-note">
        <Film size={13} />
        {text.externalPreview}
      </p>
      {activeScene && (
        <TrackEditor
          key={`${activeScene.id}:${selectedTrack}`}
          scene={activeScene}
          track={selectedTrack}
          musicUrl={musicUrl}
          musicVolume={musicVolume}
          lang={lang}
          onSaveScene={onSaveScene}
          onSaveProject={onSaveProject}
        />
      )}
    </div>
  );
}
