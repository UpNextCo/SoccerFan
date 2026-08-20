import SwiftUI

struct VsResultView: View {
    let challenge: VsChallengeDTO
    var isBusy: Bool = false
    var onPlayAgain: () -> Void
    var onBackToVs: () -> Void

    private var you: VsPlayerDTO? { challenge.players.first(where: \.isYou) }

    private var headline: String {
        switch challenge.result.winner {
        case "draw": return "IT'S A DRAW"
        case "you": return "YOU WIN"
        default: return "YOU LOSE"
        }
    }

    private var headlineColor: Color {
        headline == "YOU LOSE" ? BKTheme.wrong : BKTheme.accent
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 22) {
                    VStack(spacing: 8) {
                        Text(challenge.modeTitle.uppercased())
                            .font(BKFont.caption(11))
                            .tracking(1)
                            .foregroundStyle(BKTheme.textMuted)
                        Text(headline)
                            .font(BKFont.title(32))
                            .foregroundStyle(headlineColor)
                            .multilineTextAlignment(.center)
                        Text(challenge.title)
                            .font(BKFont.body(14))
                            .foregroundStyle(BKTheme.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 24)

                    if let series = seriesLine {
                        Text(series)
                            .font(BKFont.headline(16))
                            .foregroundStyle(BKTheme.textPrimary)
                            .multilineTextAlignment(.center)
                    }

                    rankedPlayers

                    Text(scoreNoun.uppercased())
                        .font(BKFont.caption(10))
                        .tracking(1)
                        .foregroundStyle(BKTheme.textMuted)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }

            VStack(spacing: 10) {
                Button(action: onPlayAgain) {
                    HStack {
                        if isBusy { ProgressView().tint(BKTheme.textPrimary) }
                        Text("PLAY AGAIN")
                            .font(BKFont.headline(16))
                    }
                    .foregroundStyle(BKTheme.textPrimary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(BKTheme.card)
                    .clipShape(Capsule())
                }
                .disabled(isBusy)
                .buttonStyle(.plain)

                GameResultExitBar(title: "BACK TO VS", showsBackground: false, action: onBackToVs)
                    .padding(.horizontal, -16)
                    .padding(.bottom, -16)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, BKTabBar.scrollClearance)
            .background(BKTheme.background)
        }
        .background(BKTheme.background.ignoresSafeArea())
    }

    private var seriesLine: String? {
        guard challenge.players.count == 2, let h2h = challenge.result.h2h else { return nil }
        let name = shortName(h2h.opponentName)
        var line = "YOU \(h2h.youWins) – \(h2h.theyWins) \(name)"
        if h2h.draws > 0 {
            line += h2h.draws == 1 ? "  ·  1 DRAW" : "  ·  \(h2h.draws) DRAWS"
        }
        return line
    }

    private var rankedPlayers: some View {
        VStack(spacing: 14) {
            ForEach(orderedRows, id: \.userId) { row in
                playerCard(row)
            }
        }
    }

    private var orderedRows: [VsRankingDTO] {
        if !challenge.result.rankings.isEmpty { return challenge.result.rankings }
        return challenge.players.map {
            VsRankingDTO(
                userId: $0.userId,
                displayName: $0.displayName,
                avatarUrl: $0.avatarUrl,
                score: $0.score ?? 0,
                displayScore: $0.displayScore ?? $0.score ?? 0
            )
        }
    }

    private func playerCard(_ row: VsRankingDTO) -> some View {
        let isWinner = challenge.result.winner != "draw" && row.userId == challenge.result.winnerUserId
        let player = challenge.players.first { $0.userId == row.userId }
        let isYou = player?.isYou == true || row.userId == you?.userId
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                resultAvatar(player: player, ranking: row, winner: isWinner)
                Text(isYou ? "YOU" : row.displayName.uppercased())
                    .font(BKFont.headline(15))
                    .foregroundStyle(isWinner ? BKTheme.accent : BKTheme.textPrimary)
                    .lineLimit(1)
                Spacer()
                if challenge.modeId == GameModeID.backYourself.rawValue,
                   let hotseat = challenge.hotseat?.players.first(where: { $0.userId == row.userId }),
                   !hotseat.alive {
                    Text("OUT")
                        .font(BKFont.headline(14))
                        .foregroundStyle(BKTheme.wrong)
                }
                Text("\(row.displayScore)")
                    .font(BKFont.title(24))
                    .foregroundStyle(isWinner || challenge.result.winner == "draw" ? BKTheme.accent : BKTheme.textPrimary)
            }
            breakdown(for: row.userId)
        }
        .padding(16)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(isWinner ? BKTheme.accent.opacity(0.45) : Color.clear, lineWidth: 1.5)
        )
    }

    @ViewBuilder
    private func breakdown(for userId: String) -> some View {
        switch challenge.modeId {
        case GameModeID.draftMaster.rawValue:
            draftBreakdown(userId)
        case GameModeID.backYourself.rawValue:
            hotseatBreakdown(userId)
        case GameModeID.targetMan.rawValue:
            targetManBreakdown(userId)
        case GameModeID.darts501.rawValue:
            dartsBreakdown(userId)
        default:
            EmptyView()
        }
    }

    @ViewBuilder
    private func draftBreakdown(_ userId: String) -> some View {
        let picks = (challenge.live?.picks ?? []).filter { $0.userId == userId }
        if !picks.isEmpty {
            VStack(spacing: 6) {
                ForEach(picks) { pick in
                    HStack(spacing: 8) {
                        PlayerAvatar(urlString: pick.headshotUrl, size: 26)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(pick.playerName)
                                .font(BKFont.body(13))
                                .foregroundStyle(pick.correct ? BKTheme.textPrimary : BKTheme.wrong)
                                .lineLimit(1)
                            if !pick.constraintLabel.isEmpty {
                                Text(pick.constraintLabel)
                                    .font(BKFont.caption(10))
                                    .foregroundStyle(BKTheme.textMuted)
                                    .lineLimit(1)
                            }
                        }
                        Spacer()
                        Text("\(pick.statValue)")
                            .font(BKFont.headline(13))
                            .foregroundStyle(pick.correct ? BKTheme.accent : BKTheme.wrong)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func hotseatBreakdown(_ userId: String) -> some View {
        let names = (challenge.hotseat?.named ?? []).filter { $0.userId == userId }
        if !names.isEmpty {
            VStack(spacing: 6) {
                ForEach(names) { row in
                    HStack(spacing: 8) {
                        PlayerAvatar(urlString: row.headshotUrl, size: 26)
                        Text(row.playerName)
                            .font(BKFont.body(13))
                            .foregroundStyle(BKTheme.textPrimary)
                            .lineLimit(1)
                        Spacer()
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func targetManBreakdown(_ userId: String) -> some View {
        let picks = (challenge.targetMan?.picks ?? [])
            .filter { $0.userId == userId }
            .sorted { $0.slotIndex < $1.slotIndex }
        let unit = challenge.targetMan?.unit
        if !picks.isEmpty {
            VStack(spacing: 6) {
                ForEach(picks) { pick in
                    HStack(spacing: 8) {
                        PlayerAvatar(urlString: pick.headshotUrl, size: 26)
                        Text(pick.playerName.isEmpty ? "Skipped" : pick.playerName)
                            .font(BKFont.body(13))
                            .foregroundStyle(BKTheme.textPrimary)
                            .lineLimit(1)
                        Spacer()
                        Text(formatTargetManValue(pick.statValue, unit: unit))
                            .font(BKFont.headline(13))
                            .foregroundStyle(BKTheme.accent)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func dartsBreakdown(_ userId: String) -> some View {
        if let board = challenge.darts501?.board.first(where: { $0.userId == userId }) {
            Text("\(board.remaining) LEFT")
                .font(BKFont.caption(11))
                .tracking(0.6)
                .foregroundStyle(BKTheme.textMuted)
        }
    }

    private func resultAvatar(player: VsPlayerDTO?, ranking: VsRankingDTO, winner: Bool) -> some View {
        Group {
            if player?.isYou == true, let image = LocalProfile.loadAvatar() {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                PlayerAvatar(urlString: player?.avatarUrl ?? ranking.avatarUrl, size: 40) {
                    BKTheme.cardElevated
                        .overlay {
                            Ph.userCircle.fill
                                .color(BKTheme.avatarPlaceholder)
                                .frame(width: 24, height: 24)
                        }
                }
            }
        }
        .frame(width: 40, height: 40)
        .clipShape(Circle())
        .overlay(Circle().stroke(winner ? BKTheme.accent : Color.clear, lineWidth: 2))
    }

    private var scoreNoun: String {
        switch challenge.modeId {
        case GameModeID.targetMan.rawValue: return challenge.categoryNoun
        case GameModeID.backYourself.rawValue: return "named"
        case GameModeID.darts501.rawValue: return "left"
        default: return challenge.categoryNoun
        }
    }

    private func formatTargetManValue(_ value: Int?, unit: String?) -> String {
        guard let value else { return "—" }
        if unit == "eur_m" { return "€\(value)m" }
        return "\(value)"
    }

    private func shortName(_ name: String) -> String {
        name.split(separator: " ").first.map { String($0).uppercased() } ?? name.uppercased()
    }
}
