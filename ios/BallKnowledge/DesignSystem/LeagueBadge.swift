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
        "league one": 41,
        "league two": 42,
        "fa cup": 45,
        "efl cup": 48,
        "league cup": 48,
        "carabao cup": 48,
        "liga mx": 262,
        "brasileirao": 71,
        "serie b": 136,
        "2. bundesliga": 79,
    ]

    static func logoURL(league: String) -> URL? {
        guard let id = leagueIds[normalize(league)] else { return nil }
        return URL(string: "\(cdnBase)/\(id).png")
    }

    /// Logo fill inside the light backdrop circle — some CDN assets (Ligue 1) ship with heavy padding.
    static func backdropLogoFraction(for league: String) -> CGFloat {
        switch normalize(league) {
        case "ligue 1": return 0.74
        default: return 0.68
        }
    }

    /// Extra zoom on the bitmap itself when the PNG has large transparent margins.
    static func logoContentScale(for league: String) -> CGFloat {
        switch normalize(league) {
        case "ligue 1": return 1.68
        default: return 1.0
        }
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
    /// Soft light circle so dark crests (Premier League, Ligue 1, etc.) read on dark UI.
    var lightBackdrop: Bool = false
    @ViewBuilder var fallback: () -> Fallback

    @State private var loadFailed = false

    var body: some View {
        Group {
            if lightBackdrop {
                Circle()
                    .fill(Color(white: 0.93))
                    .frame(width: size, height: size)
                    .overlay {
                        badgeContent
                            .frame(
                                width: size * LeagueBadgeResolver.backdropLogoFraction(for: league),
                                height: size * LeagueBadgeResolver.backdropLogoFraction(for: league)
                            )
                            .clipShape(Circle())
                    }
            } else {
                badgeContent
                    .frame(width: size, height: size)
            }
        }
    }

    @ViewBuilder
    private var badgeContent: some View {
        if !loadFailed, let url = LeagueBadgeResolver.logoURL(league: league) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .interpolation(.high)
                        .scaledToFit()
                        .scaleEffect(LeagueBadgeResolver.logoContentScale(for: league))
                case .failure:
                    fallback()
                        .onAppear { loadFailed = true }
                case .empty:
                    ProgressView()
                        .scaleEffect(0.55)
                @unknown default:
                    fallback()
                }
            }
        } else {
            fallback()
        }
    }
}
