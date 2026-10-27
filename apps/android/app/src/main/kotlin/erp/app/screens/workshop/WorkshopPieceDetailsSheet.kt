package erp.app.screens.workshop

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import erp.app.data.ErpApi
import erp.app.screens.customers.FormSection
import erp.app.screens.neworder.FieldRow
import erp.app.screens.neworder.PhotoField
import erp.app.screens.neworder.StoredImage
import erp.app.screens.neworder.StoredSample
import erp.app.screens.neworder.WideFieldRow
import erp.app.screens.neworder.readStoredSample
import erp.app.ui.LocalNoteState
import erp.app.ui.Note
import erp.app.ui.Radius
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.rememberHaptics

// The Workshop's Details dialog for an order's piece or a sold piece (src/app/workshop/page.tsx EditDetailsDialog), a
// write through the ERP (`updateOrderPieceDetails`, `updateInvoicePieceDetails`, lib/writes/piece-details.ts). A stock
// job's own sheet is WorkshopJobDetailsSheet. Nothing here moves money: price, customer and quantity are not sent.
// (WorkshopPieceDetailsSheet.swift.)

/**
 * Making details asked for on an order's piece or a sold piece: the piece, where it is kept, and the order piece's
 * sample picture as the order holds it (a picture of its own, or one in `order_photos`).
 */
class WorkshopPieceAsk(
    val job: WorkshopJob,
    val target: Target,
    val samplePhotoId: String? = null,
    val sampleImageDataUri: String? = null,
) {
    sealed interface Target {
        class Order(val id: String, val index: Int) : Target
        class Invoice(val id: String, val index: Int) : Target
    }

    val isOrder: Boolean get() = target is Target.Order
}

/**
 * "Making details": only the fields the karigar sees. The name (never cleared; it prints on the customer's estimate and
 * invoice), the size and the instructions, and on an order's piece its weight, reference SKU and sample picture. A sold
 * piece's weight is what the bill was priced from, so it is shown and not changed.
 */
@Composable
fun WorkshopPieceDetailsSheet(ask: WorkshopPieceAsk, onDismiss: () -> Unit) {
    val note = LocalNoteState.current
    val haptics = rememberHaptics()
    val job = ask.job
    var name by remember { mutableStateOf(job.description) }
    var size by remember { mutableStateOf(job.size ?: "") }
    var weightText by remember { mutableStateOf(WorkshopFigure.field(job.weightG)) }
    var reference by remember { mutableStateOf(job.referenceSku ?: "") }
    // The board's line merges the stones, the diamonds and the owner's note; saved, they become the one note.
    var instructions by remember { mutableStateOf(job.notes ?: "") }
    // A new picture chosen here (JPEG), sent only when there is one.
    var photo by remember { mutableStateOf<ByteArray?>(null) }
    // The picture on file is to come off.
    var removePhoto by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val hasStoredPhoto = !ask.samplePhotoId.isNullOrEmpty() || !ask.sampleImageDataUri.isNullOrEmpty()

    fun save() {
        // The web's own words when the name is cleared.
        if (name.trim().isEmpty()) {
            error = "An item needs a name."
            return
        }
        val write = WorkshopWrites.pieceDetails(ask.target, name, size, weightText, reference, instructions, photo, removePhoto)
        error = null
        ErpApi.shared.enqueue(write.op, write.fields, "Details of ${job.description}")
        note.show(Note("Details updated", job.description))
        haptics.success()
        onDismiss()
    }

    WorkshopFormSheet("Making details", onDismiss, "Save", name.trim().isNotEmpty(), ::save) {
        FormSection(
            title = "Item name",
            footer = "Also prints on the customer's estimate and invoice. Only the fields the karigar sees; price, customer and quantity are not changed.",
        ) {
            WideFieldRow("Item name", name, { name = it }, prompt = "What is being made", minLines = 1, maxLines = 3, capitalization = KeyboardCapitalization.Sentences)
        }
        FormSection(footer = if (!ask.isOrder) "A sold piece keeps the weight its bill was priced from." else null) {
            FieldRow("Size", size, { size = it }, prompt = "e.g. 12")
            FieldRow("Weight (g)", weightText, { weightText = it }, prompt = "0.000", number = true, enabled = ask.isOrder)
            if (ask.isOrder) FieldRow("Ref SKU", reference, { reference = it }, prompt = "Optional", capitalization = KeyboardCapitalization.Characters)
        }
        // Only an order's piece keeps a sample picture; a sold piece has none to show.
        if (ask.isOrder) {
            FormSection(title = "Sample picture", footer = "Shown to the karigar on their work list.") {
                SamplePicture(ask, hasStoredPhoto, photo, removePhoto) { bytes, remove -> photo = bytes; removePhoto = remove }
            }
        }
        FormSection(
            title = "Instructions",
            footer = "Shown to the karigar and on the workshop slip. Never printed on a customer estimate or invoice: keep prices and customer details out of it.",
        ) {
            WideFieldRow("Instructions", instructions, { instructions = it }, prompt = "Stones, plating, sizing, or other specifications", minLines = 3, maxLines = 8)
        }
        WorkshopFormError(error)
    }
}

/** The picture on file while nothing new is chosen, its Remove, and Photos / Camera for a new one. */
@Composable
private fun SamplePicture(ask: WorkshopPieceAsk, hasStored: Boolean, photo: ByteArray?, removed: Boolean, change: (ByteArray?, Boolean) -> Unit) {
    // A picture kept in its own document (lib/order-photos.ts) is read for the editor, as the web's dialog reads it.
    val stored by produceState<StoredSample>(StoredSample.Loading, ask.samplePhotoId, ask.sampleImageDataUri) {
        val id = ask.samplePhotoId
        val inline = ask.sampleImageDataUri
        value = when {
            !inline.isNullOrEmpty() -> StoredSample.Ready(inline)
            id.isNullOrEmpty() -> StoredSample.Loading
            else -> readStoredSample(id, keptOn = "piece")
        }
    }
    Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (photo == null && !removed && hasStored) {
            when (val s = stored) {
                is StoredSample.Ready -> StoredImage(s.uri, ask.job.description, Modifier.heightIn(max = 160.dp).clip(Radius.tileShape))
                is StoredSample.Failed -> Text(s.words, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                StoredSample.Loading -> SkeletonLoading(Modifier.heightIn(min = 80.dp))
            }
            TextButton(onClick = { change(null, true) }) {
                Icon(Symbols.DeleteOutline, null, Modifier.size(18.dp), tint = Tone.problem.color())
                Text("Remove photo", Modifier.padding(start = 6.dp), color = Tone.problem.color())
            }
        }
        // A cleared new photo takes the old one off too, as the web's dialog does when there was one on file.
        PhotoField(photo) { bytes -> change(bytes, bytes == null && hasStored) }
    }
}
