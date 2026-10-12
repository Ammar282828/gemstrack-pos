package erp.core.entry

import erp.core.logic.MarginSettings

/**
 * Stand-in for the iPhone's App/Config/House.swift (as Contract's House.swift is): only what the New order and
 * New sale logic reads. core knows no BuildConfig, so the app sets `id` once at start ("taheri" or "mina"; the
 * code's default is Taheri's, as everywhere) and the contract generator switches it to write both houses' cases.
 */
object EntryHouse {
    @Volatile
    var id: String = "taheri"

    /** The metal a new piece starts on. */
    val metal: String get() = if (id == "mina") "silver" else "gold"

    val margin: MarginSettings get() = if (id == "mina") MarginSettings.mina else MarginSettings.taheri
}
