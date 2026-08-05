import Foundation
import SwiftUI

struct VsBanner: Equatable {
    let challengeId: String
    let title: String
    let message: String
}

struct VsActivityAlert: Codable, Equatable, Identifiable {
    let id: String
    let challengeId: String
    let title: String
    let message: String
    let createdAt: TimeInterval
    var unread: Bool
}

/// App-wide poller for active VS challenges. Surfaces an in-app banner + Activity feed
/// item when the opponent finishes (even if you're not on the VS tab).
@MainActor
@Observable
final class VsMonitor {
    static let shared = VsMonitor()

    var banner: VsBanner?
    private(set) var hasTabBadge = false

    private var trackedId: String?
    private var lastOpponentCompleted = false
    private var lastBothDone = false
    private var seeded = false
    private var loopTask: Task<Void, Never>?

    private init() {}

    func start() {
        guard loopTask == nil else { return }
        loopTask = Task { [weak self] in
            await self?.refreshTabBadge()
            while !Task.isCancelled {
                await self?.tick()
                try? await Task.sleep(for: .seconds(4))
            }
        }
    }

    func stop() {
        loopTask?.cancel()
        loopTask = nil
    }

    /// Keep the monitor locked onto the challenge the VS tab just created/joined/refreshed.
    func track(_ challenge: VsChallengeDTO?) {
        guard let challenge else {
            trackedId = nil
            seeded = false
            lastOpponentCompleted = false
            lastBothDone = false
            return
        }
        let switching = trackedId != challenge.id
        trackedId = challenge.id
        if switching {
            seeded = false
            lastOpponentCompleted = opponentCompleted(challenge)
            lastBothDone = challenge.result.bothDone
        }
        process(challenge, allowNotify: seeded)
        seeded = true
        Task { await refreshTabBadge() }
    }

    func dismissBanner() {
        banner = nil
    }

    func markAlertsRead() {
        ActivityFeedStore.markVsAlertsRead()
        hasTabBadge = ActivityFeedStore.unreadVsAlertCount > 0
    }

    private func tick() async {
        do {
            if let id = trackedId {
                let challenge = try await APIClient.shared.vsGet(id: id)
                process(challenge, allowNotify: seeded)
                seeded = true
                if challenge.result.bothDone || challenge.status == "expired" {
                    // Keep tracking briefly so the VS tab can still show the result if open,
                    // but stop once we've notified for both-done.
                    if challenge.result.bothDone {
                        trackedId = challenge.id
                    }
                }
            } else if let challenge = try await APIClient.shared.vsActive() {
                trackedId = challenge.id
                lastOpponentCompleted = opponentCompleted(challenge)
                lastBothDone = challenge.result.bothDone
                seeded = true
            }
        } catch {
            // Transient network / auth blips — keep last tracked id.
        }
        await refreshTabBadge()
    }

    private func process(_ challenge: VsChallengeDTO, allowNotify: Bool) {
        let opponentDone = opponentCompleted(challenge)
        let bothDone = challenge.result.bothDone
        let opponentName = self.opponentName(challenge)

        if allowNotify, opponentDone, !lastOpponentCompleted {
            if bothDone {
                notifyResults(challenge, opponentName: opponentName)
            } else {
                notifyOpponentFinished(challenge, opponentName: opponentName)
            }
        } else if allowNotify, bothDone, !lastBothDone {
            notifyResults(challenge, opponentName: opponentName)
        }

        lastOpponentCompleted = opponentDone
        lastBothDone = bothDone
    }

    private func notifyOpponentFinished(_ challenge: VsChallengeDTO, opponentName: String) {
        let alertId = "vs-opponent-\(challenge.id)"
        guard !ActivityFeedStore.hasVsAlert(id: alertId) else { return }

        let title = "\(opponentName) finished"
        let message = youCompleted(challenge)
            ? "Waiting on the final score — jump into VS."
            : "Their Draft XI is in. Your turn to play."

        ActivityFeedStore.appendVsAlert(
            VsActivityAlert(
                id: alertId,
                challengeId: challenge.id,
                title: title,
                message: message,
                createdAt: Date().timeIntervalSince1970,
                unread: true
            )
        )
        banner = VsBanner(challengeId: challenge.id, title: title, message: message)
        hasTabBadge = true
        HapticManager.success()
    }

    private func notifyResults(_ challenge: VsChallengeDTO, opponentName: String) {
        let alertId = "vs-result-\(challenge.id)"
        guard !ActivityFeedStore.hasVsAlert(id: alertId) else { return }

        let title: String
        switch challenge.result.winner {
        case "draw":
            title = "VS draw"
        case "host":
            title = challenge.youAreHost ? "You won the VS" : "\(opponentName) won the VS"
        case "guest":
            title = challenge.youAreHost ? "\(opponentName) won the VS" : "You won the VS"
        default:
            title = "VS results are in"
        }

        let yourScore = challenge.result.yourScore.map(String.init) ?? "—"
        let theirScore = challenge.result.theirScore.map(String.init) ?? "—"
        let message = "\(yourScore) vs \(theirScore) \(challenge.categoryNoun)."

        ActivityFeedStore.appendVsAlert(
            VsActivityAlert(
                id: alertId,
                challengeId: challenge.id,
                title: title,
                message: message,
                createdAt: Date().timeIntervalSince1970,
                unread: true
            )
        )
        banner = VsBanner(challengeId: challenge.id, title: title, message: message)
        hasTabBadge = true
        HapticManager.success()
    }

    private func refreshTabBadge() async {
        hasTabBadge = ActivityFeedStore.unreadVsAlertCount > 0
    }

    private func opponentCompleted(_ challenge: VsChallengeDTO) -> Bool {
        challenge.youAreHost ? (challenge.guest?.completed ?? false) : challenge.host.completed
    }

    private func youCompleted(_ challenge: VsChallengeDTO) -> Bool {
        challenge.youAreHost ? challenge.host.completed : (challenge.guest?.completed ?? false)
    }

    private func opponentName(_ challenge: VsChallengeDTO) -> String {
        if challenge.youAreHost {
            return challenge.guest?.displayName ?? "Opponent"
        }
        return challenge.host.displayName
    }
}
