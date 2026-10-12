// Ported from src/lib/units.ts: weight, the way a Karachi jeweller talks about it. Everything is stored in
// grams; tola is how it is quoted. 11.664 g per tola is the one figure every screen reads. (Only the
// constant and toTola: the entry screens do not format weights.)

package erp.core.logic

const val gramsPerTola: Double = 11.664

fun toTola(grams: Double): Double = (if (grams.isNaN()) 0.0 else grams) / gramsPerTola
