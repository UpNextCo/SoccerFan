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
/// item when someone else finishes (even if you're not on the VS tab).
@MainActor
@Observable
final class VsMonitor {
    static let shared = VsMonitor()

    var banner: VsBanner?
    private(set) var hasTabBadge = false

    private var trackedId: String?
    private var lastOtherCompletedIds: Set<String> = []
    private var lastAllDone = false
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
            lastOtherCompletedIds = []
            lastAllDone = false
            return
        }
        let switching = trackedId != challenge.id
        trackedId = challenge.id
        if switching {
            seeded = false
            lastOtherCompletedIds = otherCompletedIds(challenge)
            lastAllDone = challenge.result.allDone
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
                if challenge.result.allDone || challenge.status == "expired" {
                    if challenge.result.allDone {
                        trackedId = challenge.id
                    }
                }
            } else if let challenge = try await APIClient.shared.vsActive() {
                trackedId = challenge.id
                lastOtherCompletedIds = otherCompletedIds(challenge)
                lastAllDone = challenge.result.allDone
                seeded = true
            }
        } catch {
            // Transient network / auth blips — keep last tracked id.
        }
        await refreshTabBadge()
    }

    private func process(_ challenge: VsChallengeDTO, allowNotify: Bool) {
        let others = otherCompletedIds(challenge)
        let newFinishers = others.subtracting(lastOtherCompletedIds)
        let allDone = challenge.result.allDone

        if allowNotify, !newFinishers.isEmpty {
            if allDone {
                notifyResults(challenge)
            } else if let player = challenge.players.first(where: { newFinishers.contains($0.userId) }) {
                notifyOpponentFinished(challenge, opponentName: player.displayName)
            }
        } else if allowNotify, allDone, !lastAllDone {
            notifyResults(challenge)
        }

        lastOtherCompletedIds = others
        lastAllDone = allDone
    }

    private func notifyOpponentFinished(_ challenge: VsChallengeDTO, opponentName: String) {
        let alertId = "vs-opponent-\(challenge.id)-\(opponentName)"
        guard !ActivityFeedStore.hasVsAlert(id: alertId) else { return }

        let title = "\(opponentName) finished"
        let message = youCompleted(challenge)
            ? "Waiting on the rest — jump into VS."
            : "Their \(challenge.modeTitle) is in. Your turn to play."

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

    private func notifyResults(_ challenge: VsChallengeDTO) {
        let alertId = "vs-result-\(challenge.id)"
        guard !ActivityFeedStore.hasVsAlert(id: alertId) else { return }

        let title: String
        switch challenge.result.winner {
        case "draw":
            title = "VS draw"
        case "you":
            title = "You won the VS"
        default:
            if let winnerId = challenge.result.winnerUserId,
               let winner = challenge.players.first(where: { $0.userId == winnerId }) {
                title = "\(winner.displayName) won the VS"
            } else {
                title = "VS results are in"
            }
        }

        let yourScore = challenge.result.yourScore.map(String.init) ?? "—"
        let message = "You scored \(yourScore) \(challenge.categoryNoun)."

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

    private func otherCompletedIds(_ challenge: VsChallengeDTO) -> Set<String> {
        Set(challenge.players.filter { !$0.isYou && $0.completed }.map(\.userId))
    }

    private func youCompleted(_ challenge: VsChallengeDTO) -> Bool {
        challenge.players.first(where: \.isYou)?.completed ?? false
    }
}
