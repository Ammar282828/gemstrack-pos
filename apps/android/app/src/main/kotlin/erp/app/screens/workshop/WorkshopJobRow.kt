package erp.app.screens.workshop

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Handyman
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PanoramaFishEye
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PersonRemove
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ShoppingBag
import androidx.compose.material.icons.automirrored.filled.StickyNote2
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import erp.app.ui.FigureRow
import erp.app.ui.MinTouchTarget
import erp.app.ui.Radius
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.theme.ErpColors
import erp.core.models.Karigar
import erp.core.models.KarigarJobStatus

/**
 * One piece on the bench (src/components/karigar/job-card.tsx, the Workshop's JobRow): what it is, who has it,
 * whether it has left the shop, and what an owner does to it, each a write through the ERP. An order's piece and a
 * sold piece (an invoice's line): pick a karigar, tick it Given, tick it Done. A stock job (written up by hand, for
 * the shop's own stock, a repair or a sample) keeps the karigar it was written for: tick it Given, set its status,
 * change its making details, delete it (the delete code). Assigning, handing over and finishing are three different
 * moments, and a name picked is not gold gone. Any piece's making details are changed in its Details sheet.
 */
@Composable
fun WorkshopJobRow(
    job: WorkshopJob,
    /** Name the karigar on the row (the stage and list layouts; the karigar layout already says it). */
    showKarigar: Boolean,
    isOwner: Boolean,
    /** A write for this piece is in flight. */
    busy: Boolean,
    choices: WorkshopChoices,
    actions: WorkshopActions,
) {
    // Only an owner changes a piece (the ERP refuses anyone else), and only one the ERP can find again.
    val canWrite = isOwner && WorkshopLogic.writeTarget(job) != null
    val isStock = job.source == WorkshopJob.Source.manual
    var instructionsOpen by rememberSaveable(job.id) { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    val stockStatus = when (job.status) {
        WorkshopJob.Status.pending -> KarigarJobStatus.pending
        WorkshopJob.Status.inProgress -> KarigarJobStatus.inProgress
        WorkshopJob.Status.completed -> KarigarJobStatus.completed
    }
    // An order's or a sold piece's making details (name, size, weight, instructions, sample picture), from the menu; a
    // stock job's Details sit on the card too.
    val showsDetails = canWrite && !isStock
    val referencePath = job.invoiceId?.let { workshopInvoicePath(it) } ?: job.orderId?.let { workshopOrderPath(it) }
    val referenceId = job.invoiceId ?: job.orderId ?: ""

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(job.description, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold))
                FigureRow(spacing = 8.dp, verticalAlignment = Alignment.CenterVertically) {
                    StageLabel(job)
                    WorkshopAgeBadge(job)
                }
            }
            Box {
                IconButton(onClick = { menuOpen = true }, Modifier.size(MinTouchTarget)) {
                    Icon(Icons.Filled.MoreVert, "Actions for " + job.description)
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    if (referencePath != null) {
                        MenuItem("Open $referenceId", Icons.Filled.Description) { menuOpen = false; actions.open(referencePath) }
                    }
                    if (!job.isUnassigned) {
                        MenuItem("Open " + job.karigarName, Icons.Filled.Handyman) { menuOpen = false; actions.open(WorkshopLogic.karigarPath(job.karigarId)) }
                    }
                    if (showsDetails && !busy) {
                        MenuItem("Details", Icons.Filled.Edit) { menuOpen = false; actions.details(job) }
                    }
                    if (canWrite && !busy) {
                        MenuItem(
                            if (job.isDone) "Mark not done" else "Mark done",
                            if (job.isDone) Icons.Filled.PanoramaFishEye else Icons.Filled.CheckCircle,
                        ) { menuOpen = false; actions.done(job, !job.isDone) }
                        if (!job.isDone && !job.isUnassigned) {
                            MenuItem(if (job.hasGiven) "Mark not given" else "Mark given", Icons.Filled.Inventory2) {
                                menuOpen = false
                                actions.given(job, !job.hasGiven)
                            }
                        }
                        if (isStock) {
                            MenuItem("Details", Icons.Filled.Edit) { menuOpen = false; actions.details(job) }
                            MenuItem("Delete job", Icons.Filled.Delete, destructive = true) { menuOpen = false; actions.delete(job) }
                        }
                    }
                }
            }
        }
        ReferenceLine(job, referencePath, referenceId, actions)
        if (job.isOnline) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.ShoppingBag, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Online sale", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (showKarigar && !job.isUnassigned && (job.isDone || (isStock && canWrite))) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Handyman, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(job.karigarName, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        val meta = WorkshopLogic.meta(job)
        if (meta.isNotEmpty()) Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        job.notes?.takeIf { it.isNotEmpty() }?.let { notes ->
            Instructions(notes, instructionsOpen) { instructionsOpen = it }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Controls(job, canWrite, isStock, busy, choices, actions, stockStatus)
        if (busy) SkeletonLoading(Modifier.height(20.dp), label = "Updating job", compact = true)
    }
}

@Composable
private fun MenuItem(text: String, icon: ImageVector, destructive: Boolean = false, onClick: () -> Unit) {
    val ink = if (destructive) Tone.problem.color() else MaterialTheme.colorScheme.onSurface
    DropdownMenuItem(
        text = { Text(text, color = ink) },
        leadingIcon = { Icon(icon, null, tint = ink) },
        onClick = onClick,
    )
}

/** "Completed", "Needs a karigar", "On the bench" or "Ready to give", with its mark. */
@Composable
private fun StageLabel(job: WorkshopJob) {
    val words = when {
        job.isDone -> "Completed"
        job.isUnassigned -> "Needs a karigar"
        job.hasGiven -> "On the bench"
        else -> "Ready to give"
    }
    val icon = when {
        job.isDone -> Icons.Filled.CheckCircle
        job.isUnassigned -> Icons.Filled.PersonAdd
        job.hasGiven -> Icons.Filled.Handyman
        else -> Icons.Filled.Inventory2
    }
    val tint = when {
        job.isDone -> Tone.settled.color()
        job.isUnassigned -> Tone.owed.color()
        job.hasGiven -> ErpColors.accent
        else -> Tone.owed.color()
    }
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, Modifier.size(14.dp), tint = tint)
        Text(words, style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold), color = tint)
    }
}

/** The order (or invoice) it came off, its customer, and who took it: "on every order in the Workshop". */
@Composable
private fun ReferenceLine(job: WorkshopJob, path: String?, id: String, actions: WorkshopActions) {
    if (path != null) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                Modifier.defaultMinSize(minHeight = MinTouchTarget).clickable(role = Role.Button, onClickLabel = "Open $id") { actions.open(path) },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(id, style = MaterialTheme.typography.labelLarge.copy(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Medium))
                Icon(Icons.Filled.ChevronRight, null, Modifier.size(16.dp))
            }
            val parts = ArrayList<String>()
            job.customerName?.takeIf { it.isNotEmpty() }?.let { parts.add(it) }
            parts.add("Taken by " + (job.takenBy?.takeIf { it.isNotEmpty() } ?: "not recorded"))
            Text(parts.joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    } else {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Inventory2, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Stock work", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** The full instructions, opened on the card (the stones, the diamonds, the owner's note). */
@Composable
private fun Instructions(notes: String, open: Boolean, onToggle: (Boolean) -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(ErpColors.ground, RoundedCornerShape(Radius.tile)).padding(horizontal = 12.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().defaultMinSize(minHeight = MinTouchTarget)
                .clickable(role = Role.Button, onClickLabel = if (open) "Hide instructions" else "Show instructions") { onToggle(!open) },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(Icons.AutoMirrored.Filled.StickyNote2, null, Modifier.size(18.dp))
            Text("Instructions", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium))
            Icon(Icons.Filled.ExpandMore, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        AnimatedVisibility(open) {
            Text(
                notes, Modifier.padding(bottom = 12.dp), style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// MARK: Who has it, and whether it has gone

@Composable
private fun Controls(
    job: WorkshopJob,
    canWrite: Boolean,
    isStock: Boolean,
    busy: Boolean,
    choices: WorkshopChoices,
    actions: WorkshopActions,
    stockStatus: KarigarJobStatus,
) {
    when {
        canWrite && isStock -> {
            // A stock job's controls stay while it is done too (the web's): its status can go back, it can be deleted.
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (!job.isDone && !job.isUnassigned) GivenToggle(job, busy, actions)
                FigureRow(spacing = 12.dp, verticalAlignment = Alignment.CenterVertically) {
                    StatusMenu(stockStatus, busy) { actions.status(job, it) }
                    OutlinedButton(onClick = { actions.details(job) }, enabled = !busy, modifier = Modifier.defaultMinSize(minHeight = MinTouchTarget)) {
                        Icon(Icons.Filled.Edit, null, Modifier.size(18.dp))
                        Text("Details", Modifier.padding(start = 6.dp))
                    }
                }
            }
        }
        canWrite && !job.isDone -> {
            // Who has it, and whether it has gone: nothing else on the card. A piece with nobody yet has nothing to
            // hand over, so no switch; the ERP's details are in the card's menu.
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                FigureRow(spacing = 12.dp, verticalAlignment = Alignment.CenterVertically) {
                    AssignMenu(job, busy, choices, actions)
                    OutlinedButton(onClick = { actions.done(job, true) }, enabled = !busy, modifier = Modifier.defaultMinSize(minHeight = MinTouchTarget)) {
                        Icon(Icons.Filled.CheckCircle, null, Modifier.size(18.dp))
                        Text("Mark done", Modifier.padding(start = 6.dp), fontWeight = FontWeight.Medium)
                    }
                }
                if (!job.isUnassigned) GivenToggle(job, busy, actions)
            }
        }
        !job.isDone -> ReadOnlyControls(job)
        else -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.CheckCircle, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                if (job.hasGiven) "Given " + ShopDate.say(job.givenAt) else "Completed",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun StatusMenu(current: KarigarJobStatus, busy: Boolean, onPick: (KarigarJobStatus) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }, enabled = !busy, modifier = Modifier.defaultMinSize(minHeight = MinTouchTarget)) {
            Icon(WorkshopStatusWords.icon(current), null, Modifier.size(18.dp))
            Text(WorkshopStatusWords.say(current), Modifier.padding(start = 6.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for (s in WorkshopStatusWords.choices) {
                DropdownMenuItem(
                    text = { Text(WorkshopStatusWords.say(s)) },
                    leadingIcon = { Icon(if (s == current) Icons.Filled.Check else WorkshopStatusWords.icon(s), null) },
                    onClick = {
                        open = false
                        if (s != current) onPick(s)
                    },
                )
            }
        }
    }
}

@Composable
private fun AssignMenu(job: WorkshopJob, busy: Boolean, choices: WorkshopChoices, actions: WorkshopActions) {
    var open by remember { mutableStateOf(false) }
    val assigned = !job.isUnassigned
    Box {
        OutlinedButton(onClick = { open = true }, enabled = !busy, modifier = Modifier.defaultMinSize(minHeight = MinTouchTarget)) {
            Icon(if (assigned) Icons.Filled.Handyman else Icons.Filled.PersonAdd, null, Modifier.size(18.dp), tint = if (assigned) MaterialTheme.colorScheme.onSurface else ErpColors.accent)
            Text(
                if (assigned) job.karigarName else "Assign karigar", Modifier.padding(start = 6.dp),
                color = if (assigned) MaterialTheme.colorScheme.onSurface else ErpColors.accent,
            )
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            if (assigned) {
                MenuItem("Remove karigar", Icons.Filled.PersonRemove, destructive = true) { open = false; actions.assign(job, "none") }
            }
            if (choices.working.isNotEmpty()) {
                MenuHeader("Has work now")
                for (k in choices.working) KarigarItem(k, job, actions) { open = false }
            }
            MenuHeader(if (choices.working.isEmpty()) "Karigars" else "Other karigars")
            for (k in choices.others) KarigarItem(k, job, actions) { open = false }
        }
    }
}

@Composable
private fun MenuHeader(text: String) {
    Text(
        text, Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
        style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun KarigarItem(k: Karigar, job: WorkshopJob, actions: WorkshopActions, close: () -> Unit) {
    DropdownMenuItem(
        text = { Text(k.name) },
        leadingIcon = if (k.id == job.karigarId) ({ Icon(Icons.Filled.Check, null) }) else null,
        onClick = {
            close()
            if (k.id != job.karigarId) actions.assign(job, k.id)
        },
    )
}

@Composable
private fun GivenToggle(job: WorkshopJob, busy: Boolean, actions: WorkshopActions) {
    val enabled = !job.isUnassigned && !busy
    val words = when {
        job.hasGiven -> "Given " + ShopDate.say(job.givenAt)
        job.isUnassigned -> "Assign a karigar first"
        else -> "Given to karigar"
    }
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = MinTouchTarget)
            .toggleable(value = job.hasGiven, enabled = enabled, role = Role.Switch) { actions.given(job, it) },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            words, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium,
            color = if (job.hasGiven) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
        )
        Switch(checked = job.hasGiven, onCheckedChange = null, enabled = enabled)
    }
}

/** A piece the phone does not change (staff's view): who has it and whether it went. */
@Composable
private fun ReadOnlyControls(job: WorkshopJob) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(Icons.Filled.Handyman, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        if (job.isUnassigned) {
            Text("No karigar yet", color = Tone.owed.color(), style = MaterialTheme.typography.bodyMedium)
        } else {
            Text(job.karigarName, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium))
            Text(
                if (job.hasGiven) "Given " + ShopDate.say(job.givenAt) else "Not given yet",
                style = MaterialTheme.typography.bodyMedium,
                color = if (job.hasGiven) MaterialTheme.colorScheme.onSurfaceVariant else Tone.owed.color(),
            )
        }
    }
}
