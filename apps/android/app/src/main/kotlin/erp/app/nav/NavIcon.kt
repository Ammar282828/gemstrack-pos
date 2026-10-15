package erp.app.nav

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AccountBalance
import androidx.compose.material.icons.rounded.AccountBalanceWallet
import androidx.compose.material.icons.rounded.AddCircleOutline
import androidx.compose.material.icons.rounded.AddPhotoAlternate
import androidx.compose.material.icons.automirrored.rounded.Assignment
import androidx.compose.material.icons.rounded.Build
import androidx.compose.material.icons.rounded.BusinessCenter
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Campaign
import androidx.compose.material.icons.rounded.Checklist
import androidx.compose.material.icons.rounded.Construction
import androidx.compose.material.icons.rounded.ContactPage
import androidx.compose.material.icons.rounded.Contacts
import androidx.compose.material.icons.rounded.CropSquare
import androidx.compose.material.icons.rounded.Diamond
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.GridView
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Inventory
import androidx.compose.material.icons.rounded.Inventory2
import androidx.compose.material.icons.rounded.Language
import androidx.compose.material.icons.rounded.Layers
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Paid
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material.icons.rounded.Payments
import androidx.compose.material.icons.rounded.PendingActions
import androidx.compose.material.icons.rounded.People
import androidx.compose.material.icons.rounded.PhotoCamera
import androidx.compose.material.icons.rounded.PieChart
import androidx.compose.material.icons.rounded.Power
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.Receipt
import androidx.compose.material.icons.rounded.RocketLaunch
import androidx.compose.material.icons.rounded.Scale
import androidx.compose.material.icons.rounded.Sell
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Storage
import androidx.compose.material.icons.rounded.Adjust
import androidx.compose.material.icons.rounded.BarChart
import androidx.compose.material.icons.automirrored.rounded.TrendingUp
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.automirrored.rounded.Undo
import androidx.compose.material.icons.rounded.Unarchive
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.material.icons.outlined.*
import androidx.compose.material.icons.automirrored.outlined.*

/**
 * The ERP's icons (lucide) as Material icons. A name not here falls back to a plain square, and the map is
 * short enough to keep whole: nav-export lists every icon the ERP's map uses (a test checks both files').
 */
object NavIcon {
    private val icons: Map<String, () -> ImageVector> = mapOf(
        "ArchiveRestore" to { Icons.Rounded.Unarchive }, "Banknote" to { Icons.Rounded.Payments }, "Bell" to { Icons.Rounded.Notifications },
        "BookUser" to { Icons.Rounded.ContactPage }, "Boxes" to { Icons.Rounded.Inventory2 }, "Briefcase" to { Icons.Rounded.BusinessCenter },
        "Calendar" to { Icons.Rounded.CalendarMonth }, "Camera" to { Icons.Rounded.PhotoCamera }, "ChartColumn" to { Icons.Rounded.BarChart },
        "ChartPie" to { Icons.Rounded.PieChart }, "CirclePlus" to { Icons.Rounded.AddCircleOutline }, "ClipboardList" to { Icons.AutoMirrored.Rounded.Assignment },
        "Coins" to { Icons.Rounded.Paid }, "Contact" to { Icons.Rounded.Contacts }, "Database" to { Icons.Rounded.Storage },
        "FileClock" to { Icons.Rounded.PendingActions }, "Gem" to { Icons.Rounded.Diamond }, "Globe" to { Icons.Rounded.Language },
        "Hammer" to { Icons.Rounded.Construction }, "History" to { Icons.Rounded.History }, "House" to { Icons.Rounded.Home },
        "ImagePlus" to { Icons.Rounded.AddPhotoAlternate }, "Import" to { Icons.Rounded.Download }, "Landmark" to { Icons.Rounded.AccountBalance },
        "Layers" to { Icons.Rounded.Layers }, "LayoutGrid" to { Icons.Rounded.GridView }, "ListChecks" to { Icons.Rounded.Checklist },
        "Megaphone" to { Icons.Rounded.Campaign }, "Mic" to { Icons.Rounded.Mic }, "Package" to { Icons.Rounded.Inventory },
        "Palette" to { Icons.Rounded.Palette }, "PenLine" to { Icons.Rounded.Edit }, "Plug" to { Icons.Rounded.Power },
        "Receipt" to { Icons.Rounded.Receipt }, "Rocket" to { Icons.Rounded.RocketLaunch }, "RotateCcw" to { Icons.AutoMirrored.Rounded.Undo },
        "Scale" to { Icons.Rounded.Scale }, "ScanLine" to { Icons.Rounded.QrCodeScanner }, "Send" to { Icons.AutoMirrored.Rounded.Send },
        "Settings" to { Icons.Rounded.Settings }, "SlidersHorizontal" to { Icons.Rounded.Tune }, "Tag" to { Icons.Rounded.Sell },
        "Target" to { Icons.Rounded.Adjust }, "TrendingUp" to { Icons.AutoMirrored.Rounded.TrendingUp }, "Users" to { Icons.Rounded.People },
        "UsersRound" to { Icons.Rounded.Groups }, "Wallet" to { Icons.Rounded.AccountBalanceWallet }, "Wrench" to { Icons.Rounded.Build },
    )

    /** The same places drawn as outlines: the bar shows these until a tab is chosen, then crossfades to the filled one. */
    private val outlined: Map<String, () -> ImageVector> = mapOf(
        "ArchiveRestore" to { Icons.Outlined.Unarchive }, "Banknote" to { Icons.Outlined.Payments }, "Bell" to { Icons.Outlined.Notifications },
        "BookUser" to { Icons.Outlined.ContactPage }, "Boxes" to { Icons.Outlined.Inventory2 }, "Briefcase" to { Icons.Outlined.BusinessCenter },
        "Calendar" to { Icons.Outlined.CalendarMonth }, "Camera" to { Icons.Outlined.PhotoCamera }, "ChartColumn" to { Icons.Outlined.BarChart },
        "ChartPie" to { Icons.Outlined.PieChart }, "CirclePlus" to { Icons.Outlined.AddCircleOutline }, "ClipboardList" to { Icons.AutoMirrored.Outlined.Assignment },
        "Coins" to { Icons.Outlined.Paid }, "Contact" to { Icons.Outlined.Contacts }, "Database" to { Icons.Outlined.Storage },
        "FileClock" to { Icons.Outlined.PendingActions }, "Gem" to { Icons.Outlined.Diamond }, "Globe" to { Icons.Outlined.Language },
        "Hammer" to { Icons.Outlined.Construction }, "History" to { Icons.Outlined.History }, "House" to { Icons.Outlined.Home },
        "ImagePlus" to { Icons.Outlined.AddPhotoAlternate }, "Import" to { Icons.Outlined.Download }, "Landmark" to { Icons.Outlined.AccountBalance },
        "Layers" to { Icons.Outlined.Layers }, "LayoutGrid" to { Icons.Outlined.GridView }, "ListChecks" to { Icons.Outlined.Checklist },
        "Megaphone" to { Icons.Outlined.Campaign }, "Mic" to { Icons.Outlined.Mic }, "Package" to { Icons.Outlined.Inventory },
        "Palette" to { Icons.Outlined.Palette }, "PenLine" to { Icons.Outlined.Edit }, "Plug" to { Icons.Outlined.Power },
        "Receipt" to { Icons.Outlined.Receipt }, "Rocket" to { Icons.Outlined.RocketLaunch }, "RotateCcw" to { Icons.AutoMirrored.Outlined.Undo },
        "Scale" to { Icons.Outlined.Scale }, "ScanLine" to { Icons.Outlined.QrCodeScanner }, "Send" to { Icons.AutoMirrored.Outlined.Send },
        "Settings" to { Icons.Outlined.Settings }, "SlidersHorizontal" to { Icons.Outlined.Tune }, "Tag" to { Icons.Outlined.Sell },
        "Target" to { Icons.Outlined.Adjust }, "TrendingUp" to { Icons.AutoMirrored.Outlined.TrendingUp }, "Users" to { Icons.Outlined.People },
        "UsersRound" to { Icons.Outlined.Groups }, "Wallet" to { Icons.Outlined.AccountBalanceWallet }, "Wrench" to { Icons.Outlined.Build },
    )

    /** The lucide names this app draws. */
    val known: Set<String> get() = icons.keys

    fun vector(lucide: String?): ImageVector = lucide?.let { icons[it]?.invoke() } ?: Icons.Rounded.CropSquare

    fun outline(lucide: String?): ImageVector = lucide?.let { outlined[it]?.invoke() } ?: Icons.Outlined.CropSquare
}
