package erp.app.device

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import erp.app.MainActivity
import erp.app.screens.voice.VoiceLaunch

/**
 * The Quick Settings tile "Talk to ERP" (the iPhone's Control Center control, Widget/ERPVoiceControl.swift). A tap opens the app
 * on the open business straight into the voice sheet, through the same address as the launcher shortcut; the sheet itself is for
 * owners, and the app's lock still asks first. The tile holds no state: it is a button.
 */
class VoiceTileService : TileService() {
    override fun onStartListening() {
        qsTile?.let {
            it.state = Tile.STATE_INACTIVE
            if (Build.VERSION.SDK_INT >= 29) it.subtitle = getString(erp.app.R.string.voice_tile_subtitle)
            it.updateTile()
        }
    }

    override fun onClick() {
        // Behind the lock screen the phone is unlocked first, then the app opens.
        if (isLocked) unlockAndRun { open() } else open()
    }

    private fun open() {
        val intent = launch(this)
        if (Build.VERSION.SDK_INT >= 34) {
            // API 34 takes a PendingIntent; the Intent form is gone for apps that target it.
            val pending = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            startActivityAndCollapse(pending)
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }

    companion object {
        /** What the tile fires: the app, on `erp://voice` (a new task, as a tile is outside the app). */
        fun launch(context: android.content.Context): Intent =
            Intent(Intent.ACTION_VIEW, Uri.parse(VoiceLaunch.ADDRESS), context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}
