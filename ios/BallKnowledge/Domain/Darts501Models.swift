import Foundation

// MARK: - Puzzle

struct Darts501Puzzle: Equatable, Codable {
    let id: String
    let date: String
    let formulaId: String
    let formulaLabel: String
    var nationality: String? = nil
    var leagueName: String? = nil
    var leagueId: Int? = nil
    var club: String? = nil
    var clubLeague: String? = nil
    var teamId: Int? = nil
    var audience: String? = nil
    var formulaDetail: String? = nil
    let startScore: Int
    let checkoutWindow: Int
    let checkoutLives: Int

    var category: Darts501CategoryDisplay {
        Darts501CategoryDisplay.make(from: self)
    }
}

struct Darts501CategoryDisplay: Equatable {
    let nationality: String?
    var leagueName: String? = nil
    var leagueId: Int? = nil
    var club: String? = nil
    var clubLeague: String? = nil
    var teamId: Int? = nil
    let audience: String
    let formula: String

    var flag: String {
        guard let nationality, !nationality.isEmpty else { return "" }
        return GuessWhoDisplay.nationalityFlag(nationality)
    }

    var hasNationFilter: Bool {
        nationality != nil && !(nationality ?? "").isEmpty
    }

    var hasLeagueFilter: Bool {
        guard let leagueName, !leagueName.isEmpty else { return false }
        return true
    }

    var hasClubFilter: Bool {
        guard let club, !club.isEmpty else { return false }
        return true
    }

    var hasInternationalFilter: Bool {
        !hasNationFilter && !hasLeagueFilter && !hasClubFilter
            && audience.localizedCaseInsensitiveContains("international")
    }

    static func make(from puzzle: Darts501Puzzle) -> Darts501CategoryDisplay {
        let fallback = catalog[puzzle.formulaId]
        let audience = nonempty(puzzle.audience) ?? fallback?.audience ?? "Players"
        let formula = nonempty(puzzle.formulaDetail) ?? fallback?.formula ?? puzzle.formulaLabel
        return Darts501CategoryDisplay(
            nationality: nonempty(puzzle.nationality) ?? fallback?.nationality,
            leagueName: nonempty(puzzle.leagueName) ?? fallback?.leagueName,
            leagueId: puzzle.leagueId ?? fallback?.leagueId,
            club: nonempty(puzzle.club) ?? fallback?.club,
            clubLeague: nonempty(puzzle.clubLeague) ?? fallback?.clubLeague,
            teamId: puzzle.teamId ?? fallback?.teamId,
            audience: audience == "Any player" ? (fallback?.audience ?? "Players") : audience,
            formula: formula
        )
    }

    private static func nonempty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static let catalog: [String: Darts501CategoryDisplay] = [
        "pl_apps_minus_goals_wales": .init(nationality: "Wales", audience: "Welsh Players", formula: "Premier League appearances − career goals"),
        "cl_apps_plus_intl_goals": .init(nationality: nil, leagueName: "Champions League", leagueId: 2, audience: "Champions League Players", formula: "Champions League appearances + international goals"),
        "pl_goals_plus_england_caps": .init(nationality: "England", audience: "English Players", formula: "Premier League goals + international caps"),
        "pl_apps_minus_goals_scotland": .init(nationality: "Scotland", audience: "Scottish Players", formula: "Premier League appearances − career goals"),
        "pl_apps_minus_goals_ireland": .init(nationality: "Ireland", audience: "Irish Players", formula: "Premier League appearances − career goals"),
        "pl_apps_minus_pl_goals_nireland": .init(nationality: "Northern Ireland", audience: "Northern Irish Players", formula: "Premier League appearances − Premier League goals"),
        "laliga_goals_plus_spain_caps": .init(nationality: "Spain", audience: "Spanish Players", formula: "La Liga goals + international caps"),
        "seriea_goals_plus_italy_caps": .init(nationality: "Italy", audience: "Italian Players", formula: "Serie A goals + international caps"),
        "bundesliga_goals_plus_germany_caps": .init(nationality: "Germany", audience: "German Players", formula: "Bundesliga goals + international caps"),
        "ligue1_goals_plus_france_caps": .init(nationality: "France", audience: "French Players", formula: "Ligue 1 goals + international caps"),
        "pl_goals_plus_france_caps": .init(nationality: "France", audience: "French Players", formula: "Premier League goals + international caps"),
        "pl_goals_plus_brazil_caps": .init(nationality: "Brazil", audience: "Brazilian Players", formula: "Premier League goals + international caps"),
        "pl_assists_plus_england_caps": .init(nationality: "England", audience: "English Players", formula: "Premier League assists + international caps"),
        "cl_goals_plus_intl_goals": .init(nationality: nil, leagueName: "Champions League", leagueId: 2, audience: "Champions League Players", formula: "Champions League goals + international goals"),
        "pl_goals_plus_cl_goals": .init(nationality: nil, leagueName: "Premier League", leagueId: 39, audience: "Premier League Players", formula: "Premier League goals + Champions League goals"),
        "cl_apps_minus_cl_goals": .init(nationality: nil, leagueName: "Champions League", leagueId: 2, audience: "Champions League Players", formula: "Champions League appearances − Champions League goals"),
        "pl_goals_plus_intl_goals": .init(nationality: nil, leagueName: "Premier League", leagueId: 39, audience: "Premier League Players", formula: "Premier League goals + international goals"),
        "laliga_goals_plus_cl_goals": .init(nationality: nil, leagueName: "La Liga", leagueId: 140, audience: "La Liga Players", formula: "La Liga goals + Champions League goals"),
        "career_trophies_plus_intl_goals": .init(nationality: nil, audience: "International Players", formula: "Career trophies + international goals"),
        "cl_apps_plus_portugal_caps": .init(nationality: "Portugal", audience: "Portuguese Players", formula: "Champions League appearances + international caps"),
        "cl_apps_plus_netherlands_caps": .init(nationality: "Netherlands", audience: "Dutch Players", formula: "Champions League appearances + international caps"),
        "seriea_goals_plus_cl_goals": .init(nationality: nil, leagueName: "Serie A", leagueId: 135, audience: "Serie A Players", formula: "Serie A goals + Champions League goals"),
        "pl_assists_plus_cl_assists": .init(nationality: nil, leagueName: "Premier League", leagueId: 39, audience: "Premier League Players", formula: "Premier League assists + Champions League assists"),
        "wc_goals_plus_cl_goals": .init(nationality: nil, leagueName: "World Cup", leagueId: 1, audience: "World Cup Players", formula: "World Cup goals + Champions League goals"),
        "intl_caps_minus_intl_goals_brazil": .init(nationality: "Brazil", audience: "Brazilian Players", formula: "International caps − international goals"),
        "intl_caps_minus_intl_goals_argentina": .init(nationality: "Argentina", audience: "Argentine Players", formula: "International caps − international goals"),
        "pl_goals_plus_scotland_caps": .init(nationality: "Scotland", audience: "Scottish Players", formula: "Premier League goals + international caps"),
        "pl_apps_minus_pl_goals_wales": .init(nationality: "Wales", audience: "Welsh Players", formula: "Premier League appearances − Premier League goals"),
        "pl_apps_minus_yellows_chelsea": .init(nationality: nil, club: "Chelsea", clubLeague: "Premier League", teamId: 49, audience: "Chelsea Players", formula: "Premier League appearances − Premier League yellow cards"),
    ]
}

struct Darts501CheckoutsDTO: Codable {
    let count: Int
}

struct Darts501ThrowResultDTO: Codable {
    let valid: Bool
    let duplicate: Bool
    let reason: String?
    let player: Darts501PlayerDTO?
    let score: Int?
    let leftValue: Int?
    let rightValue: Int?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        valid = try c.decodeIfPresent(Bool.self, forKey: .valid) ?? false
        duplicate = try c.decodeIfPresent(Bool.self, forKey: .duplicate) ?? false
        reason = try c.decodeIfPresent(String.self, forKey: .reason)
        player = try c.decodeIfPresent(Darts501PlayerDTO.self, forKey: .player)
        score = try c.decodeIfPresent(Int.self, forKey: .score)
        leftValue = try c.decodeIfPresent(Int.self, forKey: .leftValue)
        rightValue = try c.decodeIfPresent(Int.self, forKey: .rightValue)
    }
}

struct Darts501PlayerDTO: Codable, Equatable {
    let id: String
    let name: String
    let club: String
    let nationality: String
    let position: String
    let headshotUrl: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        club = try c.decodeIfPresent(String.self, forKey: .club) ?? ""
        nationality = try c.decodeIfPresent(String.self, forKey: .nationality) ?? ""
        position = try c.decodeIfPresent(String.self, forKey: .position) ?? ""
        headshotUrl = try c.decodeIfPresent(String.self, forKey: .headshotUrl)
    }
}

// MARK: - Throw history

enum Darts501BustReason: String, Codable, Equatable {
    case impossible
    case over180 = "over_180"
    case checkoutOvershoot = "checkout_overshoot"
    case wrongCategory = "wrong_category"
}

enum Darts501ThrowKind: String, Codable, Equatable {
    case score
    case bust
    case checkout
    case perfect
    case gameOver = "game_over"
}

struct Darts501Throw: Identifiable, Equatable, Codable {
    var id = UUID()
    let playerId: String
    let playerName: String
    let headshotUrl: String?
    let club: String
    let nationality: String
    let score: Int
    let remainingAfter: Int
    let kind: Darts501ThrowKind
    let bustReason: Darts501BustReason?
    let leftValue: Int?
    let rightValue: Int?
}

// MARK: - State

enum Darts501Phase: String, Codable, Equatable {
    case playing
    case checkout
    case won
    case lost
}

struct Darts501GameState: Equatable, Codable {
    static let progressVersion = 1

    let puzzle: Darts501Puzzle
    var remaining: Int
    var throwHistory: [Darts501Throw]
    var checkoutBusts: Int
    var phase: Darts501Phase

    init(puzzle: Darts501Puzzle) {
        self.puzzle = puzzle
        remaining = puzzle.startScore
        throwHistory = []
        checkoutBusts = 0
        phase = .playing
    }

    var usedPlayerIds: Set<String> {
        Set(throwHistory.map(\.playerId))
    }

    var isResumable: Bool {
        !throwHistory.isEmpty && (phase == .playing || phase == .checkout)
    }

    var isFinished: Bool {
        phase == .won || phase == .lost
    }

    var won: Bool { phase == .won }
    var perfect: Bool { phase == .won && remaining == 0 }

    var highestScore: Int {
        throwHistory.filter { $0.kind != .bust && $0.kind != .gameOver }.map(\.score).max() ?? 0
    }

    var bustCount: Int {
        throwHistory.filter { $0.kind == .bust || $0.kind == .gameOver }.count
    }

    var checkoutRemaining: Int {
        max(0, puzzle.checkoutLives - checkoutBusts)
    }

    var xpEarned: Int {
        Darts501Scoring.xp(
            won: won,
            perfect: perfect,
            throwCount: throwHistory.count,
            busts: bustCount
        )
    }

    func answerPayload() -> JSONValue {
        .object([
            "playerIds": .array(throwHistory.map { .string($0.playerId) }),
        ])
    }
}

// MARK: - Rules

enum Darts501Scoring {
    static let startScore = 501
    static let checkoutThreshold = 180
    static let checkoutWindow = 10
    static let checkoutLives = 3
    static let impossibleScores: Set<Int> = [163, 166, 169, 172, 173, 175, 176, 178, 179]

    static func isValidDartsScore(_ score: Int) -> Bool {
        score >= 0 && score <= 180 && !impossibleScores.contains(score)
    }

    static func bustReason(for score: Int) -> Darts501BustReason? {
        if score > 180 { return .over180 }
        if impossibleScores.contains(score) { return .impossible }
        return nil
    }

    static func isCheckoutRemaining(_ remaining: Int) -> Bool {
        remaining <= checkoutThreshold
    }

    static func isSuccessfulCheckout(_ nextRemaining: Int) -> Bool {
        nextRemaining <= 0 && nextRemaining >= -checkoutWindow
    }

    struct Resolution: Equatable {
        let kind: Darts501ThrowKind
        let remaining: Int
        let inCheckout: Bool
        let checkoutBusts: Int
        let bustReason: Darts501BustReason?
    }

    static func resolve(
        remaining: Int,
        score: Int,
        inCheckout: Bool,
        checkoutBusts: Int,
        wrongCategory: Bool = false
    ) -> Resolution {
        let checkout = inCheckout || isCheckoutRemaining(remaining)
        if wrongCategory {
            return applyBust(
                remaining: remaining,
                inCheckout: checkout,
                checkoutBusts: checkoutBusts,
                reason: .wrongCategory
            )
        }
        if let reason = bustReason(for: score) {
            return applyBust(
                remaining: remaining,
                inCheckout: checkout,
                checkoutBusts: checkoutBusts,
                reason: reason
            )
        }

        let nextRemaining = remaining - score
        if isSuccessfulCheckout(nextRemaining) {
            return Resolution(
                kind: nextRemaining == 0 ? .perfect : .checkout,
                remaining: nextRemaining,
                inCheckout: true,
                checkoutBusts: checkoutBusts,
                bustReason: nil
            )
        }

        if checkout && nextRemaining < -checkoutWindow {
            return applyBust(
                remaining: remaining,
                inCheckout: true,
                checkoutBusts: checkoutBusts,
                reason: .checkoutOvershoot
            )
        }

        return Resolution(
            kind: .score,
            remaining: nextRemaining,
            inCheckout: isCheckoutRemaining(nextRemaining),
            checkoutBusts: checkoutBusts,
            bustReason: nil
        )
    }

    private static func applyBust(
        remaining: Int,
        inCheckout: Bool,
        checkoutBusts: Int,
        reason: Darts501BustReason
    ) -> Resolution {
        let nextBusts = checkoutBusts + 1
        return Resolution(
            kind: nextBusts >= checkoutLives ? .gameOver : .bust,
            remaining: remaining,
            inCheckout: inCheckout,
            checkoutBusts: nextBusts,
            bustReason: reason
        )
    }

    static func xp(won: Bool, perfect: Bool, throwCount: Int, busts: Int) -> Int {
        DailyXP.darts501(won: won, perfect: perfect, throwCount: throwCount, busts: busts)
    }
}
