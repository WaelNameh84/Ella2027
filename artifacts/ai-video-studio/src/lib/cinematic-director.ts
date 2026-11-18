export type CinematicCharacterReference = {
  name: string;
  description?: string | null;
  costume?: string | null;
};

export type CinematicShotInput = {
  title?: string | null;
  description?: string | null;
  shotType?: string | null;
  cameraMovement?: string | null;
  location?: string | null;
  lighting?: string | null;
  visualStyle?: string | null;
  characters?: CinematicCharacterReference[];
};

const clean = (value?: string | null) => (value || '').replace(/\s+/g, ' ').trim();

/** Builds a deterministic prompt from saved shot direction and character bibles. No AI/API call is made. */
export function buildCinematicPrompt(input: CinematicShotInput, lang: 'ar' | 'en'): string {
  const ar = lang === 'ar';
  const sections: string[] = [];
  const title = clean(input.title);
  const action = clean(input.description);
  const location = clean(input.location);
  const lighting = clean(input.lighting);
  const shot = clean(input.shotType);
  const movement = clean(input.cameraMovement);
  const style = clean(input.visualStyle);

  if (title) sections.push(ar ? `عنوان اللقطة: ${title}` : `Shot: ${title}`);
  if (action) sections.push(ar ? `الفعل والأداء: ${action}` : `Action and performance: ${action}`);
  if (location) sections.push(ar ? `المكان والزمن: ${location}` : `Location and time: ${location}`);
  if (input.characters?.length) {
    const cast = input.characters.map(character => {
      const identity = [clean(character.name), clean(character.description), clean(character.costume)].filter(Boolean).join(' — ');
      return identity;
    }).filter(Boolean);
    if (cast.length) sections.push(ar
      ? `استمرارية الشخصيات — حافظ على نفس ملامح الوجه والعمر وتسريحة الشعر والملابس في كل إطار: ${cast.join(' | ')}`
      : `Character continuity — preserve the same face, age, hairstyle, and costume in every frame: ${cast.join(' | ')}`);
  }
  if (shot) sections.push(ar ? `تكوين الكاميرا: ${shot}` : `Camera framing: ${shot}`);
  if (movement) sections.push(ar ? `حركة الكاميرا: ${movement}` : `Camera movement: ${movement}`);
  if (lighting) sections.push(ar ? `الإضاءة والمعالجة اللونية: ${lighting}` : `Lighting and color grade: ${lighting}`);
  if (style) sections.push(ar ? `الأسلوب البصري: ${style}` : `Visual style: ${style}`);
  sections.push(ar
    ? 'جودة سينمائية واقعية، تكوين واضح، حركة طبيعية متصلة، تفاصيل دقيقة، عمق ميدان مناسب، لا نصوص أو شعارات أو علامات مائية، لا تشوهات في الوجه أو اليدين.'
    : 'Photoreal cinematic quality, clear composition, coherent natural motion, fine detail, appropriate depth of field, no text, logos, or watermarks, no facial or hand distortions.');
  return sections.join('\n');
}
