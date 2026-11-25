# ELLA VIDEO ENGINE — Kaggle T4 (Wan 2.2 TI2V 5B)

هذه أول نسخة تشغيل تجريبية مستقلة للمحرك. تستخدم أوزان Wan 2.2 TI2V 5B بصيغة GGUF Q4 مع stable-diffusion.cpp. الكود والتنظيم باسم ELLA؛ النموذج الأساسي وأوزانه من أصحابها الأصليين وليست مدرّبة من الصفر.

## المتطلبات
- Kaggle Notebook مع GPU مفعّل. الأفضلية لتجربة T4 16GB؛ توفر GPU والحصص المجانية يخضعان لسياسة Kaggle وقد لا يكونان متاحين دائماً.
- مساحة قرص كافية لتنزيل الحزمة (حوالي 8GB بحسب بطاقة النموذج، إضافة إلى مساحة البناء والإطارات).
- لا توجد مفاتيح API مدفوعة ولا أوزان محفوظة في GitHub.

## القرار التقني
- Wan 2.2 TI2V 5B Q4_K_S: نموذج واحد يدعم text-to-video وimage-to-video.
- stable-diffusion.cpp: تشغيل GGUF مع full flash attention وdirect VAE convolution وVAE tiling.
- نبدأ بدقة 1280×704 أفقية و8 FPS وخمس ثوانٍ كاختبار. هذه إعدادات بدء وليست ضماناً أن كل T4 ستنجح؛ إذا نفدت الذاكرة نخفض الإعدادات بعد تسجيل الخطأ.
- عدد الإطارات يضبط تلقائياً إلى 4k+1 لأن VAE الزمني يتطلب هذا التوافق.
- ثبات الشخصيات ليس مضموناً من prompt وحده؛ سنضيف conditioning/مرجع شخصية بعد إثبات خط التوليد الأساسي.

## التشغيل
1. افتح الملف `notebooks/ELLA_WAN_ENGINE_KAGGLE.ipynb` في Kaggle.
2. من Notebook settings اختر GPU ثم شغّل الخلايا بالترتيب.
3. عدّل متغيرات PROMPT وDURATION وMODE في خلية الإعدادات.
4. عند image-to-video ارفع صورة مرجعية باسم `reference.png` إلى مساحة العمل أو عيّن مسارها.
5. الناتج في `/kaggle/working/ella_output.mp4`.

## حدود النسخة
- هذه مرحلة اختبار توليد محلي داخل Kaggle، وليست بعدُ وصلة الإنتاج مع Ella API أو طابور المشاهد.
- لا نضع Kaggle secrets أو Render tokens داخل Git.
- عند انقطاع جلسة Kaggle قد تضيع الملفات المؤقتة؛ يجب إعادة تشغيل الخلايا. الربط الإنتاجي لاحقاً سيضيف إرسال المهام وتأكيد النتائج وإعادة المحاولة.
- لا تدّعي هذه النسخة أن T4 يشغّل كل الدقات أو المدد. أول معيار قبول هو نجاح أول MP4 حقيقي على GPU المستخدم.

## المصادر والتراخيص
- Wan 2.2 TI2V 5B GGUF Q4: https://huggingface.co/off-grid-ai/Wan2.2-TI2V-5B-GGUF
- UMT5 companion: https://huggingface.co/off-grid-ai/Video-Companions-GGUF
- Runtime: https://github.com/leejet/stable-diffusion.cpp
- راجع بطاقات النماذج وملفات LICENSE/NOTICE قبل أي توزيع تجاري. تحويل GGUF لا يجعلنا مالكي النموذج.
