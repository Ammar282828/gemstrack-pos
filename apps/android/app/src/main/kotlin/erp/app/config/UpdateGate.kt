package erp.app.config

import erp.app.BuildConfig
import erp.app.data.ErpApi

/**
 * The ERP asks for a newer build than this one (`APP_MIN_ANDROID_BUILD`, Business.needsUpdate): money screens stay shut and
 * say why, quietly. Read where it is drawn, so a business switch to one with another floor shows at once. The Android floor
 * is its own number: the iPhone's build numbers (APP_MIN_BUILD) are not Android version codes. (UpdateGate.swift.)
 */
object UpdateGate {
    const val words = "This app is out of date: install the latest version."

    fun blocked(business: Business, build: Int = BuildConfig.VERSION_CODE): Boolean = business.needsUpdate(build)

    /** The open business's. */
    val blocked: Boolean get() = blocked(Businesses.current)

    /** For a money write that has no Save button of its own to switch off (`ErpApi.write` refuses it for everything else). */
    fun refuse() {
        if (blocked) throw ErpApi.Failure(426, words)
    }
}
