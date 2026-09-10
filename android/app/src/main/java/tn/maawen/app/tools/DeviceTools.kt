package tn.maawen.app.tools

import android.Manifest
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import tn.maawen.app.data.DeviceCall
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Les « apps » qui vivent sur le téléphone.
 *
 * Le serveur ne les exécute jamais: il renvoie l'appel, on l'exécute ici,
 * et on lui rend le résultat. Deux conséquences voulues:
 *   • l'agenda et les contacts ne quittent pas l'appareil, sauf le petit
 *     extrait que l'assistant a besoin de lire pour répondre;
 *   • envoyer un SMS ou lancer un appel reste un geste de l'utilisateur.
 */
object DeviceTools {

    private val TZ: ZoneId = ZoneId.of("Africa/Tunis")

    suspend fun run(context: Context, call: DeviceCall): JSONObject = withContext(Dispatchers.IO) {
        try {
            when (call.tool) {
                "agenda_lire" -> readCalendar(context, call.input)
                "agenda_ajouter" -> addEvent(context, call.input)
                "rappel" -> setReminder(context, call.input)
                "contacts_chercher" -> findContact(context, call.input)
                "sms_preparer" -> prepareSms(context, call.input)
                "appel" -> dial(context, call.input)
                else -> error("app inconnue: ${call.tool}")
            }
        } catch (e: SecurityException) {
            JSONObject().put("error", "ما عنديش الإذن باش نستعمل ${call.tool}.")
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "صار مشكل")
        }
    }

    fun has(context: Context, permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    // ──────────────────────────────────────────────────────────── agenda ──

    private fun readCalendar(context: Context, input: JSONObject): JSONObject {
        if (!has(context, Manifest.permission.READ_CALENDAR)) {
            return JSONObject().put("error", "الإذن متاع الروزنامة ماهوش معطى.")
        }
        val from = day(input.optString("du"))
        val to = day(input.optString("au")).plusDays(1)
        val start = from.atStartOfDay(TZ).toInstant().toEpochMilli()
        val end = to.atStartOfDay(TZ).toInstant().toEpochMilli()

        val projection = arrayOf(
            CalendarContract.Instances.TITLE,
            CalendarContract.Instances.BEGIN,
            CalendarContract.Instances.END,
            CalendarContract.Instances.EVENT_LOCATION,
            CalendarContract.Instances.ALL_DAY,
        )

        val events = JSONArray()
        val uri = CalendarContract.Instances.CONTENT_URI.buildUpon().apply {
            ContentUris.appendId(this, start)
            ContentUris.appendId(this, end)
        }.build()

        context.contentResolver.query(uri, projection, null, null, "${CalendarContract.Instances.BEGIN} ASC")
            ?.use { cursor ->
                while (cursor.moveToNext() && events.length() < 25) {
                    val begin = cursor.getLong(1)
                    events.put(
                        JSONObject()
                            .put("titre", cursor.getString(0) ?: "")
                            .put("debut", isoMinutes(begin))
                            .put("fin", isoMinutes(cursor.getLong(2)))
                            .put("lieu", cursor.getString(3) ?: "")
                            .put("journee_entiere", cursor.getInt(4) == 1),
                    )
                }
            }
        return JSONObject().put("du", from.toString()).put("evenements", events)
    }

    private fun addEvent(context: Context, input: JSONObject): JSONObject {
        if (!has(context, Manifest.permission.WRITE_CALENDAR)) {
            return JSONObject().put("error", "الإذن متاع كتبة في الروزنامة ماهوش معطى.")
        }
        val titre = input.optString("titre").ifBlank { return JSONObject().put("error", "العنوان فارغ") }
        val debut = moment(input.optString("debut"))
        val minutes = input.optInt("duree_minutes", 60).coerceIn(5, 24 * 60)
        val calendarId = primaryCalendarId(context)
            ?: return JSONObject().put("error", "ما فماش روزنامة مسجّلة في التليفون.")

        val values = ContentValues().apply {
            put(CalendarContract.Events.CALENDAR_ID, calendarId)
            put(CalendarContract.Events.TITLE, titre)
            put(CalendarContract.Events.DTSTART, debut)
            put(CalendarContract.Events.DTEND, debut + minutes * 60_000L)
            put(CalendarContract.Events.EVENT_TIMEZONE, TZ.id)
            input.optString("lieu").takeIf { it.isNotBlank() }
                ?.let { put(CalendarContract.Events.EVENT_LOCATION, it) }
            input.optString("note").takeIf { it.isNotBlank() }
                ?.let { put(CalendarContract.Events.DESCRIPTION, it) }
        }

        val uri = context.contentResolver.insert(CalendarContract.Events.CONTENT_URI, values)
            ?: return JSONObject().put("error", "ما نجّمناش نزيدو الموعد.")

        // Un rappel 15 minutes avant, comme on s'y attend d'un assistant.
        ContentUris.parseId(uri).let { eventId ->
            runCatching {
                context.contentResolver.insert(
                    CalendarContract.Reminders.CONTENT_URI,
                    ContentValues().apply {
                        put(CalendarContract.Reminders.EVENT_ID, eventId)
                        put(CalendarContract.Reminders.MINUTES, 15)
                        put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT)
                    },
                )
            }
        }
        return JSONObject().put("ajoute", JSONObject().put("titre", titre).put("debut", isoMinutes(debut)))
    }

    private fun primaryCalendarId(context: Context): Long? {
        val projection = arrayOf(
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.IS_PRIMARY,
            CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,
        )
        var fallback: Long? = null
        context.contentResolver.query(
            CalendarContract.Calendars.CONTENT_URI,
            projection,
            "${CalendarContract.Calendars.VISIBLE} = 1",
            null,
            null,
        )?.use { cursor ->
            while (cursor.moveToNext()) {
                val id = cursor.getLong(0)
                val writable = cursor.getInt(2) >= CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR
                if (!writable) continue
                if (cursor.getInt(1) == 1) return id
                if (fallback == null) fallback = id
            }
        }
        return fallback
    }

    // ─────────────────────────────────────────────────────────── rappels ──

    /**
     * Moins de 24 h → une alarme (rien à installer, ça sonne).
     * Plus loin → un événement d'agenda avec rappel, si l'app y a droit.
     */
    private fun setReminder(context: Context, input: JSONObject): JSONObject {
        val titre = input.optString("titre").ifBlank { "تذكير" }
        val quand = input.optString("quand")
        val at = moment(quand)
        val delay = at - System.currentTimeMillis()

        if (delay in 0..(24 * 3600_000L)) {
            val local = java.time.Instant.ofEpochMilli(at).atZone(TZ)
            val intent = Intent(AlarmClock.ACTION_SET_ALARM).apply {
                putExtra(AlarmClock.EXTRA_HOUR, local.hour)
                putExtra(AlarmClock.EXTRA_MINUTES, local.minute)
                putExtra(AlarmClock.EXTRA_MESSAGE, titre)
                putExtra(AlarmClock.EXTRA_SKIP_UI, true)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            return if (intent.resolveActivity(context.packageManager) != null) {
                context.startActivity(intent)
                JSONObject().put("rappel", JSONObject().put("titre", titre).put("heure", isoMinutes(at)))
            } else {
                JSONObject().put("error", "ما فماش تطبيق منبّه في التليفون.")
            }
        }

        return addEvent(
            context,
            JSONObject().put("titre", titre).put("debut", quand).put("duree_minutes", 30),
        )
    }

    // ────────────────────────────────────────────────── contacts / envoi ──

    private fun findContact(context: Context, input: JSONObject): JSONObject {
        if (!has(context, Manifest.permission.READ_CONTACTS)) {
            return JSONObject().put("error", "الإذن متاع الرقيمات ماهوش معطى.")
        }
        val name = input.optString("nom").trim()
        if (name.isBlank()) return JSONObject().put("error", "الاسم فارغ")

        val results = JSONArray()
        context.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER,
            ),
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ?",
            arrayOf("%$name%"),
            null,
        )?.use { cursor ->
            val seen = mutableSetOf<String>()
            while (cursor.moveToNext() && results.length() < 8) {
                val number = cursor.getString(1)?.replace(" ", "") ?: continue
                if (!seen.add(number)) continue
                results.put(JSONObject().put("nom", cursor.getString(0) ?: "").put("numero", number))
            }
        }
        return JSONObject().put("contacts", results)
    }

    private fun prepareSms(context: Context, input: JSONObject): JSONObject {
        val number = input.optString("numero").ifBlank { "" }
        val message = input.optString("message")
        val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:$number")).apply {
            putExtra("sms_body", message)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return if (intent.resolveActivity(context.packageManager) != null) {
            context.startActivity(intent)
            // On ne dit jamais « envoyé »: l'utilisateur appuie lui-même.
            JSONObject().put("brouillon_ouvert", true).put("numero", number)
        } else {
            JSONObject().put("error", "ما فماش تطبيق رسائل.")
        }
    }

    private fun dial(context: Context, input: JSONObject): JSONObject {
        val number = input.optString("numero")
        if (number.isBlank()) return JSONObject().put("error", "النمرة فارغة")
        val intent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:$number"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        return JSONObject().put("clavier_ouvert", true).put("numero", number)
    }

    // ───────────────────────────────────────────────────────────── dates ──

    private fun day(value: String): LocalDate =
        runCatching { LocalDate.parse(value.take(10)) }.getOrElse { LocalDate.now(TZ) }

    private fun moment(value: String): Long {
        val text = value.trim()
        return runCatching {
            if (text.length <= 10) day(text).atTime(9, 0).atZone(TZ).toInstant().toEpochMilli()
            else LocalDateTime.parse(text.take(16), DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm"))
                .atZone(TZ).toInstant().toEpochMilli()
        }.getOrElse { System.currentTimeMillis() + 3600_000L }
    }

    private fun isoMinutes(millis: Long): String =
        java.time.Instant.ofEpochMilli(millis).atZone(TZ)
            .format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm"))
}
