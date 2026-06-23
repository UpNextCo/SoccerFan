import Foundation

enum FootballTowerCatalog {
    struct PlayerProfile: Equatable {
        let id: String
        let name: String
        let nationality: String
        let clubs: [String]
        let leagues: [String]
        let position: String
        let plApps: Int
        let plGoals: Int
        let plAssists: Int
        let uclGoals: Int
        let uclApps: Int
        let uclWinner: Bool
        let aliases: [String]
    }

    static let plClubs: [String] = [
        "Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton",
        "Chelsea", "Crystal Palace", "Everton", "Fulham", "Ipswich Town",
        "Leicester City", "Liverpool", "Manchester City", "Manchester United",
        "Newcastle United", "Nottingham Forest", "Southampton", "Tottenham",
        "West Ham", "Wolverhampton",
    ]

    static let countries: [String] = [
        "England", "France", "Spain", "Germany", "Italy", "Portugal", "Brazil",
        "Argentina", "Netherlands", "Belgium", "Senegal", "Croatia", "Uruguay",
        "Poland", "Norway", "Denmark", "Sweden", "Mexico", "USA", "Japan",
        "Morocco", "Egypt", "South Korea", "Colombia", "Wales", "Scotland",
    ]

    static let players: [PlayerProfile] = [
        p("ft_salah", "Mohamed Salah", "Egypt", ["Liverpool", "Chelsea", "Roma"], ["Premier League", "Serie A"], "RW", 258, 118, 52, 24, 48, true),
        p("ft_kane", "Harry Kane", "England", ["Tottenham", "Bayern Munich"], ["Premier League", "Bundesliga"], "ST", 320, 213, 42, 14, 28, false),
        p("ft_bruno", "Bruno Fernandes", "Portugal", ["Manchester United", "Sporting CP"], ["Premier League"], "AM", 178, 78, 62, 8, 22, false),
        p("ft_kdb", "Kevin De Bruyne", "Belgium", ["Manchester City", "Chelsea"], ["Premier League"], "AM", 278, 72, 112, 6, 38, false),
        p("ft_alisson", "Alisson", "Brazil", ["Liverpool", "Roma"], ["Premier League", "Serie A"], "GK", 178, 0, 0, 0, 28, true),
        p("ft_ederson", "Ederson", "Brazil", ["Manchester City", "Benfica"], ["Premier League"], "GK", 156, 0, 0, 0, 24, true),
        p("ft_saka", "Bukayo Saka", "England", ["Arsenal"], ["Premier League"], "RW", 148, 58, 44, 4, 12, false),
        p("ft_rice", "Declan Rice", "England", ["Arsenal", "West Ham"], ["Premier League"], "DM", 178, 8, 10, 0, 8, false),
        p("ft_haaland", "Erling Haaland", "Norway", ["Manchester City", "Borussia Dortmund"], ["Premier League", "Bundesliga"], "ST", 98, 82, 14, 18, 22, false),
        p("ft_son", "Son Heung-min", "South Korea", ["Tottenham"], ["Premier League"], "LW", 278, 104, 48, 8, 18, false),
        p("ft_vvd", "Virgil van Dijk", "Netherlands", ["Liverpool", "Southampton"], ["Premier League"], "CB", 198, 18, 6, 4, 32, true),
        p("ft_robertson", "Andrew Robertson", "Scotland", ["Liverpool", "Hull City"], ["Premier League"], "LB", 198, 8, 52, 2, 24, true),
        p("ft_rashford", "Marcus Rashford", "England", ["Manchester United"], ["Premier League"], "LW", 248, 82, 28, 6, 14, false),
        p("ft_palmer", "Cole Palmer", "England", ["Chelsea", "Manchester City"], ["Premier League"], "AM", 78, 36, 18, 2, 8, false),
        p("ft_isak", "Alexander Isak", "Sweden", ["Newcastle", "Real Sociedad"], ["Premier League", "La Liga"], "ST", 92, 42, 8, 4, 10, false),
        p("ft_richarlison", "Richarlison", "Brazil", ["Tottenham", "Everton", "Watford"], ["Premier League"], "ST", 156, 52, 14, 0, 6, false),
        p("ft_gabriel", "Gabriel Jesus", "Brazil", ["Arsenal", "Manchester City"], ["Premier League"], "ST", 156, 58, 24, 8, 20, false),
        p("ft_casemiro", "Casemiro", "Brazil", ["Manchester United", "Real Madrid"], ["Premier League", "La Liga"], "DM", 112, 8, 6, 12, 48, true),
        p("ft_mane", "Sadio Mané", "Senegal", ["Liverpool", "Bayern Munich", "Southampton"], ["Premier League", "Bundesliga"], "LW", 196, 111, 38, 22, 42, true),
        p("ft_sterling", "Raheem Sterling", "England", ["Chelsea", "Manchester City", "Liverpool"], ["Premier League"], "LW", 378, 112, 56, 12, 34, true),
        p("ft_grealish", "Jack Grealish", "England", ["Manchester City", "Aston Villa"], ["Premier League"], "LW", 142, 18, 24, 2, 10, false),
        p("ft_milner", "James Milner", "England", ["Liverpool", "Manchester City", "Aston Villa"], ["Premier League"], "CM", 632, 24, 38, 6, 28, true),
        p("ft_gundogan", "Ilkay Gündogan", "Germany", ["Manchester City", "Barcelona"], ["Premier League", "La Liga"], "CM", 278, 34, 18, 8, 26, true),
        p("ft_bernardo", "Bernardo Silva", "Portugal", ["Manchester City", "Monaco"], ["Premier League", "Ligue 1"], "AM", 198, 42, 48, 4, 22, true),
        p("ft_martial", "Anthony Martial", "France", ["Manchester United", "Monaco"], ["Premier League", "Ligue 1"], "ST", 178, 55, 18, 4, 12, false),
        p("ft_pogba", "Paul Pogba", "France", ["Manchester United", "Juventus"], ["Premier League", "Serie A"], "CM", 178, 28, 24, 6, 18, false),
        p("ft_giroud", "Olivier Giroud", "France", ["Chelsea", "Arsenal", "AC Milan"], ["Premier League", "Serie A"], "ST", 148, 42, 18, 18, 42, true),
        p("ft_kante", "N'Golo Kanté", "France", ["Chelsea", "Leicester City"], ["Premier League"], "CM", 178, 8, 8, 2, 18, true),
        p("ft_lloris", "Hugo Lloris", "France", ["Tottenham"], ["Premier League"], "GK", 318, 0, 0, 0, 22, false),
        p("ft_lukaku", "Romelu Lukaku", "Belgium", ["Chelsea", "Manchester United", "Everton"], ["Premier League", "Serie A"], "ST", 198, 88, 24, 8, 16, false),
        p("ft_de_gea", "David De Gea", "Spain", ["Manchester United", "Atletico Madrid"], ["Premier League", "La Liga"], "GK", 298, 0, 0, 0, 18, false),
        p("ft_odegaard", "Martin Ødegaard", "Norway", ["Arsenal", "Real Madrid"], ["Premier League", "La Liga"], "AM", 112, 28, 24, 2, 8, false),
        p("ft_benzema", "Karim Benzema", "France", ["Real Madrid", "Lyon"], ["La Liga", "Ligue 1"], "ST", 0, 0, 0, 78, 124, true),
        p("ft_lewa", "Robert Lewandowski", "Poland", ["Bayern Munich", "Barcelona", "Borussia Dortmund"], ["Bundesliga", "La Liga"], "ST", 0, 0, 0, 42, 68, true),
        p("ft_muller", "Thomas Müller", "Germany", ["Bayern Munich"], ["Bundesliga"], "AM", 0, 0, 0, 28, 72, true),
        p("ft_kimmich", "Joshua Kimmich", "Germany", ["Bayern Munich"], ["Bundesliga"], "CM", 0, 0, 0, 4, 48, true),
        p("ft_chiesa", "Federico Chiesa", "Italy", ["Juventus", "Liverpool"], ["Serie A", "Premier League"], "RW", 28, 4, 2, 4, 12, false),
        p("ft_jorginho", "Jorginho", "Italy", ["Arsenal", "Chelsea", "Napoli"], ["Premier League", "Serie A"], "CM", 178, 8, 8, 4, 18, true),
        p("ft_tarkowski", "James Tarkowski", "England", ["Everton", "Burnley"], ["Premier League"], "CB", 248, 6, 3, 0, 4, false),
        p("ft_walker", "Kyle Walker", "England", ["Manchester City", "Tottenham"], ["Premier League"], "RB", 312, 8, 28, 2, 18, false),
        p("ft_zaha", "Wilfried Zaha", "Ivory Coast", ["Crystal Palace", "Manchester United"], ["Premier League"], "LW", 328, 68, 32, 0, 4, false),
        p("ft_aubameyang", "Pierre-Emerick Aubameyang", "Gabon", ["Arsenal", "Chelsea", "Barcelona"], ["Premier League", "La Liga"], "ST", 168, 68, 18, 12, 24, false),
        p("ft_vardy", "Jamie Vardy", "England", ["Leicester City"], ["Premier League"], "ST", 258, 123, 28, 4, 8, true),
        p("ft_fabregas", "Cesc Fàbregas", "Spain", ["Arsenal", "Chelsea", "Barcelona"], ["Premier League", "La Liga"], "CM", 248, 42, 68, 4, 18, false),
        p("ft_torres", "Fernando Torres", "Spain", ["Liverpool", "Chelsea", "Atletico Madrid"], ["Premier League", "La Liga"], "ST", 128, 38, 12, 14, 32, true),
        p("ft_cole", "Ashley Cole", "England", ["Arsenal", "Chelsea"], ["Premier League"], "LB", 508, 8, 42, 2, 22, true),
        p("ft_ashley_young", "Ashley Young", "England", ["Manchester United", "Aston Villa", "Everton"], ["Premier League"], "RB", 398, 28, 48, 2, 14, false),
        p("ft_coutinho", "Philippe Coutinho", "Brazil", ["Liverpool", "Barcelona", "Aston Villa"], ["Premier League", "La Liga"], "AM", 112, 24, 18, 8, 22, false),
        p("ft_william", "Willian", "Brazil", ["Chelsea", "Arsenal", "Tottenham"], ["Premier League"], "LW", 248, 42, 48, 4, 16, false),
        p("ft_firmino", "Roberto Firmino", "Brazil", ["Liverpool", "Hoffenheim"], ["Premier League", "Bundesliga"], "ST", 198, 68, 28, 12, 32, true),
        p("ft_mahrez", "Riyad Mahrez", "Algeria", ["Manchester City", "Leicester City"], ["Premier League"], "RW", 238, 78, 48, 8, 22, true),
        p("ft_silva", "Bernardo Silva", "Portugal", ["Manchester City"], ["Premier League"], "AM", 198, 42, 48, 4, 22, true),
    ]

    static func profile(for player: PlayerSearchResultDTO) -> PlayerProfile? {
        let key = normalized(player.name)
        return players.first { entry in
            entry.id == player.id
                || normalized(entry.name) == key
                || entry.aliases.contains(where: { normalized($0) == key })
        }
    }

    static func profile(named name: String) -> PlayerProfile? {
        let key = normalized(name)
        return players.first {
            normalized($0.name) == key || $0.aliases.contains(where: { normalized($0) == key })
        }
    }

    static func searchClubs(query: String) -> [String] {
        let q = normalized(query)
        guard q.count >= 2 else { return [] }
        return plClubs.filter { normalized($0).contains(q) }.prefix(PlayerSearchLimits.maxResults).map { $0 }
    }

    static func searchCountries(query: String) -> [String] {
        let q = normalized(query)
        guard q.count >= 2 else { return [] }
        return countries.filter { normalized($0).contains(q) }.prefix(PlayerSearchLimits.maxResults).map { $0 }
    }

    private static func p(
        _ id: String,
        _ name: String,
        _ nationality: String,
        _ clubs: [String],
        _ leagues: [String],
        _ position: String,
        _ plApps: Int,
        _ plGoals: Int,
        _ plAssists: Int,
        _ uclGoals: Int,
        _ uclApps: Int,
        _ uclWinner: Bool,
        _ aliases: [String] = []
    ) -> PlayerProfile {
        PlayerProfile(
            id: id, name: name, nationality: nationality, clubs: clubs, leagues: leagues,
            position: position, plApps: plApps, plGoals: plGoals, plAssists: plAssists,
            uclGoals: uclGoals, uclApps: uclApps, uclWinner: uclWinner, aliases: aliases
        )
    }

    static func normalized(_ value: String) -> String {
        value.lowercased()
            .folding(options: .diacriticInsensitive, locale: .current)
            .replacingOccurrences(of: "[^a-z0-9 ]", with: "", options: .regularExpression)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

enum FootballTowerValidator {
    static func validate(
        answerId: String,
        answerName: String,
        question: FootballTowerQuestion,
        usedIds: Set<String>,
        nationality: String? = nil,
        league: String? = nil,
        position: String? = nil
    ) -> Bool {
        guard !usedIds.contains(answerId) else { return false }

        switch question.answerType {
        case .club:
            return validateClub(answerName, rule: question.rule)
        case .country:
            return validateCountry(answerName, rule: question.rule)
        case .player:
            return validatePlayer(
                answerId: answerId,
                answerName: answerName,
                rule: question.rule,
                nationality: nationality,
                league: league,
                position: position
            )
        }
    }

    static func answerId(for name: String, type: FootballTowerAnswerType) -> String {
        switch type {
        case .club: return "club_\(FootballTowerCatalog.normalized(name))"
        case .country: return "country_\(FootballTowerCatalog.normalized(name))"
        case .player:
            if let profile = FootballTowerCatalog.profile(named: name) {
                return profile.id
            }
            return "player_\(FootballTowerCatalog.normalized(name))"
        }
    }

    private static func validateClub(_ name: String, rule: FootballTowerRule) -> Bool {
        guard rule == .plClub else { return false }
        return FootballTowerCatalog.plClubs.contains {
            FootballTowerCatalog.normalized($0) == FootballTowerCatalog.normalized(name)
        }
    }

    private static func validateCountry(_ name: String, rule: FootballTowerRule) -> Bool {
        guard rule == .country else { return false }
        return FootballTowerCatalog.countries.contains {
            FootballTowerCatalog.normalized($0) == FootballTowerCatalog.normalized(name)
        }
    }

    private static func validatePlayer(
        answerId: String,
        answerName: String,
        rule: FootballTowerRule,
        nationality: String?,
        league: String?,
        position: String?
    ) -> Bool {
        let profile = FootballTowerCatalog.profile(named: answerName)
            ?? FootballTowerCatalog.players.first { $0.id == answerId }

        switch rule {
        case .plPlayer:
            return hasPL(profile, answerName, league: league)
        case .nationality(let nation):
            return matchesNationality(profile, answerName, nation, dtoNationality: nationality)
        case .uclWinner:
            return profile?.uclWinner == true || inferUCLWinner(answerName)
        case .goalkeeper:
            return isGoalkeeper(profile, position)
        case .brazilianPL:
            return matchesNationality(profile, answerName, "Brazil", dtoNationality: nationality)
                && hasPL(profile, answerName, league: league)
        case .minPlApps(let min):
            return (profile?.plApps ?? fallbackPLApps(answerName, league: league)) >= min
        case .playedFor(let club):
            return playedFor(profile, answerName, club: club)
        case .uclScorer:
            return (profile?.uclGoals ?? 0) > 0
        case .spanishLaLiga:
            return matchesNationality(profile, answerName, "Spain", dtoNationality: nationality)
                && (profile?.leagues.contains("La Liga") == true || league?.localizedCaseInsensitiveContains("la liga") == true)
        case .frenchMinUclGoals(let min):
            return matchesNationality(profile, answerName, "France", dtoNationality: nationality)
                && (profile?.uclGoals ?? 0) >= min
        case .minPlAssists(let min):
            return (profile?.plAssists ?? 0) >= min
        case .gkMinPlApps(let min):
            return isGoalkeeper(profile, position) && (profile?.plApps ?? 0) >= min
        case .playedForBoth(let a, let b):
            return playedFor(profile, answerName, club: a) && playedFor(profile, answerName, club: b)
        case .italianPL:
            return matchesNationality(profile, answerName, "Italy", dtoNationality: nationality)
                && hasPL(profile, answerName, league: league)
        case .dutchMinPlApps(let min):
            return matchesNationality(profile, answerName, "Netherlands", dtoNationality: nationality)
                && (profile?.plApps ?? 0) >= min
        case .bayernMinUclGoals(let min):
            return playedFor(profile, answerName, club: "Bayern Munich") && (profile?.uclGoals ?? 0) >= min
        case .defenderMinPlApps(let min):
            return isDefender(profile, position) && (profile?.plApps ?? 0) >= min
        case .nonEuropeanMinUclApps(let min):
            guard let profile else { return false }
            return isNonEuropean(profile.nationality) && profile.uclApps >= min
        case .plClub, .country:
            return false
        }
    }

    private static func hasPL(
        _ profile: FootballTowerCatalog.PlayerProfile?,
        _ name: String,
        league: String?
    ) -> Bool {
        if let profile {
            return profile.leagues.contains("Premier League") || profile.plApps > 0
        }
        if league?.localizedCaseInsensitiveContains("premier") == true { return true }
        return fallbackPLApps(name, league: league) > 0
    }

    private static func matchesNationality(
        _ profile: FootballTowerCatalog.PlayerProfile?,
        _ name: String,
        _ nation: String,
        dtoNationality: String?
    ) -> Bool {
        let target = FootballTowerCatalog.normalized(nation)
        if let profile, FootballTowerCatalog.normalized(profile.nationality) == target { return true }
        if let dtoNationality, FootballTowerCatalog.normalized(dtoNationality) == target { return true }
        return false
    }

    private static func isGoalkeeper(_ profile: FootballTowerCatalog.PlayerProfile?, _ position: String?) -> Bool {
        if profile?.position.uppercased() == "GK" { return true }
        return position?.localizedCaseInsensitiveContains("goal") == true
            || position?.uppercased() == "GK"
    }

    private static func isDefender(_ profile: FootballTowerCatalog.PlayerProfile?, _ position: String?) -> Bool {
        if let pos = profile?.position.uppercased(), ["CB", "LB", "RB"].contains(pos) || pos.contains("B") {
            return true
        }
        let p = position?.uppercased() ?? ""
        return p.contains("DEF") || p == "CB" || p == "LB" || p == "RB"
    }

    private static func playedFor(
        _ profile: FootballTowerCatalog.PlayerProfile?,
        _ name: String,
        club: String
    ) -> Bool {
        guard let profile else { return false }
        let target = FootballTowerCatalog.normalized(club)
        return profile.clubs.contains { FootballTowerCatalog.normalized($0).contains(target) || target.contains(FootballTowerCatalog.normalized($0)) }
    }

    private static func isNonEuropean(_ nationality: String) -> Bool {
        !["England", "France", "Spain", "Germany", "Italy", "Portugal", "Netherlands", "Belgium",
          "Poland", "Croatia", "Denmark", "Sweden", "Norway", "Scotland", "Wales", "Serbia", "Ukraine"]
            .contains { FootballTowerCatalog.normalized($0) == FootballTowerCatalog.normalized(nationality) }
    }

    private static func inferUCLWinner(_ name: String) -> Bool {
        FootballTowerCatalog.profile(named: name)?.uclWinner == true
    }

    private static func fallbackPLApps(_ name: String, league: String?) -> Int {
        if league?.localizedCaseInsensitiveContains("premier") == true { return 50 }
        return FootballTowerCatalog.profile(named: name)?.plApps ?? 0
    }
}
