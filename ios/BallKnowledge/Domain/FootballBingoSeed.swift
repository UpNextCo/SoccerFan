import Foundation

enum FootballBingoSeed {
    static func makeDailyGame(date: String) -> FootballBingoGame {
        var game = makeGame()
        game = FootballBingoGame(
            id: "football_bingo_\(date)",
            title: "Daily Football Bingo",
            categories: game.categories,
            playerQueue: seededShuffle(game.playerQueue, seed: stableSeed(date)),
            currentPlayerIndex: 0,
            completedCategoryIds: [],
            remainingPlayers: game.playerQueue.count,
            status: .active
        )
        return game
    }

    static func makeGame() -> FootballBingoGame {
        let categories = defaultCategories
        let queue = defaultPlayers.shuffled()
        return FootballBingoGame(
            id: "football_bingo_local",
            title: "Football Bingo",
            categories: categories,
            playerQueue: queue,
            currentPlayerIndex: 0,
            completedCategoryIds: [],
            remainingPlayers: queue.count,
            status: .active
        )
    }

    static let defaultCategories: [FootballBingoCategory] = [
        FootballBingoCategory(id: "brazil", title: "Brazil", type: .nationality, iconType: .flag, iconValue: "Brazil", matchingRule: "Brazil"),
        FootballBingoCategory(id: "england", title: "England", type: .nationality, iconType: .flag, iconValue: "England", matchingRule: "England"),
        FootballBingoCategory(id: "liverpool", title: "Played for Liverpool", type: .playedForClub, iconType: .clubBadge, iconValue: "Liverpool|Premier League", matchingRule: "Liverpool"),
        FootballBingoCategory(id: "barcelona", title: "Played for Barcelona", type: .playedForClub, iconType: .clubBadge, iconValue: "Barcelona|La Liga", matchingRule: "Barcelona"),
        FootballBingoCategory(id: "pl", title: "Premier League", type: .playedInLeague, iconType: .league, iconValue: "Premier League", matchingRule: "Premier League"),
        FootballBingoCategory(id: "laliga", title: "La Liga", type: .playedInLeague, iconType: .league, iconValue: "La Liga", matchingRule: "La Liga"),
        FootballBingoCategory(id: "seriea", title: "Serie A", type: .playedInLeague, iconType: .league, iconValue: "Serie A", matchingRule: "Serie A"),
        FootballBingoCategory(id: "bundesliga", title: "Bundesliga", type: .playedInLeague, iconType: .league, iconValue: "Bundesliga", matchingRule: "Bundesliga"),
        FootballBingoCategory(id: "ucl", title: "Champions League Winner", type: .wonCompetition, iconType: .trophy, iconValue: "Champions League", matchingRule: "Champions League"),
        FootballBingoCategory(id: "worldcup", title: "World Cup Winner", type: .wonCompetition, iconType: .trophy, iconValue: "World Cup", matchingRule: "World Cup"),
        FootballBingoCategory(id: "copa", title: "Copa América Winner", type: .wonCompetition, iconType: .trophy, iconValue: "Copa América", matchingRule: "Copa América"),
        FootballBingoCategory(id: "afcon", title: "AFCON Winner", type: .wonCompetition, iconType: .trophy, iconValue: "AFCON", matchingRule: "AFCON"),
        FootballBingoCategory(id: "messi", title: "Played with Messi", type: .playedWithPlayer, iconType: .custom, iconValue: "Messi", matchingRule: "Lionel Messi"),
        FootballBingoCategory(id: "ballondor", title: "Ballon d'Or Winner", type: .wonCompetition, iconType: .trophy, iconValue: "Ballon d'Or", matchingRule: "Ballon d'Or"),
        FootballBingoCategory(id: "pep", title: "Managed by Guardiola", type: .managedByManager, iconType: .custom, iconValue: "Pep Guardiola", matchingRule: "Pep Guardiola"),
        FootballBingoCategory(id: "pl100", title: "100+ PL Apps", type: .statThreshold, iconType: .custom, iconValue: "100+", matchingRule: "pl_apps>=100"),
    ]

    static let defaultPlayers: [FootballBingoPlayer] = [
        p("1", "Lionel Messi", "Argentina", ["Barcelona", "Paris Saint Germain", "Inter Miami"], ["La Liga", "Ligue 1", "MLS"], ["Champions League", "World Cup", "Copa América", "Ballon d'Or"], [], [], nil),
        p("2", "Cristiano Ronaldo", "Portugal", ["Manchester United", "Real Madrid", "Juventus", "Al Nassr"], ["Premier League", "La Liga", "Serie A", "Pro League"], ["Champions League", "Euro"], [], [], 236),
        p("3", "Mohamed Salah", "Egypt", ["Liverpool", "Chelsea", "Roma"], ["Premier League", "Serie A"], ["Champions League", "AFCON"], ["Lionel Messi"], ["Pep Guardiola"], 258),
        p("4", "Kevin De Bruyne", "Belgium", ["Manchester City", "Chelsea", "Wolfsburg"], ["Premier League", "Bundesliga"], ["Premier League", "Champions League"], ["Lionel Messi"], ["Pep Guardiola"], 278),
        p("5", "Virgil van Dijk", "Netherlands", ["Liverpool", "Southampton", "Celtic"], ["Premier League", "Scottish Premership"], ["Champions League", "Premier League"], [], [], 198),
        p("6", "Harry Kane", "England", ["Tottenham", "Bayern Munich"], ["Premier League", "Bundesliga"], [], [], [], 320),
        p("7", "Jude Bellingham", "England", ["Borussia Dortmund", "Real Madrid", "Birmingham City"], ["Bundesliga", "La Liga", "Championship"], ["Champions League"], [], [], 0),
        p("8", "Erling Haaland", "Norway", ["Manchester City", "Borussia Dortmund", "Red Bull Salzburg"], ["Premier League", "Bundesliga"], ["Champions League", "Premier League"], [], ["Pep Guardiola"], 98),
        p("9", "Neymar", "Brazil", ["Barcelona", "Paris Saint Germain", "Al Hilal", "Santos"], ["La Liga", "Ligue 1"], ["Champions League", "Copa América"], ["Lionel Messi"], [], 0),
        p("10", "Kylian Mbappé", "France", ["Monaco", "Paris Saint Germain", "Real Madrid"], ["Ligue 1", "La Liga"], ["World Cup"], ["Lionel Messi"], [], 0),
        p("11", "Robert Lewandowski", "Poland", ["Bayern Munich", "Barcelona", "Borussia Dortmund"], ["Bundesliga", "La Liga"], ["Champions League", "Bundesliga"], [], [], 0),
        p("12", "Luka Modrić", "Croatia", ["Real Madrid", "Tottenham", "Dinamo Zagreb"], ["La Liga", "Premier League"], ["Champions League", "La Liga"], ["Lionel Messi"], [], 0),
        p("13", "Sergio Ramos", "Spain", ["Real Madrid", "Paris Saint Germain", "Sevilla"], ["La Liga", "Ligue 1"], ["World Cup", "Champions League", "La Liga"], ["Lionel Messi"], [], 0),
        p("14", "Karim Benzema", "France", ["Real Madrid", "Lyon"], ["La Liga", "Ligue 1"], ["Champions League", "La Liga", "Ballon d'Or"], [], [], 0),
        p("15", "Sadio Mané", "Senegal", ["Liverpool", "Bayern Munich", "Southampton"], ["Premier League", "Bundesliga"], ["Champions League", "AFCON", "Premier League"], [], [], 196),
        p("16", "Bruno Fernandes", "Portugal", ["Manchester United", "Sporting CP"], ["Premier League", "Primeira Liga"], [], [], [], 178),
        p("17", "Phil Foden", "England", ["Manchester City"], ["Premier League"], ["Premier League", "Champions League"], ["Lionel Messi"], ["Pep Guardiola"], 142),
        p("18", "Rodri", "Spain", ["Manchester City", "Atletico Madrid", "Villarreal"], ["Premier League", "La Liga"], ["Premier League", "Champions League", "Euro"], [], ["Pep Guardiola"], 134),
        p("19", "Declan Rice", "England", ["Arsenal", "West Ham"], ["Premier League"], [], [], [], 178),
        p("20", "Bukayo Saka", "England", ["Arsenal"], ["Premier League"], [], [], [], 148),
        p("21", "Gabriel Jesus", "Brazil", ["Arsenal", "Manchester City"], ["Premier League"], ["Premier League", "Copa América"], [], ["Pep Guardiola"], 156),
        p("22", "Casemiro", "Brazil", ["Manchester United", "Real Madrid"], ["Premier League", "La Liga"], ["Champions League", "Copa América"], ["Lionel Messi"], [], 112),
        p("23", "Ederson", "Brazil", ["Manchester City", "Benfica"], ["Premier League", "Primeira Liga"], ["Premier League", "Champions League"], [], ["Pep Guardiola"], 156),
        p("24", "Alisson", "Brazil", ["Liverpool", "Roma"], ["Premier League", "Serie A"], ["Champions League", "Copa América", "Premier League"], [], [], 178),
        p("25", "Andrew Robertson", "Scotland", ["Liverpool", "Hull City"], ["Premier League", "Championship"], ["Champions League", "Premier League"], [], [], 198),
        p("26", "Trent Alexander-Arnold", "England", ["Liverpool"], ["Premier League"], ["Champions League", "Premier League"], [], [], 178),
        p("27", "Luis Suárez", "Uruguay", ["Barcelona", "Liverpool", "Atletico Madrid"], ["La Liga", "Premier League"], ["Champions League", "Copa América"], ["Lionel Messi"], [], 198),
        p("28", "Andres Iniesta", "Spain", ["Barcelona", "Vissel Kobe"], ["La Liga", "J1 League"], ["World Cup", "Champions League", "Euro"], ["Lionel Messi"], [], 0),
        p("29", "Xavi", "Spain", ["Barcelona"], ["La Liga"], ["World Cup", "Champions League", "Euro"], ["Lionel Messi"], [], 0),
        p("30", "Gerard Piqué", "Spain", ["Barcelona", "Manchester United"], ["La Liga", "Premier League"], ["World Cup", "Champions League", "Euro"], ["Lionel Messi"], [], 156),
        p("31", "Thiago Silva", "Brazil", ["Chelsea", "Paris Saint Germain", "AC Milan"], ["Premier League", "Ligue 1", "Serie A"], ["Champions League", "Copa América"], ["Lionel Messi"], [], 142),
        p("32", "Raphael Varane", "France", ["Real Madrid", "Manchester United"], ["La Liga", "Premier League"], ["World Cup", "Champions League"], [], [], 112),
        p("33", "Paul Pogba", "France", ["Manchester United", "Juventus"], ["Premier League", "Serie A"], ["World Cup", "Europa League"], [], [], 178),
        p("34", "Antoine Griezmann", "France", ["Atletico Madrid", "Barcelona"], ["La Liga"], ["World Cup", "Europa League"], ["Lionel Messi"], [], 0),
        p("35", "Son Heung-min", "South Korea", ["Tottenham", "Bayer Leverkusen"], ["Premier League", "Bundesliga"], [], [], [], 278),
        p("36", "James Milner", "England", ["Liverpool", "Manchester City", "Aston Villa"], ["Premier League"], ["Premier League", "Champions League"], [], ["Pep Guardiola"], 632),
        p("37", "Raheem Sterling", "England", ["Manchester City", "Chelsea", "Arsenal", "Liverpool"], ["Premier League"], ["Premier League", "Champions League"], ["Lionel Messi"], ["Pep Guardiola"], 378),
        p("38", "Bernardo Silva", "Portugal", ["Manchester City", "Monaco"], ["Premier League", "Ligue 1"], ["Premier League", "Champions League"], [], ["Pep Guardiola"], 198),
        p("39", "Ilkay Gündogan", "Germany", ["Manchester City", "Barcelona", "Borussia Dortmund"], ["Premier League", "La Liga", "Bundesliga"], ["Premier League", "Champions League"], ["Lionel Messi"], ["Pep Guardiola"], 278),
        p("40", "Riyad Mahrez", "Algeria", ["Manchester City", "Leicester City"], ["Premier League"], ["Premier League", "Champions League", "AFCON"], [], ["Pep Guardiola"], 238),
        p("41", "João Cancelo", "Portugal", ["Manchester City", "Barcelona", "Bayern Munich"], ["Premier League", "La Liga", "Bundesliga"], ["Premier League", "Champions League"], [], ["Pep Guardiola"], 142),
        p("42", "Kyle Walker", "England", ["Manchester City", "Tottenham"], ["Premier League"], ["Premier League", "Champions League"], [], ["Pep Guardiola"], 312),
        p("43", "John Stones", "England", ["Manchester City", "Everton"], ["Premier League"], ["Premier League", "Champions League"], [], ["Pep Guardiola"], 198),
        p("44", "Marcus Rashford", "England", ["Manchester United"], ["Premier League"], ["Europa League"], [], [], 178),
        p("45", "Martin Ødegaard", "Norway", ["Arsenal", "Real Madrid", "Real Sociedad"], ["Premier League", "La Liga"], [], [], [], 112),
    ]

    private static func p(
        _ id: String,
        _ name: String,
        _ nationality: String,
        _ clubs: [String],
        _ leagues: [String],
        _ trophies: [String],
        _ teammates: [String],
        _ managers: [String],
        _ plApps: Int?
    ) -> FootballBingoPlayer {
        FootballBingoPlayer(
            id: id,
            name: name,
            nationality: nationality,
            clubs: clubs,
            leagues: leagues,
            trophies: trophies,
            teammates: teammates,
            managers: managers,
            premierLeagueApps: plApps
        )
    }

    private static func stableSeed(_ date: String) -> Int {
        date.utf8.reduce(5381) { ($0 &* 33) &+ Int($1) }
    }

    private static func seededShuffle<T>(_ items: [T], seed: Int) -> [T] {
        var result = items
        var state = UInt64(bitPattern: Int64(seed))
        guard result.count > 1 else { return result }
        for index in stride(from: result.count - 1, through: 1, by: -1) {
            state = state &* 6364136223846793005 &+ 1
            let swapIndex = Int(state % UInt64(index + 1))
            result.swapAt(index, swapIndex)
        }
        return result
    }
}
