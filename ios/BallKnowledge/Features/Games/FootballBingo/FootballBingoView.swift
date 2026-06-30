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
    var wrongFlashToken = 0
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
        wrongFlashToken = 0
        showResult = false
    }

    func skip() {
        guard game.isActive else { return }
        HapticManager.light()
        advanceTurn(by: 1)
    }

    func turnExpired() {
        guard game.isActive else { return }
        HapticManager.light()
        advanceTurn(by: 1)
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
            advanceTurn(by: 1)

            if game.status == .won {
                confettiBurstToken += 1
            }
        } else {
            HapticManager.error()
            shakeCategoryId = category.id
            wrongFlashToken += 1
            advanceTurn(by: 2)
        }

        presentResultIfNeeded()

        Task {
            try? await Task.sleep(for: .seconds(FootballBingoTiming.tileShake))
            if shakeCategoryId == category.id {
                shakeCategoryId = nil
            }
        }
    }

    private func advanceTurn(by steps: Int) {
        game.advance(by: steps)
        playerPanelToken = UUID()
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
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: FootballBingoViewModel
    @State private var wrongFlashOpacity: Double = 0
    private let allowReplay: Bool
    private let dailyDate: String?
    var onComplete: () -> Void

    init(
        dailyDate: String? = nil,
        serverPuzzle: FootballBingoPuzzleDTO? = nil,
        allowReplay: Bool = true,
        onComplete: @escaping () -> Void
    ) {
        if let serverPuzzle {
            _viewModel = State(initialValue: FootballBingoViewModel(game: FootballBingoSeed.makeGame(from: serverPuzzle)))
        } else if let dailyDate {
            _viewModel = State(initialValue: FootballBingoViewModel(game: FootballBingoSeed.makeDailyGame(date: dailyDate)))
        } else {
            _viewModel = State(initialValue: FootballBingoViewModel())
        }
        self.dailyDate = dailyDate
        self.allowReplay = allowReplay
        self.onComplete = onComplete
    }

    var body: some View {
        ZStack {
            NavigationStack {
                VStack(spacing: 0) {
                    FootballBingoTurnTimerBar(
                        turnToken: viewModel.playerPanelToken,
                        isActive: viewModel.game.isActive && !viewModel.showResult,
                        onExpired: { viewModel.turnExpired() }
                    )

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
                }
                .background(StadiumBackground())
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

            BKTheme.wrong
                .opacity(wrongFlashOpacity)
                .ignoresSafeArea()
                .allowsHitTesting(false)

            FootballConfettiView(burstToken: viewModel.confettiBurstToken)
                .zIndex(999)
        }
        .animation(.spring(response: FootballBingoTiming.playerSlide, dampingFraction: 0.82), value: viewModel.playerPanelToken)
        .onChange(of: viewModel.wrongFlashToken) { _, _ in
            withAnimation(.easeOut(duration: FootballBingoTiming.wrongFlashIn)) {
                wrongFlashOpacity = 0.22
            }
            withAnimation(.easeOut(duration: FootballBingoTiming.wrongFlashOut).delay(FootballBingoTiming.wrongFlashIn)) {
                wrongFlashOpacity = 0
            }
        }
        .fullScreenCover(isPresented: $viewModel.showResult) {
            FootballBingoResultView(
                won: viewModel.game.status == .won,
                remainingPlayers: viewModel.game.remainingPlayers,
                completedCount: viewModel.game.completedCount,
                totalCategories: viewModel.game.categories.count,
                xpEarned: viewModel.xpEarned,
                showPlayAgain: allowReplay,
                onPlayAgain: {
                    viewModel.showResult = false
                    viewModel.restart()
                },
                onHome: {
                    if !allowReplay, let dailyDate {
                        Task {
                            await DailyCompletionService.recordCompletion(
                                modeId: GameModeID.footballBingo.rawValue,
                                date: dailyDate,
                                score: viewModel.xpEarned,
                                won: viewModel.game.status == .won,
                                context: modelContext
                            )
                        }
                    }
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
                HStack(spacing: 12) {
                    // Headshot only — the fallback stays neutral (initials, not a flag) so it never
                    // leaks the player's nationality, which is one of the tiles to deduce.
                    PlayerAvatar(urlString: player.headshotUrl, size: 52) {
                        Circle()
                            .fill(BKTheme.card)
                            .frame(width: 52, height: 52)
                            .overlay(
                                Text(Self.initials(player.name))
                                    .font(.system(size: 18, weight: .bold, design: .rounded))
                                    .foregroundStyle(BKTheme.textMuted)
                            )
                    }
                    Text(player.name.uppercased())
                        .font(BKFont.title(21))
                        .foregroundStyle(BKTheme.textPrimary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                    Spacer(minLength: 0)
                }
            } else {
                Text("OUT OF PLAYERS")
                    .font(BKFont.headline())
                    .foregroundStyle(BKTheme.wrong)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.white.opacity(0.06), lineWidth: 1))
    }

    private static func initials(_ name: String) -> String {
        let parts = name.split(separator: " ")
        let first = parts.first?.first.map(String.init) ?? ""
        let last = parts.count > 1 ? (parts.last?.first.map(String.init) ?? "") : ""
        return (first + last).uppercased()
    }
}

// MARK: - Turn Timer

private struct FootballBingoTurnTimerBar: View {
    let turnToken: UUID
    let isActive: Bool
    var onExpired: () -> Void

    @State private var turnStart = Date()
    @State private var didExpire = false

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30)) { timeline in
            let elapsed = timeline.date.timeIntervalSince(turnStart)
            let remaining = max(0, 1 - elapsed / FootballBingoTiming.turnDuration)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(BKTheme.cardElevated)
                    Capsule()
                        .fill(BKTheme.accent)
                        .frame(width: max(0, geo.size.width * remaining))
                }
            }
            .frame(height: 4)
            .onChange(of: remaining) { _, value in
                guard isActive, value <= 0, !didExpire else { return }
                didExpire = true
                onExpired()
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .onChange(of: turnToken) { _, _ in
            turnStart = Date()
            didExpire = false
        }
        .onChange(of: isActive) { _, active in
            if active {
                turnStart = Date()
                didExpire = false
            }
        }
        .onAppear {
            turnStart = Date()
        }
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
    @State private var greenBurstScale: CGFloat = 0

    var body: some View {
        Button(action: onTap) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(BKTheme.cardElevated)

                if isCompleted {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(BKTheme.accent)
                        .scaleEffect(greenBurstScale)
                }

                VStack(spacing: 4) {
                    FootballBingoCategoryIcon(category: category)
                    Text(category.title.uppercased())
                        .font(.system(size: 9, weight: .heavy, design: .rounded))
                        .foregroundStyle(isCompleted ? Color.black : BKTheme.textPrimary)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                        .minimumScaleFactor(0.75)
                }
                .padding(6)
                .opacity(1)

                if isCompleted {
                    VStack {
                        HStack {
                            Spacer()
                            Ph.checkCircle.fill
                                .color(.black)
                                .frame(width: 14, height: 14)
                        }
                        Spacer()
                    }
                    .padding(5)
                }
            }
            .frame(height: 82)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .scaleEffect(isPopping ? 1.06 : 1)
            .offset(x: shakeOffset)
        }
        .buttonStyle(.plain)
        .allowsHitTesting(isEnabled)
        .animation(.spring(response: FootballBingoTiming.tilePop, dampingFraction: 0.62), value: isPopping)
        .onChange(of: isCompleted) { _, completed in
            guard completed else {
                greenBurstScale = 0
                return
            }
            greenBurstScale = 0.15
            withAnimation(.spring(response: FootballBingoTiming.greenBurst, dampingFraction: 0.68)) {
                greenBurstScale = 1
            }
        }
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

    var body: some View {
        Group {
            switch category.iconType {
            case .flag:
                Text(GuessWhoDisplay.nationalityFlag(category.iconValue))
                    .font(.system(size: 26))
            case .clubBadge:
                let parts = category.iconValue.split(separator: "|").map(String.init)
                let club = parts.first ?? category.iconValue
                let league = parts.count > 1 ? parts[1] : "Premier League"
                TeamBadgeImage(club: club, league: league, size: 28) {
                    iconFallback(String(club.prefix(3)).uppercased())
                }
            case .league:
                LeagueBadgeImage(league: category.iconValue, size: 28) {
                    iconFallback(GuessWhoDisplay.leagueAbbrev(category.iconValue))
                }
            case .trophy:
                Ph.trophy.fill
                    .color(BKTheme.streak)
                    .frame(width: 24, height: 24)
            case .custom:
                customIcon
            }
        }
        .frame(height: 28)
        .opacity(1)
    }

    @ViewBuilder
    private var customIcon: some View {
        if category.matchingRule.contains("Messi") {
            Text("🐐").font(.system(size: 24))
        } else if category.matchingRule.contains("Guardiola") {
            Ph.users.fill
                .color(BKTheme.textSecondary)
                .frame(width: 22, height: 22)
        } else if category.type == .statThreshold || category.type == .position {
            Text(category.iconValue)
                .font(.system(size: 12, weight: .black, design: .rounded))
                .foregroundStyle(BKTheme.accent)
        } else {
            Ph.sealQuestion.fill
                .color(BKTheme.textMuted)
                .frame(width: 22, height: 22)
        }
    }

    private func iconFallback(_ text: String) -> some View {
        Circle()
            .fill(BKTheme.cardElevated)
            .frame(width: 28, height: 28)
            .overlay(
                Text(text)
                    .font(.system(size: 8, weight: .bold, design: .rounded))
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
    var showPlayAgain = true
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
                    if showPlayAgain {
                        Button(action: onPlayAgain) {
                            Text(won ? "PLAY AGAIN" : "TRY AGAIN")
                                .font(BKFont.headline())
                                .foregroundStyle(BKTheme.background)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 16)
                                .background(BKTheme.accent)
                                .clipShape(RoundedRectangle(cornerRadius: 16))
                        }
                    }

                    Button(action: onHome) {
                        Text(showPlayAgain ? "BACK HOME" : "DONE")
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

