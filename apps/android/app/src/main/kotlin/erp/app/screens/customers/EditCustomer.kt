package erp.app.screens.customers

import erp.app.ui.icons.Symbols
import erp.app.ui.ContainedLoading
import erp.app.ui.Loading
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.data.Connection
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.screens.neworder.ActionRow
import erp.app.screens.neworder.DateRow
import erp.app.screens.neworder.FieldRow
import erp.app.screens.neworder.ValueRow
import erp.app.ui.NotAvailableState
import erp.app.ui.ShelfState
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.readableColumn
import erp.app.ui.rememberHaptics
import erp.core.models.Customer
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private val DraftSaver = listSaver<CustomerDraft, String>(
    save = { d ->
        listOf(
            d.name, d.phone, d.altPhone, d.email, d.address, d.city, d.country, d.source, d.ringSize, d.bangleSize,
            d.braceletSize, d.chainLength, d.birthday, d.anniversary, d.preference, d.notes,
        )
    },
    restore = { v ->
        CustomerDraft(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10], v[11], v[12], v[13], v[14], v[15])
    },
)

/**
 * Edit customer (src/app/customers/[id]/edit/page.tsx, components/customer/customer-form.tsx in edit mode): every field
 * the web form has, the name, both numbers, email, address, city and country, the four sizes, the birthday and
 * anniversary, preferences, notes and the referral source.
 *
 * Saving is `updateCustomer` (owners only, as the browser's direct write is): the ERP checks the fields as the web form
 * does, makes the numbers E.164, merges them into the profile and writes "Updated customer" to the activity log. Only
 * what was changed is sent, so a field this form cannot show faithfully is never overwritten with a blank. A name left
 * blank becomes "Customer - <number>", or "Unnamed Customer", which the ERP does with the number it normalised.
 *
 * A rename changes this one profile, as in the browser: invoices, orders and hisaab rows keep the name they were
 * written with. After saving the screen goes back; the book brings the change in by itself.
 */
@Composable
fun EditCustomer(id: String) {
    val book = LocalBook.current
    val session = LocalSession.current
    val customers = rememberShelfStatus(book.customers)
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()
    val seed = CustomerSeeds[id]
    val customer = customers.items.firstOrNull { it.id == id } ?: seed
    ScreenTitle("Edit customer")
    ShelfState(loaded = seed != null || customers.loaded, error = customers.error, offline = customers.offline, connectionLost = connectionLost) {
        when {
            !session.isOwner -> NotAvailableState("Only an owner can change a customer", why = "Ask an owner to make the change.")
            customer != null && !CustomerKit.isRemoved(customer) -> EditCustomerForm(customer)
            else -> NotAvailableState(
                "Customer not found", why = "They may have been removed. Settings, Recently removed puts them back.", icon = Symbols.PersonOff,
            )
        }
    }
}

@Composable
private fun EditCustomerForm(customer: Customer) {
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    // The form opens on the profile as it is when this screen is made, once: a change arriving from the book meanwhile
    // must not throw away what is being typed.
    var d by rememberSaveable(customer.id, stateSaver = DraftSaver) { mutableStateOf(CustomerDraft.of(customer)) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val canSave = d.canSave(saving, customer)

    // Not money: the screen closes at once and the Outbox carries the change (the book brings it in).
    val haptics = rememberHaptics()
    suspend fun save() {
        if (!d.canSave(saving, customer)) return
        haptics.success()
        ErpApi.shared.enqueue("updateCustomer", mapOf("customerId" to customer.id, "patch" to d.patch(customer)), "Customer ${customer.name}")
        navigator.back()
    }

    ScreenActions { TextButton(onClick = { scope.launch { save() } }, enabled = canSave) { Text("Save") } }
    BackHandler(enabled = saving) {}

    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).readableColumn(820.dp).imePadding().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            FormSection(title = "Name") {
                TextRow("Full name", d.name, { d = d.copy(name = it) }, capitalization = KeyboardCapitalization.Words)
            }
            FormSection(title = "Phone", footer = "The spare slot. A contact import fills this rather than overwriting the number above.") {
                TextRow("Phone number", d.phone, { d = d.copy(phone = it) }, keyboardType = KeyboardType.Phone)
                TextRow("Second number", d.altPhone, { d = d.copy(altPhone = it) }, keyboardType = KeyboardType.Phone)
            }
            FormSection(
                title = "Email",
                footer = if (!d.emailOK()) "That doesn't look like an email address." else null,
                footerTone = Tone.problem,
            ) {
                TextRow("Email address", d.email, { d = d.copy(email = it) }, keyboardType = KeyboardType.Email, autoCorrect = false)
            }
            FormSection(title = "Address") {
                TextRow("Address", d.address, { d = d.copy(address = it) }, minLines = 2, maxLines = 5, capitalization = KeyboardCapitalization.Sentences)
                TextRow("City", d.city, { d = d.copy(city = it) }, prompt = "e.g. Karachi", capitalization = KeyboardCapitalization.Words)
                TextRow("Country", d.country, { d = d.copy(country = it) }, prompt = "e.g. Pakistan", capitalization = KeyboardCapitalization.Words)
            }
            FormSection(
                title = "Sizes",
                footer = "What the shop needs before it can make anything. Written the way it is quoted at the counter, not forced into a number.",
            ) {
                FieldRow("Ring", d.ringSize, { d = d.copy(ringSize = it) }, prompt = "e.g. 12.5")
                FieldRow("Bangle", d.bangleSize, { d = d.copy(bangleSize = it) }, prompt = "e.g. 2.6")
                FieldRow("Bracelet", d.braceletSize, { d = d.copy(braceletSize = it) }, prompt = "e.g. 7 in")
                FieldRow("Chain", d.chainLength, { d = d.copy(chainLength = it) }, prompt = "e.g. 18 in")
            }
            FormSection(
                title = "Dates",
                footer = "What the dashboard watches for, so a regular gets a message before the day rather than after it.",
            ) {
                EditDayRow("Birthday", d.birthday) { d = d.copy(birthday = it) }
                EditDayRow("Anniversary", d.anniversary) { d = d.copy(anniversary = it) }
            }
            FormSection(title = "Preferences and notes") {
                TextRow("Preferences", d.preference, { d = d.copy(preference = it) }, prompt = "e.g. no rose gold, prefers heavier sets", maxLines = 3, capitalization = KeyboardCapitalization.Sentences)
                TextRow("Notes", d.notes, { d = d.copy(notes = it) }, prompt = "Anything worth remembering", minLines = 3, maxLines = 8, capitalization = KeyboardCapitalization.Sentences)
            }
            FormSection(footer = "Where they came from: used for walk-in and referral analytics.") {
                SourcePicker(d.source, original = customer.source?.rawValue) { d = d.copy(source = it) }
            }
            error?.let { Text(it, color = Tone.problem.color(), style = MaterialTheme.typography.bodyMedium) }
            if (saving) Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { ContainedLoading() }
        }
    }
}

/** An optional date, as the web's date input: nothing yet, or a day to change or take off. Karachi's day. */
@Composable
private fun EditDayRow(title: String, day: String, onChange: (String) -> Unit) {
    val lower = title.lowercase()
    val today = { EditDay.string(Instant.now()) }
    if (day.isEmpty()) {
        ActionRow("Add $lower", onClick = { onChange(today()) }, icon = Symbols.AddCircle)
    } else if (EditDay.date(day) != null) {
        DateRow(title, day.take(10)) { onChange(it) }
        ActionRow("Remove $lower", onClick = { onChange("") }, destructive = true)
    } else {
        // Written another way by an old import: shown as it is, until a day is set in its place.
        ValueRow(title, day)
        ActionRow("Set $lower", onClick = { onChange(today()) })
        ActionRow("Remove $lower", onClick = { onChange("") }, destructive = true)
    }
}
