import SwiftUI

// MARK: - Results dropdown (sizes to content)

struct SearchResultsContainer<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            content()
        }
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - Standard player row

struct PlayerSearchResultRow: View {
    let player: PlayerSearchResultDTO
    var subtitle: String?
    var trailing: AnyView?

    var body: some View {
        HStack(spacing: 12) {
            PlayerAvatar(urlString: player.headshotUrl, size: 32) {
                PlayerTeamBadge(player: player, size: 28) {
                    Circle()
                        .fill(BKTheme.cardElevated)
                        .frame(width: 28, height: 28)
                        .overlay(
                            Text(GuessWhoDisplay.clubAbbrev(player.club))
                                .font(.system(size: 8, weight: .bold, design: .rounded))
                                .foregroundStyle(BKTheme.textMuted)
                        )
                }
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(player.name.uppercased())
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(BKTheme.textPrimary)
                Text(subtitle ?? "\(player.club) · \(player.league)")
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textMuted)
            }

            Spacer(minLength: 0)

            if let trailing {
                trailing
            } else {
                Ph.caretRight.bold
                    .color(BKTheme.textMuted)
                    .frame(width: 12, height: 12)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }
}

// MARK: - Generic text row (clubs, countries, tower)

struct SearchSuggestionRow: View {
    let title: String
    let subtitle: String

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title.uppercased())
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(BKTheme.textPrimary)
                Text(subtitle)
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textMuted)
            }
            Spacer(minLength: 0)
            Ph.caretRight.bold
                .color(BKTheme.textMuted)
                .frame(width: 12, height: 12)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }
}

// MARK: - Player results list

struct PlayerSearchResultsList: View {
    let players: [PlayerSearchResultDTO]
    var isDisabled: (PlayerSearchResultDTO) -> Bool = { _ in false }
    var subtitle: (PlayerSearchResultDTO) -> String = { "\($0.club) · \($0.league)" }
    var trailing: (PlayerSearchResultDTO) -> AnyView? = { _ in nil }
    var onSelect: (PlayerSearchResultDTO) -> Void

    var body: some View {
        SearchResultsContainer {
            ForEach(players) { player in
                Button {
                    onSelect(player)
                } label: {
                    PlayerSearchResultRow(
                        player: player,
                        subtitle: subtitle(player),
                        trailing: trailing(player)
                    )
                }
                .disabled(isDisabled(player))

                if player.id != players.last?.id {
                    Divider().background(BKTheme.cardElevated)
                }
            }
        }
    }
}
