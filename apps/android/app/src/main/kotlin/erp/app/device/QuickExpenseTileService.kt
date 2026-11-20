package erp.app.device

import android.app.PendingIntent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * The Quick Settings tile "Add expense" (the iPhone's Shortcut control, QuickExpenseIntent.swift): a tap opens the small
 * expense window ([QuickExpenseActivity]) over the Home Screen, not the app. The tile holds no state: it is a button.
 */
class QuickExpenseTileService : TileService() {
    override fun onStartListening() {
        qsTile?.let {
            it.state = Tile.STATE_INACTIVE
            if (Build.VERSION.SDK_INT >= 29) it.subtitle = getString(erp.app.R.string.expense_tile_subtitle)
            it.updateTile()
        }
    }

    override fun onClick() {
        // Behind the lock screen the phone is unlocked first, then the window opens.
        if (isLocked) unlockAndRun { open() } else open()
    }

    private fun open() {
        val intent = QuickExpenseActivity.launch(this)
        if (Build.VERSION.SDK_INT >= 34) {
            // API 34 takes a PendingIntent; the Intent form is gone for apps that target it.
            val pending = PendingIntent.getActivity(this, 1, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            startActivityAndCollapse(pending)
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }
}
