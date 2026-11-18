# Ella2027 — Autonomous Studio: خطة التنفيذ التقنية

**الحالة:** خطة تنفيذ مرتبطة بالكود الحالي، وليست ادعاءً بأن جميع الوظائف اكتملت.  
**المبدأ:** الحفاظ على الميزات الحالية، عدم استبدال الملفات الحديثة بنسخ أقدم، وعدم إرسال أي طلب مدفوع دون موافقة صريحة.

## الهدف

تحويل Ella2027 إلى استوديو إنتاج أفلام ومسلسلات متعدد المزودات، يعمل تلقائياً من الفكرة إلى ملف MP4، مع نقاط مراجعة بشرية اختيارية، واستعادة آمنة بعد الفشل.

## ما هو موجود الآن بحسب مراجعة المستودع

- Auto Studio لتشغيل مهام الفيديو للمشاهد الناقصة والصوت للمشاهد التي تحتاج تعليقاً، ثم طلب التصدير.
- Character Bible ضمن توليد السيناريو، ومكتبة شخصيات وصور مرجعية يدوية.
- Cinematic Director لبناء prompt من تفاصيل المشهد.
- سجل مشاريع ومهام في API/قاعدة البيانات، واستعادة مهام Auto Studio المسجلة.
- موصل `local-video-worker` وخدمة ComfyUI Worker أولية.
- FFmpeg لتجميع وتصدير MP4.
- Zero-spend مع استثناءات محددة للعامل المحلي ومزود الصوت المحلي.
- مزودات متعددة للنص والصور والفيديو والصوت والبحث، مع اختلاف مستوى التنفيذ والاختبار بينها.

## المرحلة 1 — Reliability Foundation

**الأولوية القصوى قبل إضافة واجهات جديدة.**

1. **Durable GPU Jobs:** حفظ سجل العامل وملفات MP4 خارج الذاكرة، مع volume دائم، حالات واضحة للمهام المنقطعة، وإمكانية إعادة محاولة المشهد وحده.
2. **Idempotency:** تمرير `project_id` و`scene_id` و`generation_attempt` أو idempotency key؛ منع إنشاء مهمتين متطابقتين عند تكرار الضغط أو إعادة الاتصال.
3. **Checkpointed Pipeline:** حفظ انتقالات كل مرحلة: planned → queued → running → validating → completed/failed/interrupted.
4. **Artifact Storage Adapter:** واجهة تخزين موحدة للملفات، تبدأ بمجلد دائم للعامل ثم تدعم S3-compatible object storage أو مزوداً آخر عبر إعدادات صريحة. قاعدة البيانات تحفظ metadata والملكية والروابط لا بايتات الفيديو الكبيرة.
5. **Worker Heartbeats & Leases:** مهلة heartbeat، حجز مهمة بمدة lease، اكتشاف العامل الميت، ومنع عاملين من تنفيذ المشهد نفسه.
6. **Safe Retry:** إعادة محاولة المشهد الفاشل فقط، مع backoff وحد أقصى للمحاولات، وعدم حذف النسخة السابقة.

**قبول المرحلة:** إعادة تشغيل العامل لا تمحو سجل المهمة أو الملفات النهائية؛ المشهد المنقطع يظهر interrupted ويمكن إعادة تشغيله دون إعادة المشاهد المكتملة.

## المرحلة 2 — Autonomous Director

1. **Director Orchestrator:** عقد JSON versioned لخطة الإنتاج، ومراحل واضحة من الفكرة إلى السيناريو إلى الشخصيات إلى المشاهد إلى اللقطات إلى المهام.
2. **Story Bible:** عالم القصة، قواعده، الخط الزمني، المواقع، العلاقات، النبرة، والمعلومات التي لا يجوز تغييرها.
3. **Character DNA:** معرف ثابت لكل شخصية، ملامح الوجه والشعر والملابس والصوت والعمر الظاهري، صور مرجعية متعددة، ونسخ للشخصية حسب الحقبة/الحلقة.
4. **Storyboard Planner:** تقسيم المشهد إلى shots مع shot type، lens/look، camera movement، lighting، action، dialogue، duration، negative prompt، reference assets.
5. **Review Gates:** خيار مراجعة السيناريو والشخصيات والـstoryboard قبل أي توليد يستهلك رصيداً.
6. **Prompt Compiler:** تحويل الخطة إلى صيغة خاصة بكل مزود/نموذج، مع المحافظة على معنى المشهد وقيوده.

**قبول المرحلة:** فكرة واحدة تنتج خطة JSON قابلة للتحرير، وشخصيات ومعرفات ثابتة، وقائمة مشاهد ولقطات قبل تشغيل أي مزود.

## المرحلة 3 — GPU Brain & Provider Intelligence

1. **Capability Registry:** كل Worker يعلن GPU/VRAM المتاح، النماذج المثبتة فعلياً، الدقة، الحد الأقصى للمدة، image-to-video، audio، والميزات المدعومة.
2. **Model Fit Scorer:** يختار النموذج بحسب متطلبات اللقطة وVRAM والجودة والوقت والتكلفة؛ لا يعلن model ready اعتماداً على اسم متغير فقط.
3. **Worker Pool:** توزيع المهام على عمال متعددين، مع queue، leases، heartbeats، وأولوية للمشاهد.
4. **Provider Health:** قياس نجاح/فشل/زمن استجابة كل مزود، وفصل أخطاء المصادقة عن quota/rate-limit/outage.
5. **Cost Firewall:** وضع مجاني افتراضياً، وتقدير تكلفة قبل الإرسال المدفوع، وموافقة صريحة لكل عملية أو ميزانية محددة يوافق عليها المستخدم.
6. **Fallback Rules:** التبديل فقط إلى مزود يحقق شروط الجودة والمدة والخصوصية؛ لا تحويل صامت من مجاني إلى مدفوع.
7. **Adaptive Scene Split:** تقسيم اللقطة وفق حدود النموذج الفعلية، مع مراجع استمرارية ودمج موحد وفحص كل جزء.

**قبول المرحلة:** اختيار نموذج مثبت ومتوافق فقط، ورفض المهمة بوضوح إن لم يوجد GPU/نموذج مناسب، وعدم استهلاك رصيد بلا موافقة.

## المرحلة 4 — Quality & Continuity

1. **Continuity Guard:** مقارنة المراجع بين اللقطات، والملابس والموقع والإضاءة والعناصر الثابتة.
2. **Quality Inspector:** فحص سلامة MP4 والمدة والدقة ومعدل الإطارات والصوت والسواد/التجميد/الملف الفارغ.
3. **Semantic Review:** مقارنة وصف اللقطة بالمخرجات باستخدام نموذج رؤية عند توفره وموافقة المستخدم على أي تكلفة.
4. **Variant Lab:** توليد بدائل للمشهد مع الاحتفاظ بكل النسخ، ثم اختيار أفضل نتيجة.
5. **Repair Only:** إصلاح اللقطة المتأثرة فقط، وعدم إعادة الفيلم كله.

**ملاحظة:** لا يمكن ضمان تطابق هوية الشخصية بنسبة 100% مع كل نموذج؛ هذه المرحلة تقيس الانحراف وتستخدم reference conditioning/LoRA عندما يدعمه النموذج فعلاً.

## المرحلة 5 — Voice, Lip Sync & Sound

1. توزيع الحوار على معرفات الشخصيات.
2. Voice profiles ثابتة لكل شخصية مع لغة ولهجة وسرعة ونبرة.
3. توليد narration/dialogue منفصل لكل مقطع مع تخزين timestamps.
4. Lip-sync عبر مزود أو workflow مثبت يدعم ذلك؛ لا نعرضه كميزة جاهزة قبل اختبار الناتج.
5. موسيقى ومؤثرات مع إدارة التراخيص والمصدر.
6. خلط صوتي ducking/normalization وقياس loudness ومراجعة التزامن.

## المرحلة 6 — Auto Editor & Delivery

1. Timeline متعدد المسارات للفيديو والصوت والترجمة.
2. مونتاج تلقائي وفق الإيقاع والحوار ونوع المحتوى.
3. انتقالات وcolor matching وsafe areas للمنصات.
4. تصدير presets لـ YouTube وShorts وTikTok وReels.
5. ترجمات SRT/VTT مدمجة أو منفصلة، ونسخ متعددة للغة.
6. Render queue مع استئناف export وحفظ نسخ المشروع.

## المرحلة 7 — Series Universe

- ذاكرة دائمة لعالم المسلسل والحلقات والشخصيات والأماكن والأحداث.
- Episode planner يحفظ ملخصات الحلقات السابقة ونقاط الحبكة المفتوحة.
- Character state حسب الزمن/الحلقة (ملابس/إصابات/موقع).
- إعادة استخدام الأصول واللقطات المسموح بها لتقليل التكلفة.
- إنتاج دفعات حلقات مع حدود موافقة وتكلفة لكل دفعة.

## المرحلة 8 — AI Production Assistant

مساعد محادثة ينفذ أوامر محددة على المشروع: تعديل مشهد، تغيير الإضاءة، إعادة توليد لقطة، مقارنة نسخ، استكمال الإنتاج، أو تجهيز نسخة منصة. كل تعديل يسجل في history ويمكن التراجع عنه.

## عقود بيانات مقترحة

- `ProductionPlanV1`: genre, audience, language, target_platform, aspect_ratio, duration, style, approval_policy.
- `CharacterBibleV1`: character_id, canonical_description, visual_traits, wardrobe_states, voice_profile, reference_assets.
- `ScenePlanV1`: scene_id, sequence, location_id, characters, action, dialogue, duration_seconds, continuity_constraints.
- `ShotPlanV1`: shot_id, scene_id, shot_type, camera, lens, lighting, prompt, negative_prompt, reference_assets, target_model_capabilities.
- `GenerationTaskV1`: task_id, project_id, scene_id, shot_id, provider_id, model_id, idempotency_key, status, attempts, cost_estimate, approval_id, artifact_id.
- `ArtifactV1`: artifact_id, type, storage_provider, storage_key, checksum, mime_type, size_bytes, duration, metadata.

## ترتيب التنفيذ المقترح

1. إكمال الاستمرارية والتكرار الآمن للعامل وربط المخرجات بتخزين دائم.
2. توحيد عقود خطة الإنتاج والشخصيات واللقطات والمهام.
3. Director Orchestrator + Story Bible + Character DNA.
4. Capability Registry + Worker Pool + Cost Firewall.
5. Quality Inspector + Continuity Guard.
6. Voice/Lip-sync + Auto Editor.
7. Series Universe + Assistant.

## قواعد لا نتجاوزها

- لا حذف أو استبدال للميزات الموجودة دون سبب واختبار.
- لا أسرار أو مفاتيح API داخل Git أو الواجهة الأمامية.
- لا ادعاء بأن مزوداً أو نموذجاً يعمل قبل اختبار health وتوليد حقيقي.
- لا استدعاء مدفوع دون موافقة واضحة.
- لا اعتبار SQLite على قرص مؤقت تخزيناً دائماً؛ يلزم volume دائم أو object storage.
- لا نعتبر المهمة مستأنفة بعد restart لمجرد بقاء metadata؛ يجب إعادة تشغيل الجزء غير المكتمل أو استكماله فعلياً.
- كل مرحلة لها اختبارات قبول ونتائج موثقة قبل الانتقال للمرحلة التالية.
