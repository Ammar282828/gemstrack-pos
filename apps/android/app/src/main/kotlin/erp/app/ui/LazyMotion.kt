package erp.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.lazy.LazyItemScope
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridItemScope
import androidx.compose.foundation.lazy.grid.LazyGridItemSpanScope
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * A keyed `item` that moves, arrives and leaves with the list (`Modifier.animateItem()`: a placement spring, a fade in and out,
 * from the theme's motion scheme by default) instead of jumping: a section that appears under a filter, a heading that goes,
 * a row that is reordered. Use it for every keyed single item of a column; the data rows use `items(key = …)` with the modifier
 * on their own root. Reduce Motion: the item animations follow the system's animator scale by themselves.
 */
fun LazyListScope.animatedItem(key: Any, contentType: Any? = null, content: @Composable LazyItemScope.() -> Unit) {
    item(key = key, contentType = contentType) {
        val scope = this
        Box(Modifier.animateItem()) { scope.content() }
    }
}

/** The same for a grid's keyed item (it takes the span as `item` does). */
fun LazyGridScope.animatedItem(
    key: Any,
    span: (LazyGridItemSpanScope.() -> GridItemSpan)? = null,
    contentType: Any? = null,
    content: @Composable LazyGridItemScope.() -> Unit,
) {
    item(key = key, span = span, contentType = contentType) {
        val scope = this
        Box(Modifier.animateItem()) { scope.content() }
    }
}
