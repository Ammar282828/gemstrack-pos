package erp.app.screens.design

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import erp.app.ui.FullScreenSheet
import erp.app.ui.Note
import erp.app.ui.NoteBanner
import erp.app.ui.theme.ErpColors
import androidx.compose.foundation.layout.navigationBarsPadding

// The hooks (DesignHooks.swift): each button the shell shows opens a sheet from this package, and a screen may replace a closure to
// open something else:
//   resize / redoFromMaster   DesignResize.kt   (resize-sheet.tsx, lib/design/resize*.ts, POST /api/design/resize)
//   startWithAnything          DesignSmart.kt    (smart-input.tsx, POST /api/design/{parse,analyze,layers}, GET /api/design/fetch)
//   publish                    DesignPublish*.kt (publish-sheet.tsx, lib/design/{destinations,publish}.ts, GET /api/design/destinations)
// The AI picture tools are the photograph card's own (DesignAI.kt).
//
// What a sheet can use on `DesignWorkspaceModel`: work / photos, addPages, setDoc / redoFromMaster, render / renderWith, saveToShop,
// recordPublish, finish, say.
object DesignHooks {
    /** "Resize…" in the workspace and "Size" in the page strip: the master's design on another shape (AI resize). */
    var resize: (DesignWorkspaceModel) -> Unit = { model ->
        model.sheet = DesignSheet("Resize") { dismiss -> DesignResizeSheet(model, dismiss) }
    }

    /** "Re-do from the master" on a resized page that is behind it (resize engine, one page). */
    var redoFromMaster: (DesignWorkspaceModel, String) -> Unit = { model, pageId -> model.go { model.redoPage(pageId) } }

    /** "Publish": the one sheet that sends a design anywhere (website, WhatsApp, Instagram, Meta ad, queue, download). */
    var publish: (DesignWorkspaceModel) -> Unit = { model ->
        if (model.work?.fresh == false) model.sheet = DesignSheet("Publish") { dismiss -> DesignPublishSheet(model, dismiss) }
    }

    /**
     * "Start with anything" on the start screen: paste a caption, a forwarded message, a link or a SKU, or choose photos. The sheet fills the
     * form through `DesignStartModel.apply(...)`.
     */
    var startWithAnything: (DesignStartModel) -> Unit = { start ->
        start.sheet = DesignSheet("Start with anything") { dismiss -> DesignSmartSheet(start, start.adsAllowed, dismiss) }
    }

    /** Back to the app's own after a business switch or a test (the Swift's `reset`). */
    fun reset() {
        resize = { model -> model.sheet = DesignSheet("Resize") { dismiss -> DesignResizeSheet(model, dismiss) } }
        publish = { model -> if (model.work?.fresh == false) model.sheet = DesignSheet("Publish") { dismiss -> DesignPublishSheet(model, dismiss) } }
        startWithAnything = { start -> start.sheet = DesignSheet("Start with anything") { dismiss -> DesignSmartSheet(start, start.adsAllowed, dismiss) } }
        redoFromMaster = { model, pageId -> model.go { model.redoPage(pageId) } }
    }
}

/** A sheet the hooks asked for, shown full screen with its own title; the screen's toasts go into it while it is up. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun DesignSheetHost(sheet: DesignSheet, speak: ((Note) -> Unit)?, onClose: () -> Unit) {
    if (sheet.compact) {
        androidx.compose.material3.ModalBottomSheet(onDismissRequest = onClose, containerColor = ErpColors.ground) {
            Column(Modifier.navigationBarsPadding().padding(bottom = 8.dp)) { sheet.content(onClose) }
        }
    } else {
        FullScreenSheet(title = sheet.title, onCancel = onClose, cancelText = "Close") {
            sheet.content(onClose)
        }
    }
}

/** What fills a sheet: the note it is carrying (from [designSpeech]) above its content. */
@Composable
fun DesignSheetBody(note: Note?, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize()) {
        note?.let { NoteBanner(it, Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
        content()
    }
}
