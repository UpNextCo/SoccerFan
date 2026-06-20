import Foundation

enum BlindRankSeed {
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

    private static func makeChallenge(
        seed: Int,
        id: String,
        isDaily: Bool,
        date: String?
    ) -> BlindRankChallenge {
        let league = TargetManLeague.allCases[seed % TargetManLeague.allCases.count]
        let category = TargetManStatCategory.allCases[(seed / 7) % TargetManStatCategory.allCases.count]

        let valued = roster.compactMap { entry -> BlindRankPlayer? in
            let dto = PlayerSearchResultDTO(
                id: entry.id,
                name: entry.name,
                club: entry.club,
                league: league.rawValue,
                nationality: entry.nationality,
                position: entry.position
            )
            let value = TargetManSeed.statValue(for: dto, league: league, category: category)
            return BlindRankPlayer(
                id: entry.id,
                name: entry.name,
                club: entry.club,
                league: league.rawValue,
                nationality: entry.nationality,
                position: entry.position,
                statValue: value
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
            league: league,
            category: category,
            presentationOrder: presentationOrder,
            correctRanking: correctRanking,
            isDaily: isDaily,
            date: date
        )
    }

    private static func pickPlayers(
        from sorted: [BlindRankPlayer],
        seed: Int,
        category: TargetManStatCategory
    ) -> [BlindRankPlayer] {
        guard sorted.count >= BlindRankGameState.slotCount else {
            return Array(sorted.prefix(BlindRankGameState.slotCount))
        }

        let minSpread = max(8, category.fallbackRange.lowerBound / 4)
        let windowSize = 14
        var bestStart = 0
        var bestSpread = 0

        for start in 0...(sorted.count - BlindRankGameState.slotCount) {
            let end = min(start + windowSize, sorted.count)
            let window = Array(sorted[start..<end])
            guard window.count >= BlindRankGameState.slotCount else { continue }
            let slice = Array(window.prefix(BlindRankGameState.slotCount))
            let spread = (slice.first?.statValue ?? 0) - (slice.last?.statValue ?? 0)
            if spread > bestSpread {
                bestSpread = spread
                bestStart = start
            }
        }

        let poolStart: Int
        if bestSpread >= minSpread {
            poolStart = bestStart
        } else {
            poolStart = (seed / 13) % max(sorted.count - BlindRankGameState.slotCount, 1)
        }

        let poolEnd = min(poolStart + windowSize, sorted.count)
        let pool = Array(sorted[poolStart..<poolEnd])
        var picks: [BlindRankPlayer] = []
        var index = 0
        while picks.count < BlindRankGameState.slotCount, !pool.isEmpty {
            let pickIndex = (seed / (index + 3)) % pool.count
            let candidate = pool[pickIndex]
            if !picks.contains(where: { $0.id == candidate.id }) {
                picks.append(candidate)
            }
            index += 1
            if index > pool.count * 3 { break }
        }

        if picks.count < BlindRankGameState.slotCount {
            for player in sorted where picks.count < BlindRankGameState.slotCount {
                if !picks.contains(where: { $0.id == player.id }) {
                    picks.append(player)
                }
            }
        }

        return Array(picks.prefix(BlindRankGameState.slotCount))
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
