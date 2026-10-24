package erp.app.auth

import erp.app.ErpApp
import erp.app.config.Business
import erp.app.config.Businesses

/**
 * One [Session] per business, made for the open one (Sessions in Session.swift). Firebase keeps each business's sign-in in its
 * own app, so every business stays signed in independently; only the open business's session is live at a time. Switching drops
 * the one left and opens the next from its cached answer, as a cold start does.
 */
object Sessions {
    private val all = HashMap<String, Session>()

    /** The open business's session, made the first time it is asked for. */
    val current: Session get() = of(Businesses.current)

    @Synchronized
    fun of(b: Business): Session = all.getOrPut(b.id) { Session(ErpApp.instance, b) }

    /** The business was left: its session stops (its books and stores start again for the next one). */
    @Synchronized
    fun deactivate(id: String) { all.remove(id)?.close() }

    @Synchronized
    fun drop(id: String) { all.remove(id)?.close() }
}
