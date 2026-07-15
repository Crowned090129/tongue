import Foundation
import AVFoundation
import Speech

/// Scaffolding for the future voice tutor. Not wired into the UI beyond the mic
/// button placeholder in `CoachView`.
///
/// The intended flow (future work):
///   1. Request `SFSpeechRecognizer` + `AVAudioSession` permissions.
///   2. Stream mic audio through `SFSpeechAudioBufferRecognitionRequest`.
///   3. Feed the transcript into `CoachViewModel.send()`.
///   4. Speak the coach's reply with `AVSpeechSynthesizer` in the target locale.
///
/// Kept minimal on purpose — the Info.plist already declares the mic and speech
/// usage descriptions so this can be fleshed out without further config.
@MainActor
final class VoiceInputStub: ObservableObject {
    @Published private(set) var isRecording = false
    @Published private(set) var transcript = ""

    private let synthesizer = AVSpeechSynthesizer()

    /// Ask for the permissions the real implementation will need.
    func requestPermissions() async -> Bool {
        let speechOK = await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { status in
                cont.resume(returning: status == .authorized)
            }
        }
        // iOS 16-compatible mic permission request.
        let micOK = await withCheckedContinuation { cont in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                cont.resume(returning: granted)
            }
        }
        return speechOK && micOK
    }

    /// Speak text in the given language locale (used to voice coach replies).
    func speak(_ text: String, locale: String) {
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: locale)
        synthesizer.speak(utterance)
    }

    // start()/stop() recognition to be implemented in a future iteration.
}
