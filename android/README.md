# تطبيق Android — المعاون

تطبيق Kotlin + Jetpack Compose. يحكي مع Supabase برك: ما فماش حتى مفتاح
API متاع الذكاء الاصطناعي فيه، والكود متاع الفوترة والحساب الكل في الـEdge
Functions.

## شنوّة فيه

| الملف | يعمل شنوّة |
|---|---|
| `MainActivity.kt` | الشاشة الوحيدة + الـdeep links (دخول Google، رجوع من الخلاص) + الأذونات |
| `AppViewModel.kt` | الحالة، حلقة المحادثة، تنفيذ apps التليفون، حساب الوقت |
| `data/Api.kt` | نداءات Supabase (REST + Functions) بـ`HttpURLConnection` — بلا مكتبات |
| `data/Session.kt` | الجيتونات + رابط دخول Google |
| `tools/DeviceTools.kt` | apps التليفون: روزنامة، تذكير، رقيمات، SMS، مكالمة |
| `voice/Voice.kt` | `SpeechRecognizer` بـ`ar-TN` + `TextToSpeech` |
| `ui/` | الشاشات (Compose، RTL، ثيم أخضر غامق) |

## قبل ما تبني

اعمل `android/local.properties`:

```properties
sdk.dir=/path/to/Android/sdk
supabase.url=https://xxxxxxxx.supabase.co
supabase.anonKey=eyJhbGciOi...
```

> `anonKey` مفتاح عمومي عادي — الحماية الحقيقية هي الـRLS في Postgres.
> المفتاح متاع Claude ما يدخلش لهوني أبدًا.

## البناء

```bash
cd android
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
./gradlew installDebug           # تليفون موصول بـadb
```

بالنسبة لـrelease لازم keystore متاعك:

```bash
./gradlew assembleRelease
```

## الأذونات

التطبيق ما يطلب حتى إذن كي تحلّو. كل إذن يتطلب **وقت اللي المستخدم يشعّل الـapp
اللي تحتاجو** في شاشة «التطبيقات»:

| App | الإذن |
|---|---|
| الروزنامة (قراية/كتبة) | `READ_CALENDAR` / `WRITE_CALENDAR` |
| الرقيمات | `READ_CONTACTS` |
| تذكير | `SET_ALARM` (عادي، بلا نافذة) |
| SMS ومكالمة | **حتى إذن** — نحلّو تطبيق الرسائل/الclavier والمستخدم هو اللي يبعث |
| الميكرو | `RECORD_AUDIO` أول مرّة تضغط 🎙️ |

هكا التطبيق يعدّي في Google Play بلا مشاكل: سياسة Play تمنع `READ_SMS`/`SEND_SMS`
للتطبيقات اللي ماهيش تطبيق الرسائل الافتراضي.

## الدخول بـGoogle

ما فماش مكتبة Google في التطبيق. نحلّو صفحة Supabase في Custom Tab:

```
https://<project>.supabase.co/auth/v1/authorize?provider=google&redirect_to=maawen://auth
```

وSupabase يرجّعنا لـ`maawen://auth#access_token=…`. باش يخدم لازم:

1. في Supabase → Authentication → Providers → Google: حطّ Client ID/Secret.
2. في Supabase → Authentication → URL Configuration → Redirect URLs:
   زيد `maawen://auth` و`maawen://payment/success` و`maawen://payment/fail`.
