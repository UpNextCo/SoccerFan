import Foundation

struct FootballGolfAnswerSuggestion: Identifiable, Equatable {
    let id: String
    let name: String
    let subtitle: String?
    let answerType: FootballGolfAnswerType
    let league: String?
    let club: String?
    let country: String?
    let player: PlayerSearchResultDTO?

    static func fromPlayer(_ player: PlayerSearchResultDTO) -> FootballGolfAnswerSuggestion {
        FootballGolfAnswerSuggestion(
            id: "player_\(player.id)",
            name: player.name,
            subtitle: "\(player.club) · \(player.league)",
            answerType: .player,
            league: player.league,
            club: player.club,
            country: player.nationality,
            player: player
        )
    }

    static func fromLocal(_ entry: FootballGolfLocalEntry) -> FootballGolfAnswerSuggestion {
        FootballGolfAnswerSuggestion(
            id: entry.id,
            name: entry.name,
            subtitle: entry.subtitle,
            answerType: entry.answerType,
            league: entry.league,
            club: entry.club,
            country: entry.country,
            player: nil
        )
    }
}

struct FootballGolfLocalEntry: Identifiable, Equatable {
    let id: String
    let name: String
    let answerType: FootballGolfAnswerType
    let league: String?
    let club: String?
    let country: String?
    let subtitle: String?
    let searchTerms: [String]
}

enum FootballGolfAnswerSearch {
    static func search(query: String, answerType: FootballGolfAnswerType) async -> [FootballGolfAnswerSuggestion] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else { return [] }

        switch answerType {
        case .player:
            return await searchPlayers(trimmed)
        case .manager:
            return filterLocal(trimmed, types: [.manager])
        case .team:
            return filterLocal(trimmed, types: [.team])
        case .country:
            return filterLocal(trimmed, types: [.country])
        case .stadium:
            return filterLocal(trimmed, types: [.stadium])
        }
    }

    private static func searchPlayers(_ query: String) async -> [FootballGolfAnswerSuggestion] {
        do {
            let players = try await APIClient.shared.searchPlayers(query: query)
            return players.prefix(8).map { FootballGolfAnswerSuggestion.fromPlayer($0) }
        } catch {
            return filterLocal(query, types: [.player])
        }
    }

    private static func filterLocal(_ query: String, types: [FootballGolfAnswerType]) -> [FootballGolfAnswerSuggestion] {
        let normalizedQuery = normalize(query)
        return FootballGolfSeed.localCatalog
            .filter { types.contains($0.answerType) }
            .filter { entry in
                entry.searchTerms.contains { normalize($0).contains(normalizedQuery) }
                    || normalize(entry.name).contains(normalizedQuery)
            }
            .prefix(8)
            .map { FootballGolfAnswerSuggestion.fromLocal($0) }
    }

    private static func normalize(_ value: String) -> String {
        value
            .lowercased()
            .folding(options: .diacriticInsensitive, locale: .current)
            .replacingOccurrences(of: "[^a-z0-9 ]", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
