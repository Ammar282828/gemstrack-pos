// Ported from src/lib/rates.ts (tests: RatesTests, from rates.test.ts). Named RatesLogic.kt because
// models/Payments.kt holds the `Rates` document type.
//
// The shop's live rates: which one is "the" rate, when it was set and by whom, and what a
// sale may write back to it.
//
// The rates in app_settings/global are what every new sale starts from and what the website
// quotes and takes orders at (website/config.ts). Until 2026-10-01 the cart wrote its rates
// back after every save, new or edited — and editing an old invoice first loads that invoice's
// own rates, and a scanned bill sets the paper's — so re-saving a July invoice made July's rate
// today's (the audit of 1 Oct). Now only a new invoice writes back, and only the rates typed by
// hand in that cart (`ratesToKeep`).

package erp.core.logic

import erp.core.ERPDate
import erp.core.models.MetalType
import erp.core.models.Rates
import erp.core.models.Settings
import erp.core.seconds
import java.time.Instant
import kotlin.math.abs

/** Every rate the settings document holds, PKR per gram. The cases are in `RATE_KEYS`' order, which is the order `changedRates` answers in. */
enum class RateKey(val metal: MetalType) {
    goldRatePerGram24k(MetalType.gold), goldRatePerGram22k(MetalType.gold), goldRatePerGram21k(MetalType.gold), goldRatePerGram18k(MetalType.gold),
    palladiumRatePerGram(MetalType.palladium), palladiumRatePerGram18k(MetalType.palladium), palladiumRatePerGram12k(MetalType.palladium),
    platinumRatePerGram(MetalType.platinum), silverRatePerGram(MetalType.silver),
}

val RATE_KEYS: List<RateKey> = RateKey.values().toList()

/** TS `Rates = Partial<Record<RateKey, number>>`: whichever rates are given. */
typealias RateValues = Map<RateKey, Double>

/** The cart's rate boxes, by the names it uses. */
enum class RateInputKey(val rateKey: RateKey) {
    gold24k(RateKey.goldRatePerGram24k), gold22k(RateKey.goldRatePerGram22k), gold21k(RateKey.goldRatePerGram21k), gold18k(RateKey.goldRatePerGram18k),
    palladium(RateKey.palladiumRatePerGram), palladium18k(RateKey.palladiumRatePerGram18k), palladium12k(RateKey.palladiumRatePerGram12k),
    platinum(RateKey.platinumRatePerGram), silver(RateKey.silverRatePerGram),
}

/** The rates this sale carried (a rate it did not carry is absent, never 0). */
val Rates.values: RateValues
    get() {
        val out = LinkedHashMap<RateKey, Double>()
        val all = listOf(
            RateKey.goldRatePerGram24k to goldRatePerGram24k, RateKey.goldRatePerGram22k to goldRatePerGram22k,
            RateKey.goldRatePerGram21k to goldRatePerGram21k, RateKey.goldRatePerGram18k to goldRatePerGram18k,
            RateKey.palladiumRatePerGram to palladiumRatePerGram, RateKey.palladiumRatePerGram18k to palladiumRatePerGram18k,
            RateKey.palladiumRatePerGram12k to palladiumRatePerGram12k, RateKey.platinumRatePerGram to platinumRatePerGram,
            RateKey.silverRatePerGram to silverRatePerGram,
        )
        for ((key, value) in all) if (value != null) out[key] = value
        return out
    }

/** The shop's rates as stored (a rate never set reads 0 here, as in the model). */
val Settings.rates: RateValues
    get() = mapOf(
        RateKey.goldRatePerGram24k to goldRatePerGram24k, RateKey.goldRatePerGram22k to goldRatePerGram22k,
        RateKey.goldRatePerGram21k to goldRatePerGram21k, RateKey.goldRatePerGram18k to goldRatePerGram18k,
        RateKey.palladiumRatePerGram to palladiumRatePerGram, RateKey.palladiumRatePerGram18k to palladiumRatePerGram18k,
        RateKey.palladiumRatePerGram12k to palladiumRatePerGram12k, RateKey.platinumRatePerGram to platinumRatePerGram,
        RateKey.silverRatePerGram to silverRatePerGram,
    )

data class MainRate(val key: RateKey, val label: String)

/** The one rate a house watches: 21K for a gold house, silver for a silver one. */
fun mainRate(defaultMetal: MetalType): MainRate =
    if (defaultMetal == MetalType.silver) MainRate(RateKey.silverRatePerGram, "Silver") else MainRate(RateKey.goldRatePerGram21k, "21K")

/**
 * What a saved invoice may write back to the shop's rates: nothing for an edit, and for a new
 * invoice only the boxes typed by hand in this cart, for a metal the sale carries, when the
 * figure is a real rate and differs from the one stored. A rate loaded from an invoice or read
 * off a scanned bill is never "typed" (the cart forgets a box when either sets it).
 * Null when nothing is to be written.
 */
fun ratesToKeep(
    isNew: Boolean,
    typed: Set<RateInputKey>,
    inputs: Map<RateInputKey, String>,
    metals: Set<MetalType>,
    current: RateValues,
): RateValues? {
    if (!isNew) return null
    val out = LinkedHashMap<RateKey, Double>()
    // The TS walks a Set in insertion order; no two boxes write the same rate, so the order cannot show.
    for (input in typed) {
        val key = input.rateKey
        if (!metals.contains(key.metal)) continue
        val v = JS.parseFloat(inputs[input] ?: "")
        if (!v.isFinite() || v <= 0) continue
        if (abs(v - (current[key] ?: 0.0)) < 0.005) continue
        out[key] = v
    }
    return if (out.isEmpty()) null else out
}

/** The rate keys in a settings change whose value actually moves. */
fun changedRates(patch: RateValues, current: RateValues): List<RateKey> =
    RATE_KEYS.filter { k ->
        val v = patch[k]
        if (v == null || !v.isFinite()) false else abs(v - (current[k] ?: 0.0)) >= 0.005
    }

/** Karachi's calendar date, yyyy-mm-dd. */
fun karachiDay(d: Instant): String = ERPDate.karachiDay(d)

/** Whether the rates were set on Karachi's today. An unknown time is never today. */
fun ratesSetToday(updatedAt: String?, now: Instant = Instant.now()): Boolean {
    val t = JS.newDate(updatedAt) ?: return false
    return karachiDay(t) == karachiDay(now)
}

/**
 * "9:40" today, "Tue 9:40" this week, "28 Sept" before: Karachi time. (The browser's en-GB:
 * 24-hour clock with the hour unpadded, "0:30" after midnight, and September short as "Sept".)
 */
fun whenSet(updatedAt: String?, now: Instant = Instant.now()): String {
    val t = JS.newDate(updatedAt) ?: return "not dated"
    val local = t.atOffset(ERPDate.karachi)
    val time = "${local.hour}:" + (if (local.minute < 10) "0${local.minute}" else "${local.minute}")
    if (karachiDay(t) == karachiDay(now)) return time
    val days = (now.seconds - t.seconds) * 1000 / 86_400_000
    if (days < 6) return "${JS.shortWeekdays[local.dayOfWeek.value % 7]} $time"
    return "${local.dayOfMonth} ${JS.shortMonths[local.monthValue - 1]}"
}
