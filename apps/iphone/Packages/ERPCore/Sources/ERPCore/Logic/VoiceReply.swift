// Not a port: the native voice sheet's own rule (docs/features/ai.md, Voice). While a plan is on screen the phone
// keeps listening, and a whole utterance that is only "yes" or "no" answers the plan instead of being sent to the
// model as a new request. Only the whole utterance counts ("no, make it 700" is a change, not a refusal), and a bare
// "okay" counts as neither: a stray word must never save money. English and the shop's Roman Urdu.

import Foundation

public enum VoiceReply: Equatable {
    case yes, no, other
}

private let yesWords: Set<String> = [
    "yes", "yeah", "yep", "yup", "yes please", "yes save", "yes save it", "yes do it", "yes go ahead",
    "save", "save it", "save this", "do it", "confirm", "ok save", "okay save", "go ahead",
    "haan", "han", "haan ji", "han ji", "ji haan", "ji han", "ji", "jee", "haan save", "haan kar do",
    "kar do", "kardo", "save kar do", "save karo", "theek hai", "thik hai", "sahi hai",
]

private let noWords: Set<String> = [
    "no", "nope", "no cancel", "cancel", "cancel it", "cancel this", "stop", "never mind", "nevermind",
    "leave it", "forget it", "dont", "dont save", "do not save",
    "nahi", "nahin", "nai", "na", "nahi cancel", "nahi karna", "mat karo", "rehne do", "reh ne do",
    "chhor do", "chor do", "cancel kar do",
]

/// What a whole utterance says to the plan on screen.
public func voiceReply(_ words: String) -> VoiceReply {
    let kept = words.lowercased().unicodeScalars.map { s -> Character in
        if s == "'" || s == "\u{2019}" { return "\0" }
        return CharacterSet.alphanumerics.contains(s) ? Character(s) : " "
    }
    let phrase = String(kept.filter { $0 != "\0" }).split(separator: " ").joined(separator: " ")
    if yesWords.contains(phrase) { return .yes }
    if noWords.contains(phrase) { return .no }
    return .other
}
