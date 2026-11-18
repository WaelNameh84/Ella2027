# Ella GPU Worker — خدمة توليد الفيديو

هذه خدمة فعلية تربط Ella بخادم ComfyUI عبر API، وتدعم فحص الصحة والقدرات، اختيار النموذج المعلن، المهام غير المتزامنة، وتقسيم المشهد الطويل إلى مقاطع ثم دمجها بـ FFmpeg.

## مهم قبل التشغيل

- هذا المجلد لا يحتوي أوزان Wan أو ComfyUI ولا يمنح GPU مجانياً. يجب تشغيله على جهاز/خادم فيه NVIDIA GPU وComfyUI ونموذج فيديو مثبت.
- يجب تصدير Workflow من ComfyUI بصيغة **API format** وحفظه باسم `workflows/video_api.json`.
- عدّل `.env` ليتوافق مع أرقام العقد وأسماء المدخلات في Workflow الفعلي. القيم في `.env.example` أمثلة وليست ضماناً أنها تطابق أي Workflow جاهز.
- يجب أن يحتوي الـ workflow على عقدة إخراج فيديو تكتب ملفاً في ComfyUI history (مثل VHS_VideoCombine أو عقدة فيديو مكافئة). ضع رقمها في `COMFYUI_VIDEO_OUTPUT_NODE`.
- تقسيم المشهد يكرر صورة المرجع نفسها لكل مقطع ويضيف تعليمات استمرارية؛ هذا لا يضمن تطابق الوجه بنسبة 100%. للحصول على ثبات أقوى، استخدم workflow يدعم Character LoRA/Reference أو image conditioning.

## تشغيل

1. شغّل ComfyUI على المنفذ 8188 مع API متاح.
2. انسخ `.env.example` إلى `.env` وعدّل كل القيم.
3. ضع API workflow في `workflows/video_api.json`.
4. شغّل:

```bash
docker build -t ella-gpu-worker .
docker run --gpus all --env-file .env -p 8000:8000 -v "$PWD/workflows:/app/workflows" ella-gpu-worker
```

إذا كان ComfyUI في حاوية منفصلة، استخدم اسم الخدمة في `COMFYUI_URL` واجعل الحاويتين على Docker network واحدة. لا تستخدم `127.0.0.1` من داخل حاوية العامل للوصول إلى حاوية ComfyUI أخرى.

## ربط Ella

على خادم API الخاص بـ Ella:

- `LOCAL_VIDEO_WORKER_URL=https://عنوان-العامل`
- في إعدادات Video أضف مزود `Ella Local GPU Worker` ومفتاح API نفسه الموجود في `WORKER_API_TOKEN`.
- فعّل المزود ثم نفّذ Test.

## حدود النسخة الأولى

- سجل المهام في الذاكرة؛ إعادة تشغيل العامل تفقد حالة المهام الجارية. لا تستخدم عدة replicas خلف load balancer.
- لا يوجد استئناف تلقائي بعد إعادة تشغيل ComfyUI/العامل. Ella لا تعيد إرسال نفس المشهد إلا حسب منطق سجلها الحالي.
- يتم نقل MP4 إلى Ella بصيغة base64 وفق عقدها الحالي، لذلك حد الملف الافتراضي 250MB.
- قيمة النموذج في `/capabilities` اسم تكوين `ELLA_MODEL_ID`؛ تأكد أن الـ workflow المحفوظ يشغّل ذلك النموذج فعلاً.
