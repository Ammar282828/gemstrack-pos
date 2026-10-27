package erp.app.screens.customers

import erp.app.ui.icons.Symbols
import erp.app.ui.ContainedLoading
import erp.app.ui.Loading
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import erp.app.ui.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import erp.app.auth.LocalSession
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelf
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.screens.neworder.PickerRow
import erp.app.screens.neworder.formRow
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.readableColumn
import erp.app.ui.rememberHaptics
import erp.app.ui.theme.ErpColors
import erp.core.DocJSON
import erp.core.models.Customer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private class SavedCustomer(val id: String, val name: String, val customer: Customer?)

/**
 * New customer (src/components/customer/customer-form.tsx, add mode). The ERP's server takes a name, number, email,
 * address and source (`addCustomer`); the form's second number, city, sizes, dates and notes are the edit form's
 * (EditCustomer), offered once they are saved.
 *
 * Like the web form, a name is optional: left blank it becomes "Customer - <number>", or "Unnamed Customer" (the server
 * refuses a nameless customer). Unlike a sale, this never makes a walk-in a customer (lib/walk-in.ts): that
 * placeholder is the absence of one.
 *
 * After saving, the form is replaced by a "Saved" page that opens the new customer's page with one tap (a push, so
 * Back returns to it), because this screen can be a sheet (New customer) or a pushed page (Customers' plus).
 */
@Composable
fun AddCustomer() {
    val book = LocalBook.current
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val customers by rememberShelf(book.customers)
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()

    var name by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var address by rememberSaveable { mutableStateOf("") }
    var source by rememberSaveable { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var saved by remember { mutableStateOf<SavedCustomer?>(null) }

    val form = NewCustomerForm(name, phone, email, address, source)
    val canSave = form.canSave(saving)
    val sameNumber = form.sameNumber(customers)

    suspend fun save() {
        if (!form.canSave(saving)) return
        saving = true
        error = null
        try {
            val out = ErpApi.shared.write("addCustomer", form.fields())
            @Suppress("UNCHECKED_CAST")
            val doc = out["customer"] as? Map<String, Any?>
            val newId = doc?.get("id") as? String ?: ""
            val made: Customer? = if (newId.isEmpty()) null else DocJSON.decode<Customer>(newId, doc ?: emptyMap())
            made?.let { CustomerSeeds.put(it) }
            saved = SavedCustomer(newId, made?.name ?: form.nameToSave, made)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message ?: e.toString()
        }
        saving = false
    }

    fun startAnother() {
        name = ""; phone = ""; email = ""; address = ""; source = ""
        error = null
        saved = null
    }

    val done = saved
    ScreenTitle(if (done == null) "New customer" else "Saved")
    ScreenActions {
        if (done == null) {
            TextButton(onClick = { scope.launch { save() } }, enabled = canSave) { Text("Save") }
        } else {
            TextButton(onClick = { navigator.back() }) { Text("Done") }
        }
    }
    // A save in flight is not left (the iPhone's interactiveDismissDisabled).
    BackHandler(enabled = saving) {}
    LaunchedEffect(done) { if (done != null) haptics.success() }

    if (done != null) {
        SavedPage(done, owner = session.isOwner, onEdit = { navigator.open(CustomerKit.path(done.id, "/edit")) }, onAnother = ::startAnother) {
            navigator.open(CustomerKit.path(done.id))
        }
    } else {
        Box(Modifier.fillMaxSize()) {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).readableColumn().imePadding().padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                FormSection(
                    title = "Name",
                    footer = if (form.walkIn) "A walk-in is not a customer: a sale to nobody in particular is left without one." else null,
                    footerTone = Tone.problem,
                ) {
                    TextRow("Full name", name, { name = it }, capitalization = KeyboardCapitalization.Words)
                }
                FormSection(title = "Phone") {
                    TextRow("Phone number", phone, { phone = it }, keyboardType = KeyboardType.Phone)
                    if (sameNumber != null) {
                        Row(
                            Modifier.fillMaxWidth().clickable(role = Role.Button) { navigator.open(CustomerKit.path(sameNumber.id)) }.formRow(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Icon(Symbols.VerifiedUser, contentDescription = null, tint = ErpColors.accent)
                            Text("Already on file: ${CustomerKit.shown(sameNumber)}", color = ErpColors.accent, style = MaterialTheme.typography.bodyLarge)
                        }
                    }
                }
                FormSection(
                    title = "Email",
                    footer = if (!form.emailOK) "That doesn't look like an email address." else null,
                    footerTone = Tone.problem,
                ) {
                    TextRow("Email address", email, { email = it }, keyboardType = KeyboardType.Email, autoCorrect = false)
                }
                FormSection(title = "Address") {
                    TextRow("Address", address, { address = it }, minLines = 2, maxLines = 5, capitalization = KeyboardCapitalization.Sentences)
                }
                FormSection(footer = "Where they came from: used for walk-in and referral analytics.") {
                    SourcePicker(source) { source = it }
                }
                error?.let { Text(it, color = Tone.problem.color(), style = MaterialTheme.typography.bodyMedium) }
                if (saving) Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { ContainedLoading() }
            }
        }
    }
}

/** The `CUSTOMER_SOURCES` words, with "Not specified" first. */
@Composable
internal fun SourcePicker(source: String, original: String? = null, onPick: (String) -> Unit) {
    val options = buildList {
        add("" to "Not specified")
        CustomerKit.sources.forEach { add(it.rawValue to CustomerKit.sourceLabel(it)) }
        // A word the app does not know (written by something else) stays choosable, so it is not lost.
        if (!original.isNullOrEmpty() && CustomerKit.sources.none { it.rawValue == original }) add(original to original)
    }
    PickerRow("Referral source", source, options, onPick)
}

@Composable
private fun SavedPage(s: SavedCustomer, owner: Boolean, onEdit: () -> Unit, onAnother: () -> Unit, onOpen: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).readableColumn().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            SavedHeader("${s.name} is on file.")
            FormSection(
                footer = if (owner) "The second number, city, sizes, dates and notes are filled in on the edit page." else null,
            ) {
                // Editing a profile is an owner's (the shop floor has no write to it, in the ERP or here).
                if (s.id.isNotEmpty() && owner) SavedAction("Add sizes, birthday and notes", Symbols.Straighten, onEdit)
                SavedAction("Add another customer", Symbols.PersonAdd, onAnother)
            }
        }
        if (s.id.isNotEmpty()) {
            Button(
                onClick = onOpen,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).defaultMinSize(minHeight = 52.dp),
            ) { Text("Open ${s.name}") }
        }
    }
}

@Composable
private fun SavedAction(text: String, icon: ImageVector, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).formRow(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = ErpColors.accent)
        Text(text, style = MaterialTheme.typography.bodyLarge, color = ErpColors.accent)
    }
}
