import Foundation

enum OneMoreSeed {
    static func makeDailyPrompt(date: String? = nil) -> OneMorePrompt {
        let dateKey = date ?? todayUTC()
        return OneMorePrompt(
            id: "one_more_daily_\(dateKey)",
            league: .premierLeague,
            category: .goals,
            minimum: 10,
            isDaily: true,
            date: dateKey
        )
    }

    static func makePracticePrompt() -> OneMorePrompt {
        OneMorePrompt(
            id: "one_more_practice_\(UUID().uuidString.prefix(8))",
            league: .premierLeague,
            category: .goals,
            minimum: 10,
            isDaily: false,
            date: nil
        )
    }

    static func eligiblePlayers(for prompt: OneMorePrompt) -> [OneMoreEligiblePlayer] {
        roster
            .filter { $0.goals >= prompt.minimum }
            .map { entry in
                OneMoreEligiblePlayer(
                    id: entry.id,
                    name: entry.name,
                    club: entry.club,
                    league: prompt.league.rawValue,
                    nationality: entry.nationality,
                    position: entry.position,
                    statValue: entry.goals,
                    aliases: entry.aliases
                )
            }
    }

    // MARK: - Private

    struct OneMoreEligiblePlayer: Equatable {
        let id: String
        let name: String
        let club: String
        let league: String
        let nationality: String
        let position: String
        let statValue: Int
        let aliases: [String]

        var searchDTO: PlayerSearchResultDTO {
            PlayerSearchResultDTO(
                id: id,
                name: name,
                club: club,
                league: league,
                nationality: nationality,
                position: position
            )
        }
    }

    private struct RosterEntry {
        let id: String
        let name: String
        let club: String
        let nationality: String
        let position: String
        let goals: Int
        let aliases: [String]
    }

    private static let roster: [RosterEntry] = [
        e("om_salah", "Mohamed Salah", "Liverpool", "Egypt", "RW", 118),
        e("om_kane", "Harry Kane", "Bayern Munich", "England", "ST", 213),
        e("om_haaland", "Erling Haaland", "Manchester City", "Norway", "ST", 82),
        e("om_son", "Son Heung-min", "Tottenham", "South Korea", "LW", 104, ["Son Heung Min", "Heung-min Son"]),
        e("om_sterling", "Raheem Sterling", "Chelsea", "England", "LW", 112),
        e("om_bruno", "Bruno Fernandes", "Manchester United", "Portugal", "AM", 78),
        e("om_kdb", "Kevin De Bruyne", "Manchester City", "Belgium", "AM", 72, ["De Bruyne"]),
        e("om_rashford", "Marcus Rashford", "Manchester United", "England", "LW", 82),
        e("om_saka", "Bukayo Saka", "Arsenal", "England", "RW", 58),
        e("om_palmer", "Cole Palmer", "Chelsea", "England", "AM", 36),
        e("om_isak", "Alexander Isak", "Newcastle", "Sweden", "ST", 42),
        e("om_nunez", "Darwin Núñez", "Liverpool", "Uruguay", "ST", 34, ["Darwin Nunez"]),
        e("om_odegaard", "Martin Ødegaard", "Arsenal", "Norway", "AM", 28, ["Martin Odegaard", "Odegaard"]),
        e("om_grealish", "Jack Grealish", "Manchester City", "England", "LW", 18),
        e("om_rodri", "Rodri", "Manchester City", "Spain", "DM", 18),
        e("om_joelinton", "Joelinton", "Newcastle", "Brazil", "CM", 24),
        e("om_bernardo", "Bernardo Silva", "Manchester City", "Portugal", "AM", 42),
        e("om_gundogan", "Ilkay Gündogan", "Barcelona", "Germany", "CM", 34, ["Ilkay Gundogan", "Gundogan"]),
        e("om_milner", "James Milner", "Brighton", "England", "CM", 24),
        e("om_taa", "Trent Alexander-Arnold", "Liverpool", "England", "RB", 16, ["Alexander-Arnold"]),
        e("om_vvd", "Virgil van Dijk", "Liverpool", "Netherlands", "CB", 18, ["Van Dijk"]),
        e("om_gabriel", "Gabriel Magalhães", "Arsenal", "Brazil", "CB", 14, ["Gabriel"]),
        e("om_eriksen", "Christian Eriksen", "Manchester United", "Denmark", "CM", 12),
        e("om_watkins", "Ollie Watkins", "Aston Villa", "England", "ST", 68),
        e("om_bowen", "Jarrod Bowen", "West Ham", "England", "RW", 48),
        e("om_foden", "Phil Foden", "Manchester City", "England", "AM", 52),
        e("om_wilson", "Callum Wilson", "Newcastle", "England", "ST", 46),
        e("om_vardy", "Jamie Vardy", "Leicester", "England", "ST", 123),
        e("om_mane", "Sadio Mané", "Al-Nassr", "Senegal", "LW", 111, ["Sadio Mane", "Mane"]),
        e("om_jesus", "Gabriel Jesus", "Arsenal", "Brazil", "ST", 58),
        e("om_martial", "Anthony Martial", "Manchester United", "France", "ST", 55),
        e("om_mount", "Mason Mount", "Manchester United", "England", "AM", 27),
        e("om_maddison", "James Maddison", "Tottenham", "England", "AM", 44),
        e("om_zaha", "Wilfried Zaha", "Crystal Palace", "Ivory Coast", "LW", 68),
        e("om_aubameyang", "Pierre-Emerick Aubameyang", "Chelsea", "Gabon", "ST", 68, ["Aubameyang"]),
        e("om_lacazette", "Alexandre Lacazette", "Arsenal", "France", "ST", 54),
        e("om_ings", "Danny Ings", "West Ham", "England", "ST", 46),
        e("om_toney", "Ivan Toney", "Brentford", "England", "ST", 36),
        e("om_mahrez", "Riyad Mahrez", "Al-Ahli", "Algeria", "RW", 63, ["Mahrez"]),
        e("om_gordon", "Anthony Gordon", "Newcastle", "England", "LW", 14),
        e("om_antonio", "Michail Antonio", "West Ham", "Jamaica", "ST", 68),
        e("om_calvert", "Dominic Calvert-Lewin", "Everton", "England", "ST", 48, ["Calvert-Lewin"]),
    ]

    private static func e(
        _ id: String,
        _ name: String,
        _ club: String,
        _ nationality: String,
        _ position: String,
        _ goals: Int,
        _ aliases: [String] = []
    ) -> RosterEntry {
        RosterEntry(id: id, name: name, club: club, nationality: nationality, position: position, goals: goals, aliases: aliases)
    }

    private static func todayUTC() -> String {
        String(ISO8601DateFormatter().string(from: Date()).prefix(10))
    }
}

enum OneMoreMatcher {
    static func validate(
        _ player: PlayerSearchResultDTO,
        prompt: OneMorePrompt,
        usedIds: Set<String>
    ) -> OneMoreValidationResult {
        if usedIds.contains(player.id) {
            return .alreadyUsed
        }

        let eligible = OneMoreSeed.eligiblePlayers(for: prompt)
        let normalizedQuery = normalized(player.name)

        guard let match = eligible.first(where: { entry in
            entry.id == player.id
                || normalized(entry.name) == normalizedQuery
                || entry.aliases.contains(where: { normalized($0) == normalizedQuery })
                || fuzzyMatch(entry.name, normalizedQuery)
        }) else {
            return .notEligible(reason: "Doesn't qualify — need \(prompt.minimum)+ PL goals")
        }

        return .valid(statValue: match.statValue)
    }

    private static func fuzzyMatch(_ candidate: String, _ query: String) -> Bool {
        let a = normalized(candidate)
        let b = query
        guard b.count >= 4 else { return false }
        return a.contains(b) || b.contains(a)
    }

    private static func normalized(_ value: String) -> String {
        value.lowercased()
            .folding(options: .diacriticInsensitive, locale: .current)
            .replacingOccurrences(of: "[^a-z0-9 ]", with: "", options: .regularExpression)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
