package erp.app.screens.workshop

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import erp.app.data.ErpApi
import erp.app.screens.customers.FormSection
import erp.app.screens.neworder.FieldRow
import erp.app.screens.neworder.PickerRow
import erp.app.screens.neworder.WideFieldRow
import erp.app.ui.LocalNoteState
import erp.app.ui.Note
import erp.core.models.Karigar
import erp.core.models.KarigarJob
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

// The Workshop page's two stock-work dialogs (src/app/workshop/page.tsx AddJobDialog, EditDetailsDialog), each a
// write through the ERP (`addStockJob`, `updateStockJobDetails`, lib/writes/workshop-admin.ts). Nothing here moves
// money: the making agreed is written on the job, and paying him is a payment from his page.

/**
 * "Assign Stock Work": pieces for the shop's own stock, not tied to a customer order; repairs and samples too. A
 * karigar and what he is making are needed; the rest is the web form's, each left out when blank. The job starts
 * Pending, written up now; the ERP names it with the karigar's name on file.
 */
@Composable
fun WorkshopStockJobSheet(karigars: List<Karigar>, presetKarigarId: String, onDismiss: () -> Unit) {
    val note = LocalNoteState.current
    val scope = rememberCoroutineScope()
    // Only a karigar on the books is offered, so a focus on someone removed starts blank.
    var karigarId by remember { mutableStateOf(if (karigars.any { it.id == presetKarigarId }) presetKarigarId else "") }
    var what by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("") }
    var metal by remember { mutableStateOf("gold") }
    var weightText by remember { mutableStateOf("") }
    var quantityText by remember { mutableStateOf("1") }
    var makingText by remember { mutableStateOf("") }
    var size by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val cleanedWhat = what.trim()
    val canSave = karigarId.isNotEmpty() && cleanedWhat.isNotEmpty() && !saving

    fun save() {
        if (!canSave) return
        val write = WorkshopWrites.stockJob(karigarId, what, category, metal, weightText, quantityText, makingText, size, notes)
        saving = true
        error = null
        scope.launch {
            try {
                ErpApi.shared.write(write.op, write.fields)
                val name = karigars.firstOrNull { it.id == karigarId }?.name ?: ""
                note.show(Note("Job assigned", "$cleanedWhat → $name"))
                saving = false
                onDismiss()
                return@launch
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = workshopSay(e)
            }
            saving = false
        }
    }

    WorkshopFormSheet("Assign Stock Work", onDismiss, "Assign", canSave, ::save, locked = saving) {
        FormSection(
            title = "Work & karigar",
            footer = "Pieces for your own inventory, not tied to a customer order. Also use this for repairs and samples.",
        ) {
            PickerRow("Karigar", karigarId, listOf("" to "Select karigar") + karigars.map { it.id to it.name.ifEmpty { it.id } }) { karigarId = it }
            WideFieldRow("What are they making?", what, { what = it }, prompt = "What are they making? e.g. 4 stacked rings, moti set repair", minLines = 1, maxLines = 3)
        }
        FormSection(title = "Piece") {
            PickerRow("Category", category, listOf("" to "Optional") + WorkshopLogic.categoryIds.map { it to (WorkshopLogic.categoryTitle(it) ?: it) }) { category = it }
            PickerRow("Metal", metal, WorkshopLogic.stockMetals.map { it.id to it.title }) { metal = it }
        }
        FormSection(title = "Specifications") {
            FieldRow("Weight (g)", weightText, { weightText = it }, prompt = "0.000", number = true)
            FieldRow("Qty", quantityText, { quantityText = it }, prompt = "1", keyboardType = KeyboardType.Number)
            FieldRow("Making (PKR)", makingText, { makingText = it }, prompt = "0", number = true)
            FieldRow("Size", size, { size = it }, prompt = "Size, e.g. 12, 2.4, 7.5\"")
        }
        FormSection(title = "Notes") {
            WideFieldRow("Notes", notes, { notes = it }, prompt = "Instructions, stone details…", minLines = 2, maxLines = 5)
        }
        WorkshopFormError(error)
    }
}

/**
 * "Making details" of a stock job: only the fields the karigar sees. Its name (never cleared), size, weight and
 * instructions; a blank size or instructions is removed. Price, customer and quantity are unchanged.
 */
@Composable
fun WorkshopJobDetailsSheet(job: KarigarJob, onDismiss: () -> Unit) {
    val note = LocalNoteState.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(job.description) }
    var size by remember { mutableStateOf(job.size ?: "") }
    var weightText by remember { mutableStateOf(WorkshopFigure.field(job.weightG)) }
    var instructions by remember { mutableStateOf(job.notes ?: "") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun save() {
        // The web's own words when the name is cleared.
        if (name.trim().isEmpty()) {
            error = "An item needs a name."
            return
        }
        val write = WorkshopWrites.jobDetails(job.id, name, size, weightText, instructions)
        saving = true
        error = null
        scope.launch {
            try {
                ErpApi.shared.write(write.op, write.fields)
                note.show(Note("Details updated", job.description))
                saving = false
                onDismiss()
                return@launch
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = workshopSay(e)
            }
            saving = false
        }
    }

    WorkshopFormSheet("Making details", onDismiss, "Save", name.trim().isNotEmpty(), ::save, locked = saving) {
        FormSection(
            title = "Item name",
            footer = "${job.description}: only the fields the karigar sees. Price, customer and quantity are unchanged.",
        ) {
            WideFieldRow("Item name", name, { name = it }, prompt = "What is being made", minLines = 1, maxLines = 3, capitalization = KeyboardCapitalization.Sentences)
        }
        FormSection {
            FieldRow("Size", size, { size = it }, prompt = "e.g. 12")
            FieldRow("Weight (g)", weightText, { weightText = it }, prompt = "0.000", number = true)
        }
        FormSection(title = "Instructions", footer = "Shown to the karigar and on the workshop slip.") {
            WideFieldRow("Instructions", instructions, { instructions = it }, prompt = "Stones, plating, sizing, or other specifications", minLines = 3, maxLines = 8)
        }
        WorkshopFormError(error)
    }
}
