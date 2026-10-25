import XCTest
@testable import ERPCore

/// The voice sheet's yes and no (not in the web, whose card has a Write button). Made-up phrases only.
final class VoiceReplyTests: XCTestCase {
    func testYesInEnglishAndRomanUrdu() {
        for w in ["Yes", "yes.", "  Yeah!  ", "save it", "Do it", "haan", "Haan ji", "ji haan", "kar do", "theek hai"] {
            XCTAssertEqual(voiceReply(w), .yes, w)
        }
    }

    func testNoInEnglishAndRomanUrdu() {
        for w in ["No", "no.", "Cancel", "never mind", "nahi", "Nahin", "rehne do", "don't", "Don\u{2019}t save"] {
            XCTAssertEqual(voiceReply(w), .no, w)
        }
    }

    func testOnlyAWholeUtteranceAnswers() {
        for w in ["no make it 700", "yes and also add tea", "change the amount to 50,000", "save the invoice for Sara", "", "  ", "okay", "ok"] {
            XCTAssertEqual(voiceReply(w), .other, w)
        }
    }
}
