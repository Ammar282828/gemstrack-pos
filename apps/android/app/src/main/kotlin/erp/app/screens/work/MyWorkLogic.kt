package erp.app.screens.work

import erp.app.ui.AppClock
import erp.app.nav.ScreenRoute
import erp.core.ERPDate
import erp.core.Json
import erp.core.logic.KarigarPortal
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Addresses for the Work screens (WorkKit.swift `WorkPaths`). */
object WorkPaths {
    // What JavaScript's encodeURIComponent leaves alone (a query value).
    private const val COMPONENT_SAFE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"

    fun component(s: String): String {
        val out = StringBuilder()
        for (b in s.toByteArray(Charsets.UTF_8)) {
            val c = (b.toInt() and 0xFF).toChar()
            if (c in COMPONENT_SAFE) out.append(c) else out.append('%').append(String.format(Locale.US, "%02X", b.toInt() and 0xFF))
        }
        return out.toString()
    }

    /** A value in a path's query ("/my-work?preview=KAR-1"), decoded; null when it is not there. */
    fun query(name: String, path: String): String? {
        if (!path.contains('?')) return null
        for (part in path.substringAfter('?').substringBefore('#').split('&')) {
            if (part.isEmpty()) continue
            if (part.substringBefore('=') == name) return ScreenRoute.percentDecode(part.substringAfter('=', ""))
        }
        return null
    }

    /** The portal's address: `/api/karigar/me`, or an owner's preview of one karigar. */
    fun portal(previewId: String?): String =
        if (previewId.isNullOrEmpty()) "/api/karigar/me" else "/api/karigar/me?karigarId=" + component(previewId)
}

object MyWorkText {
    private val formatter: DateTimeFormatter = DateTimeFormatter.ofPattern("h:mm a", Locale.UK).withZone(ERPDate.karachi)

    /** "4:05 pm", Karachi's clock. */
    fun clock(d: Instant): String = formatter.format(d).replace(Regex("(?i)\\s*([ap])\\.?m\\.?$")) { " ${it.groupValues[1].lowercase()}m" }
}

/** A karigar's made-up portal for the demo, as /api/karigar/me would answer it for "Ustad Demo" (WorkKit.swift `WorkDemo.portal`). */
object WorkDemo {
    private fun ago(now: Instant, seconds: Long): String = ERPDate.iso(now.minusSeconds(seconds))

    fun portal(now: Instant = AppClock.now()): KarigarPortal? {
        val day = 86_400L
        val json = """
        {"role":"karigar","preview":false,"karigar":{"id":"KAR-D1","name":"Ustad Demo"},
         "summary":{"active":4,"inProgress":3,"late":1,"critical":1,"oldestDays":16},
         "jobs":[
          {"id":"order:ORD-D0002:0","source":"order","description":"Bangle pair with filigree","category":"Bangles","metalType":"gold","karat":"21k",
           "weightG":22.5,"quantity":1,"size":"2.6","sampleGiven":true,"status":"in-progress","assignedDate":"${ago(now, 16 * day)}",
           "ageDays":16,"urgency":"critical","orderId":"ORD-D0002","notes":"Fine filigree on the outer face.\nSatin finish inside."},
          {"id":"order:ORD-D0002:1","source":"order","description":"Matching studs","category":"Earrings","metalType":"gold","karat":"21k",
           "weightG":3.1,"quantity":1,"status":"in-progress","assignedDate":"${ago(now, 16 * day)}","ageDays":16,"urgency":"critical","orderId":"ORD-D0002"},
          {"id":"order:ORD-D0005:0","source":"order","description":"Plain band, matte finish","category":"Rings","metalType":"gold","karat":"21k",
           "weightG":4.2,"quantity":1,"size":"11","status":"in-progress","assignedDate":"${ago(now, 8 * day)}","ageDays":8,"urgency":"warning","orderId":"ORD-D0005"},
          {"id":"job:JOB-D1","source":"manual","description":"Polish the stock chains","category":"Chains","metalType":"gold","karat":"22k",
           "quantity":4,"status":"pending","assignedDate":"${ago(now, 2 * day)}","ageDays":2,"urgency":"ok"},
          {"id":"order:ORD-D0001:0","source":"order","description":"Ring resize","category":"Rings","status":"completed",
           "assignedDate":"${ago(now, 12 * day)}","ageDays":12,"urgency":"ok","orderId":"ORD-D0001"}
         ],
         "account":{"goldGiven":48.5,"goldReceived":22.25,"goldNet":26.25,"totalPaid":185000,
          "ledger":[{"date":"${ago(now, 3 * day)}","description":"Gold given for ORD-D0005","goldOut":6.5,"goldIn":0},
                    {"date":"${ago(now, 9 * day)}","description":"Finished bangles returned","goldOut":0,"goldIn":22.25}],
          "payments":[{"date":"${ago(now, 5 * day)}","amount":120000,"description":"Part payment"},
                      {"date":"${ago(now, 20 * day)}","amount":65000,"description":"Month end"}]}}
        """.trimIndent()
        return Json.decode<KarigarPortal>(json)
    }
}
