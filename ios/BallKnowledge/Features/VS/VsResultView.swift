import SwiftUI
import UIKit

struct VsResultView: View {
    let challenge: VsChallengeDTO
    var isBusy: Bool = false
    var showsPlayAgain: Bool = true
    var playsOutcomeEffects: Bool = true
    var onPlayAgain: () -> Void
    var onBackToVs: () -> Void

    @State private var confettiToken = 0
    @State private var loseWash = 0.0

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

    private var darts501Category: Darts501CategoryDisplay? {
        guard challenge.modeId == GameModeID.darts501.rawValue else { return nil }
        if let dto = challenge.puzzle.decode(Darts501PuzzleDTO.self),
           let puzzle = DailyChallengeResolver.darts501Puzzle(from: dto) {
            return puzzle.category
        }
        guard let live = challenge.darts501 else { return nil }
        return Darts501CategoryDisplay(
            nationality: live.nationality,
            leagueName: live.leagueName,
            leagueId: live.leagueId,
            club: live.club,
            clubLeague: live.clubLeague,
            teamId: live.teamId,
            audience: live.audience,
            formula: live.formulaDetail.isEmpty ? live.formulaLabel : live.formulaDetail
        )
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            BKTheme.background.ignoresSafeArea()
            heroBackground
            BKTheme.wrong
                .opacity(loseWash)
                .ignoresSafeArea()
                .allowsHitTesting(false)

            VStack(spacing: 0) {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 0) {
                        VStack(spacing: 22) {
                            Text(challenge.modeTitle.uppercased())
                                .font(BKFont.headline(14))
                                .tracking(1.2)
                                .foregroundStyle(BKTheme.textMuted)
                                .multilineTextAlignment(.center)
                            Text(headline)
                                .font(BKFont.title(32))
                                .foregroundStyle(headlineColor)
                                .multilineTextAlignment(.center)
                            if let category = darts501Category {
                                Darts501CategoryCard(category: category, boxed: false)
                                    .frame(maxWidth: 280)
                            } else {
                                if let category = challenge.backYourselfPuzzle?.category {
                                    BackYourselfCategoryArt(category: category, size: 48)
                                }
                                Text(challenge.title)
                                    .font(BKFont.headline(19))
                                    .foregroundStyle(BKTheme.textSecondary)
                                    .multilineTextAlignment(.center)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .frame(maxWidth: 220)
                            }
                        }
                        .padding(.top, 28)
                        .padding(.bottom, 44)

                        rankedPlayers
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                }

                VStack(spacing: 11) {
                    if showsPlayAgain {
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
                    }

                    Button(action: onBackToVs) {
                        Text("BACK TO VS")
                            .font(BKFont.headline(16))
                            .foregroundStyle(BKTheme.background)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(BKTheme.accent)
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 2)
            }

            FootballConfettiView(burstToken: confettiToken)
        }
        .task { await playOutcomeEffects() }
    }

    @MainActor
    private func playOutcomeEffects() async {
        guard playsOutcomeEffects else { return }
        switch challenge.result.winner {
        case "you":
            confettiToken += 1
        case "draw":
            break
        default:
            await runLoseFlash()
        }
    }

    @MainActor
    private func runLoseFlash() async {
        withAnimation(.easeInOut(duration: 0.7)) { loseWash = 0.20 }
        try? await Task.sleep(for: .seconds(0.7))
        withAnimation(.easeInOut(duration: 0.85)) { loseWash = 0.05 }
        try? await Task.sleep(for: .seconds(0.55))
        withAnimation(.easeInOut(duration: 0.7)) { loseWash = 0.14 }
        try? await Task.sleep(for: .seconds(0.65))
        withAnimation(.easeInOut(duration: 1.1)) { loseWash = 0 }
    }

    private var heroImage: UIImage? {
        guard let url = GameModeTileArt.bundleImageURL(for: challenge.modeId) else { return nil }
        return UIImage(contentsOfFile: url.path)
    }

    private var heroBackground: some View {
        GeometryReader { geo in
            let heroHeight = max(geo.size.width * 1.02, geo.size.height * 0.46)
            let fadeHeight = min(170, heroHeight * 0.40)
            ZStack(alignment: .top) {
                if let heroImage {
                    Image(uiImage: heroImage)
                        .resizable()
                        .scaledToFill()
                        .frame(width: geo.size.width, height: heroHeight)
                        .clipped()
                        .opacity(0.16)
                        .mask(
                            VStack(spacing: 0) {
                                Color.white
                                LinearGradient(
                                    stops: [
                                        .init(color: .white, location: 0),
                                        .init(color: .white.opacity(0.3), location: 0.45),
                                        .init(color: .clear, location: 1),
                                    ],
                                    startPoint: .top,
                                    endPoint: .bottom
                                )
                                .frame(height: fadeHeight)
                            }
                        )
                        .overlay(alignment: .bottom) {
                            LinearGradient(
                                stops: [
                                    .init(color: .clear, location: 0),
                                    .init(color: BKTheme.background.opacity(0.5), location: 0.4),
                                    .init(color: BKTheme.background, location: 1),
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                            .frame(height: fadeHeight)
                        }
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
        }
        .ignoresSafeArea(edges: .top)
        .allowsHitTesting(false)
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
        let isOut = challenge.modeId == GameModeID.backYourself.rawValue
            && challenge.hotseat?.players.first(where: { $0.userId == row.userId })?.alive == false
        return VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 12) {
                resultAvatar(player: player, ranking: row, winner: isWinner)
                VStack(alignment: .leading, spacing: 3) {
                    Text(isYou ? "YOU" : row.displayName.uppercased())
                        .font(BKFont.headline(15))
                        .foregroundStyle(isWinner ? BKTheme.accent : BKTheme.textPrimary)
                        .lineLimit(1)
                    if isOut {
                        Text("OUT")
                            .font(BKFont.caption(9))
                            .tracking(0.8)
                            .foregroundStyle(BKTheme.wrong)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 3) {
                    Text("\(row.displayScore)")
                        .font(BKFont.title(24))
                        .foregroundStyle(isWinner || challenge.result.winner == "draw" ? BKTheme.accent : BKTheme.textPrimary)
                    Text(scoreNoun)
                        .font(BKFont.caption(9))
                        .tracking(0.7)
                        .foregroundStyle(BKTheme.textMuted)
                        .multilineTextAlignment(.trailing)
                }
            }
            breakdown(for: row.userId)
                .padding(.leading, 10)
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
        EmptyView()
    }

    private func resultAvatar(player: VsPlayerDTO?, ranking: VsRankingDTO, winner: Bool) -> some View {
        UserAvatar(
            urlString: player?.avatarUrl ?? ranking.avatarUrl,
            usesLocalYou: player?.isYou == true,
            size: 40
        )
        .overlay(Circle().stroke(winner ? BKTheme.accent : Color.clear, lineWidth: 2))
    }

    private var scoreNoun: String {
        switch challenge.modeId {
        case GameModeID.backYourself.rawValue:
            return "PLAYERS NAMED"
        case GameModeID.darts501.rawValue:
            return "LEFT"
        case GameModeID.targetMan.rawValue:
            return expandedScoreNoun(challenge.categoryNoun)
        default:
            return expandedScoreNoun(challenge.categoryNoun)
        }
    }

    private func expandedScoreNoun(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "PTS" }
        let expanded = trimmed
            .replacingOccurrences(of: "apps", with: "appearances", options: .caseInsensitive)
            .replacingOccurrences(of: "pens", with: "penalties", options: .caseInsensitive)
            .replacingOccurrences(of: "pts", with: "points", options: .caseInsensitive)
        return expanded.uppercased()
    }

    private func formatTargetManValue(_ value: Int?, unit: String?) -> String {
        guard let value else { return "—" }
        if unit == "eur_m" { return "€\(value)m" }
        return "\(value)"
    }

}
