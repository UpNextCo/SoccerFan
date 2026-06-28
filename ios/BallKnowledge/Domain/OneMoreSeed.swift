import Foundation

enum OneMoreSeed {
    /// Build the daily prompt from the server-generated puzzle. The server embeds the full set
    /// of binary rounds (each with two options + their real stat values), so play is offline-safe.
    static func makeServerPrompt(from dto: OneMorePuzzleDTO) -> OneMorePrompt? {
        let rounds = dto.rounds.compactMap { round -> OneMoreRound? in
            guard round.options.count == 2 else { return nil }
            return OneMoreRound(options: round.options.map {
                OneMoreOption(id: $0.id, name: $0.name, clubs: $0.clubs, position: $0.position, value: $0.value, headshotUrl: $0.headshotUrl)
            })
        }
        guard rounds.count >= 3 else { return nil } // too thin → caller falls back
        return OneMorePrompt(
            id: dto.puzzleId,
            metricTitle: dto.title,
            valueNoun: dto.valueNoun,
            minimum: dto.minimum,
            rounds: rounds,
            isDaily: true,
            date: dto.date
        )
    }

    /// Offline / practice fallback: a "Premier League goals" prompt with rounds built from the
    /// local roster (one qualifier vs one short-of-the-line name per round).
    static func makeDailyPrompt(date: String? = nil) -> OneMorePrompt {
        makeLocalPrompt(id: "one_more_daily_\(date ?? todayUTC())", isDaily: true, date: date ?? todayUTC())
    }

    static func makePracticePrompt() -> OneMorePrompt {
        makeLocalPrompt(id: "one_more_practice_\(UUID().uuidString.prefix(8))", isDaily: false, date: nil)
    }

    // MARK: - Local round building

    private static func makeLocalPrompt(id: String, isDaily: Bool, date: String?) -> OneMorePrompt {
        let minimum = 50
        let qualifiers = roster.filter { $0.goals >= minimum }.shuffled()
        let distractors = roster.filter { $0.goals < minimum }.sorted { $0.goals > $1.goals }
        let n = min(12, qualifiers.count, distractors.count)
        var rounds: [OneMoreRound] = []
        for i in 0..<n {
            let q = option(qualifiers[i])
            let d = option(distractors[i])
            rounds.append(OneMoreRound(options: Bool.random() ? [q, d] : [d, q]))
        }
        return OneMorePrompt(
            id: id,
            metricTitle: "Premier League goals",
            valueNoun: "goals",
            minimum: minimum,
            rounds: rounds,
            isDaily: isDaily,
            date: date
        )
    }

    private static func option(_ e: RosterEntry) -> OneMoreOption {
        OneMoreOption(id: e.id, name: e.name, clubs: e.club, position: e.position, value: e.goals)
    }

    // MARK: - Private roster

    private struct RosterEntry {
        let id: String
        let name: String
        let club: String
        let nationality: String
        let position: String
        let goals: Int
    }

    private static let roster: [RosterEntry] = [
        e("om_salah", "Mohamed Salah", "Liverpool", "Egypt", "RW", 118),
        e("om_kane", "Harry Kane", "Tottenham", "England", "ST", 213),
        e("om_vardy", "Jamie Vardy", "Leicester", "England", "ST", 123),
        e("om_sterling", "Raheem Sterling", "Chelsea", "England", "LW", 112),
        e("om_son", "Son Heung-min", "Tottenham", "South Korea", "LW", 104),
        e("om_mane", "Sadio Mané", "Liverpool", "Senegal", "LW", 90),
        e("om_haaland", "Erling Haaland", "Manchester City", "Norway", "ST", 82),
        e("om_rashford", "Marcus Rashford", "Manchester United", "England", "LW", 82),
        e("om_aubameyang", "Pierre-Emerick Aubameyang", "Arsenal", "Gabon", "ST", 68),
        e("om_watkins", "Ollie Watkins", "Aston Villa", "England", "ST", 68),
        e("om_zaha", "Wilfried Zaha", "Crystal Palace", "Ivory Coast", "LW", 68),
        e("om_mahrez", "Riyad Mahrez", "Manchester City", "Algeria", "RW", 63),
        e("om_jesus", "Gabriel Jesus", "Arsenal", "Brazil", "ST", 58),
        e("om_saka", "Bukayo Saka", "Arsenal", "England", "RW", 58),
        e("om_martial", "Anthony Martial", "Manchester United", "France", "ST", 55),
        e("om_lacazette", "Alexandre Lacazette", "Arsenal", "France", "ST", 54),
        e("om_foden", "Phil Foden", "Manchester City", "England", "AM", 52),
        // Below 50 — plausible distractors (good names, just short)
        e("om_bowen", "Jarrod Bowen", "West Ham", "England", "RW", 48),
        e("om_wilson", "Callum Wilson", "Newcastle", "England", "ST", 46),
        e("om_maddison", "James Maddison", "Tottenham", "England", "AM", 44),
        e("om_isak", "Alexander Isak", "Newcastle", "Sweden", "ST", 42),
        e("om_bernardo", "Bernardo Silva", "Manchester City", "Portugal", "AM", 42),
        e("om_palmer", "Cole Palmer", "Chelsea", "England", "AM", 36),
        e("om_nunez", "Darwin Núñez", "Liverpool", "Uruguay", "ST", 34),
        e("om_kdb", "Kevin De Bruyne", "Manchester City", "Belgium", "AM", 30),
        e("om_odegaard", "Martin Ødegaard", "Arsenal", "Norway", "AM", 28),
        e("om_grealish", "Jack Grealish", "Manchester City", "England", "LW", 18),
        e("om_vvd", "Virgil van Dijk", "Liverpool", "Netherlands", "CB", 18),
        e("om_taa", "Trent Alexander-Arnold", "Liverpool", "England", "RB", 16),
    ]

    private static func e(
        _ id: String, _ name: String, _ club: String, _ nationality: String, _ position: String, _ goals: Int
    ) -> RosterEntry {
        RosterEntry(id: id, name: name, club: club, nationality: nationality, position: position, goals: goals)
    }

    private static func todayUTC() -> String {
        String(ISO8601DateFormatter().string(from: Date()).prefix(10))
    }
}
