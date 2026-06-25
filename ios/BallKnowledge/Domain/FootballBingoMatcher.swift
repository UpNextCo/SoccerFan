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

        case .position:
            return normalize(player.position) == normalize(category.matchingRule)

        case .statThreshold:
            // Rule grammar: `<stat>>=<n>` where stat is pl_apps | goals | apps.
            let parts = category.matchingRule.components(separatedBy: ">=")
            guard parts.count == 2, let threshold = Int(parts[1]) else { return false }
            let value: Int
            switch parts[0] {
            case "goals": value = player.topLeagueGoals ?? 0
            case "apps": value = player.topLeagueApps ?? 0
            default: value = player.premierLeagueApps ?? 0 // pl_apps
            }
            return value >= threshold
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
