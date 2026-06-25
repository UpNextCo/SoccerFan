import Foundation

enum BlindRankSeed {
    private static let practiceSlotCount = 10

    /// Offline fallback only uses categories whose values come from real seeded
    /// stats (PL goals/appearances/assists). The fabricated transfer-fee / market-value
    /// / trophy maps are intentionally excluded so we never show made-up "answers".
    private static let reliableCategories: [BlindRankCategory] = [
        .premierLeagueGoals,
        .premierLeagueAppearances,
        .premierLeagueAssists,
    ]

    static func makeDailyChallenge(date: String? = nil) -> BlindRankChallenge {
        let dateKey = date ?? todayUTC()
        let seed = stableHash("blind_rank_\(dateKey)")
        return makeChallenge(seed: seed, id: "blind_rank_daily_\(dateKey)", isDaily: true, date: dateKey)
    }

    static func makePracticeChallenge() -> BlindRankChallenge {
        let seed = Int.random(in: 0...999_999)
        return makeChallenge(
            seed: seed,
            id: "blind_rank_practice_\(UUID().uuidString.prefix(8))",
            isDaily: false,
            date: nil
        )
    }

    // MARK: - Private

    private struct RosterEntry {
        let id: String
        let name: String
        let club: String
        let nationality: String
        let position: String
    }

    private static let roster: [RosterEntry] = [
        RosterEntry(id: "br_kane", name: "Harry Kane", club: "Bayern Munich", nationality: "England", position: "ST"),
        RosterEntry(id: "br_salah", name: "Mohamed Salah", club: "Liverpool", nationality: "Egypt", position: "RW"),
        RosterEntry(id: "br_bruno", name: "Bruno Fernandes", club: "Manchester United", nationality: "Portugal", position: "AM"),
        RosterEntry(id: "br_kdb", name: "Kevin De Bruyne", club: "Manchester City", nationality: "Belgium", position: "AM"),
        RosterEntry(id: "br_haaland", name: "Erling Haaland", club: "Manchester City", nationality: "Norway", position: "ST"),
        RosterEntry(id: "br_son", name: "Son Heung-min", club: "Tottenham", nationality: "South Korea", position: "LW"),
        RosterEntry(id: "br_sterling", name: "Raheem Sterling", club: "Chelsea", nationality: "England", position: "LW"),
        RosterEntry(id: "br_milner", name: "James Milner", club: "Brighton", nationality: "England", position: "CM"),
        RosterEntry(id: "br_casemiro", name: "Casemiro", club: "Manchester United", nationality: "Brazil", position: "DM"),
        RosterEntry(id: "br_rodri", name: "Rodri", club: "Manchester City", nationality: "Spain", position: "DM"),
        RosterEntry(id: "br_tarkowski", name: "James Tarkowski", club: "Everton", nationality: "England", position: "CB"),
        RosterEntry(id: "br_joelinton", name: "Joelinton", club: "Newcastle", nationality: "Brazil", position: "CM"),
        RosterEntry(id: "br_grealish", name: "Jack Grealish", club: "Manchester City", nationality: "England", position: "LW"),
        RosterEntry(id: "br_walker", name: "Kyle Walker", club: "Manchester City", nationality: "England", position: "RB"),
        RosterEntry(id: "br_gundogan", name: "Ilkay Gündogan", club: "Barcelona", nationality: "Germany", position: "CM"),
        RosterEntry(id: "br_bernardo", name: "Bernardo Silva", club: "Manchester City", nationality: "Portugal", position: "AM"),
        RosterEntry(id: "br_rashford", name: "Marcus Rashford", club: "Manchester United", nationality: "England", position: "LW"),
        RosterEntry(id: "br_saka", name: "Bukayo Saka", club: "Arsenal", nationality: "England", position: "RW"),
        RosterEntry(id: "br_rice", name: "Declan Rice", club: "Arsenal", nationality: "England", position: "DM"),
        RosterEntry(id: "br_palmer", name: "Cole Palmer", club: "Chelsea", nationality: "England", position: "AM"),
        RosterEntry(id: "br_isak", name: "Alexander Isak", club: "Newcastle", nationality: "Sweden", position: "ST"),
        RosterEntry(id: "br_nunez", name: "Darwin Núñez", club: "Liverpool", nationality: "Uruguay", position: "ST"),
        RosterEntry(id: "br_vvd", name: "Virgil van Dijk", club: "Liverpool", nationality: "Netherlands", position: "CB"),
        RosterEntry(id: "br_robertson", name: "Andrew Robertson", club: "Liverpool", nationality: "Scotland", position: "LB"),
        RosterEntry(id: "br_taa", name: "Trent Alexander-Arnold", club: "Liverpool", nationality: "England", position: "RB"),
        RosterEntry(id: "br_ederson", name: "Ederson", club: "Manchester City", nationality: "Brazil", position: "GK"),
        RosterEntry(id: "br_alisson", name: "Alisson", club: "Liverpool", nationality: "Brazil", position: "GK"),
        RosterEntry(id: "br_odegaard", name: "Martin Ødegaard", club: "Arsenal", nationality: "Norway", position: "AM"),
        RosterEntry(id: "br_dias", name: "Rúben Dias", club: "Manchester City", nationality: "Portugal", position: "CB"),
        RosterEntry(id: "br_saliba", name: "William Saliba", club: "Arsenal", nationality: "France", position: "CB"),
        RosterEntry(id: "br_gabriel", name: "Gabriel Magalhães", club: "Arsenal", nationality: "Brazil", position: "CB"),
        RosterEntry(id: "br_eriksen", name: "Christian Eriksen", club: "Manchester United", nationality: "Denmark", position: "CM"),
    ]

    private static let transferFees: [String: Int] = [
        "br_kane": 100, "br_salah": 41, "br_bruno": 47, "br_kdb": 76, "br_haaland": 60,
        "br_son": 22, "br_sterling": 49, "br_casemiro": 70, "br_rodri": 63, "br_isak": 63,
        "br_nunez": 75, "br_rice": 105, "br_vvd": 75, "br_grealish": 100, "br_martial": 36,
        "br_pogba": 89, "br_lukaku": 97, "br_giroud": 18, "br_palmer": 0, "br_rashford": 0,
    ]

    private static let marketValue: [String: Int] = [
        "br_haaland": 180, "br_salah": 120, "br_kane": 110, "br_kdb": 85, "br_vvd": 65,
        "br_saka": 130, "br_rice": 105, "br_palmer": 90, "br_isak": 80, "br_bruno": 70,
        "br_rodri": 110, "br_son": 75, "br_nunez": 55, "br_rashford": 50, "br_grealish": 45,
        "br_alisson": 60, "br_ederson": 55, "br_dias": 80, "br_saliba": 75, "br_odegaard": 85,
    ]

    private static let careerTrophies: [String: Int] = [
        "br_milner": 14, "br_kdb": 18, "br_gundogan": 16, "br_silva": 15, "br_walker": 14,
        "br_salah": 12, "br_vvd": 11, "br_alisson": 11, "br_ederson": 12, "br_rodri": 10,
        "br_kane": 8, "br_son": 7, "br_casemiro": 12, "br_grealish": 9, "br_sterling": 10,
        "br_robertson": 10, "br_taa": 9, "br_dias": 11, "br_bruno": 6, "br_rashford": 6,
    ]

    private static let uclGoals: [String: Int] = [
        "br_salah": 24, "br_benzema": 78, "br_lewa": 42, "br_muller": 28, "br_kane": 14,
        "br_haaland": 18, "br_sterling": 12, "br_grealish": 2, "br_kdb": 6, "br_bruno": 8,
        "br_son": 8, "br_mane": 22, "br_casemiro": 12, "br_vvd": 4, "br_giroud": 18,
        "br_firmino": 12, "br_martial": 4, "br_rashford": 4, "br_nunez": 6, "br_isak": 2,
    ]

    private static func makeChallenge(
        seed: Int,
        id: String,
        isDaily: Bool,
        date: String?
    ) -> BlindRankChallenge {
        let category = reliableCategories[seed % reliableCategories.count]

        let valued = roster.map { entry -> BlindRankPlayer in
            BlindRankPlayer(
                id: entry.id,
                name: entry.name,
                club: entry.club,
                league: "Premier League",
                nationality: entry.nationality,
                position: entry.position,
                statValue: statValue(for: entry, category: category)
            )
        }

        let sorted = valued.sorted {
            if $0.statValue == $1.statValue { return $0.name < $1.name }
            return $0.statValue > $1.statValue
        }

        let selected = pickPlayers(from: sorted, seed: seed, category: category)
        let correctRanking = selected.sorted {
            if $0.statValue == $1.statValue { return $0.name < $1.name }
            return $0.statValue > $1.statValue
        }.map(\.id)

        let presentationOrder = seededShuffle(selected, seed: seed ^ 0x9E37)

        return BlindRankChallenge(
            id: id,
            category: category,
            presentationOrder: presentationOrder,
            correctRanking: correctRanking,
            isDaily: isDaily,
            date: date
        )
    }

    private static func statValue(for entry: RosterEntry, category: BlindRankCategory) -> Int {
        let dto = PlayerSearchResultDTO(
            id: entry.id,
            name: entry.name,
            club: entry.club,
            league: "Premier League",
            nationality: entry.nationality,
            position: entry.position
        )

        switch category {
        case .premierLeagueGoals:
            return TargetManSeed.statValue(for: dto, league: .premierLeague, category: .goals)
        case .premierLeagueAppearances:
            return TargetManSeed.statValue(for: dto, league: .premierLeague, category: .appearances)
        case .premierLeagueAssists:
            return TargetManSeed.statValue(for: dto, league: .premierLeague, category: .assists)
        case .transferFees:
            return transferFees[entry.id] ?? fallbackStat(entry.id, range: 15...120)
        case .marketValue:
            return marketValue[entry.id] ?? fallbackStat(entry.id, range: 20...150)
        case .careerTrophies:
            return careerTrophies[entry.id] ?? fallbackStat(entry.id, range: 2...12)
        case .championsLeagueGoals:
            return uclGoals[entry.id] ?? fallbackStat(entry.id, range: 0...30)
        }
    }

    private static func pickPlayers(
        from sorted: [BlindRankPlayer],
        seed: Int,
        category: BlindRankCategory
    ) -> [BlindRankPlayer] {
        guard sorted.count >= practiceSlotCount else {
            return Array(sorted.prefix(practiceSlotCount))
        }

        let minSpread = category == .transferFees || category == .marketValue ? 25 : 8
        let windowSize = 14
        var bestStart = 0
        var bestSpread = 0

        for start in 0...(sorted.count - practiceSlotCount) {
            let end = min(start + windowSize, sorted.count)
            let window = Array(sorted[start..<end])
            guard window.count >= practiceSlotCount else { continue }
            let slice = Array(window.prefix(practiceSlotCount))
            let spread = (slice.first?.statValue ?? 0) - (slice.last?.statValue ?? 0)
            if spread > bestSpread {
                bestSpread = spread
                bestStart = start
            }
        }

        let poolStart = bestSpread >= minSpread
            ? bestStart
            : (seed / 13) % max(sorted.count - practiceSlotCount, 1)

        let poolEnd = min(poolStart + windowSize, sorted.count)
        let pool = Array(sorted[poolStart..<poolEnd])
        var picks: [BlindRankPlayer] = []
        var index = 0
        while picks.count < practiceSlotCount, !pool.isEmpty {
            let pickIndex = (seed / (index + 3)) % pool.count
            let candidate = pool[pickIndex]
            if !picks.contains(where: { $0.id == candidate.id }) {
                picks.append(candidate)
            }
            index += 1
            if index > pool.count * 3 { break }
        }

        if picks.count < practiceSlotCount {
            for player in sorted where picks.count < practiceSlotCount {
                if !picks.contains(where: { $0.id == player.id }) {
                    picks.append(player)
                }
            }
        }

        return Array(picks.prefix(practiceSlotCount))
    }

    private static func fallbackStat(_ id: String, range: ClosedRange<Int>) -> Int {
        let hash = stableHash(id)
        return range.lowerBound + (hash % (range.upperBound - range.lowerBound + 1))
    }

    private static func seededShuffle<T>(_ array: [T], seed: Int) -> [T] {
        var result = array
        var state = UInt64(bitPattern: Int64(seed == 0 ? 1 : seed))
        for index in stride(from: result.count - 1, through: 1, by: -1) {
            state = state &* 6364136223846793005 &+ 1
            let swapIndex = Int(state % UInt64(index + 1))
            result.swapAt(index, swapIndex)
        }
        return result
    }

    private static func todayUTC() -> String {
        String(ISO8601DateFormatter().string(from: Date()).prefix(10))
    }

    private static func stableHash(_ value: String) -> Int {
        abs(value.utf8.reduce(5381) { ($0 << 5) &+ $0 &+ Int($1) })
    }
}
