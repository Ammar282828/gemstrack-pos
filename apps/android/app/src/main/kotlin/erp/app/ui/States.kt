package erp.app.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.ErpType

// MARK: Loading

/**
 * Static placeholders never obscure a page with a spinning activity indicator.
 *
 * The default is a whole page still loading: the ledger page's own shape (a date line, the hero card, a folded
 * card, then a section of rows) on the page's own cards and margins, pinned to the top, so the page arrives
 * where its outline already stood. Nothing moves in it: a cold start shows one steady frame until the books
 * are in. [compact] is three short lines for inside a row or a button.
 */
@Composable
fun SkeletonLoading(modifier: Modifier = Modifier, label: String = "Loading", compact: Boolean = false) {
    val base = Modifier.clearAndSetSemantics { contentDescription = label }
    if (compact) {
        Column(modifier.then(base), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            SkeletonLine(76.dp, 5.dp)
            SkeletonLine(54.dp, 5.dp)
            SkeletonLine(76.dp, 5.dp)
        }
        return
    }
    Column(
        modifier.then(base).fillMaxWidth().padding(horizontal = 16.dp).padding(top = 4.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        SkeletonLine(132.dp, 10.dp, Modifier.padding(horizontal = 4.dp).padding(top = 6.dp))
        SkeletonCard(Modifier.defaultMinSize(minHeight = 172.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SkeletonLine(84.dp, 10.dp)
                SkeletonLine(190.dp, 30.dp)
                SkeletonLine(120.dp, 10.dp)
            }
        }
        SkeletonCard(Modifier.defaultMinSize(minHeight = 52.dp)) { SkeletonLine(120.dp, 12.dp) }
        SkeletonLine(96.dp, 12.dp, Modifier.padding(horizontal = 4.dp).padding(top = 14.dp))
        SkeletonCard {
            Column {
                repeat(3) { index ->
                    Row(Modifier.fillMaxWidth().height(64.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(36.dp).clip(CircleShape).background(skeletonColor()))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            SkeletonLine(if (index == 1) 120.dp else 150.dp, 11.dp)
                            SkeletonLine(90.dp, 9.dp)
                        }
                        SkeletonLine(56.dp, 11.dp)
                    }
                }
            }
        }
    }
}

@Composable
private fun skeletonColor() = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.12f)

@Composable
private fun SkeletonLine(width: Dp, height: Dp, modifier: Modifier = Modifier) {
    Spacer(
        modifier.width(width).height(height).clip(RoundedCornerShape(height / 2.5f)).background(skeletonColor()),
    )
}

@Composable
private fun SkeletonCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(
        modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card).padding(horizontal = 16.dp),
        contentAlignment = Alignment.CenterStart,
    ) { content() }
}

// MARK: What the books say

/**
 * Show cached books immediately; only a confirmed network loss warrants an offline warning. [offline] says the
 * shelf is the phone's own copy; [connectionLost] is the app's reading of the line. Both must hold for the banner.
 */
@Composable
fun ShelfState(
    loaded: Boolean,
    error: String?,
    modifier: Modifier = Modifier,
    offline: Boolean = false,
    connectionLost: Boolean = false,
    content: @Composable () -> Unit,
) {
    val reduce = reduceMotion()
    val showingOfflineCopy = offline && connectionLost
    val phase = when {
        !loaded -> 0
        !error.isNullOrEmpty() && !showingOfflineCopy -> 1
        else -> 2
    }
    // The books arriving cross-fade over the outline (none with animations off).
    AnimatedContent(
        targetState = phase,
        modifier = modifier,
        transitionSpec = { fadeIn(Motion.travel(reduce)) togetherWith fadeOut(Motion.travel(reduce)) },
        label = "shelf",
    ) { shown ->
        when (shown) {
            0 -> SkeletonLoading(Modifier.fillMaxSize())
            1 -> NotAvailableState("Couldn't read the books", why = error, icon = Icons.Filled.CloudOff, modifier = Modifier.fillMaxSize())
            else -> Column(Modifier.fillMaxSize()) {
                if (showingOfflineCopy) {
                    Text(
                        "Offline: showing this phone's copy",
                        Modifier
                            .align(Alignment.CenterHorizontally)
                            .padding(top = 4.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                            .padding(horizontal = 14.dp, vertical = 7.dp),
                        style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
                    )
                }
                Box(Modifier.weight(1f).fillMaxWidth()) { content() }
            }
        }
    }
}

/** A page or section the signed-in person cannot have, or that has nothing to show, in the ERP's words. */
@Composable
fun NotAvailableState(
    title: String,
    modifier: Modifier = Modifier,
    why: String? = null,
    icon: ImageVector = Icons.Filled.Lock,
) {
    Column(
        modifier.fillMaxWidth().padding(32.dp).semantics(mergeDescendants = true) {},
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(icon, contentDescription = null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(12.dp))
        Text(title, style = ErpType.heading, textAlign = TextAlign.Center)
        if (!why.isNullOrEmpty()) {
            Spacer(Modifier.height(6.dp))
            Text(why, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
    }
}

// MARK: Not done

/**
 * An alert for a refused or failed action, shown while [message] is set and clearing it on OK (call [onDismiss]
 * to set it back to null). Taps the error haptic as it appears.
 */
@Composable
fun FailureAlert(message: String?, onDismiss: () -> Unit, title: String = "Not done") {
    if (message == null) return
    val haptics = rememberHaptics()
    LaunchedEffect(message) { haptics.failure() }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = { TextButton(onClick = onDismiss) { Text("OK") } },
    )
}
