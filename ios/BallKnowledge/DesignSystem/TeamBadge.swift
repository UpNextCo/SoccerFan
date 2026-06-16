import SwiftUI

/// Team crests from the open-source football-logos repo (top 25 European leagues).
/// https://github.com/luukhopman/football-logos
enum TeamBadgeResolver {
    private static let cdnHost = "cdn.jsdelivr.net"
    private static let cdnPath = "/gh/luukhopman/football-logos@master/logos"

    private struct Entry {
        let leagueFolder: String
        let fileName: String
    }

    private static let leagueFolders: [String: String] = [
        "premier league": "England - Premier League",
        "la liga": "Spain - LaLiga",
        "serie a": "Italy - Serie A",
        "ligue 1": "France - Ligue 1",
        "bundesliga": "Germany - Bundesliga",
        "super lig": "Türkiye - Süper Lig",
        "eredivisie": "Netherlands - Eredivisie",
        "primeira liga": "Portugal - Liga Portugal",
        "liga portugal": "Portugal - Liga Portugal",
        "scottish premiership": "Scotland - Scottish Premiership",
    ]

    /// club|league (normalized) → logo file
    private static let logos: [String: Entry] = [
        "manchester city|premier league": Entry(leagueFolder: "England - Premier League", fileName: "Manchester City.png"),
        "manchester united|premier league": Entry(leagueFolder: "England - Premier League", fileName: "Manchester United.png"),
        "liverpool|premier league": Entry(leagueFolder: "England - Premier League", fileName: "Liverpool FC.png"),
        "arsenal|premier league": Entry(leagueFolder: "England - Premier League", fileName: "Arsenal FC.png"),
        "tottenham|premier league": Entry(leagueFolder: "England - Premier League", fileName: "Tottenham Hotspur.png"),
        "tottenham hotspur|premier league": Entry(leagueFolder: "England - Premier League", fileName: "Tottenham Hotspur.png"),
        "chelsea|premier league": Entry(leagueFolder: "England - Premier League", fileName: "Chelsea FC.png"),
        "real madrid|la liga": Entry(leagueFolder: "Spain - LaLiga", fileName: "Real Madrid.png"),
        "barcelona|la liga": Entry(leagueFolder: "Spain - LaLiga", fileName: "FC Barcelona.png"),
        "atletico madrid|la liga": Entry(leagueFolder: "Spain - LaLiga", fileName: "Atlético de Madrid.png"),
        "bayern munich|bundesliga": Entry(leagueFolder: "Germany - Bundesliga", fileName: "Bayern Munich.png"),
        "ac milan|serie a": Entry(leagueFolder: "Italy - Serie A", fileName: "AC Milan.png"),
        "inter|serie a": Entry(leagueFolder: "Italy - Serie A", fileName: "Inter Milan.png"),
        "inter milan|serie a": Entry(leagueFolder: "Italy - Serie A", fileName: "Inter Milan.png"),
        "juventus|serie a": Entry(leagueFolder: "Italy - Serie A", fileName: "Juventus FC.png"),
        "paris saint germain|ligue 1": Entry(leagueFolder: "France - Ligue 1", fileName: "Paris Saint-Germain.png"),
        "paris saint-germain|ligue 1": Entry(leagueFolder: "France - Ligue 1", fileName: "Paris Saint-Germain.png"),
        "galatasaray|super lig": Entry(leagueFolder: "Türkiye - Süper Lig", fileName: "Galatasaray.png"),
    ]

    static func logoURL(club: String, league: String) -> URL? {
        guard let entry = resolve(club: club, league: league) else { return nil }
        return buildCDNURL(leagueFolder: entry.leagueFolder, fileName: entry.fileName)
    }

    private static func buildCDNURL(leagueFolder: String, fileName: String) -> URL? {
        let segments = [cdnPath, leagueFolder, fileName]
        let encodedPath = segments
            .map { $0.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? $0 }
            .joined(separator: "/")
        return URL(string: "https://\(cdnHost)\(encodedPath)")
    }

    private static func resolve(club: String, league: String) -> Entry? {
        let key = "\(normalize(club))|\(normalize(league))"
        if let entry = logos[key] { return entry }

        guard let folder = leagueFolders[normalize(league)] else { return nil }
        let candidates = filenameCandidates(for: club)
        return candidates.first.map { Entry(leagueFolder: folder, fileName: $0) }
    }

    private static func filenameCandidates(for club: String) -> [String] {
        let trimmed = club.trimmingCharacters(in: .whitespaces)
        return [
            "\(trimmed).png",
            "\(trimmed) FC.png",
            "FC \(trimmed).png",
        ]
    }

    private static func normalize(_ value: String) -> String {
        value
            .folding(options: .diacriticInsensitive, locale: .current)
            .lowercased()
            .replacingOccurrences(of: "  ", with: " ")
            .trimmingCharacters(in: .whitespaces)
    }
}

struct TeamBadgeImage<Fallback: View>: View {
    let club: String
    let league: String
    var size: CGFloat = 32
    @ViewBuilder var fallback: () -> Fallback

    @State private var loadFailed = false

    var body: some View {
        if !loadFailed, let url = TeamBadgeResolver.logoURL(club: club, league: league) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .interpolation(.high)
                        .scaledToFit()
                        .frame(width: size, height: size)
                case .failure:
                    fallback()
                        .onAppear { loadFailed = true }
                case .empty:
                    ProgressView()
                        .scaleEffect(0.55)
                        .frame(width: size, height: size)
                @unknown default:
                    fallback()
                }
            }
        } else {
            fallback()
        }
    }
}
