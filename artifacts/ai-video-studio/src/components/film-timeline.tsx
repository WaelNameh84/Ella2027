import { useState } from "react";
import { AudioLines, Captions, Clapperboard, Music2 } from "lucide-react";
import type { Scene } from "@workspace/api-client-react";

type FilmTimelineProps = {
  scenes: Scene[];
  selectedId: string | null;
  musicUrl: string | null;
  lang: "ar" | "en";
  onSelect: (sceneId: string) => void;
  onReorder: (sourceId: string, targetId: string) => void;
};

const copy = {
  ar: {
    title: "المسارات الزمنية",
    visual: "الصورة والفيديو",
    voice: "الحوار والصوت",
    subtitles: "الترجمة",
    music: "الموسيقى",
    noVoice: "لا يوجد صوت",
    noSubtitle: "لا يوجد نص",
    soundtrack: "الموسيقى الخلفية",
    addSoundtrack: "أضف موسيقى من مكتبة الوسائط",
    dragHint: "اسحب المشاهد لإعادة ترتيبها",
    seconds: "ث",
  },
  en: {
    title: "Timeline tracks",
    visual: "Picture & video",
    voice: "Dialogue & voice",
    subtitles: "Subtitles",
    music: "Music",
    noVoice: "No audio",
    noSubtitle: "No text",
    soundtrack: "Background soundtrack",
    addSoundtrack: "Add music from the media library",
    dragHint: "Drag scenes to reorder",
    seconds: "s",
  },
} as const;

function sceneDuration(scene: Scene): number {
  const speed = Math.max(0.25, Math.min(4, scene.playbackSpeed || 1));
  if (scene.assetType === "video" && scene.clipEndSeconds !== null) {
    return Math.max(0.25, (scene.clipEndSeconds - scene.clipStartSeconds) / speed);
  }
  return Math.max(0.25, scene.durationSeconds / speed);
}

function clipWidth(scene: Scene): number {
  return Math.max(92, Math.round(sceneDuration(scene) * 16));
}

function TrackLabel({ icon, title }: { icon: React.ReactNode; title: string }) {
  return <div className="timeline-track-label">{icon}<span>{title}</span></div>;
}

export function FilmTimeline({
  scenes,
  selectedId,
  musicUrl,
  lang,
  onSelect,
  onReorder,
}: FilmTimelineProps) {
  const [draggedScene, setDraggedScene] = useState<string | null>(null);
  const text = copy[lang];
  const totalWidth = Math.max(
    92,
    scenes.reduce((sum, scene) => sum + clipWidth(scene), 0) + Math.max(0, scenes.length - 1) * 8,
  );
  const totalDuration = scenes.reduce((sum, scene) => sum + sceneDuration(scene), 0);

  return (
    <div className="film-timeline" dir={lang === "ar" ? "rtl" : "ltr"}>
      <div className="film-timeline-heading">
        <span>{text.title}</span>
        <small>{text.dragHint}</small>
      </div>
      <div className="film-timeline-scroll">
        <div className="film-timeline-grid" style={{ minWidth: `${totalWidth + 154}px` }}>
          <TrackLabel icon={<Clapperboard size={15} />} title={text.visual} />
          <div className="film-timeline-lane">
            {scenes.map((scene, index) => (
              <button
                key={`visual-${scene.id}`}
                type="button"
                draggable
                className={`film-clip film-clip-visual ${selectedId === scene.id ? "is-selected" : ""} ${draggedScene === scene.id ? "is-dragged" : ""}`}
                style={{ width: `${clipWidth(scene)}px` }}
                onClick={() => onSelect(scene.id)}
                onDragStart={(event) => {
                  setDraggedScene(scene.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", scene.id);
                }}
                onDragEnd={() => setDraggedScene(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceId = event.dataTransfer.getData("text/plain") || draggedScene;
                  if (sourceId) onReorder(sourceId, scene.id);
                  setDraggedScene(null);
                }}
                aria-pressed={selectedId === scene.id}
                aria-label={`${index + 1}. ${scene.title}, ${sceneDuration(scene).toFixed(1)} ${text.seconds}`}
              >
                {scene.assetType === "image" && scene.assetUrl
                  ? <img src={scene.assetUrl} alt="" />
                  : <span className="film-clip-placeholder"><Clapperboard size={16} /></span>}
                <span className="film-clip-copy"><b>{String(index + 1).padStart(2, "0")} · {scene.title}</b><small>{sceneDuration(scene).toFixed(1)}{text.seconds}</small></span>
              </button>
            ))}
          </div>

          <TrackLabel icon={<AudioLines size={15} />} title={text.voice} />
          <div className="film-timeline-lane">
            {scenes.map((scene) => (
              <button
                key={`voice-${scene.id}`}
                type="button"
                className={`film-clip film-clip-audio ${selectedId === scene.id ? "is-selected" : ""}`}
                style={{ width: `${clipWidth(scene)}px` }}
                onClick={() => onSelect(scene.id)}
                aria-label={`${text.voice}: ${scene.title}`}
              >
                <AudioLines size={15} />
                <span>{scene.voiceUrl ? scene.title : text.noVoice}</span>
              </button>
            ))}
          </div>

          <TrackLabel icon={<Captions size={15} />} title={text.subtitles} />
          <div className="film-timeline-lane">
            {scenes.map((scene) => (
              <button
                key={`subtitle-${scene.id}`}
                type="button"
                className={`film-clip film-clip-subtitle ${selectedId === scene.id ? "is-selected" : ""}`}
                style={{ width: `${clipWidth(scene)}px` }}
                onClick={() => onSelect(scene.id)}
                aria-label={`${text.subtitles}: ${scene.title}`}
              >
                <span>{scene.narration.trim() || text.noSubtitle}</span>
              </button>
            ))}
          </div>

          <TrackLabel icon={<Music2 size={15} />} title={text.music} />
          <div className="film-timeline-lane">
            <a
              className={`film-clip film-clip-music ${musicUrl ? "" : "is-empty"}`}
              style={{ width: `${totalWidth}px` }}
              href={musicUrl || `/media?projectId=${scenes[0]?.projectId ?? ""}`}
              target={musicUrl ? "_blank" : undefined}
              rel={musicUrl ? "noreferrer" : undefined}
              aria-label={musicUrl ? text.soundtrack : text.addSoundtrack}
            >
              <Music2 size={15} />
              <span>{musicUrl ? text.soundtrack : text.addSoundtrack}</span>
              <small>{totalDuration.toFixed(1)}{text.seconds}</small>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
