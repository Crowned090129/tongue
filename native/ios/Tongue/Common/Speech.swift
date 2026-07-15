import SwiftUI
import AVFoundation

/// Thin wrapper around `AVSpeechSynthesizer` for reading target-language text
/// aloud. One shared synthesizer so a new utterance interrupts the previous one
/// (tapping a second play button stops the first).
///
/// `lang` is a BCP-47 code (e.g. "fr-FR") — exactly what `Language.locale`
/// carries and what `AVSpeechSynthesisVoice(language:)` expects.
final class Speaker: NSObject, ObservableObject {
    static let shared = Speaker()

    private let synth = AVSpeechSynthesizer()

    /// The text currently being spoken, so `PlayButton` can reflect play state.
    @Published private(set) var speakingText: String?

    private override init() {
        super.init()
        synth.delegate = self
    }

    func speak(_ text: String, lang: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        // Tapping the same phrase again toggles it off.
        if synth.isSpeaking {
            synth.stopSpeaking(at: .immediate)
            if speakingText == trimmed {
                speakingText = nil
                return
            }
        }

        configureAudioSession()

        let utterance = AVSpeechUtterance(string: trimmed)
        utterance.voice = AVSpeechSynthesisVoice(language: lang)
            ?? AVSpeechSynthesisVoice(language: String(lang.prefix(2)))
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.92
        speakingText = trimmed
        synth.speak(utterance)
    }

    func stop() {
        synth.stopSpeaking(at: .immediate)
        speakingText = nil
    }

    private func configureAudioSession() {
        // Play even if the ring/silent switch is on — learners expect audio.
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? session.setActive(true, options: [])
    }
}

extension Speaker: AVSpeechSynthesizerDelegate {
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        speakingText = nil
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        speakingText = nil
    }
}

// MARK: - PlayButton

/// A small speaker button that reads `text` in `lang`. Reflects play state by
/// swapping the SF Symbol. No emoji — SF Symbols only.
struct PlayButton: View {
    @Environment(\.theme) private var theme
    @ObservedObject private var speaker = Speaker.shared

    let text: String
    let lang: String
    var size: CGFloat = 30

    private var isSpeaking: Bool {
        speaker.speakingText == text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        Button {
            Speaker.shared.speak(text, lang: lang)
        } label: {
            Image(systemName: isSpeaking ? "speaker.wave.2.fill" : "speaker.wave.2")
                .font(.system(size: size * 0.5, weight: .semibold))
                .foregroundStyle(isSpeaking ? .white : theme.accent)
                .frame(width: size, height: size)
                .background(
                    Group {
                        if isSpeaking { AnyView(theme.brandGradient) }
                        else { AnyView(theme.surface2) }
                    }
                )
                .clipShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Play pronunciation")
    }
}
