import SwiftUI

/// League crests via API-Football's public media CDN (same league IDs as player ingestion).
/// https://www.api-football.com/documentation-v3#tag/Leagues
enum LeagueBadgeResolver {
    private static let cdnBase = "https://media.api-sports.io/football/leagues"

    private static let leagueIds: [String: Int] = [
        "premier league": 39,
        "la liga": 140,
        "serie a": 135,
        "ligue 1": 61,
        "bundesliga": 78,
        "super lig": 203,
        "süper lig": 203,
        "eredivisie": 88,
        "primeira liga": 94,
        "liga portugal": 94,
        "scottish premiership": 179,
        "mls": 253,
        "major league soccer": 253,
        "pro league": 307,
        "saudi pro league": 307,
        "saudi professional league": 307,
        "championship": 40,
        "liga mx": 262,
        "brasileirao": 71,
        "serie b": 136,
        "2. bundesliga": 79,
    ]

    static func logoURL(league: String) -> URL? {
        guard let id = leagueIds[normalize(league)] else { return nil }
        return URL(string: "\(cdnBase)/\(id).png")
    }

    private static func normalize(_ value: String) -> String {
        value
            .folding(options: .diacriticInsensitive, locale: .current)
            .lowercased()
            .replacingOccurrences(of: "  ", with: " ")
            .trimmingCharacters(in: .whitespaces)
    }
}

struct LeagueBadgeImage<Fallback: View>: View {
    let league: String
    var size: CGFloat = 32
    @ViewBuilder var fallback: () -> Fallback

    @State private var loadFailed = false

    var body: some View {
        if !loadFailed, let url = LeagueBadgeResolver.logoURL(league: league) {
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
