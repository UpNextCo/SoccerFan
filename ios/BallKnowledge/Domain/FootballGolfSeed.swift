import Foundation

enum FootballGolfSeed {
    static func weeklyCourse() -> FootballGolfCourse {
        FootballGolfCourse(
            id: "pl_week_\(weekId())",
            title: "Premier League Week",
            theme: "Premier League Goalscorers & Keepers",
            weekId: weekId(),
            holes: holes
        )
    }

    static func mockLeaderboard(userScore: Int) -> [FootballGolfLeaderboardEntry] {
        var entries: [FootballGolfLeaderboardEntry] = [
            .init(id: "1", name: "Sam", score: -5, isUser: false),
            .init(id: "2", name: "Josh", score: -4, isUser: false),
            .init(id: "3", name: "Liam", score: -2, isUser: false),
            .init(id: "4", name: "Alex", score: 0, isUser: false),
            .init(id: "5", name: "Max", score: 1, isUser: false),
        ]

        entries.append(.init(id: "user", name: "YOU", score: userScore, isUser: true))
        return entries.sorted { $0.score < $1.score }
    }

    private static func weekId() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        let date = Date()
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let week = calendar.component(.weekOfYear, from: date)
        let year = calendar.component(.yearForWeekOfYear, from: date)
        return "\(year)-W\(week)"
    }

    private static func hole(
        _ number: Int,
        par: Int,
        question: String,
        type: FootballGolfAnswerType,
        answers: [String],
        aliases: [String: [String]] = [:]
    ) -> FootballGolfHole {
        FootballGolfHole(
            id: "hole_\(number)",
            holeNumber: number,
            par: par,
            question: question,
            answerType: type,
            correctAnswers: answers,
            aliases: aliases
        )
    }

    private static let holes: [FootballGolfHole] = [
        hole(
            1, par: 3,
            question: "Name 3 Premier League goalkeepers with 10+ clean sheets in 2023/24.",
            type: .player,
            answers: ["Alisson", "Ederson", "Andre Onana", "David Raya", "Emiliano Martinez"],
            aliases: [
                "Alisson": ["alisson becker"],
                "Ederson": ["ederson moraes"],
                "Andre Onana": ["onana"],
                "David Raya": ["raya"],
                "Emiliano Martinez": ["martinez", "emiliano martinez"],
            ]
        ),
        hole(
            2, par: 4,
            question: "Name 4 clubs that have won the Premier League since 2010.",
            type: .team,
            answers: ["Manchester City", "Chelsea", "Leicester City", "Liverpool", "Manchester United"],
            aliases: [
                "Manchester City": ["man city", "city"],
                "Chelsea": ["chelsea fc"],
                "Leicester City": ["leicester"],
                "Liverpool": ["lfc"],
                "Manchester United": ["man united", "man utd", "united"],
            ]
        ),
        hole(
            3, par: 5,
            question: "Name 5 countries that have won the FIFA World Cup.",
            type: .country,
            answers: ["Brazil", "Germany", "Argentina", "France", "Italy", "England", "Spain", "Uruguay"],
            aliases: [
                "Germany": ["west germany"],
                "Argentina": ["argentina"],
            ]
        ),
        hole(
            4, par: 4,
            question: "Name 4 players who have won the Premier League Golden Boot.",
            type: .player,
            answers: ["Mohamed Salah", "Harry Kane", "Sergio Aguero", "Thierry Henry", "Alan Shearer", "Erling Haaland"],
            aliases: [
                "Mohamed Salah": ["salah", "mo salah"],
                "Harry Kane": ["kane"],
                "Sergio Aguero": ["aguero", "kun aguero"],
                "Thierry Henry": ["henry"],
                "Alan Shearer": ["shearer"],
                "Erling Haaland": ["haaland"],
            ]
        ),
        hole(
            5, par: 3,
            question: "Name 3 managers who have won the Champions League with two different clubs.",
            type: .manager,
            answers: ["Jose Mourinho", "Carlo Ancelotti", "Pep Guardiola", "Zinedine Zidane"],
            aliases: [
                "Jose Mourinho": ["mourinho"],
                "Carlo Ancelotti": ["ancelotti"],
                "Pep Guardiola": ["guardiola", "pep"],
                "Zinedine Zidane": ["zidane"],
            ]
        ),
        hole(
            6, par: 5,
            question: "Name 5 Premier League stadiums with a capacity over 60,000.",
            type: .stadium,
            answers: ["Old Trafford", "Tottenham Hotspur Stadium", "London Stadium", "Emirates Stadium", "Etihad Stadium", "Anfield", "St James' Park"],
            aliases: [
                "Old Trafford": ["old trafford", "trafford"],
                "Tottenham Hotspur Stadium": ["tottenham hotspur stadium", "spurs stadium"],
                "London Stadium": ["london stadium", "olympic stadium"],
                "Emirates Stadium": ["emirates", "arsenal stadium"],
                "Etihad Stadium": ["etihad", "city of manchester stadium"],
                "Anfield": ["anfield"],
                "St James' Park": ["st james park", "st james' park"],
            ]
        ),
        hole(
            7, par: 4,
            question: "Name 4 Brazilian players who have played in the Premier League.",
            type: .player,
            answers: ["Gabriel Jesus", "Casemiro", "Alisson", "Roberto Firmino", "Willian", "Richarlison"],
            aliases: [
                "Gabriel Jesus": ["gabriel jesus", "jesus"],
                "Casemiro": ["casemiro"],
                "Alisson": ["alisson becker"],
                "Roberto Firmino": ["firmino"],
                "Willian": ["willian"],
                "Richarlison": ["richarlison"],
            ]
        ),
        hole(
            8, par: 3,
            question: "Name 3 teams that have won the Champions League in the last 5 seasons.",
            type: .team,
            answers: ["Real Madrid", "Manchester City", "Bayern Munich", "Chelsea", "Liverpool"],
            aliases: [
                "Real Madrid": ["real madrid", "madrid"],
                "Manchester City": ["man city", "city"],
                "Bayern Munich": ["bayern", "bayern munich"],
                "Chelsea": ["chelsea fc"],
                "Liverpool": ["lfc"],
            ]
        ),
        hole(
            9, par: 5,
            question: "Name 5 players who have scored 100+ Premier League goals.",
            type: .player,
            answers: ["Alan Shearer", "Harry Kane", "Wayne Rooney", "Andrew Cole", "Sergio Aguero", "Frank Lampard", "Thierry Henry", "Robbie Fowler"],
            aliases: [
                "Alan Shearer": ["shearer"],
                "Harry Kane": ["kane"],
                "Wayne Rooney": ["rooney"],
                "Andrew Cole": ["cole", "andy cole"],
                "Sergio Aguero": ["aguero"],
                "Frank Lampard": ["lampard"],
                "Thierry Henry": ["henry"],
                "Robbie Fowler": ["fowler"],
            ]
        ),
    ]
}
