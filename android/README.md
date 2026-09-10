# المعاون — تطبيق Android

هذا مشروع Android بسيط: WebView يعرض واجهة الـagent (اللي يخدمها السرفور
متاعك)، وزيد الحوايج اللي الـWebView وحدو ما ينجّمش يعملهم:

| الخدمة | الكود | الملاحظة |
|---|---|---|
| تعرّف على الصوت بالتونسي | `SpeechRecognizer` مع `ar-TN` | الـWeb Speech API ما تخدمش في WebView، علاش عملناها native |
| قراية الجواب بالصوت | `TextToSpeech` (`ar-TN` وإلا `ar`) | |
| SMS | `ACTION_SENDTO` + `sms_body` | ما فماش permission `SEND_SMS`: التطبيق يحلّ برك تطبيق الرسائل والتاجر هو اللي يبعث |
| عنوان السرفور | `SharedPreferences` | يتبدّل من "الدفتر" ← «بدّل عنوان السرفور» |

الجسر متاع JavaScript إسمو `window.TnNative`:

```js
TnNative.startListening('ar-TN');   // → window.tnOnSpeechPartial / tnOnSpeechResult / tnOnSpeechError
TnNative.stopListening();
TnNative.speak('نص');
TnNative.stopSpeaking();
TnNative.sendSms('+216...', 'نص الرسالة');   // يحلّ تطبيق الرسائل، ما يبعثش وحدو
TnNative.openSettings();
```

## كيفاش تعمل الـAPK

الطريق الأسهل: افتح مجلّد `android/` في **Android Studio** (Ladybug ولا أجدّ)،
خلّيه ينزّل الـSDK وحدو، وبعد **Run**.

من الـterminal (لازم Android SDK مركّب و`ANDROID_HOME` محطوط):

```bash
cd android
echo "sdk.dir=$ANDROID_HOME" > local.properties
./gradlew assembleDebug
# الـAPK: app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

> ملاحظة: المشروع هذا **ما تكومبيلاش** في البيئة اللي تكتب فيها الكود (ما فماش
> Android SDK غادي). أول build لازم يكون عندك Android Studio ولا `sdkmanager`.

## أول مرة تحلّ التطبيق

يسألك على عنوان السرفور. حطّ العنوان متاع الجهاز اللي يخدم فيه `npm start`:

- تليفون حقيقي على نفس الـWi-Fi: `http://192.168.1.x:3000`
- Émulateur: `http://10.0.2.2:3000` (هذا هو الـdéfaut)
- سرفور على الإنترنت: `https://...` (وقتها تنجّم تفسخ
  `network_security_config.xml` والـattribut متاعو من الـmanifest)

## الإعدادات التقنية

- `minSdk 24` (Android 7)، `targetSdk 35`
- بلا حتى dependency خارجي — framework Android برك
- Permissions: `INTERNET` و`RECORD_AUDIO` برك
