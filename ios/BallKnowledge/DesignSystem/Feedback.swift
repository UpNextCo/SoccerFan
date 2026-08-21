import AVFoundation
import UIKit

/// Named clips in `Resources/GameTiles/soundeffects/{name}.mp3`.
enum SFX: String, CaseIterable {
    case place
    case lock
    case success
    case deny
    case tick
    case pop
    case lifeLost
    case reveal
    case win
    case lose
    case yourTurn
    case opponent
}

/// Sound plus the haptic that already matched that moment.
@MainActor
enum Feedback {
    static func play(_ sfx: SFX) {
        SoundManager.shared.play(sfx)
        switch sfx {
        case .place, .pop, .reveal, .yourTurn, .opponent:
            HapticManager.light()
        case .lock, .success, .win:
            HapticManager.success()
        case .deny, .lose, .lifeLost:
            HapticManager.error()
        case .tick:
            break
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
        if sfx != .tick { stopTick() }
        activateSession()
        let now = CACurrentMediaTime()
        if let last = lastPlayedAt[sfx], now - last < debounce { return }
        lastPlayedAt[sfx] = now

        guard let player = player(for: sfx) else { return }
        player.numberOfLoops = 0
        player.currentTime = 0
        player.play()
    }

    /// Plays the long `tick` bed so its end lands on timeout (file is ~81s, turns are 10–15s).
    func startTick(lasting remaining: TimeInterval) {
        activateSession()
        guard remaining > 0.15, let player = player(for: .tick) else { return }
        if player.isPlaying { player.stop() }
        player.numberOfLoops = 0
        let duration = player.duration
        if duration.isFinite, duration > remaining {
            player.currentTime = max(0, duration - remaining)
        } else {
            player.currentTime = 0
        }
        player.play()
    }

    func stopTick() {
        guard let player = players[.tick], player.isPlaying else { return }
        player.stop()
        player.currentTime = 0
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
