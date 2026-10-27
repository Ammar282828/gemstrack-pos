package erp.app.nav

import androidx.compose.ui.graphics.vector.ImageVector
import erp.app.ui.icons.Symbols

/**
 * The ERP's icons (lucide) as Material Symbols. A name not here falls back to a plain square, and the map is
 * short enough to keep whole: nav-export lists every icon the ERP's map uses (a test checks both files').
 */
object NavIcon {
    private val icons: Map<String, () -> ImageVector> = mapOf(
        "ArchiveRestore" to { Symbols.Unarchive }, "Banknote" to { Symbols.Payments }, "Bell" to { Symbols.Notifications },
        "BookUser" to { Symbols.ContactPage }, "Bot" to { Symbols.AutoAwesome }, "Radio" to { Symbols.Sensors }, "Boxes" to { Symbols.Inventory2 }, "Briefcase" to { Symbols.BusinessCenter },
        "Calendar" to { Symbols.CalendarMonth }, "Camera" to { Symbols.PhotoCamera }, "ChartColumn" to { Symbols.BarChart },
        "ChartPie" to { Symbols.PieChart }, "CirclePlus" to { Symbols.AddCircleOutline }, "ClipboardList" to { Symbols.Assignment },
        "Coins" to { Symbols.Paid }, "Contact" to { Symbols.Contacts }, "Database" to { Symbols.Storage },
        "FileClock" to { Symbols.PendingActions }, "Gem" to { Symbols.Diamond }, "Globe" to { Symbols.Language },
        "Hammer" to { Symbols.Construction }, "History" to { Symbols.History }, "House" to { Symbols.Home },
        "ImagePlus" to { Symbols.AddPhotoAlternate }, "Import" to { Symbols.Download }, "Landmark" to { Symbols.AccountBalance },
        "Layers" to { Symbols.Layers }, "LayoutGrid" to { Symbols.GridView }, "ListChecks" to { Symbols.Checklist },
        "Map" to { Symbols.Explore }, "Megaphone" to { Symbols.Campaign }, "Mic" to { Symbols.Mic }, "Package" to { Symbols.Inventory },
        "Palette" to { Symbols.Palette }, "PenLine" to { Symbols.Edit }, "Plug" to { Symbols.Power },
        "Receipt" to { Symbols.Receipt }, "Rocket" to { Symbols.RocketLaunch }, "Rows3" to { Symbols.ViewAgenda }, "RotateCcw" to { Symbols.Undo },
        "Scale" to { Symbols.Scale }, "ScanLine" to { Symbols.QrCodeScanner }, "Send" to { Symbols.Send },
        "Settings" to { Symbols.Settings }, "SlidersHorizontal" to { Symbols.Tune }, "Tag" to { Symbols.Sell },
        "Target" to { Symbols.Adjust }, "TrendingUp" to { Symbols.TrendingUp }, "Users" to { Symbols.People },
        "UsersRound" to { Symbols.Groups }, "Wallet" to { Symbols.AccountBalanceWallet }, "Wrench" to { Symbols.Build },
    )


    /** The same places filled: the chosen tab of the bar. */
    private val selected: Map<String, () -> ImageVector> = mapOf(
        "ArchiveRestore" to { Symbols.Fill.Unarchive }, "Banknote" to { Symbols.Fill.Payments }, "Bell" to { Symbols.Fill.Notifications },
        "BookUser" to { Symbols.Fill.ContactPage }, "Bot" to { Symbols.Fill.AutoAwesome }, "Radio" to { Symbols.Fill.Sensors }, "Boxes" to { Symbols.Fill.Inventory2 }, "Briefcase" to { Symbols.Fill.BusinessCenter },
        "Calendar" to { Symbols.Fill.CalendarMonth }, "Camera" to { Symbols.Fill.PhotoCamera }, "ChartColumn" to { Symbols.Fill.BarChart },
        "ChartPie" to { Symbols.Fill.PieChart }, "CirclePlus" to { Symbols.Fill.AddCircleOutline }, "ClipboardList" to { Symbols.Fill.Assignment },
        "Coins" to { Symbols.Fill.Paid }, "Contact" to { Symbols.Fill.Contacts }, "Database" to { Symbols.Fill.Storage },
        "FileClock" to { Symbols.Fill.PendingActions }, "Gem" to { Symbols.Fill.Diamond }, "Globe" to { Symbols.Fill.Language },
        "Hammer" to { Symbols.Fill.Construction }, "History" to { Symbols.Fill.History }, "House" to { Symbols.Fill.Home },
        "ImagePlus" to { Symbols.Fill.AddPhotoAlternate }, "Import" to { Symbols.Fill.Download }, "Landmark" to { Symbols.Fill.AccountBalance },
        "Layers" to { Symbols.Fill.Layers }, "LayoutGrid" to { Symbols.Fill.GridView }, "ListChecks" to { Symbols.Fill.Checklist },
        "Map" to { Symbols.Fill.Explore }, "Megaphone" to { Symbols.Fill.Campaign }, "Mic" to { Symbols.Fill.Mic }, "Package" to { Symbols.Fill.Inventory },
        "Palette" to { Symbols.Fill.Palette }, "PenLine" to { Symbols.Fill.Edit }, "Plug" to { Symbols.Fill.Power },
        "Receipt" to { Symbols.Fill.Receipt }, "Rocket" to { Symbols.Fill.RocketLaunch }, "Rows3" to { Symbols.Fill.ViewAgenda }, "RotateCcw" to { Symbols.Fill.Undo },
        "Scale" to { Symbols.Fill.Scale }, "ScanLine" to { Symbols.Fill.QrCodeScanner }, "Send" to { Symbols.Fill.Send },
        "Settings" to { Symbols.Fill.Settings }, "SlidersHorizontal" to { Symbols.Fill.Tune }, "Tag" to { Symbols.Fill.Sell },
        "Target" to { Symbols.Fill.Adjust }, "TrendingUp" to { Symbols.Fill.TrendingUp }, "Users" to { Symbols.Fill.People },
        "UsersRound" to { Symbols.Fill.Groups }, "Wallet" to { Symbols.Fill.AccountBalanceWallet }, "Wrench" to { Symbols.Fill.Build },
    )


    /** The lucide names this app draws. */
    val known: Set<String> get() = icons.keys

    /** Outline: the bar shows this until a tab is chosen, and every list of places wears it. */
    fun vector(lucide: String?): ImageVector = lucide?.let { icons[it]?.invoke() } ?: Symbols.CropSquare

    fun outline(lucide: String?): ImageVector = vector(lucide)

    /** Filled: the bar's chosen tab (Material Symbols' fill axis, as the navigation bar's selected item). */
    fun filled(lucide: String?): ImageVector = lucide?.let { selected[it]?.invoke() } ?: Symbols.Fill.CropSquare
}
