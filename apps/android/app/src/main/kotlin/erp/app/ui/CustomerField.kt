package erp.app.ui

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DirectionsWalk
import androidx.compose.material.icons.filled.NorthWest
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.core.logic.CustomerSearch
import erp.core.logic.pakistanE164
import erp.core.models.Customer
import erp.core.models.Invoice
import erp.core.models.Order

private enum class Field { Name, Phone }

/**
 * Who a sale or an order is for, as New sale and New order take it (the web's customer-autocomplete.tsx, both
 * forms): the book is offered as the name is typed, right under the box, and a tap fills the name, the customer
 * and their number. A number typed first finds its customer too. Nothing picked is a new customer (a name or a
 * number typed) or a walk-in (nothing), and the screen's own rules decide which (lib/walk-in.ts).
 *
 * - [name], [phone]: as typed (the picked customer's name once one is picked); [onType] and [onPhoneChange] take edits.
 * - [pickedId]: the customer on file, when one was picked. Typing lets go of a picked customer, as the web's box does.
 * - [book]: the whole book; removed customers and old walk-in records are left out here.
 * - [recent]: the last few people served, offered before anything is typed ([RecentCustomers.recent]). Asked for only then.
 * - [onPick]: a pick from the book; null is the walk-in.
 */
@Composable
fun CustomerField(
    name: String,
    pickedId: String?,
    phone: String,
    book: List<Customer>,
    onType: (String) -> Unit,
    onPhoneChange: (String) -> Unit,
    onPick: (Customer?) -> Unit,
    modifier: Modifier = Modifier,
    recent: () -> List<Customer> = { emptyList() },
) {
    val focusManager = LocalFocusManager.current
    var focus by remember { mutableStateOf<Field?>(null) }
    // The customer just picked. The name box gives way to them while it still has focus, and on its way out it
    // may write back what it last held, which would let go of the pick: nothing it writes counts until Change,
    // or the screen, lets go of them.
    var settled by remember { mutableStateOf<String?>(null) }
    val nameFocus = remember { FocusRequester() }
    val phoneFocus = remember { FocusRequester() }
    var wantName by remember { mutableIntStateOf(0) }

    val picked = pickedId?.takeIf { it.isNotEmpty() }?.let { id -> book.firstOrNull { it.id == id } }
    val typed = name.trim()
    val nameHits = if (focus == Field.Name && picked == null && typed.isNotEmpty()) CustomerSearch.rank(typed, book, 6) else emptyList()
    // A number being typed with no name picked: who it already belongs to.
    val phoneHits = if (focus == Field.Phone && picked == null && CustomerSearch.digitsTyped(phone).length >= 4) CustomerSearch.rank(phone, book, 3) else emptyList()

    LaunchedEffect(pickedId) { if (pickedId.isNullOrEmpty()) settled = null }
    LaunchedEffect(wantName) { if (wantName > 0) runCatching { nameFocus.requestFocus() } }

    Column(modifier.fillMaxWidth().animateContentSize(rememberErpMotion().spatial()), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (picked != null) {
            PickedRow(picked, phone) {
                settled = null
                onType("")
                onPhoneChange("")
                wantName++
            }
        } else {
            OutlinedTextField(
                value = name,
                onValueChange = { if (settled == null) onType(it) },
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(nameFocus)
                    .onFocusChanged { state -> focus = if (state.isFocused) Field.Name else if (focus == Field.Name) null else focus },
                label = { Text("Name") },
                placeholder = { Text("Search or type a new name") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, autoCorrectEnabled = false, imeAction = ImeAction.Next),
                keyboardActions = KeyboardActions(onNext = { phoneFocus.requestFocus() }),
            )
            if (focus == Field.Name) {
                if (typed.isEmpty()) {
                    Row(
                        Modifier.fillMaxWidth().defaultMinSize(minHeight = MinTouchTarget)
                            .clickable(role = Role.Button) { onPick(null); focusManager.clearFocus() },
                        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Filled.DirectionsWalk, contentDescription = null, Modifier.size(30.dp).padding(3.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("Walk-in", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    recent().take(4).forEach { c ->
                        HitRow(CustomerSearch.Hit(customer = c, match = null, byPhone = false), note = "Recent") {
                            settled = c.id; focusManager.clearFocus(); onPick(c)
                        }
                    }
                } else {
                    nameHits.forEach { hit ->
                        HitRow(hit, note = null) { settled = hit.customer.id; focusManager.clearFocus(); onPick(hit.customer) }
                    }
                    if (CustomerSearch.exact(typed, book).isEmpty()) {
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 8.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Filled.PersonAdd, contentDescription = null, Modifier.size(24.dp), tint = ErpColors.accent)
                            Text("New customer “$typed”", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            var phoneWasFocused by remember { mutableStateOf(false) }
            OutlinedTextField(
                value = phone,
                onValueChange = onPhoneChange,
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(phoneFocus)
                    .onFocusChanged { state ->
                        focus = if (state.isFocused) Field.Phone else if (focus == Field.Phone) null else focus
                        // The number kept as the ERP keeps it (+92…), as the web's phone box does, once the counter moves on.
                        if (phoneWasFocused && !state.isFocused) {
                            val kept = pakistanE164(phone)
                            if (kept != phone) onPhoneChange(kept)
                        }
                        phoneWasFocused = state.isFocused
                    },
                label = { Text("Phone") },
                placeholder = { Text("Optional") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            )
            phoneHits.forEach { hit ->
                HitRow(hit, note = "This number is on file") { settled = hit.customer.id; focusManager.clearFocus(); onPick(hit.customer) }
            }
        }
    }
}

@Composable
private fun HitRow(hit: CustomerSearch.Hit, note: String?, onClick: () -> Unit) {
    val sub = listOf(hit.customer.phone ?: "", hit.customer.city ?: "").filter { it.isNotEmpty() }.joinToString(" · ")
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = MinTouchTarget).clickable(role = Role.Button, onClick = onClick),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Initials(hit.customer.name)
        Column(Modifier.weight(1f)) {
            Text(marked(hit), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (sub.isNotEmpty() || note != null) {
                Text(
                    listOfNotNull(note, sub.ifEmpty { null }).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Icon(Icons.Filled.NorthWest, contentDescription = null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f))
    }
}

@Composable
private fun PickedRow(c: Customer, phone: String, onChange: () -> Unit) {
    val sub = listOf(phone.ifEmpty { c.phone ?: "" }, c.city ?: "").filter { it.isNotEmpty() }.joinToString(" · ")
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Initials(c.name, size = 40.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(c.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Verified, contentDescription = null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    sub.ifEmpty { "On file" },
                    style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits),
                    color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
        }
        OutlinedButton(onClick = onChange, Modifier.defaultMinSize(minHeight = MinTouchTarget)) { Text("Change") }
    }
}

/** The typed letters marked in the name. */
@Composable
private fun marked(hit: CustomerSearch.Hit): AnnotatedString {
    val name = hit.customer.name
    val accent = ErpColors.accent
    return buildAnnotatedString {
        append(name)
        hit.match?.let { r ->
            val start = r.start.coerceIn(0, name.length)
            val end = r.end.coerceIn(start, name.length)
            addStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = accent), start, end)
        }
    }
}

/** The last people served, newest first: the invoices' and orders' customers, once each, still in the book. */
object RecentCustomers {
    fun recent(invoices: List<Invoice>, orders: List<Order>, book: List<Customer>, count: Int = 4): List<Customer> {
        val byId = HashMap<String, Customer>()
        CustomerSearch.people(book).forEach { byId.putIfAbsent(it.id, it) }
        val stamped = invoices.mapNotNull { i -> i.customerId?.let { it to i.createdAt } } +
            orders.mapNotNull { o -> o.customerId?.let { it to o.createdAt } }
        val seen = HashSet<String>()
        val out = ArrayList<Customer>()
        for ((id, _) in stamped.sortedByDescending { it.second }) {
            if (out.size >= count) break
            val c = byId[id] ?: continue
            if (!seen.add(id)) continue
            out.add(c)
        }
        return out
    }
}

/** A person's initials in a small circle of the house's colour, as Contacts and Messages show people. */
@Composable
fun Initials(name: String, modifier: Modifier = Modifier, size: Dp = 30.dp) {
    val parts = name.split(' ').filter { it.isNotEmpty() }.take(2)
    val letters = parts.joinToString("") { it.first().uppercase() }.ifEmpty { "?" }
    val accent = MaterialTheme.colorScheme.onSecondaryContainer
    val textSize = with(LocalDensity.current) { (size * 0.4f).toSp() }
    androidx.compose.foundation.layout.Box(
        modifier.size(size).clip(CircleShape).background(MaterialTheme.colorScheme.secondaryContainer).clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) {
        Text(letters, color = accent, fontSize = textSize, lineHeight = textSize, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.SansSerif, maxLines = 1, softWrap = false)
    }
}
