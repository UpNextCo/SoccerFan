import Foundation

enum FootballBingoMatcher {
    static func matches(player: FootballBingoPlayer, category: FootballBingoCategory) -> Bool {
        switch category.type {
        case .nationality:
            return normalize(player.nationality) == normalize(category.matchingRule)

        case .playedForClub:
            return player.clubs.contains { normalize($0) == normalize(category.matchingRule) }

        case .nationClub:
            // matchingRule = "Nation|Club"
            let parts = category.matchingRule.components(separatedBy: "|")
            guard parts.count == 2 else { return false }
            return normalize(player.nationality) == normalize(parts[0])
                && player.clubs.contains { normalize($0) == normalize(parts[1]) }

        case .clubCombo:
            // matchingRule = "ClubA|ClubB"
            let parts = category.matchingRule.components(separatedBy: "|")
            guard parts.count == 2 else { return false }
            return player.clubs.contains { normalize($0) == normalize(parts[0]) }
                && player.clubs.contains { normalize($0) == normalize(parts[1]) }

        case .playedInLeague:
            return player.leagues.contains { normalize($0) == normalize(category.matchingRule) }

        case .wonCompetition:
            return player.trophies.contains { normalize($0) == normalize(category.matchingRule) }

        case .award:
            return player.awards.contains { normalize($0) == normalize(category.matchingRule) }

        case .playedWithPlayer:
            return player.teammates.contains { normalize($0) == normalize(category.matchingRule) }

        case .managedByManager:
            return player.managers.contains { normalize($0) == normalize(category.matchingRule) }

        case .position:
            return normalize(player.position) == normalize(category.matchingRule)

        case .statThreshold:
            // Rule grammar: `<statKey>>=<n>` resolved against the player's stats map.
            let parts = category.matchingRule.components(separatedBy: ">=")
            guard parts.count == 2, let threshold = Int(parts[1]) else { return false }
            return (player.stats[parts[0]] ?? 0) >= threshold
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
