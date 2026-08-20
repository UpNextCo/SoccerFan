import Foundation

/// One pickable name in a round; `value` is its career total of the category in the league.
struct OneMoreOption: Identifiable, Equatable, Codable {
    let id: String
    let name: String
    let clubs: String
    let position: String
    var nationality: String = ""
    /// Stat value — 0 until revealed via server check (stripped from the daily bundle).
    var value: Int
    var headshotUrl: String? = nil
    var teamId: Int? = nil
    var teamLogoUrl: String? = nil
    /// True once the server has revealed this option's value for the current round.
    var valueRevealed: Bool = false

    /// The primary club (first of the "Club · Club" list) for the card badge + label.
    var primaryClub: String { clubs.split(separator: "·").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? clubs }

    /// A search-result shim so the shared team-badge view can render this option's crest.
    var badgeDTO: PlayerSearchResultDTO {
        PlayerSearchResultDTO(id: id, name: name, club: primaryClub, league: "", nationality: "", position: position, teamId: teamId, teamLogoUrl: teamLogoUrl)
    }
}

/// A binary round: exactly two options, one of which clears the day's threshold.
struct OneMoreRound: Equatable, Codable {
    let options: [OneMoreOption]
}

struct OneMorePrompt: Equatable, Codable {
    let id: String
    let metricTitle: String   // e.g. "Premier League goals", "career penalty goals"
    let valueNoun: String     // reveal unit, e.g. "goals", "pens", "caps"
    let minimum: Int
    var compareMode: Bool
    var rounds: [OneMoreRound]
    let isDaily: Bool
    let date: String?

    enum CodingKeys: String, CodingKey {
        case id, metricTitle, valueNoun, minimum, compareMode, rounds, isDaily, date
    }

    init(
        id: String,
        metricTitle: String,
        valueNoun: String,
        minimum: Int,
        compareMode: Bool = false,
        rounds: [OneMoreRound],
        isDaily: Bool,
        date: String?
    ) {
        self.id = id
        self.metricTitle = metricTitle
        self.valueNoun = valueNoun
        self.minimum = minimum
        self.compareMode = compareMode
        self.rounds = rounds
        self.isDaily = isDaily
        self.date = date
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        metricTitle = try c.decode(String.self, forKey: .metricTitle)
        valueNoun = try c.decode(String.self, forKey: .valueNoun)
        minimum = try c.decode(Int.self, forKey: .minimum)
        compareMode = try c.decodeIfPresent(Bool.self, forKey: .compareMode) ?? false
        rounds = try c.decode([OneMoreRound].self, forKey: .rounds)
        isDaily = try c.decode(Bool.self, forKey: .isDaily)
        date = try c.decodeIfPresent(String.self, forKey: .date)
    }

    var statNoun: String { valueNoun }

    /// Full prompt line, e.g. "Players with 50+ Premier League goals".
    var title: String {
        compareMode ? "Who has more \(metricTitle)" : "Players with \(minimum)+ \(metricTitle)"
    }

    /// Big card headline, e.g. "Who has 50+ Premier League goals?"
    var question: String {
        compareMode ? "Who has more \(metricTitle)?" : "Who has \(minimum)+ \(metricTitle)?"
    }

    var ruleLine: String {
        "15 seconds a pick · one miss loses everything"
    }

    /// Whether an option is the correct pick. Requires a revealed value from the server.
    func qualifies(_ option: OneMoreOption, in round: OneMoreRound) -> Bool {
        guard option.valueRevealed else { return false }
        if compareMode {
            let values = round.options.filter(\.valueRevealed).map(\.value)
            guard values.count == round.options.count, let best = values.max() else { return false }
            return option.value == best && values.filter { $0 == best }.count == 1
        }
        return option.value >= minimum
    }
}

struct OneMorePick: Identifiable, Equatable, Codable {
    var id = UUID()
    let name: String
    let optionId: String
    let statValue: Int
    let pointsAfter: Int
}

enum OneMorePhase: Equatable, Codable {
    case playing
    case revealing   // showing both stat values right after a pick
    case busted
    case cashedOut   // cashed out OR cleared every round
}

struct OneMoreGameState: Equatable, Codable {
    static let progressVersion = 2
    var prompt: OneMorePrompt
    var phase: OneMorePhase
    var streak: Int
    var bankedScore: Int
    var picks: [OneMorePick]
    var roundIndex: Int
    var chosenOptionId: String?     // the option tapped this round (for reveal highlight)
    var bustPick: OneMorePick?      // the wrong option chosen
    var bustCorrect: OneMoreOption? // the option they should have picked

    init(prompt: OneMorePrompt) {
        self.prompt = prompt
        phase = .playing
        streak = 0
        bankedScore = 0
        picks = []
        roundIndex = 0
        chosenOptionId = nil
        bustPick = nil
        bustCorrect = nil
    }

    var isActive: Bool {
        phase == .playing || phase == .revealing
    }

    var currentRound: OneMoreRound? {
        prompt.rounds.indices.contains(roundIndex) ? prompt.rounds[roundIndex] : nil
    }

    /// Total rounds in today's run — the streak needed to reach the full XP max.
    var totalRounds: Int { prompt.rounds.count }

    var currentScore: Int {
        OneMoreScoring.score(forStreak: streak, rounds: totalRounds)
    }

    var nextPickPoints: Int {
        OneMoreScoring.points(forPick: streak + 1, rounds: totalRounds)
    }

    /// Answer inputs for server-side score recompute.
    func answerPayload() -> JSONValue {
        var pickIds = picks.map(\.optionId)
        if phase == .busted, let bust = bustPick {
            pickIds.append(bust.optionId)
        }
        return .object([
            "picks": .array(pickIds.map { .string($0) }),
            "cashedOut": .bool(phase == .cashedOut),
        ])
    }
}

enum OneMoreScoring {
    /// XP the k-th correct pick adds — an escalating share summing to the 900 max when all N rounds
    /// are cleared (later picks worth more). This IS the XP.
    static func points(forPick pickNumber: Int, rounds: Int) -> Int {
        DailyXP.oneMorePick(pickNumber, rounds: rounds)
    }

    static func score(forStreak streak: Int, rounds: Int) -> Int {
        DailyXP.oneMoreTotal(streak: streak, rounds: rounds)
    }

    static func xp(from score: Int, streak: Int) -> Int {
        DailyXP.xp(.oneMore, score: score, won: score > 0)
    }

    static func riskLabel(forStreak streak: Int) -> String {
        switch streak {
        case 0: return "First correct answer banks points"
        case 1...2: return "Heating up — cash out or push"
        case 3...5: return "Solid run — one mistake wipes it"
        case 6...8: return "High risk — big reward territory"
        default: return "All or nothing — legend status"
        }
    }
}

enum OneMoreTiming {
    static let reveal: Double = 0.9       // how long both stat values show after a pick
    static let bustHold: Double = 1.4
    static let cashOutDelay: Double = 0.25
    static let confettiThreshold = 5
    static let roundDuration: TimeInterval = 15
}
