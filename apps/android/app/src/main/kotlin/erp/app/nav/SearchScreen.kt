package erp.app.nav

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import erp.app.ui.SearchBarField
import erp.app.ui.LedgerDivider
import erp.app.ui.SegmentedColumn
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.BuildConfig
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.data.LocalBook
import erp.app.data.rememberShelf
import erp.app.screens.money.MoneyPaths
import erp.app.screens.orders.OrdersLogic
import erp.app.ui.Monogram
import erp.app.ui.Radius
import erp.app.ui.RowAmount
import erp.app.ui.ShopDate
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.theme.ErpColors
import kotlinx.coroutines.delay

/**
 * The Search tab (SearchHome.swift). Idle it is one calm list in the house's colour: the ERP's whole map by group
 * (Analytics under "Overview"), then the account. Typed into, it finds places, customers, invoices, orders, stock and
 * repairs. No quick buttons and no recents (removed 2026-10-24). Every row is one `clickable` and nothing else:
 * a second tap detector on a row ate taps on the iPhone.
 */
@Composable
fun SearchScreen() {
    val session = LocalSession.current
    val me by session.me.collectAsStateWithLifecycle()
    val role = me?.role ?: "none"
    val map = remember(role) { NavMap.current.visible(role) }
    var text by rememberSaveable { mutableStateOf("") }
    val typed = text.trim()
    // The results are worked out from the words after a pause in typing.
    var query by remember { mutableStateOf("") }
    var expanded by remember { mutableStateOf(setOf<String>()) }
    var signingOut by remember { mutableStateOf(false) }

    // Marketing has no Firestore and the server refuses it the books: nothing to read for them.
    val readsBooks = role != "marketing"
    val book = LocalBook.current
    // The shelves are asked for only once someone types.
    val asked = typed.isNotEmpty() && readsBooks
    val customers by rememberOrEmpty(asked) { rememberShelf(book.customers) }
    val invoices by rememberOrEmpty(asked) { rememberShelf(book.invoices) }
    val orders by rememberOrEmpty(asked) { rememberShelf(book.orders) }
    val stock by rememberOrEmpty(asked) { rememberShelf(book.products) }
    val repairs by rememberOrEmpty(asked) { rememberShelf(book.repairs) }

    LaunchedEffect(text) {
        val next = text.trim()
        if (next.isEmpty()) { query = ""; expanded = emptySet(); return@LaunchedEffect }
        delay(150)
        query = next
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 96.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item(key = "field") {
            // Material 3's search bar: a full-round field on the container tone, the search glyph first, no outline.
            SearchBarField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                placeholder = { Text("Customers, invoices, orders, stock, places", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                leadingIcon = { Icon(Symbols.Search, null) },
                trailingIcon = { if (text.isNotEmpty()) IconButton({ text = "" }) { Icon(Symbols.Clear, "Clear") } },
            )
        }
        if (typed.isEmpty()) {
            for (g in SearchLogic.groups(map)) {
                item(key = "g-${g.key}") {
                    Group(g.label) {
                        g.entries.forEachIndexed { i, e ->
                            if (i > 0) Hairline()
                            Line(e.label, null, NavIcon.vector(e.icon), e.href)
                            for ((name, first) in SearchLogic.sectionRows(e)) {
                                Hairline()
                                Line(name, null, NavIcon.vector(first.icon ?: e.icon), first.href, quiet = true)
                            }
                        }
                    }
                }
            }
            item(key = "account") {
                Group("Account") {
                    Line("Businesses", null, Symbols.Domain, "/app/businesses"); Hairline()
                    if (session.isOwner) { Line("This phone", null, Symbols.PhoneAndroid, "/app/phone"); Hairline() }
                    // The map is already this person's: Settings is in it for owners only.
                    map.settings?.let { s -> Line(s.label, null, NavIcon.vector(s.icon), s.href); Hairline() }
                    val email = me?.email.orEmpty()
                    if (email.isNotEmpty()) {
                        Text(
                            "Signed in as $email",
                            Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 16.dp, vertical = 14.dp),
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                        Hairline()
                    }
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button) { signingOut = true }.padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Icon(Symbols.Logout, null, tint = Tone.problem.color())
                        Text("Sign out", style = MaterialTheme.typography.bodyLarge, color = Tone.problem.color())
                    }
                }
                Text(
                    "${House.storeName} · ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
                    Modifier.fillMaxWidth().padding(top = 8.dp),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }
        } else {
            val r = SearchResults.of(query, map, customers, invoices, orders, stock, repairs)
            val settled = query.equals(typed, ignoreCase = true)
            if (settled && r.isEmpty) {
                item(key = "none") {
                    Text(
                        "No results for \"$typed\"",
                        Modifier.padding(24.dp),
                        style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            results("Places", r.places, expanded, { expanded += it }, { it.id }) { h ->
                Line(h.place.label, h.entry?.label?.takeIf { it != h.place.label }, NavIcon.vector(h.place.icon), h.place.href)
            }
            results("Customers", r.customers, expanded, { expanded += it }, { it.id }) { c ->
                Line(c.name, c.phone?.takeIf { it.isNotEmpty() }, null, "/customers/" + MoneyPaths.encode(c.id), lead = { Monogram(c.name, size = 36.dp) })
            }
            results("Invoices", r.invoices, expanded, { expanded += it }, { it.id }) { i ->
                val line = listOf(i.customerName, ShopDate.say(i.createdAt)).filter { it.isNotEmpty() }.joinToString(" · ")
                Line(i.id, line, null, "/invoices/" + MoneyPaths.encode(i.id), trailing = {
                    RowAmount(if (i.balanceDue > 0) i.balanceDue else i.grandTotal, tone = if (i.balanceDue > 0) Tone.owed.color() else Color.Unspecified)
                })
            }
            results("Orders", r.orders, expanded, { expanded += it }, { it.id }) { o ->
                val due = OrdersLogic.balance(o)
                Line(o.id, o.customerName.orEmpty(), null, "/orders/" + MoneyPaths.encode(o.id), status = o.status.rawValue to Tone(o.status), trailing = {
                    if (due > 0) RowAmount(due, tone = Tone.owed.color())
                })
            }
            results("Stock", r.stock, expanded, { expanded += it }, { it.sku }) { p ->
                Line(p.name.ifEmpty { p.sku }, p.sku.takeIf { p.name.isNotEmpty() }, null, "/products/" + MoneyPaths.encode(p.sku))
            }
            results("Repairs", r.repairs, expanded, { expanded += it }, { it.id }) { x ->
                Line(x.id, x.customerName, null, MoneyPaths.repair(x.id))
            }
        }
    }

    if (signingOut) {
        AlertDialog(
            onDismissRequest = { signingOut = false },
            title = { Text("Sign out?") },
            text = { Text("You will need to sign in with Google again.") },
            confirmButton = { TextButton(onClick = { signingOut = false; session.signOut() }) { Text("Sign out", color = Tone.problem.color()) } },
            dismissButton = { TextButton(onClick = { signingOut = false }) { Text("Cancel") } },
        )
    }
}

/** The shelf's items once something is typed; nothing (and no request to the books) before. */
@Composable
private fun <T> rememberOrEmpty(asked: Boolean, read: @Composable () -> androidx.compose.runtime.State<List<T>>): androidx.compose.runtime.State<List<T>> =
    if (asked) read() else remember { mutableStateOf(emptyList()) }

private const val CAP = 5

/** One kind's results: up to five rows, then "Show all N". Left out when there are none. */
private fun <T> androidx.compose.foundation.lazy.LazyListScope.results(
    title: String,
    items: List<T>,
    expanded: Set<String>,
    expand: (String) -> Unit,
    key: (T) -> String,
    row: @Composable (T) -> Unit,
) {
    if (items.isEmpty()) return
    item(key = "r-$title") {
        val open = title in expanded
        Group(title) {
            val shown = if (open) items else items.take(CAP)
            shown.forEachIndexed { i, it ->
                if (i > 0) Hairline()
                androidx.compose.runtime.key(key(it)) { row(it) }
            }
            if (!open && items.size > CAP) {
                Hairline()
                Text(
                    "Show all ${items.size}",
                    Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button) { expand(title) }.padding(horizontal = 16.dp, vertical = 14.dp),
                    style = MaterialTheme.typography.bodyLarge, color = ErpColors.accent,
                )
            }
        }
    }
}

/** A heading over a card of rows, on the house's ground. */
@Composable
private fun Group(title: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        erp.app.ui.LedgerHeading(title, Modifier.padding(start = 16.dp, top = 8.dp))
        SegmentedColumn { content() }
    }
}

/** Between two rows of a group: only a marker, the gap between the tiles is the line. */
@Composable
private fun Hairline() = LedgerDivider()

/**
 * One line: an icon (in the house's accent) or a lead, a name, and under it a second line (the row a place sits in,
 * a phone, a customer and date) and a status; a sum at the trailing edge. A single `clickable` opens [path].
 */
@Composable
private fun Line(
    label: String,
    secondary: String?,
    icon: ImageVector?,
    path: String,
    quiet: Boolean = false,
    lead: (@Composable () -> Unit)? = null,
    status: Pair<String, Tone>? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    val navigator = LocalNavigator.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button) { navigator.open(path) }.padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // Text-only rows (a result with a name and a sum) start at the edge: no empty icon slot.
        if (lead != null) lead() else if (icon != null) Icon(icon, null, tint = ErpColors.accent)
        Column(Modifier.weight(1f)) {
            Text(
                label, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis,
                color = if (quiet) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
            )
            if (!secondary.isNullOrEmpty()) {
                Text(secondary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (status != null) Text(status.first, style = MaterialTheme.typography.bodySmall, color = status.second.color())
        }
        trailing?.invoke()
    }
}
