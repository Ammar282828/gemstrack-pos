package erp.app.screens.ads

import erp.app.ui.icons.Symbols
import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import erp.app.ui.FilterChip
import erp.app.ui.theme.ErpColors

// How the ad will look on Instagram before anything is made: Meta's own rendering of the unsaved ad (/api/ads/preview,
// generatepreviews), feed, story and reels, each a facebook.com frame shown as Meta draws it (AdsPreviewSheet.swift,
// AdsObject.swift MetaAdPreview).

/** Only Facebook's own addresses load in a preview frame (and the document's own inner schemes). */
object AdsFrameRules {
    fun isFacebook(host: String?): Boolean {
        val h = host ?: return false
        return h == "facebook.com" || h.endsWith(".facebook.com") || h.endsWith(".fbcdn.net")
    }

    /** The preview address inside Meta's iframe html (`src="…"`), https on facebook.com only; null otherwise. */
    fun previewUrl(html: String): String? {
        val m = Regex("""src="([^"]+)"""").find(html) ?: return null
        val text = m.groupValues[1].replace("&amp;", "&")
        val uri = runCatching { Uri.parse(text) }.getOrNull() ?: return null
        val host = uri.host ?: return null
        if (uri.scheme != "https") return null
        return if (host == "facebook.com" || host.endsWith(".facebook.com")) text else null
    }
}

/** One of Meta's preview frames. A tap that would leave Facebook's addresses is kept from opening anything. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun AdsFrame(url: String, modifier: Modifier = Modifier, height: Dp? = null) {
    AndroidView(
        modifier = modifier.fillMaxWidth().let { if (height != null) it.height(height) else it.fillMaxSize() },
        factory = { context ->
            WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                // The iPhone's frame keeps no data of its own; this one keeps no cookie from Facebook past the sheet.
                CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        val u = request.url
                        val inner = u.scheme in listOf("about", "blob", "data")
                        return !(AdsFrameRules.isFacebook(u.host) || inner || !request.isForMainFrame)
                    }

                    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {}
                }
                loadUrl(url)
            }
        },
        onRelease = { it.destroy() },
    )
}

/** The previews Meta made, a Feed / Story / Reels choice over the frame. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdsPreviewSheet(previews: List<AdsPreview>, onDismiss: () -> Unit) {
    var chosen by remember { mutableStateOf(previews.firstOrNull()?.format ?: "") }
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = ErpColors.ground) {
        Column(Modifier.fillMaxSize().padding(horizontal = 16.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            androidx.compose.foundation.layout.Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Preview", Modifier.weight(1f), style = androidx.compose.material3.MaterialTheme.typography.titleMedium)
                TextButton(onClick = onDismiss) { Text("Done") }
            }
            if (previews.size > 1) {
                AdsChips {
                    for (p in previews) FilterChip(p.label, chosen == p.format, { chosen = p.format })
                }
            }
            val p = previews.firstOrNull { it.format == chosen }
            if (p != null && p.src.startsWith("https://")) {
                androidx.compose.runtime.key(p.format) {
                    AdsFrame(p.src, Modifier.clip(RoundedCornerShape(16.dp)).weight(1f))
                }
            } else {
                AdsUnavailable("Meta gave no preview", "", icon = Symbols.VisibilityOff)
            }
        }
    }
}
