package erp.app.device

/**
 * The pure parts of notifications (DeviceLinks.swift `Push`): what a phone tells the ERP, what a notification's
 * data says, and the channels the server names (lib/push/fcm.ts sends `android.notification.channelId = kind`).
 */
object PushLogic {
    /** The iPhone's UserDefaults key for it; Settings → This phone reads the token from here. */
    const val TOKEN_KEY = "erp.pushToken"

    /** One notification channel per kind of alert: the id is the push kind the server sends. */
    class Channel(val id: String, val name: String, val detail: String)

    val channels = listOf(
        Channel("sales", "Sales", "A new sale"),
        Channel("payments", "Payments", "A payment on an invoice, a transfer slip, a payment on Shopify"),
        Channel("orders", "Orders", "A new order, one finished or cancelled, online orders waiting"),
        Channel("karigar", "Karigar work", "A karigar marking a piece done"),
    )

    /** POST /api/push/devices: the iPhone's body with the platform named (the server reads none as iOS). */
    fun registerBody(token: String, bundleId: String, label: String): Map<String, Any?> =
        mapOf("token" to token, "platform" to "android", "bundleId" to bundleId, "label" to label)

    /** DELETE /api/push/devices. */
    fun unregisterBody(token: String): Map<String, Any?> = mapOf("token" to token)

    /**
     * The page a notification opens: its `url` (a path of the ERP, which the server sends as data and FCM hands the
     * launcher in the intent's extras while the app is in the background). Anything else, an empty url included, opens
     * nothing; `//host` is a path of another site, not ours.
     */
    fun pathFor(url: String?): String? = url?.trim()?.takeIf { it.startsWith("/") && !it.startsWith("//") }

    /** The channel a notification of this kind is shown on; an unknown kind is an order's. */
    fun channelFor(kind: String?): String = channels.firstOrNull { it.id == kind }?.id ?: "orders"
}
