package erp.app.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** One thing a row can do: from a swipe, a long press, or TalkBack's actions menu. */
class RowAction(val label: String, val icon: ImageVector, val tone: Tone, val run: () -> Unit)

/**
 * The iPhone's `.swipeActions` and `.contextMenu` in Android's terms: a swipe from the left runs [start], from the
 * right runs [end] (the row springs back, as the iPhone's row does); a long press opens [menu]; TalkBack lists all
 * of them as actions. The content draws its own background so the swipe's colour shows only as it moves; give
 * [modifier] the content's shape (`clip`) so the colour does not square off a rounded card.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun SwipeActions(
    modifier: Modifier = Modifier,
    start: RowAction? = null,
    end: RowAction? = null,
    menu: List<RowAction> = emptyList(),
    /** More moves for TalkBack's actions menu only (a swipe has room for one a side; the iPhone's has two). */
    more: List<RowAction> = emptyList(),
    onClick: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    val haptics = rememberHaptics()
    val latestStart by rememberUpdatedState(start)
    val latestEnd by rememberUpdatedState(end)
    var menuOpen by remember { mutableStateOf(false) }
    val state = rememberSwipeToDismissBoxState(confirmValueChange = { target ->
        when (target) {
            SwipeToDismissBoxValue.StartToEnd -> latestStart?.run?.invoke()
            SwipeToDismissBoxValue.EndToStart -> latestEnd?.run?.invoke()
            SwipeToDismissBoxValue.Settled -> Unit
        }
        false
    })
    val all = (listOfNotNull(start, end) + more + menu).distinctBy { it.label }
    SwipeToDismissBox(
        state = state,
        modifier = modifier,
        enableDismissFromStartToEnd = start != null,
        enableDismissFromEndToStart = end != null,
        backgroundContent = {
            val direction = state.dismissDirection
            val action = when (direction) {
                SwipeToDismissBoxValue.StartToEnd -> start
                SwipeToDismissBoxValue.EndToStart -> end
                else -> null
            }
            if (action != null) {
                Box(
                    Modifier.fillMaxSize().background(action.tone.fill()).padding(horizontal = 20.dp),
                    contentAlignment = if (direction == SwipeToDismissBoxValue.StartToEnd) Alignment.CenterStart else Alignment.CenterEnd,
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(action.icon, contentDescription = null, tint = Color.White)
                        Text(action.label, color = Color.White, style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
        },
    ) {
        Box(
            Modifier
                // A card that handles its own taps (a head that opens, a button) is not made one big button.
                .then(
                    if (onClick == null && menu.isEmpty()) Modifier
                    else Modifier.combinedClickable(
                        onClick = { onClick?.invoke() },
                        onLongClick = if (menu.isEmpty()) null else ({ haptics.selection(); menuOpen = true }),
                    ),
                )
                .semantics { customActions = all.map { a -> CustomAccessibilityAction(a.label) { a.run(); true } } },
        ) {
            content()
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                for (a in menu) {
                    DropdownMenuItem(
                        text = { Text(a.label, color = if (a.tone == Tone.problem) Tone.problem.color() else Color.Unspecified) },
                        leadingIcon = { Icon(a.icon, contentDescription = null) },
                        onClick = { menuOpen = false; a.run() },
                    )
                }
            }
        }
    }
}
