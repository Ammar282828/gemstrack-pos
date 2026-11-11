package erp.app.data

import erp.app.ErpApp
import erp.app.ui.Tone
import erp.core.logic.Machines

/**
 * The state machines' table (machines.json, copied from apps/iphone/App/Resources into the assets at build): the words and tone of
 * every status and the moves it allows. The ERP's server enforces the same table and answers 409 for any other move; screens
 * read it here so they offer only what can happen, and say each status as the web does.
 *
 * Where the table cannot be read (a unit test on the JVM has no assets) it is [Machines.EMPTY]: every move is offered, no word or
 * tone is known, so each caller keeps its own and the server decides.
 */
object MachineTable {
    @Volatile private var override: Machines? = null

    private val loaded: Machines by lazy {
        val text = runCatching { ErpApp.instance.assets.open("machines.json").bufferedReader().use { it.readText() } }.getOrNull()
        if (text == null) Machines.EMPTY else Machines.parse(text)
    }

    val current: Machines get() = override ?: loaded

    /** A test's own table (null puts the assets' back). */
    fun install(table: Machines?) { override = table }

    /** The status's tone as the table names it, in the app's [Tone]; null where the table has none. */
    fun tone(machine: String, state: String): Tone? = current.tone(machine, state)?.let { name -> Tone.entries.firstOrNull { it.name == name } }

    /** The status's words as the table has them. */
    fun label(machine: String, state: String): String? = current.label(machine, state)
}
