import AVFoundation
import UIKit

/// Named clips in `Resources/GameTiles/soundeffects/{name}.mp3`.
enum SFX: String, CaseIterable {
    case place
    case lock
    case success
    case deny
}

/// Sound plus the haptic that already matched that moment.
@MainActor
enum Feedback {
    static func play(_ sfx: SFX) {
        SoundManager.shared.play(sfx)
        switch sfx {
        case .place:
            HapticManager.light()
        case .lock, .success:
            HapticManager.success()
        case .deny:
            HapticManager.error()
        }
    }
}

enum HapticManager {
    static func light() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    static func error() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }
}

@MainActor
final class SoundManager {
    static let shared = SoundManager()

    private var players: [SFX: AVAudioPlayer] = [:]
    private var lastPlayedAt: [SFX: CFTimeInterval] = [:]
    private let debounce: CFTimeInterval = 0.08
    private var sessionReady = false

    private init() {}

    func prepare() {
        activateSession()
        for sfx in SFX.allCases {
            _ = player(for: sfx)
        }
    }

    func play(_ sfx: SFX) {
        activateSession()
        let now = CACurrentMediaTime()
        if let last = lastPlayedAt[sfx], now - last < debounce { return }
        lastPlayedAt[sfx] = now

        guard let player = player(for: sfx) else { return }
        player.currentTime = 0
        player.play()
    }

    private func player(for sfx: SFX) -> AVAudioPlayer? {
        if let existing = players[sfx] { return existing }
        guard let url = Self.url(for: sfx) else { return nil }
        do {
            let player = try AVAudioPlayer(contentsOf: url)
            player.prepareToPlay()
            players[sfx] = player
            return player
        } catch {
            return nil
        }
    }

    private func activateSession() {
        guard !sessionReady else { return }
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.ambient, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)
            sessionReady = true
        } catch {
            sessionReady = false
        }
    }

    private static func url(for sfx: SFX) -> URL? {
        let name = sfx.rawValue
        let subdirectory = "GameTiles/soundeffects"
        if let url = Bundle.main.url(forResource: name, withExtension: "mp3", subdirectory: subdirectory) {
            return url
        }
        if let resourcePath = Bundle.main.resourcePath {
            let path = (resourcePath as NSString).appendingPathComponent("\(subdirectory)/\(name).mp3")
            if FileManager.default.fileExists(atPath: path) {
                return URL(fileURLWithPath: path)
            }
        }
        return Bundle.main.url(forResource: name, withExtension: "mp3")
    }
}
