import Foundation

struct BlindRankPlayer: Identifiable, Equatable {
    let id: String
    let name: String
    let club: String
    var clubs: String = ""
    let league: String
    let nationality: String
    let position: String
    let statValue: Int
    var headshotUrl: String? = nil

    /// Prefer the multi-club label ("Barcelona · Chelsea"); fall back to the single club.
    var displayClubs: String { clubs.isEmpty ? club : clubs }

    var searchDTO: PlayerSearchResultDTO {
        PlayerSearchResultDTO(
            id: id,
            name: name,
            club: club,
            league: league,
            nationality: nationality,
            position: position,
            headshotUrl: headshotUrl
        )
    }
}

enum BlindRankCategory: String, CaseIterable, Codable {
    case premierLeagueGoals
    case premierLeagueAppearances
    case premierLeagueAssists
    case transferFees
    case marketValue
    case careerTrophies
    case championsLeagueGoals

    var title: String {
        switch self {
        case .premierLeagueGoals: return "Premier League Goals"
        case .premierLeagueAppearances: return "Premier League Appearances"
        case .premierLeagueAssists: return "Premier League Assists"
        case .transferFees: return "Transfer Fees"
        case .marketValue: return "Market Value"
        case .careerTrophies: return "Career Trophies"
        case .championsLeagueGoals: return "Champions League Goals"
        }
    }

    var valueNoun: String {
        switch self {
        case .premierLeagueGoals: return "goals"
        case .premierLeagueAppearances: return "apps"
        case .premierLeagueAssists: return "assists"
        case .transferFees: return "€m"
        case .marketValue: return "€m"
        case .careerTrophies: return "trophies"
        case .championsLeagueGoals: return "UCL goals"
        }
    }

    var rankHint: String {
        switch self {
        case .transferFees, .marketValue:
            return "Highest → lowest"
        default:
            return "Most → least"
        }
    }

    var valuePrefix: String {
        switch self {
        case .transferFees, .marketValue: return "€"
        default: return ""
        }
    }
}

struct BlindRankChallenge: Equatable {
    let id: String
    let themeTitle: String
    let categoryTitle: String
    let subtitle: String
    let rankHint: String
    let valueNoun: String
    let valuePrefix: String
    let presentationOrder: [BlindRankPlayer]
    let correctRanking: [String]
    let isDaily: Bool
    let date: String?

    init(
        id: String,
        themeTitle: String = "",
        categoryTitle: String,
        subtitle: String = "",
        rankHint: String,
        valueNoun: String,
        valuePrefix: String,
        presentationOrder: [BlindRankPlayer],
        correctRanking: [String],
        isDaily: Bool,
        date: String?
    ) {
        self.id = id
        self.themeTitle = themeTitle
        self.categoryTitle = categoryTitle
        self.subtitle = subtitle.isEmpty ? "Rank by \(categoryTitle.lowercased())" : subtitle
        self.rankHint = rankHint
        self.valueNoun = valueNoun
        self.valuePrefix = valuePrefix
        self.presentationOrder = presentationOrder
        self.correctRanking = correctRanking
        self.isDaily = isDaily
        self.date = date
    }

    /// Convenience initializer for offline/seed challenges built from a local category.
    init(
        id: String,
        category: BlindRankCategory,
        presentationOrder: [BlindRankPlayer],
        correctRanking: [String],
        isDaily: Bool,
        date: String?
    ) {
        self.init(
            id: id,
            themeTitle: "Premier League",
            categoryTitle: category.title,
            subtitle: "Rank by \(category.title.lowercased())",
            rankHint: category.rankHint,
            valueNoun: category.valueNoun,
            valuePrefix: category.valuePrefix,
            presentationOrder: presentationOrder,
            correctRanking: correctRanking,
            isDaily: isDaily,
            date: date
        )
    }
}

enum BlindRankPhase: Equatable {
    case ranking
    case revealing
    case complete
}

struct BlindRankRevealStep: Identifiable, Equatable {
    let id: Int
    let rank: Int
    let player: BlindRankPlayer
    let userRank: Int?
    let isCorrect: Bool
}

struct BlindRankGameState: Equatable {
    let challenge: BlindRankChallenge
    var phase: BlindRankPhase
    var currentPlayerIndex: Int
    var slots: [BlindRankPlayer?]
    var revealSteps: [BlindRankRevealStep]
    var revealedStepCount: Int
    var score: Int?
    var exactMatches: Int?

    var slotCount: Int { challenge.presentationOrder.count }

    init(challenge: BlindRankChallenge) {
        self.challenge = challenge
        phase = .ranking
        currentPlayerIndex = 0
        slots = Array(repeating: nil, count: challenge.presentationOrder.count)
        revealSteps = []
        revealedStepCount = 0
        score = nil
        exactMatches = nil
    }

    var isBoardFull: Bool {
        slots.allSatisfy { $0 != nil }
    }

    var currentPlayer: BlindRankPlayer? {
        guard phase == .ranking,
              challenge.presentationOrder.indices.contains(currentPlayerIndex) else { return nil }
        return challenge.presentationOrder[currentPlayerIndex]
    }
}

enum BlindRankScoring {
    static func exactMatches(slots: [BlindRankPlayer?], correctRanking: [String]) -> Int {
        zip(slots, correctRanking).reduce(0) { count, pair in
            count + (pair.0?.id == pair.1 ? 1 : 0)
        }
    }

    /// Max points for a perfect 10-player round (3 each).
    static func maxScore(slotCount: Int) -> Int { slotCount * 3 }

    struct Breakdown: Equatable {
        let exact: Int    // perfect placements (distance 0)
        let close: Int    // 1–2 places off
        let disaster: Int // 3+ places off
    }

    /// Forgiving score: exact = 3, one off = 2, two off = 1, three+ off = 0.
    static func score(slots: [BlindRankPlayer?], correctRanking: [String]) -> Int {
        let correctIndex = Dictionary(uniqueKeysWithValues: correctRanking.enumerated().map { ($0.element, $0.offset) })
        var total = 0
        for (i, slot) in slots.enumerated() {
            guard let id = slot?.id, let correct = correctIndex[id] else { continue }
            let d = abs(i - correct)
            total += d == 0 ? 3 : d == 1 ? 2 : d == 2 ? 1 : 0
        }
        return total
    }

    static func breakdown(slots: [BlindRankPlayer?], correctRanking: [String]) -> Breakdown {
        let correctIndex = Dictionary(uniqueKeysWithValues: correctRanking.enumerated().map { ($0.element, $0.offset) })
        var exact = 0, close = 0, disaster = 0
        for (i, slot) in slots.enumerated() {
            guard let id = slot?.id, let correct = correctIndex[id] else { continue }
            let d = abs(i - correct)
            if d == 0 { exact += 1 } else if d <= 2 { close += 1 } else { disaster += 1 }
        }
        return Breakdown(exact: exact, close: close, disaster: disaster)
    }

    /// XP scaled from the ranking-accuracy score (win threshold 17). Mirrors the server model.
    static func xp(fromScore score: Int) -> Int {
        DailyXP.xp(.blindRank, score: score, won: score >= 17)
    }

    static func verdict(forScore score: Int) -> String {
        switch score {
        case 28...: return "Ball Knowledge verified."
        case 23...: return "Serious ball knowledge."
        case 17...: return "Decent, but the stinkers got you."
        case 9...: return "You know names, not numbers."
        default: return "Football Twitter is going to cook you."
        }
    }

    static func buildRevealSteps(
        slots: [BlindRankPlayer?],
        challenge: BlindRankChallenge
    ) -> [BlindRankRevealStep] {
        challenge.correctRanking.enumerated().map { index, playerId in
            let rank = index + 1
            let player = challenge.presentationOrder.first { $0.id == playerId }
                ?? slots.compactMap { $0 }.first { $0.id == playerId }
            let userRank = slots.firstIndex { $0?.id == playerId }.map { $0 + 1 }
            return BlindRankRevealStep(
                id: rank,
                rank: rank,
                player: player ?? BlindRankPlayer(
                    id: playerId, name: "Unknown", club: "", league: "",
                    nationality: "", position: "", statValue: 0
                ),
                userRank: userRank,
                isCorrect: userRank == rank
            )
        }
    }
}

enum BlindRankTiming {
    static let revealStagger: Double = 0.72
    static let revealSlide: Double = 0.45
    static let resultDelay: Double = 1.8
}
