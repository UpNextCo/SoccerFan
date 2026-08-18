import SwiftUI

struct ActivityEvent: Identifiable, Equatable {
    let id: String
    let icon: String
    let tint: Color
    let title: String
    let message: String
    let unread: Bool
}

/// Persists last-seen rank / league positions so we can surface real "you moved up" style alerts.
enum ActivityFeedStore {
    private static let rankTitleKey = "activityLastRankTitle"
    private static let overallRankKey = "activityLastOverallRank"
    private static let todayRankKey = "activityLastTodayRank"
    private static let todayRankDateKey = "activityLastTodayRankDate"
    private static let openedKey = "activityLastOpenedAt"
    private static let vsAlertsKey = "activityVsAlerts"

    static var lastSeenRankTitle: String? {
        get { UserDefaults.standard.string(forKey: rankTitleKey) }
        set { UserDefaults.standard.set(newValue, forKey: rankTitleKey) }
    }

    static var lastOverallRank: Int? {
        get {
            let value = UserDefaults.standard.integer(forKey: overallRankKey)
            return UserDefaults.standard.object(forKey: overallRankKey) == nil ? nil : value
        }
        set {
            if let newValue {
                UserDefaults.standard.set(newValue, forKey: overallRankKey)
            } else {
                UserDefaults.standard.removeObject(forKey: overallRankKey)
            }
        }
    }

    static var lastTodayRank: Int? {
        get {
            let value = UserDefaults.standard.integer(forKey: todayRankKey)
            return UserDefaults.standard.object(forKey: todayRankKey) == nil ? nil : value
        }
        set {
            if let newValue {
                UserDefaults.standard.set(newValue, forKey: todayRankKey)
            } else {
                UserDefaults.standard.removeObject(forKey: todayRankKey)
            }
        }
    }

    static var lastTodayRankDate: String? {
        get { UserDefaults.standard.string(forKey: todayRankDateKey) }
        set { UserDefaults.standard.set(newValue, forKey: todayRankDateKey) }
    }

    static func markOpened(
        rankTitle: String,
        overallRank: Int?,
        todayRank: Int?,
        todayDate: String
    ) {
        lastSeenRankTitle = rankTitle
        lastOverallRank = overallRank
        lastTodayRank = todayRank
        lastTodayRankDate = todayDate
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: openedKey)
        markVsAlertsRead()
    }

    static var vsAlerts: [VsActivityAlert] {
        get {
            guard let data = UserDefaults.standard.data(forKey: vsAlertsKey),
                  let decoded = try? JSONDecoder().decode([VsActivityAlert].self, from: data) else {
                return []
            }
            return decoded
        }
        set {
            if let data = try? JSONEncoder().encode(newValue) {
                UserDefaults.standard.set(data, forKey: vsAlertsKey)
            }
        }
    }

    static var unreadVsAlertCount: Int {
        vsAlerts.filter(\.unread).count
    }

    static func hasVsAlert(id: String) -> Bool {
        vsAlerts.contains { $0.id == id }
    }

    static func appendVsAlert(_ alert: VsActivityAlert) {
        var all = vsAlerts.filter { $0.id != alert.id }
        all.insert(alert, at: 0)
        // Keep the feed tidy — last 20 VS alerts.
        if all.count > 20 { all = Array(all.prefix(20)) }
        vsAlerts = all
    }

    static func markVsAlertsRead() {
        let updated = vsAlerts.map { alert -> VsActivityAlert in
            var copy = alert
            copy.unread = false
            return copy
        }
        vsAlerts = updated
    }

    static func clear() {
        [
            rankTitleKey,
            overallRankKey,
            todayRankKey,
            todayRankDateKey,
            openedKey,
            vsAlertsKey,
        ].forEach { UserDefaults.standard.removeObject(forKey: $0) }
    }
}

struct ActivityLeagueSnapshot: Equatable {
    var overallRank: Int?
    var overallTotal: Int?
    var overallXp: Int?
    var todayRank: Int?
    var todayTotal: Int?
    var todayXp: Int?
}

enum HomeActivity {
    /// Fast local unread check for the home bell badge (no network).
    static func hasUnread(user: UserProfileDTO?, streak: Int, dailyComplete: Bool) -> Bool {
        events(
            user: user,
            streak: streak,
            dailyComplete: dailyComplete,
            league: nil
        ).contains(where: \.unread)
    }

    static func events(
        user: UserProfileDTO?,
        streak: Int,
        dailyComplete: Bool,
        league: ActivityLeagueSnapshot?
    ) -> [ActivityEvent] {
        var events: [ActivityEvent] = []
        let todayXp = user?.todayXp ?? 0
        let xp = user?.xp ?? 0
        let rank = PlayerRank.progress(for: xp)
        let today = DailyDate.localToday()

        // 0) VS challenge alerts (opponent finished / results)
        for alert in ActivityFeedStore.vsAlerts {
            events.append(ActivityEvent(
                id: alert.id,
                icon: "person.2.fill",
                tint: BKTheme.accent,
                title: alert.title,
                message: alert.message,
                unread: alert.unread
            ))
        }

        // 1) Daily / streak call-to-action
        if dailyComplete {
            events.append(ActivityEvent(
                id: "daily-complete-\(today)",
                icon: "checkmark.seal.fill",
                tint: BKTheme.accent,
                title: "Daily complete",
                message: "All games done — \(todayXp.formatted()) XP banked today\(streak > 0 ? ". Streak: \(streak) day\(streak == 1 ? "" : "s")." : ".")",
                unread: false
            ))
        } else if todayXp == 0 {
            events.append(ActivityEvent(
                id: "streak-start-\(today)",
                icon: "flame.fill",
                tint: BKTheme.streak,
                title: streak > 0 ? "Keep your \(streak)-day streak alive" : "Start today's games",
                message: streak > 0
                    ? "Play one game today to keep the chain going."
                    : "Play a game today to earn XP and start a streak.",
                unread: true
            ))
        } else {
            events.append(ActivityEvent(
                id: "streak-finish-\(today)",
                icon: "flame.fill",
                tint: BKTheme.streak,
                title: streak > 0 ? "Streak saved — keep stacking XP" : "Keep stacking XP",
                message: "\(todayXp.formatted()) XP so far today — more games still to play.",
                unread: false
            ))
        }

        // 2) Rank-up (new level) when title advanced since last open
        if let previous = ActivityFeedStore.lastSeenRankTitle,
           previous != rank.title,
           rankOrder(rank.title) > rankOrder(previous) {
            events.append(ActivityEvent(
                id: "rank-up-\(rank.title)",
                icon: "arrow.up.circle.fill",
                tint: BKTheme.accent,
                title: "New level — \(rank.emoji) \(rank.title)",
                message: "You've climbed from \(previous) to \(rank.title). Nice work.",
                unread: true
            ))
        }

        // 3) Current level / progress to next
        if let remaining = rank.remaining(at: xp),
           let nextTitle = rank.nextTitle,
           let nextEmoji = rank.nextEmoji {
            events.append(ActivityEvent(
                id: "rank-status-\(rank.title)",
                icon: "star.fill",
                tint: BKTheme.accent,
                title: "\(rank.emoji) \(rank.title)",
                message: "\(remaining.formatted()) XP to \(nextEmoji) \(nextTitle).",
                unread: false
            ))
        } else {
            events.append(ActivityEvent(
                id: "rank-status-\(rank.title)",
                icon: "crown.fill",
                tint: .yellow,
                title: "\(rank.emoji) \(rank.title)",
                message: "Top rank reached — \(xp.formatted()) total XP.",
                unread: false
            ))
        }

        // 4) Overall league standing
        if let league, let overallRank = league.overallRank {
            let totalNote = league.overallTotal.map { " of \($0)" } ?? ""
            let xpNote = league.overallXp.map { " · \($0.formatted()) XP" } ?? ""
            let previous = ActivityFeedStore.lastOverallRank
            let improved = previous.map { overallRank < $0 } ?? false
            let overallMessage: String
            if improved, let previous {
                overallMessage = "Now #\(overallRank)\(totalNote)\(xpNote) — up from #\(previous)."
            } else {
                overallMessage = "You're #\(overallRank)\(totalNote) on the all-time board\(xpNote)."
            }
            events.append(ActivityEvent(
                id: "league-overall-\(overallRank)",
                icon: "trophy.fill",
                tint: .yellow,
                title: improved ? "You moved up overall" : "Overall league",
                message: overallMessage,
                unread: improved
            ))
        }

        // 5) Today's league standing (only if they've earned XP today)
        if let league, let todayRank = league.todayRank, todayXp > 0 {
            let totalNote = league.todayTotal.map { " of \($0)" } ?? ""
            let previousDate = ActivityFeedStore.lastTodayRankDate
            let previous = previousDate == today ? ActivityFeedStore.lastTodayRank : nil
            let improved = previous.map { todayRank < $0 } ?? false
            let todayMessage: String
            if improved, let previous {
                todayMessage = "Now #\(todayRank)\(totalNote) today — up from #\(previous)."
            } else {
                todayMessage = "You're #\(todayRank)\(totalNote) on today's XP board · \(todayXp.formatted()) XP."
            }
            events.append(ActivityEvent(
                id: "league-today-\(today)-\(todayRank)",
                icon: "chart.bar.fill",
                tint: BKTheme.accent,
                title: improved ? "You climbed today's board" : "Today's league",
                message: todayMessage,
                unread: improved
            ))
        } else if todayXp == 0 {
            events.append(ActivityEvent(
                id: "league-today-empty-\(today)",
                icon: "chart.bar.fill",
                tint: BKTheme.textMuted,
                title: "Today's league",
                message: "Earn XP today to appear on the daily leaderboard.",
                unread: false
            ))
        }

        // 6) Streak milestone (when already complete or mid-streak, avoid doubling the CTA)
        if streak >= 7, dailyComplete || todayXp > 0 {
            events.append(ActivityEvent(
                id: "streak-milestone-\(streak)",
                icon: "flame.fill",
                tint: BKTheme.streak,
                title: "\(streak)-day streak",
                message: streak >= 30
                    ? "Elite consistency — keep the fire going."
                    : "You're on a serious run. Don't break the chain.",
                unread: false
            ))
        }

        return events
    }

    private static func rankOrder(_ title: String) -> Int {
        switch title {
        case "Rookie": return 0
        case "Semi-Pro": return 1
        case "Pro": return 2
        case "Veteran": return 3
        case "World Class": return 4
        case "Legend": return 5
        default: return -1
        }
    }
}
