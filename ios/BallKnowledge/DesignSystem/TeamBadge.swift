import SwiftUI

/// Team crests — API-Football media CDN first (free quota), football-logos repo as fallback.
enum TeamBadgeResolver {
    private static let apiSportsHost = "media.api-sports.io"
    private static let apiSportsPath = "/football/teams"

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
        "süper lig": "Türkiye - Süper Lig",
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

    static func cacheKey(club: String, league: String) -> String {
        "\(normalize(club))|\(normalize(league))"
    }

    static func apiSportsLogoURL(teamId: Int) -> URL? {
        URL(string: "https://\(apiSportsHost)\(apiSportsPath)/\(teamId).png")
    }

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
        let key = cacheKey(club: club, league: league)
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

    static func normalize(_ value: String) -> String {
        value
            .folding(options: .diacriticInsensitive, locale: .current)
            .lowercased()
            .replacingOccurrences(of: "  ", with: " ")
            .trimmingCharacters(in: .whitespaces)
    }
}

/// Resolves crest URLs via backend teams registry (same source as player search).
actor TeamLogoCache {
    static let shared = TeamLogoCache()

    private struct CachedLogo {
        let teamId: Int?
        let logoURL: URL?
    }

    private var cache: [String: CachedLogo] = [:]
    private var inFlight: [String: Task<CachedLogo, Never>] = [:]

    func lookup(club: String, league: String) async -> CachedLogo {
        let key = TeamBadgeResolver.cacheKey(club: club, league: league)
        if let cached = cache[key] { return cached }

        if let task = inFlight[key] {
            return await task.value
        }

        let task = Task {
            if let match = await APIClient.shared.teamLogo(club: club, league: league) {
                return CachedLogo(
                    teamId: match.teamId,
                    logoURL: URL(string: match.logoUrl)
                )
            }
            return CachedLogo(teamId: nil, logoURL: nil)
        }

        inFlight[key] = task
        let result = await task.value
        inFlight[key] = nil
        cache[key] = result
        return result
    }
}

struct TeamBadgeImage<Fallback: View>: View {
    let club: String
    let league: String
    var teamId: Int? = nil
    var logoURL: URL? = nil
    var size: CGFloat = 32
    @ViewBuilder var fallback: () -> Fallback

    @State private var loadFailed = false
    @State private var fetchedTeamId: Int?
    @State private var fetchedLogoURL: URL?

    private var resolvedTeamId: Int? {
        teamId ?? fetchedTeamId
    }

    private var resolvedURL: URL? {
        if let logoURL { return logoURL }
        if let fetchedLogoURL { return fetchedLogoURL }
        if let resolvedTeamId, let url = TeamBadgeResolver.apiSportsLogoURL(teamId: resolvedTeamId) {
            return url
        }
        return TeamBadgeResolver.logoURL(club: club, league: league)
    }

    private var shouldFetchFromAPI: Bool {
        logoURL == nil && teamId == nil && !club.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        Group {
            if !loadFailed, let url = resolvedURL {
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
        .task(id: TeamBadgeResolver.cacheKey(club: club, league: league)) {
            guard shouldFetchFromAPI else { return }
            let match = await TeamLogoCache.shared.lookup(club: club, league: league)
            fetchedTeamId = match.teamId
            fetchedLogoURL = match.logoURL
        }
    }
}

struct PlayerTeamBadge<Fallback: View>: View {
    let player: PlayerSearchResultDTO
    var size: CGFloat = 32
    @ViewBuilder var fallback: () -> Fallback

    var body: some View {
        TeamBadgeImage(
            club: player.club,
            league: player.league,
            teamId: player.teamId,
            logoURL: player.teamLogoUrl.flatMap(URL.init(string:)),
            size: size,
            fallback: fallback
        )
    }
}
