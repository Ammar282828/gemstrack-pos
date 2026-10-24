package erp.app.screens.workshop

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PersonOff
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.ui.rememberHaptics
import erp.app.data.Connection
import erp.app.data.ErpApi
import erp.app.data.LocalBook
import erp.app.data.rememberShelfStatus
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.screens.customers.FormSection
import erp.app.screens.customers.TextRow
import erp.app.ui.NotAvailableState
import erp.app.ui.ShelfState
import erp.app.ui.Tone
import erp.app.ui.readableColumn
import erp.core.models.Karigar
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private val DraftSaver = listSaver<KarigarDraft, String>(
    save = { listOf(it.name, it.contact, it.email, it.specialty, it.altPhone, it.workshop, it.city, it.address, it.notes) },
    restore = { KarigarDraft(it[0], it[1], it[2], it[3], it[4], it[5], it[6], it[7], it[8]) },
)

/**
 * New karigar and edit karigar (src/app/karigars/add/page.tsx, src/app/karigars/[id]/edit,
 * components/karigar/karigar-form.tsx): one form for both. The name (required), the contact number, the Google
 * login, the specialty, a second number, the workshop, the city, the address and notes.
 *
 * Saving is `addKarigar` or `updateKarigar` (owners only, as the browser's direct write is): the ERP checks the
 * fields as the web form does, keeps the login email in lower case (it is matched against the Google account's
 * address on every karigar-portal request), makes the contact number E.164 and writes "Created karigar" or
 * "Updated karigar" to the activity log. A new karigar is sent whole, as the web form sends it; an edit sends only
 * what was changed, so a field this form does not show (the country) is never touched.
 *
 * A rename changes this one karigar, as in the browser: his jobs, given items and hisaab rows keep the name they were
 * written with. After saving the screen goes back; the book brings the change in by itself.
 */
@Composable
fun KarigarForm(id: String? = null) {
    val session = LocalSession.current
    val book = LocalBook.current
    val karigars = rememberShelfStatus(book.karigars)
    val connectionLost by Connection.isOffline.collectAsStateWithLifecycle()
    ScreenTitle(if (id == null) "New karigar" else "Edit karigar")
    when {
        !session.isOwner -> NotAvailableState("Only an owner can change a karigar", why = "Ask an owner to make the change.")
        id == null -> KarigarFormBody(null)
        else -> ShelfState(loaded = karigars.loaded, error = karigars.error, offline = karigars.offline, connectionLost = connectionLost) {
            val k = karigars.items.firstOrNull { it.id == id }
            if (k != null && k.deletedAt.isNullOrEmpty()) {
                KarigarFormBody(k)
            } else {
                NotAvailableState(
                    "Karigar not found", why = "They may have been removed. Settings, Recently removed puts them back.",
                    icon = Icons.Filled.PersonOff,
                )
            }
        }
    }
}

@Composable
private fun KarigarFormBody(karigar: Karigar?) {
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    // The form opens on the karigar as it is when this screen is made, once: a change arriving from the book
    // meanwhile must not throw away what is being typed.
    var d by rememberSaveable(karigar?.id, stateSaver = DraftSaver) { mutableStateOf(KarigarDraft.of(karigar)) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val canSave = d.canSave(saving, karigar)

    val haptics = rememberHaptics()
    fun save() {
        if (!d.canSave(saving, karigar)) return
        val write = WorkshopWrites.karigarWrite(karigar, d.patch(karigar))
        error = null
        ErpApi.shared.enqueue(write.op, write.fields, if (karigar != null) "Karigar ${karigar.name}" else "New karigar")
        haptics.success()
        navigator.back()
    }

    ScreenActions { TextButton(onClick = ::save, enabled = canSave) { Text("Save") } }
    BackHandler(enabled = saving) {}

    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).readableColumn(720.dp).imePadding().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            FormSection(
                title = "Name",
                footer = if (!d.nameOK && d.name.isNotEmpty()) "Name is required." else null,
                footerTone = Tone.problem,
            ) {
                TextRow("Full name", d.name, { d = d.copy(name = it) }, prompt = "Required", capitalization = KeyboardCapitalization.Words)
            }
            FormSection(title = "Phone") {
                TextRow("Contact number", d.contact, { d = d.copy(contact = it) }, prompt = "Optional", keyboardType = KeyboardType.Phone)
                TextRow("Second number", d.altPhone, { d = d.copy(altPhone = it) }, prompt = "Workshop line, or a son's phone", keyboardType = KeyboardType.Phone)
            }
            FormSection(
                title = "Google login",
                footer = if (!d.emailOK) {
                    "Enter a valid email."
                } else {
                    "Adding a Gmail lets this karigar sign in and see only their own work list and account. They cannot see customers, prices, or any other karigar. The first time, Firebase must allow new accounts while he signs in (Authentication, Settings, User actions, Enable create), or Google refuses him."
                },
                footerTone = if (!d.emailOK) Tone.problem else Tone.quiet,
            ) {
                TextRow("Google login", d.email, { d = d.copy(email = it) }, prompt = "karigar@gmail.com", keyboardType = KeyboardType.Email, autoCorrect = false)
            }
            FormSection(title = "Work") {
                TextRow("Specialty", d.specialty, { d = d.copy(specialty = it) }, prompt = "What he makes: setting, polish, chain, meena")
                TextRow("Workshop", d.workshop, { d = d.copy(workshop = it) }, prompt = "Where the bench is")
            }
            FormSection(title = "Where") {
                TextRow("City", d.city, { d = d.copy(city = it) }, prompt = "e.g. Karachi", capitalization = KeyboardCapitalization.Words)
                TextRow("Address", d.address, { d = d.copy(address = it) }, prompt = "Street address", minLines = 1, maxLines = 4)
            }
            FormSection(title = "Notes") {
                TextRow("Notes", d.notes, { d = d.copy(notes = it) }, prompt = "Any relevant notes, e.g. specialization, address, etc.", minLines = 3, maxLines = 8)
            }
            WorkshopFormError(error)
        }
    }
}
