package erp.app.shots

import android.Manifest
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import erp.app.nav.LocalNavigator
import erp.app.nav.Navigator
import androidx.compose.ui.unit.dp
import erp.app.ErpApp
import erp.app.data.ShelfStatus
import erp.app.screens.settings.AlertsForm
import erp.app.screens.settings.BankAccountsForm
import erp.app.screens.settings.ContactImportPage
import erp.app.screens.settings.ContactPlanAnswer
import erp.app.screens.settings.HisaabImportPage
import erp.app.screens.settings.HisaabPerson
import erp.app.screens.settings.HisaabRead
import erp.app.screens.settings.HisaabRow
import erp.app.screens.settings.LabelField
import erp.app.screens.settings.LabelForm
import erp.app.screens.settings.LabelLayout
import erp.app.screens.settings.PhonePush
import erp.app.screens.settings.PullOrder
import erp.app.screens.settings.PushNotRegistered
import erp.app.screens.settings.PushStatus
import erp.app.screens.settings.ShopForm
import erp.app.screens.settings.ShopifyInnerForm
import erp.app.screens.settings.ShopifyStatus
import erp.app.ui.ReadableColumn
import erp.core.Json
import erp.core.models.Product
import erp.core.models.Settings
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.junit.After
import org.junit.Test
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The Settings group at phone and tablet size, light and dark: the list and This phone for both houses (the house's
 * palette, name and version line show), the rest for Taheri. The demo has no bank accounts, alerts or learned names, so
 * those pages show their empty states; the pages that ask the ERP (Voice, Integrations, Backups, Shopify, Labels) show
 * what they say with no connection.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class SettingsShots(config: ShotConfig) : ShotBase(config) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun configs(): Collection<Array<Any>> {
            ShotEnv.demo()
            return ShotConfigs.all.map { arrayOf<Any>(it) }
        }
    }

    @Test fun settings_root() {
        showPlace("/settings")
        shoot("settings-root")
    }

    @Test fun settings_this_phone() {
        showPlace("/app/phone", below = listOf("/settings"))
        shoot("settings-this-phone")
    }

    @Test fun settings_shop() {
        onlyTaheri()
        showPlace("/app/settings/shop", below = listOf("/settings"))
        shoot("settings-shop")
    }

    @Test fun settings_alerts() {
        onlyTaheri()
        showPlace("/settings/alerts", below = listOf("/settings"))
        shoot("settings-alerts")
    }

    @Test fun settings_bank_accounts() {
        onlyTaheri()
        showPlace("/settings/payment-methods", below = listOf("/settings"))
        shoot("settings-bank-accounts")
    }

    @Test fun settings_integrations() {
        onlyTaheri()
        showPlace("/settings/integrations", below = listOf("/settings"))
        shoot("settings-integrations")
    }

    @Test fun settings_shopify() {
        onlyTaheri()
        showPlace("/app/settings/shopify", below = listOf("/settings", "/settings/integrations"))
        shoot("settings-shopify")
    }

    @Test fun settings_data() {
        onlyTaheri()
        showPlace("/settings/data", below = listOf("/settings"))
        shoot("settings-data")
    }

    @Test fun settings_voice() {
        onlyTaheri()
        showPlace("/settings/voice", below = listOf("/settings"))
        shoot("settings-voice")
    }

    @Test fun settings_labels() {
        onlyTaheri()
        showPlace("/settings/printer", below = listOf("/settings"))
        shoot("settings-labels")
    }

    @Test fun settings_weprint() {
        onlyTaheri()
        showPlace("/settings/weprint-api", below = listOf("/settings"))
        shoot("settings-weprint")
    }

    @Test fun settings_backups() {
        onlyTaheri()
        showPlace("/settings/backups", below = listOf("/settings", "/settings/data"))
        shoot("settings-backups")
    }

    @Test fun settings_contact_import() {
        onlyTaheri()
        showPlace("/settings/contact-import", below = listOf("/settings", "/settings/data"))
        shoot("settings-contact-import")
    }

    @Test fun settings_hisaab_import() {
        onlyTaheri()
        showPlace("/settings/hisaab-import", below = listOf("/settings", "/settings/data"))
        shoot("settings-hisaab-import")
    }

    @Test fun settings_widgets() {
        onlyTaheri()
        showPlace("/app/widgets", below = listOf("/settings", "/app/phone"))
        shoot("settings-widgets")
    }

    // MARK: The pages with something in them (made-up shop, numbers and orders: what the ERP would have answered)

    private val sample: Settings = Settings.fromMap(
        mapOf(
            "id" to "global", "shopName" to "Demo Shop", "shopAddress" to "Shop 4, Example Market, Karachi", "shopContact" to "0300 0000000",
            "theme" to "default", "lastInvoiceNumber" to 128, "lastOrderNumber" to 211, "lastRepairNumber" to 9,
            "notifEnabled" to true, "notifPhones" to listOf("923000000001", "923000000002"),
            "notifNewOrder" to true, "notifNewInvoice" to true, "notifDailyReport" to true, "notifOrderOverdue" to true,
            "notifDailyChecklistTime" to "09:00", "notifEndOfDayTime" to "18:30", "notifDailyReportTime" to "21:00",
            "paymentMethods" to listOf(
                mapOf("id" to "pm-1", "bankName" to "Meezan Bank", "accountName" to "Demo Shop", "accountNumber" to "0123456789", "iban" to "PK00MEZN0000000123456789"),
                mapOf("id" to "pm-2", "bankName" to "Bank Alfalah", "accountName" to "Demo Shop", "accountNumber" to "0099887766"),
            ),
        ),
    )

    private val noNavigator = object : Navigator {
        override fun open(path: String) {}
        override fun replace(path: String) {}
        override fun back() {}
        override val canGoBack: Boolean = false
    }

    @Composable private fun column(content: @Composable () -> Unit) =
        CompositionLocalProvider(LocalNavigator provides noNavigator) { ReadableColumn(maxWidth = 720.dp, content = content) }

    @Test fun settings_shop_filled() {
        onlyTaheri()
        show { column { ShopForm(sample) } }
        shoot("settings-shop-filled")
    }

    @Test fun settings_alerts_on() {
        onlyTaheri()
        show { column { AlertsForm(sample) } }
        shoot("settings-alerts-on")
    }

    @Test fun settings_bank_accounts_filled() {
        onlyTaheri()
        show { column { BankAccountsForm(sample) } }
        shoot("settings-bank-accounts-filled")
    }

    @Test fun settings_labels_designer() {
        onlyTaheri()
        val layout = LabelLayout(
            "std", "Double tag", 664, 296,
            listOf(
                LabelField("field-1", "text", 20, 20, 0, "SKU: {sku}", 22, null, null),
                LabelField("field-2", "text", 20, 70, 0, "{weight} g", 20, null, null),
                LabelField("field-3", "qr", 420, 30, 0, "{sku}", null, 4, null),
                LabelField("field-4", "text", 300, 250, 270, "Demo Shop", 18, null, null),
            ),
        )
        show { LabelForm(layout, layout, layout, false, {}, ShelfStatus<Product>(emptyList(), true, false, null, 0)) }
        shoot("settings-labels-designer")
    }

    @Test fun settings_shopify_connected() {
        onlyTaheri()
        val status = ShopifyStatus.from(
            Json.parse("""{"configured":true,"connected":true,"shop":"demo-shop.myshopify.com","shopName":"Demo Shop","lastSyncedAt":"2026-10-11T09:00:00.000Z","scopes":["read_orders","write_orders","read_customers","write_customers","read_products","read_draft_orders","write_draft_orders","read_inventory"],"webhooksHere":0,"webhooksTotal":2}"""),
        )
        val orders = listOf(
            PullOrder("1001", "#1001", "Amina Example · Karachi", "2026-10-10T08:00:00.000Z", 48_500.0),
            PullOrder("1002", "#1002", "Bilal Example", "2026-10-11T08:00:00.000Z", 12_000.0),
            PullOrder("1003", "#1003", "Sana Example · Lahore", "2026-10-11T10:00:00.000Z", 96_250.0),
        )
        show { column { ShopifyInnerForm(status, orders) } }
        shoot("settings-shopify-connected")
    }

    @Test fun settings_contact_import_plan() {
        onlyTaheri()
        val plan = ContactPlanAnswer.from(
            Json.parse(
                """{"plan":{"summary":{"cardsInFile":9,"ignoredUntagged":4,"mergedDuplicates":1,"settled":2,"conflicts":2},
                "fresh":[{"id":"f1","kind":"customer","name":"Amina","tags":["tj"],"phone":"0300 1111111","extraPhones":["0300 2222222"]},{"id":"f2","kind":"karigar","name":"Bilal","tags":["karigar"],"extraPhones":[]}],
                "settled":[{"name":"Sana"},{"name":"Tariq"}],
                "conflicts":[{"id":"c1","kind":"customer","name":"Hira Khan","tags":["hom"],"phone":"0300 3333333","reason":"same_name","matches":[{"id":"x","kind":"customer","name":"Hira","phone":"0300 4444444"}]},
                {"id":"c3","kind":"customer","name":"Zoya Ali","phone":"0300 5555555","reason":"same_phone","matches":[{"id":"y","kind":"customer","name":"Zoya","phone":"0300 5555555"}]}]},
                "defaults":{"c1":"add_phone","c3":"adopt_name"},"fingerprint":"fp1"}""",
            ),
        )
        show { column { ContactImportPage(plan) } }
        shoot("settings-contact-import-plan")
    }

    @Test fun settings_hisaab_import_rows() {
        onlyTaheri()
        val read = HisaabRead(
            listOf(
                HisaabRow("2026-08-02T00:00:00.000Z", true, "Advance for ring", 25_000.0, 0.0),
                HisaabRow("2026-08-19T00:00:00.000Z", true, "Balance paid", 0.0, 8_000.0),
                HisaabRow("", false, "Date did not read", 1_000.0, 0.0),
            ),
            "Row 3 has a date that could not be read.",
        )
        show { column { HisaabImportPage(read, HisaabPerson("c1", "Amina Example", "customer"), "easy-khata.csv") } }
        shoot("settings-hisaab-import-rows")
    }

    // MARK: This phone with its notifications on

    private class LinkedPush : PushStatus {
        override val registeredOnServer: StateFlow<Boolean> = MutableStateFlow(true)
        override val registering: StateFlow<Boolean> = MutableStateFlow(false)
        override val registrationError: StateFlow<String?> = MutableStateFlow(null)
        override suspend fun register() {}
        override suspend fun registered(): Boolean = true
        override suspend fun kindsOff(): List<String> = listOf("karigar")
        override suspend fun setKindsOff(off: List<String>) {}
        override suspend fun sendTest() { throw PushNotRegistered() }
    }

    @After fun forgetFakePush() {
        PhonePush.current = erp.app.screens.settings.ServerPushStatus()
    }

    @Test fun settings_this_phone_linked() {
        onlyTaheri()
        shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        PhonePush.current = LinkedPush()
        showPlace("/app/phone", below = listOf("/settings"))
        shoot("settings-this-phone-linked")
    }
}
