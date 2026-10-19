package erp.app.screens.design

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import erp.app.screens.marketing.MarketingPhotos
import erp.app.ui.Note
import erp.app.ui.Radius
import erp.app.ui.theme.ErpColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

// What the Design screens share: the action bar that keeps a screen's one primary action at the foot (rule 16 of the iPhone's
// CONVENTIONS, `.actionBar`), a words field, a photograph as a bitmap, and the toast a sheet carries while it is up.

/** One button of the action bar. */
class DesignAction(
    val label: String,
    val icon: ImageVector? = null,
    val busy: Boolean = false,
    val disabled: Boolean = false,
    val onClick: () -> Unit,
)

/**
 * The one primary action of a screen, pinned at its foot where it never scrolls away, with the secondary ones beside it and a
 * line above saying what it will do (summary). Publish in the workspace, Continue on the start screen, Send in the Publish sheet.
 */
@Composable
fun DesignActionBar(primary: DesignAction, modifier: Modifier = Modifier, secondary: List<DesignAction> = emptyList(), summary: String? = null) {
    Column(modifier.fillMaxWidth().background(ErpColors.ground)) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
        Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (summary != null) Text(summary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                for (s in secondary) {
                    OutlinedButton(onClick = s.onClick, enabled = !s.disabled && !s.busy, modifier = Modifier.weight(1f).heightIn48()) {
                        if (s.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        else if (s.icon != null) Icon(s.icon, contentDescription = null, Modifier.size(18.dp))
                        Text(s.label, Modifier.padding(start = 6.dp), maxLines = 1)
                    }
                }
                Button(
                    onClick = primary.onClick, enabled = !primary.disabled && !primary.busy, modifier = Modifier.weight(if (secondary.isEmpty()) 1f else 1.4f).heightIn48(),
                    colors = ButtonDefaults.buttonColors(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent),
                ) {
                    if (primary.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = ErpColors.onAccent)
                    else if (primary.icon != null) Icon(primary.icon, contentDescription = null, Modifier.size(18.dp))
                    Text(primary.label, Modifier.padding(start = 6.dp), maxLines = 1)
                }
            }
        }
        Box(Modifier.navigationBarsPadding())
    }
}

private fun Modifier.heightIn48(): Modifier = this.defaultMinSize(minHeight = 48.dp)

/** A words field the iPhone's way: its name small above, the text on the house's ground. */
@Composable
fun DesignField(
    label: String,
    text: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    prompt: String = "",
    minLines: Int = 1,
    maxLines: Int = 3,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(
            value = text, onValueChange = onChange, modifier = Modifier.fillMaxWidth(),
            placeholder = if (prompt.isEmpty()) null else ({ Text(prompt) }),
            minLines = minLines, maxLines = maxLines, shape = RoundedCornerShape(Radius.tile),
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        )
    }
}

/** A photograph's bytes as a bitmap at most [maxPixel] on its long side, decoded off the main thread (null while it comes). */
@Composable
fun rememberBitmap(data: ByteArray?, maxPixel: Int = 400): Bitmap? {
    val state by produceState<Bitmap?>(null, data, maxPixel) {
        value = if (data == null) null else withContext(Dispatchers.Default) { MarketingPhotos.decode(data, maxPixel) }
    }
    return state
}

/** A picture filling its box (cropped to it), or the house's ground while it comes. */
@Composable
fun DesignPicture(bitmap: Bitmap?, modifier: Modifier = Modifier, scale: ContentScale = ContentScale.Crop, description: String? = null) {
    if (bitmap == null) Box(modifier.background(ErpColors.ground))
    else Image(bitmap.asImageBitmap(), contentDescription = description, modifier = modifier, contentScale = scale)
}

/** Instagram covers a story's top and bottom bands: keep what must be read out of them. */
@Composable
fun SafeZones(top: Double, bottom: Double, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxSize()) {
        Box(Modifier.fillMaxWidth().weight(top.toFloat().coerceAtLeast(0.0001f)).background(ErpColors.accent.copy(alpha = 0.15f)))
        Box(Modifier.fillMaxWidth().weight((1f - top.toFloat() - bottom.toFloat()).coerceAtLeast(0.0001f)))
        Box(Modifier.fillMaxWidth().weight(bottom.toFloat().coerceAtLeast(0.0001f)).background(ErpColors.accent.copy(alpha = 0.15f)))
    }
}

/**
 * A sheet takes the screen's toasts while it is up (the screen's own is behind its window) and gives them back when it goes
 * (DesignSpeech). Returns the note to show inside the sheet, which hides itself after four seconds.
 */
@Composable
fun designSpeech(get: () -> ((Note) -> Unit)?, set: (((Note) -> Unit)?) -> Unit): Note? {
    var note by remember { mutableStateOf<Note?>(null) }
    DisposableEffect(Unit) {
        val previous = get()
        set { n -> note = n }
        onDispose { set(previous) }
    }
    LaunchedEffect(note) {
        if (note != null) {
            delay(4000)
            note = null
        }
    }
    return note
}

/** The bytes of a picture the person chose in the phone's picker (null when it cannot be read). */
suspend fun readUri(context: Context, uri: Uri): ByteArray? = withContext(Dispatchers.IO) {
    try { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } } catch (e: Exception) { null }
}
