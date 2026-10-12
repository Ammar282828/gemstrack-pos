package erp.app.nav

import androidx.compose.runtime.staticCompositionLocalOf
import androidx.navigation3.runtime.NavKey
import kotlinx.serialization.Serializable

/**
 * A place in the ERP, by its path ("/orders/ORD-000123"): what a back stack holds (Navigation 3 saves it across config
 * changes and process death). `n` is its depth when pushed, so the same place twice in one stack keeps two states.
 */
@Serializable
data class Route(val path: String, val n: Int = 0) : NavKey

/**
 * How a screen goes somewhere: the iPhone's `NavigationLink(value: Route(path:))`. Each tab, and the create sheet,
 * provides its own, so a screen never makes a back stack of its own (CONVENTIONS.md rule 8).
 */
interface Navigator {
    /** Push this ERP path onto the stack the screen is on (a screen with a native version, else the ERP page). */
    fun open(path: String)

    /** Pop one screen; at a stack's root, leave the sheet or do nothing. */
    fun back()

    /** More than the root is on the stack. */
    val canGoBack: Boolean
}

val LocalNavigator = staticCompositionLocalOf<Navigator> { error("No Navigator provided") }

/** The path of the Search tab's own page, which is not an ERP place. */
const val SEARCH_PATH = "/_search"
