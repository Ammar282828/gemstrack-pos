package erp.app.screens.sale

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DirectionsWalk
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import erp.app.data.LocalBook
import erp.app.nav.LocalBottomBar
import erp.app.data.rememberShelf
import erp.app.device.Foreground
import erp.app.ui.LedgerDivider
import erp.app.ui.LedgerSection
import erp.app.ui.MinTouchTarget
import erp.app.ui.Monogram
import erp.app.ui.MoneyFeedback
import erp.app.ui.MonogramSize
import erp.app.ui.Radius
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import erp.core.logic.CustomerSearch
import erp.core.models.Customer
import java.time.LocalDate
import java.time.format.DateTimeParseException
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import erp.app.ui.FieldRow
import erp.app.ui.FormSection
import erp.app.ui.FullScreenSheet
import erp.app.ui.verticalScrollColumn

// The small pieces New sale, the edit sheet and Scan a tag share (SaleKit.swift).

/**
 * Keeps a form above the keyboard where the shell does not: under a tab's bottom bar the shell leaves the keyboard
 * to the screen, but on a create sheet or a tablet its Scaffold already pads for it (and a page of a dialog does so
 * itself), so this adds nothing there.
 */
@Composable
internal fun Modifier.keyboardSafe(): Modifier = if (LocalBottomBar.current) this.imePadding() else this

/** Where the sale links to. */
internal object SaleLinks {
    const val newSale = "/invoices/new"

    /** The sale in progress: a piece was put on it (SaleStore.add), so the sale opens on it rather than blank. */
    const val continueSale = "/invoices/new?resume=1"

    /** New sale with the AI bill reader open over it (SaleScanScreen). */
    const val readBill = "/invoices/new?scan=bill"

    /** The ERP's own page for putting a new piece in stock ("New piece"). */
    const val newPiece = "/products/add"

    /** A piece's page, which is the ERP's (`/products/<sku>`). */
    fun piece(sku: String): String = "/products/" + encode(sku)

    fun invoice(id: String): String = "/invoices/" + encode(id)

    /** Letters, digits, "-", "_" and "." stay; every other byte is %XX (a SKU may hold a space or a slash). */
    fun encode(s: String): String {
        val out = StringBuilder()
        var i = 0
        while (i < s.length) {
            val cp = s.codePointAt(i)
            val len = Character.charCount(cp)
            val c = s.substring(i, i + len)
            if (Character.isLetterOrDigit(cp) || c == "-" || c == "_" || c == ".") {
                out.append(c)
            } else {
                for (b in c.toByteArray(Charsets.UTF_8)) out.append('%').append("%02X".format(b.toInt() and 0xFF))
            }
            i += len
        }
        return out.toString()
    }
}

/** "yyyy-MM-dd", the form the ERP keeps a delivery's expected date in. */
internal object SaleDates {
    fun string(d: LocalDate): String = d.toString()

    fun date(s: String): LocalDate? = if (s.isEmpty()) null else try { LocalDate.parse(s) } catch (e: DateTimeParseException) { null }
}

// MARK: Customer picker

/**
 * Pick the sale's customer from the book, or make it a walk-in. Typing a name and number on the sale itself is the
 * other way; the ERP adds a person it has not seen when the sale is saved.
 */
@Composable
internal fun SaleCustomerPicker(pick: (Customer?) -> Unit, onDismiss: () -> Unit) {
    val book = LocalBook.current
    val customers by rememberShelf(book.customers)
    var search by remember { mutableStateOf("") }
    fun digits(s: String?): String = (s ?: "").filter { it in '0'..'9' }
    val q = search.trim()
    val wanted = digits(q)
    // Removed customers stay out of every list; the old "Walk-in Customer" records are not people (lib/walk-in.ts).
    val people = remember(customers, q) {
        CustomerSearch.people(customers).filter { c ->
            q.isEmpty() || c.name.contains(q, ignoreCase = true) || (wanted.length >= 3 && digits(c.phone).contains(wanted))
        }
    }
    FullScreenSheet(title = "Customer", onCancel = onDismiss) {
        Column(Modifier.fillMaxSize().verticalScrollColumn().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            FieldRow("Name or phone", search, { search = it }, Modifier.padding(0.dp), leading = Icons.Filled.Search)
            FormSection("Walk-in", footer = { Text("Walk-in. No customer is made; overpayment can't be kept as credit.") }) {
                Row(
                    Modifier.fillMaxWidth().ledgerRow().clickable(role = Role.Button) { pick(null); onDismiss() },
                    horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.DirectionsWalk, contentDescription = null, Modifier.size(MonogramSize.row), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("Walk-in", style = MaterialTheme.typography.bodyLarge.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium))
                }
            }
            if (people.isNotEmpty()) {
                Column(Modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card)) {
                    people.forEachIndexed { i, c ->
                        if (i > 0) LedgerDivider()
                        Row(
                            Modifier.fillMaxWidth().ledgerRow().clickable(role = Role.Button) { pick(c); onDismiss() },
                            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Monogram(c.name, size = MonogramSize.row)
                            TwoLine(title = c.name, subtitle = c.phone)
                        }
                    }
                }
            }
        }
    }
}


// MARK: Scanning a tag

/**
 * The camera that reads a piece's tag, shared by Scan a tag and New sale's Scan. A tag's QR holds the SKU (the web's
 * scanner reads the same), possibly inside a link: the receiver takes the last path part (`TagCode.sku`). The reader
 * is Google's code scanner (QR and Code 128, no camera permission of its own): it opens over the screen, returns the
 * code and the screen says what it found. Where it is not there (no Google Play services) the SKU is typed instead,
 * and typing is always offered beside the camera.
 */
@Composable
internal fun TagScanner(active: Boolean = true, onCode: (String) -> Unit) {
    val context = Foreground.activity ?: LocalContext.current
    val scope = rememberCoroutineScope()
    var typed by remember { mutableStateOf("") }
    var problem by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    // The same code twice within two seconds is one read (the web scanner's debounce).
    val last = remember { arrayOfNulls<Pair<String, Long>>(1) }

    fun accept(code: String) {
        val now = System.currentTimeMillis()
        val before = last[0]
        if (before != null && before.first == code && now - before.second < 2000) return
        last[0] = code to now
        onCode(code)
    }

    fun scan() {
        if (busy) return
        busy = true
        problem = null
        scope.launch {
            try {
                val options = GmsBarcodeScannerOptions.Builder()
                    .setBarcodeFormats(Barcode.FORMAT_QR_CODE, Barcode.FORMAT_CODE_128)
                    .enableAutoZoom()
                    .build()
                val code = GmsBarcodeScanning.getClient(context, options).startScan().await().rawValue
                if (!code.isNullOrEmpty()) accept(code)
            } catch (e: CancellationException) {
                // Closed without a code: nothing to say.
            } catch (e: Exception) {
                if (e.message?.contains("cancel", ignoreCase = true) != true) {
                    problem = "This phone can't scan tags here."
                }
            } finally {
                busy = false
            }
        }
    }

    fun find() {
        val t = typed.trim()
        if (t.isEmpty()) return
        typed = ""
        onCode(t)
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(
            Modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(
                if (problem == null) Icons.Filled.QrCodeScanner else Icons.Filled.CameraAlt, contentDescription = null,
                Modifier.size(44.dp), tint = if (problem == null) ErpColors.accent else MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(problem ?: "Hold the tag's code in view", style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
            Text(
                if (problem == null) "A QR or Code 128 tag. A SKU printed on it can be typed below." else "Type the SKU below.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
            )
            if (problem == null) {
                FilledTonalButton(onClick = ::scan, enabled = active && !busy, modifier = Modifier.defaultMinSize(minHeight = MinTouchTarget)) {
                    Icon(Icons.Filled.QrCodeScanner, contentDescription = null, Modifier.size(18.dp))
                    Text("Open the camera", Modifier.padding(start = 8.dp))
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = typed,
                onValueChange = { typed = it },
                modifier = Modifier.weight(1f),
                label = { Text("Type the SKU") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false, imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { find() }),
            )
            FilledTonalButton(onClick = ::find, enabled = typed.trim().isNotEmpty(), modifier = Modifier.defaultMinSize(minHeight = MinTouchTarget)) { Text("Find") }
        }
    }
}

/** New sale's Scan: the camera opens again for the next tag, and the sheet says what became of the last one. */
@Composable
internal fun SaleScanSheet(handle: (String) -> String, onDismiss: () -> Unit) {
    var said by remember { mutableStateOf("") }
    var tick by remember { mutableIntStateOf(0) }
    MoneyFeedback(success = tick, failure = null)
    FullScreenSheet(title = "Scan a tag", onCancel = onDismiss, confirmText = "Done", onConfirm = onDismiss, cancelText = "Done") {
        Column(Modifier.fillMaxSize().verticalScrollColumn().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            TagScanner { code ->
                said = handle(code)
                tick += 1
            }
            if (said.isNotEmpty()) {
                Text(
                    said,
                    Modifier.fillMaxWidth().clip(Radius.chipShape).background(ErpColors.card).padding(14.dp)
                        .semantics { contentDescription = said },
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium),
                )
            }
        }
    }
}
