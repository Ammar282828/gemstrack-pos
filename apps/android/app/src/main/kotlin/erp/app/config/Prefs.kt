package erp.app.config

import android.content.Context
import android.content.SharedPreferences

/**
 * The phone's small settings (the iPhone's UserDefaults): the last answer of /api/app/me, the theme, the
 * lock switch, a draft's remote id. Synchronous on purpose: Session reads its cached answer before the
 * first frame, and a DataStore read would make a cold start wait. Nothing secret lives here: those are
 * kept in the Keystore (device/BiometricVault).
 */
object Prefs {
    private var store: SharedPreferences? = null

    /** Before init (unit tests) everything is kept in memory. */
    private val memory = HashMap<String, Any?>()

    fun init(context: Context) {
        if (store == null) store = context.applicationContext.getSharedPreferences("erp", Context.MODE_PRIVATE)
    }

    fun string(key: String): String? = store?.getString(key, null) ?: (if (store == null) memory[key] as? String else null)

    fun putString(key: String, value: String?) {
        val s = store
        if (s == null) { memory[key] = value; return }
        s.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
    }

    fun bool(key: String): Boolean? {
        val s = store ?: return memory[key] as? Boolean
        return if (s.contains(key)) s.getBoolean(key, false) else null
    }

    fun putBool(key: String, value: Boolean?) {
        val s = store
        if (s == null) { memory[key] = value; return }
        s.edit().apply { if (value == null) remove(key) else putBoolean(key, value) }.apply()
    }

    fun remove(key: String) {
        putString(key, null)
    }
}
