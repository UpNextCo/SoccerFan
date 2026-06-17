import Foundation

enum FootballBingoMatcher {
    static func matches(player: FootballBingoPlayer, category: FootballBingoCategory) -> Bool {
        switch category.type {
        case .nationality:
            return normalize(player.nationality) == normalize(category.matchingRule)

        case .playedForClub:
            return player.clubs.contains { normalize($0) == normalize(category.matchingRule) }

        case .playedInLeague:
            return player.leagues.contains { normalize($0) == normalize(category.matchingRule) }

        case .wonCompetition:
            return player.trophies.contains { normalize($0) == normalize(category.matchingRule) }

        case .playedWithPlayer:
            return player.teammates.contains { normalize($0) == normalize(category.matchingRule) }

        case .managedByManager:
            return player.managers.contains { normalize($0) == normalize(category.matchingRule) }

        case .statThreshold:
            guard category.matchingRule.hasPrefix("pl_apps>=") else { return false }
            let threshold = Int(category.matchingRule.replacingOccurrences(of: "pl_apps>=", with: "")) ?? 0
            return (player.premierLeagueApps ?? 0) >= threshold
        }
    }

    private static func normalize(_ value: String) -> String {
        value
            .folding(options: .diacriticInsensitive, locale: .current)
            .lowercased()
            .replacingOccurrences(of: "  ", with: " ")
            .trimmingCharacters(in: .whitespaces)
    }
}
