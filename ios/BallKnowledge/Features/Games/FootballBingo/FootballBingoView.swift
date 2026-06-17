import SwiftUI

// MARK: - ViewModel

@MainActor
@Observable
final class FootballBingoViewModel {
    var game: FootballBingoGame
    var shakeCategoryId: String?
    var popCategoryId: String?
    var playerPanelToken = UUID()
    var confettiBurstToken = 0
    var showResult = false

    init(game: FootballBingoGame = FootballBingoSeed.makeGame()) {
        self.game = game
    }

    var xpEarned: Int {
        guard game.status == .won else { return 0 }
        return 50 + game.remainingPlayers * 3
    }

    func restart() {
        game = FootballBingoSeed.makeGame()
        shakeCategoryId = nil
        popCategoryId = nil
        playerPanelToken = UUID()
        confettiBurstToken = 0
        showResult = false
    }

    func skip() {
        guard game.isActive else { return }
        HapticManager.light()
        advance(by: 1)
    }

    func tapCategory(_ category: FootballBingoCategory) {
        guard game.isActive else { return }
        guard !game.completedCategoryIds.contains(category.id) else { return }
        guard let player = game.currentPlayer else {
            game.status = .lost
            presentResultIfNeeded()
            return
        }

        if FootballBingoMatcher.matches(player: player, category: category) {
            HapticManager.success()
            game.markCompleted(categoryId: category.id)
            popCategoryId = category.id
            advance(by: 1)

            if game.status == .won {
                confettiBurstToken += 1
            }
        } else {
            HapticManager.error()
            shakeCategoryId = category.id
            advance(by: 2)
        }

        playerPanelToken = UUID()
        presentResultIfNeeded()

        Task {
            try? await Task.sleep(for: .seconds(FootballBingoTiming.tileShake))
            if shakeCategoryId == category.id {
                shakeCategoryId = nil
            }
        }
    }

    private func advance(by steps: Int) {
        game.advance(by: steps)
    }

    private func presentResultIfNeeded() {
        guard game.status != .active else { return }
        Task {
            try? await Task.sleep(for: .seconds(FootballBingoTiming.resultDelay))
            showResult = true
        }
    }
}

// MARK: - Main View

struct FootballBingoView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var viewModel = FootballBingoViewModel()
    var onComplete: () -> Void

    var body: some View {
        ZStack {
            NavigationStack {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 20) {
                        FootballBingoPlayerPanel(
                            player: viewModel.game.currentPlayer,
                            remaining: viewModel.game.remainingPlayers,
                            onSkip: { viewModel.skip() },
                            isActive: viewModel.game.isActive
                        )
                        .id(viewModel.playerPanelToken)
                        .transition(.asymmetric(
                            insertion: .move(edge: .trailing).combined(with: .opacity),
                            removal: .move(edge: .leading).combined(with: .opacity)
                        ))

                        FootballBingoBoardView(
                            categories: viewModel.game.categories,
                            completedIds: viewModel.game.completedCategoryIds,
                            shakeId: viewModel.shakeCategoryId,
                            popId: viewModel.popCategoryId,
                            isEnabled: viewModel.game.isActive,
                            onTap: { viewModel.tapCategory($0) }
                        )
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .padding(.bottom, 24)
                }
                .background(BKTheme.background)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { dismiss() } label: {
                            Ph.x.bold
                                .color(BKTheme.textPrimary)
                                .frame(width: 15, height: 15)
                        }
                    }
                    ToolbarItem(placement: .principal) {
                        Text("FOOTBALL BINGO")
                            .font(BKFont.caption(13))
                            .tracking(1)
                            .foregroundStyle(BKTheme.accent)
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {} label: {
                            Ph.sealQuestion.fill
                                .color(BKTheme.textMuted)
                                .frame(width: 16, height: 16)
                        }
                        .disabled(true)
                        .opacity(0.35)
                    }
                }
            }

            FootballConfettiView(burstToken: viewModel.confettiBurstToken)
                .zIndex(999)
        }
        .animation(.spring(response: FootballBingoTiming.playerSlide, dampingFraction: 0.82), value: viewModel.playerPanelToken)
        .fullScreenCover(isPresented: $viewModel.showResult) {
            FootballBingoResultView(
                won: viewModel.game.status == .won,
                remainingPlayers: viewModel.game.remainingPlayers,
                completedCount: viewModel.game.completedCount,
                totalCategories: viewModel.game.categories.count,
                xpEarned: viewModel.xpEarned,
                onPlayAgain: {
                    viewModel.showResult = false
                    viewModel.restart()
                },
                onHome: {
                    viewModel.showResult = false
                    onComplete()
                    dismiss()
                }
            )
        }
    }
}

// MARK: - Player Panel

private struct FootballBingoPlayerPanel: View {
    let player: FootballBingoPlayer?
    let remaining: Int
    var onSkip: () -> Void
    let isActive: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("\(remaining) PLAYERS LEFT")
                    .font(BKFont.caption(11))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.accent)
                Spacer()
                if isActive {
                    Button(action: onSkip) {
                        Text("SKIP")
                            .font(.system(size: 11, weight: .heavy, design: .rounded))
                            .foregroundStyle(BKTheme.background)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(BKTheme.accent)
                            .clipShape(Capsule())
                    }
                }
            }

            if let player {
                Text(player.name.uppercased())
                    .font(BKFont.title(22))
                    .foregroundStyle(BKTheme.textPrimary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)

                HStack(spacing: 8) {
                    Text(GuessWhoDisplay.nationalityFlag(player.nationality))
                        .font(.system(size: 16))
                    Text(player.nationality.uppercased())
                        .font(BKFont.caption(10))
                        .foregroundStyle(BKTheme.textMuted)
                    if let club = player.clubs.first {
                        Text("·")
                            .foregroundStyle(BKTheme.textMuted)
                        Text(club.uppercased())
                            .font(BKFont.caption(10))
                            .foregroundStyle(BKTheme.textMuted)
                            .lineLimit(1)
                    }
                }
            } else {
                Text("OUT OF PLAYERS")
                    .font(BKFont.headline())
                    .foregroundStyle(BKTheme.wrong)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BKTheme.card.opacity(0.85))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(BKTheme.accent.opacity(0.2), lineWidth: 1)
        )
    }
}

// MARK: - Board

private struct FootballBingoBoardView: View {
    let categories: [FootballBingoCategory]
    let completedIds: Set<String>
    let shakeId: String?
    let popId: String?
    let isEnabled: Bool
    var onTap: (FootballBingoCategory) -> Void

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 4)

    var body: some View {
        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(categories) { category in
                FootballBingoTileView(
                    category: category,
                    isCompleted: completedIds.contains(category.id),
                    isShaking: shakeId == category.id,
                    isPopping: popId == category.id,
                    isEnabled: isEnabled && !completedIds.contains(category.id),
                    onTap: { onTap(category) }
                )
            }
        }
    }
}

private struct FootballBingoTileView: View {
    let category: FootballBingoCategory
    let isCompleted: Bool
    let isShaking: Bool
    let isPopping: Bool
    let isEnabled: Bool
    var onTap: () -> Void

    @State private var shakeOffset: CGFloat = 0

    var body: some View {
        Button(action: onTap) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(isCompleted ? BKTheme.guessCorrect.opacity(0.22) : BKTheme.card)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .strokeBorder(
                                isCompleted ? BKTheme.accent.opacity(0.65) : Color.white.opacity(0.08),
                                lineWidth: isCompleted ? 1.5 : 1
                            )
                    )

                VStack(spacing: 6) {
                    FootballBingoCategoryIcon(category: category, isCompleted: isCompleted)
                    Text(category.title.uppercased())
                        .font(.system(size: 7, weight: .heavy, design: .rounded))
                        .foregroundStyle(isCompleted ? BKTheme.accent : BKTheme.textPrimary)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                        .minimumScaleFactor(0.75)
                }
                .padding(6)

                if isCompleted {
                    VStack {
                        HStack {
                            Spacer()
                            Ph.checkCircle.fill
                                .color(BKTheme.accent)
                                .frame(width: 14, height: 14)
                        }
                        Spacer()
                    }
                    .padding(5)
                }
            }
            .frame(height: 78)
            .scaleEffect(isPopping ? 1.06 : 1)
            .offset(x: shakeOffset)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .animation(.spring(response: FootballBingoTiming.tilePop, dampingFraction: 0.62), value: isPopping)
        .animation(.spring(response: FootballBingoTiming.tilePop, dampingFraction: 0.62), value: isCompleted)
        .onChange(of: isShaking) { _, shaking in
            guard shaking else {
                shakeOffset = 0
                return
            }
            withAnimation(.default.repeatCount(3, autoreverses: true).speed(6)) {
                shakeOffset = 6
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + FootballBingoTiming.tileShake) {
                shakeOffset = 0
            }
        }
    }
}

private struct FootballBingoCategoryIcon: View {
    let category: FootballBingoCategory
    let isCompleted: Bool

    var body: some View {
        Group {
            switch category.iconType {
            case .flag:
                Text(GuessWhoDisplay.nationalityFlag(category.iconValue))
                    .font(.system(size: 18))
            case .clubBadge:
                let parts = category.iconValue.split(separator: "|").map(String.init)
                let club = parts.first ?? category.iconValue
                let league = parts.count > 1 ? parts[1] : "Premier League"
                TeamBadgeImage(club: club, league: league, size: 22) {
                    iconFallback(String(club.prefix(3)).uppercased())
                }
            case .league:
                LeagueBadgeImage(league: category.iconValue, size: 22) {
                    iconFallback(GuessWhoDisplay.leagueAbbrev(category.iconValue))
                }
            case .trophy:
                Ph.trophy.fill
                    .color(isCompleted ? BKTheme.accent : BKTheme.streak)
                    .frame(width: 18, height: 18)
            case .custom:
                customIcon
            }
        }
        .frame(height: 22)
    }

    @ViewBuilder
    private var customIcon: some View {
        if category.matchingRule.contains("Messi") {
            Text("🐐").font(.system(size: 16))
        } else if category.matchingRule.contains("Guardiola") {
            Ph.users.fill
                .color(BKTheme.textSecondary)
                .frame(width: 16, height: 16)
        } else if category.type == .statThreshold {
            Text("100+")
                .font(.system(size: 10, weight: .black, design: .rounded))
                .foregroundStyle(BKTheme.accent)
        } else {
            Ph.sealQuestion.fill
                .color(BKTheme.textMuted)
                .frame(width: 16, height: 16)
        }
    }

    private func iconFallback(_ text: String) -> some View {
        Circle()
            .fill(BKTheme.cardElevated)
            .frame(width: 22, height: 22)
            .overlay(
                Text(text)
                    .font(.system(size: 7, weight: .bold, design: .rounded))
                    .foregroundStyle(BKTheme.textMuted)
            )
    }
}

// MARK: - Result

private struct FootballBingoResultView: View {
    let won: Bool
    let remainingPlayers: Int
    let completedCount: Int
    let totalCategories: Int
    let xpEarned: Int
    var onPlayAgain: () -> Void
    var onHome: () -> Void

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()

            VStack(spacing: 20) {
                Spacer()

                if won {
                    Ph.checkCircle.fill
                        .color(BKTheme.accent)
                        .frame(width: 64, height: 64)
                    Text("BINGO COMPLETE")
                        .font(BKFont.title(26))
                        .foregroundStyle(BKTheme.textPrimary)
                    Text("\(remainingPlayers) players remaining")
                        .font(BKFont.body())
                        .foregroundStyle(BKTheme.textSecondary)
                    Text("+\(xpEarned) XP")
                        .font(BKFont.headline(20))
                        .foregroundStyle(BKTheme.accent)
                } else {
                    Ph.xCircle.fill
                        .color(BKTheme.wrong)
                        .frame(width: 64, height: 64)
                    Text("OUT OF PLAYERS")
                        .font(BKFont.title(26))
                        .foregroundStyle(BKTheme.textPrimary)
                    Text("\(completedCount)/\(totalCategories) squares completed")
                        .font(BKFont.body())
                        .foregroundStyle(BKTheme.textSecondary)
                }

                Spacer()

                VStack(spacing: 12) {
                    Button(action: onPlayAgain) {
                        Text(won ? "PLAY AGAIN" : "TRY AGAIN")
                            .font(BKFont.headline())
                            .foregroundStyle(BKTheme.background)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(BKTheme.accent)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                    }

                    Button(action: onHome) {
                        Text("BACK HOME")
                            .font(BKFont.headline())
                            .foregroundStyle(BKTheme.textPrimary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(BKTheme.card)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
            }
        }
    }
}

