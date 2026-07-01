import Foundation
import CoreGraphics

enum WorldCupXISeed {
    static func puzzle(for date: String? = nil) -> WorldCupXIPuzzle {
        let dateKey = date ?? todayUTC()
        let index = abs(stableHash("world_cup_xi_\(dateKey)")) % pool.count
        return pool[index]
    }

    private static let pool: [WorldCupXIPuzzle] = [
        argentina2014,
        france2018,
        spain2010,
        germany2014,
        italy2006,
        brazil2002,
    ]

    // MARK: - Argentina 2014 (4-2-3-1)

    private static let argentina2014 = make(
        id: "argentina_2014",
        country: "Argentina",
        year: 2014,
        formation: "4-2-3-1",
        manager: "Alejandro Sabella",
        captain: "Lionel Messi",
        hostNation: "Brazil",
        topScorerClue: "Lionel Messi scored 4 goals at this World Cup for Argentina.",
        slots: [
            slot("gk", "GK", 0.50, 0.88, "Sergio Romero", [
                "Argentina's No.1 at Brazil 2014",
                "Later played for Manchester United and Monaco",
            ]),
            slot("rb", "RB", 0.82, 0.72, "Pablo Zabaleta", [
                "Manchester City full-back in 2014",
                "Known for tireless overlapping runs",
            ]),
            slot("cb1", "CB", 0.62, 0.78, "Martín Demichelis", [
                "Centre-back who played for Manchester City",
                "Also featured for Bayern Munich and Málaga",
            ]),
            slot("cb2", "CB", 0.38, 0.78, "Ezequiel Garay", [
                "Benfica and Valencia defender in 2014",
                "Partnered Argentina's back line in Brazil",
            ]),
            slot("lb", "LB", 0.18, 0.72, "Marcos Rojo", [
                "Left-back who joined Manchester United after the tournament",
                "Scored in a World Cup knockout match for Argentina",
            ]),
            slot("dm1", "DM", 0.38, 0.58, "Javier Mascherano", [
                "Argentina's defensive midfield general",
                "Captained Barcelona and made 100+ caps for his country",
            ]),
            slot("dm2", "DM", 0.62, 0.58, "Fernando Gago", [
                "Deep-lying playmaker once at Real Madrid",
                "Linked with Boca Juniors and Roma",
            ]),
            slot("rw", "RW", 0.78, 0.42, "Ángel Di María", [
                "Scored in the 2014 World Cup final",
                "Real Madrid winger before moving to Manchester United",
            ]),
            slot("am", "AM", 0.50, 0.38, "Lionel Messi", [
                "Won the Golden Ball at this World Cup",
                "Four goals and a final appearance in Rio",
            ]),
            slot("lw", "LW", 0.22, 0.42, "Enzo Pérez", [
                "Benfica midfielder in Argentina's XI",
                "Box-to-box option in a narrow front three",
            ]),
            slot("st", "ST", 0.50, 0.18, "Gonzalo Higuaín", [
                "Napoli striker leading Argentina's line",
                "Missed a big chance in the 2014 final",
            ]),
        ]
    )

    // MARK: - France 2018 (4-2-3-1)

    private static let france2018 = make(
        id: "france_2018",
        country: "France",
        year: 2018,
        formation: "4-2-3-1",
        manager: "Didier Deschamps",
        captain: "Hugo Lloris",
        hostNation: "Russia",
        topScorerClue: "Antoine Griezmann and Kylian Mbappé each scored 4 goals for France.",
        slots: [
            slot("gk", "GK", 0.50, 0.88, "Hugo Lloris", [
                "Tottenham captain and France's keeper in Russia",
                "Lifted the trophy as captain in Moscow",
            ]),
            slot("rb", "RB", 0.82, 0.72, "Benjamin Pavard", [
                "Scored a famous volley vs Argentina",
                "Stuttgart and Bayern Munich defender",
            ]),
            slot("cb1", "CB", 0.62, 0.78, "Raphaël Varane", [
                "Real Madrid centre-back in 2018",
                "Key part of France's defensive spine",
            ]),
            slot("cb2", "CB", 0.38, 0.78, "Samuel Umtiti", [
                "Barcelona centre-back at Russia 2018",
                "Scored the winner vs Belgium in the semi-final",
            ]),
            slot("lb", "LB", 0.18, 0.72, "Lucas Hernandez", [
                "Atlético Madrid left-back in the winning XI",
                "Son of a 1998 World Cup winner",
            ]),
            slot("dm1", "DM", 0.38, 0.58, "N'Golo Kanté", [
                "Leicester and Chelsea midfield destroyer",
                "Engine room of France's title run",
            ]),
            slot("dm2", "DM", 0.62, 0.58, "Paul Pogba", [
                "Scored in the 2018 final",
                "Manchester United star and World Cup winner",
            ]),
            slot("rw", "RW", 0.78, 0.42, "Kylian Mbappé", [
                "Teenage sensation who scored in the final",
                "Won Young Player of the Tournament",
            ]),
            slot("am", "AM", 0.50, 0.38, "Antoine Griezmann", [
                "Atlético Madrid forward and penalty scorer in the final",
                "Finished among the tournament's top scorers",
            ]),
            slot("lw", "LW", 0.22, 0.42, "Blaise Matuidi", [
                "Juventus midfielder in France's starting XI",
                "Veteran energy in a young squad",
            ]),
            slot("st", "ST", 0.50, 0.18, "Olivier Giroud", [
                "Did not score but started every knockout game",
                "Chelsea and Arsenal striker leading the line",
            ]),
        ]
    )

    // MARK: - Spain 2010 (4-3-3)

    private static let spain2010 = make(
        id: "spain_2010",
        country: "Spain",
        year: 2010,
        formation: "4-3-3",
        manager: "Vicente del Bosque",
        captain: "Iker Casillas",
        hostNation: "South Africa",
        topScorerClue: "David Villa was Spain's top scorer with 5 goals.",
        slots: [
            slot("gk", "GK", 0.50, 0.88, "Iker Casillas", [
                "Real Madrid legend and Spain's captain",
                "Golden Glove winner in South Africa",
            ]),
            slot("rb", "RB", 0.82, 0.72, "Sergio Ramos", [
                "Real Madrid defender and future Spain captain",
                "Part of Spain's dominant era",
            ]),
            slot("cb1", "CB", 0.62, 0.78, "Gerard Piqué", [
                "Barcelona centre-back in 2010",
                "Partnered Spain's back line in Johannesburg",
            ]),
            slot("cb2", "CB", 0.38, 0.78, "Carles Puyol", [
                "Scored the winner vs Germany in the semi-final",
                "Barcelona and Spain defensive icon",
            ]),
            slot("lb", "LB", 0.18, 0.72, "Joan Capdevila", [
                "Villarreal left-back in the final XI",
                "Started every game at South Africa 2010",
            ]),
            slot("cm1", "CM", 0.30, 0.52, "Sergio Busquets", [
                "Barcelona pivot anchoring Spain's midfield",
                "Still a fixture of tiki-taka Spain",
            ]),
            slot("cm2", "CM", 0.50, 0.48, "Xavi", [
                "Barcelona maestro and pass master",
                "Player of the Tournament at this World Cup",
            ]),
            slot("cm3", "CM", 0.70, 0.52, "Xabi Alonso", [
                "Deep-lying midfielder at Liverpool then Real Madrid",
                "Key metronome in Spain's 2010 engine",
            ]),
            slot("rw", "RW", 0.78, 0.28, "Pedro", [
                "Barcelona winger in Spain's front three",
                "Pep Guardiola product in the winning squad",
            ]),
            slot("st", "ST", 0.50, 0.14, "David Villa", [
                "Spain's top scorer at the tournament",
                "Valencia and Barcelona striker",
            ]),
            slot("lw", "LW", 0.22, 0.28, "Andrés Iniesta", [
                "Scored the winning goal in the final",
                "Barcelona legend and World Cup hero",
            ]),
        ]
    )

    // MARK: - Germany 2014 (4-2-3-1)

    private static let germany2014 = make(
        id: "germany_2014",
        country: "Germany",
        year: 2014,
        formation: "4-2-3-1",
        manager: "Joachim Löw",
        captain: "Philipp Lahm",
        hostNation: "Brazil",
        topScorerClue: "Thomas Müller scored 5 goals for Germany, including a hat-trick vs Portugal.",
        slots: [
            slot("gk", "GK", 0.50, 0.88, "Manuel Neuer", [
                "Revolutionary sweeper-keeper for Germany",
                "Bayern Munich No.1 in Brazil",
            ]),
            slot("rb", "RB", 0.82, 0.72, "Philipp Lahm", [
                "Bayern Munich captain playing right-back",
                "Germany's captain at Brazil 2014",
            ]),
            slot("cb1", "CB", 0.62, 0.78, "Jerome Boateng", [
                "Bayern Munich centre-back in the winning XI",
                "Shut down Leo Messi in the final",
            ]),
            slot("cb2", "CB", 0.38, 0.78, "Mats Hummels", [
                "Borussia Dortmund defender in 2014",
                "Scored in the quarter-final vs France",
            ]),
            slot("lb", "LB", 0.18, 0.72, "Benedikt Höwedes", [
                "Schalke left-back started every game",
                "Unsung starter in Germany's run",
            ]),
            slot("dm1", "DM", 0.38, 0.58, "Bastian Schweinsteiger", [
                "Bayern Munich legend and midfield general",
                "Came on in the final to steady the ship",
            ]),
            slot("dm2", "DM", 0.62, 0.58, "Toni Kroos", [
                "Real Madrid-bound playmaker after the tournament",
                "Two goals in the famous 7-1 vs Brazil",
            ]),
            slot("rw", "RW", 0.78, 0.42, "Thomas Müller", [
                "Hat-trick vs Portugal in the group stage",
                "Bayern Munich's Raumdeuter",
            ]),
            slot("am", "AM", 0.50, 0.38, "Mesut Özil", [
                "Arsenal playmaker in Germany's attack",
                "Assist machine behind the striker",
            ]),
            slot("lw", "LW", 0.22, 0.42, "Mario Götze", [
                "Scored the winning goal in the final",
                "Borussia Dortmund forward turned super sub hero",
            ]),
            slot("st", "ST", 0.50, 0.18, "Miroslav Klose", [
                "Broke the World Cup goals record in Brazil",
                "Germany's all-time leading scorer",
            ]),
        ]
    )

    // MARK: - Italy 2006 (4-4-2 diamond)

    private static let italy2006 = make(
        id: "italy_2006",
        country: "Italy",
        year: 2006,
        formation: "4-3-1-2",
        manager: "Marcello Lippi",
        captain: "Fabio Cannavaro",
        hostNation: "Germany",
        topScorerClue: "Luca Toni and Alessandro Del Piero each scored 2 goals for Italy.",
        slots: [
            slot("gk", "GK", 0.50, 0.88, "Gianluigi Buffon", [
                "Juventus legend and Italy's No.1",
                "Only conceded 2 goals (1 own goal) all tournament",
            ]),
            slot("cb1", "CB", 0.62, 0.78, "Fabio Cannavaro", [
                "Won the Ballon d'Or after this World Cup",
                "Italy's captain and defensive leader",
            ]),
            slot("cb2", "CB", 0.38, 0.78, "Marco Materazzi", [
                "Scored in the 2006 final",
                "Infamous Zidane headbutt incident involved him",
            ]),
            slot("lb", "LB", 0.18, 0.72, "Fabio Grosso", [
                "Scored the winning penalty in the final",
                "Left-back hero of Italy's 2006 run",
            ]),
            slot("rb", "RB", 0.82, 0.72, "Gianluca Zambrotta", [
                "Juventus full-back on both flanks in 2006",
                "Started every game at Germany 2006",
            ]),
            slot("dm", "DM", 0.50, 0.58, "Andrea Pirlo", [
                "Free-kick maestro and deep playmaker",
                "Juventus and AC Milan icon",
            ]),
            slot("cm1", "CM", 0.30, 0.48, "Gennaro Gattuso", [
                "AC Milan midfield enforcer",
                "Shut down France's midfield in the final",
            ]),
            slot("cm2", "CM", 0.70, 0.48, "Mauro Camoranesi", [
                "Juventus winger on the right of midfield",
                "Argentina-born Italy international",
            ]),
            slot("am", "AM", 0.50, 0.32, "Francesco Totti", [
                "Roma legend and 2006 World Cup winner",
                "Creative No.10 behind the strikers",
            ]),
            slot("st1", "ST", 0.38, 0.16, "Luca Toni", [
                "Fiorentina striker in Italy's front two",
                "Physical target man in Germany",
            ]),
            slot("st2", "ST", 0.62, 0.16, "Alessandro Del Piero", [
                "Juventus icon and super sub turned starter",
                "Scored in the semi-final vs Germany",
            ]),
        ]
    )

    // MARK: - Brazil 2002 (3-4-1-2)

    private static let brazil2002 = make(
        id: "brazil_2002",
        country: "Brazil",
        year: 2002,
        formation: "3-4-1-2",
        manager: "Luiz Felipe Scolari",
        captain: "Cafu",
        hostNation: "South Korea & Japan",
        topScorerClue: "Ronaldo scored 8 goals to win the Golden Boot.",
        slots: [
            slot("gk", "GK", 0.50, 0.88, "Marcos", [
                "Palmeiras goalkeeper and Brazil's No.1 in 2002",
                "Clean sheets in the knockout stages",
            ]),
            slot("cb1", "CB", 0.30, 0.76, "Lúcio", [
                "Bayer Leverkusen centre-back in the winning XI",
                "Towering presence at the back",
            ]),
            slot("cb2", "CB", 0.50, 0.80, "Roque Júnior", [
                "AC Milan defender in Brazil's back three",
                "Part of the 2002 title defence",
            ]),
            slot("cb3", "CB", 0.70, 0.76, "Edmílson", [
                "Lyon centre-back completing Brazil's trio",
                "Less heralded but started every game",
            ]),
            slot("rm", "RM", 0.88, 0.52, "Cafu", [
                "Brazil captain and overlapping right wing-back",
                "Only player in three consecutive World Cup finals (1994–2002)",
            ]),
            slot("cm1", "CM", 0.38, 0.54, "Gilberto Silva", [
                "Arsenal-bound defensive midfielder",
                "Shield for Brazil's attacking stars",
            ]),
            slot("cm2", "CM", 0.62, 0.54, "Kléberson", [
                "Palmeiras midfielder before joining Manchester United",
                "Breakout star of Korea/Japan 2002",
            ]),
            slot("lm", "LM", 0.12, 0.52, "Roberto Carlos", [
                "Real Madrid left wing-back with a thunderous shot",
                "Famous free-kick vs China in the group stage",
            ]),
            slot("am", "AM", 0.50, 0.36, "Ronaldinho", [
                "Free-kick vs England in the quarter-finals",
                "Barcelona-bound magician in the No.10 role",
            ]),
            slot("st1", "ST", 0.38, 0.16, "Ronaldo", [
                "Golden Boot winner with 8 goals",
                "Two goals in the final vs Germany",
            ]),
            slot("st2", "ST", 0.62, 0.16, "Rivaldo", [
                "Barcelona star and 1999 Ballon d'Or winner",
                "Overhead kick vs Belgium in the round of 16",
            ]),
        ]
    )

    private static func todayUTC() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        return String(formatter.string(from: Date()).prefix(10))
    }

    private static func stableHash(_ value: String) -> Int {
        var hash = 5381
        for char in value.utf8 {
            hash = ((hash << 5) &+ hash) &+ Int(char)
        }
        return hash
    }

    /// Adapts the legacy single-tournament seed data onto the current "name the XI" model.
    /// (Offline/practice fallback only; the live game uses the server-generated cross-tournament XI.)
    private static func make(
        id: String, country: String, year: Int, formation: String, manager: String,
        captain: String, hostNation: String, topScorerClue: String, slots: [WorldCupXISlot]
    ) -> WorldCupXIPuzzle {
        // Stamp the tournament year onto each slot so the offline fallback shows the same
        // "{year} World Cup" header as the live game. (Club is left nil — these legacy seed clues
        // already carry their club hints inline, and the side here is a nation, not a club.)
        let stamped = slots.map {
            WorldCupXISlot(
                id: $0.id, label: $0.label, pitchPoint: $0.pitchPoint,
                expectedName: $0.expectedName, clues: $0.clues,
                year: year, club: nil, clubBadgeUrl: nil, nation: country
            )
        }
        return WorldCupXIPuzzle(id: id, title: "\(country) \(year)", formation: formation, slots: stamped)
    }

    private static func slot(
        _ id: String,
        _ label: String,
        _ x: CGFloat,
        _ y: CGFloat,
        _ expectedName: String,
        _ clues: [String]
    ) -> WorldCupXISlot {
        WorldCupXISlot(
            id: id,
            label: label,
            pitchPoint: CGPoint(x: x, y: y),
            expectedName: expectedName,
            clues: clues
        )
    }
}
