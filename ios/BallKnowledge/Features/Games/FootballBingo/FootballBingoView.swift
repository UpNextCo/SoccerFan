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
    var wildcardUsed = false

    private let serverPuzzle: FootballBingoPuzzleDTO

    init(serverPuzzle: FootballBingoPuzzleDTO) {
        self.serverPuzzle = serverPuzzle
        self.game = FootballBingoSeed.makeGame(from: serverPuzzle)
    }

    /// XP submitted to the server — 0 unless the grid is completed, then an efficiency slide (fewer
    /// players used = more XP). This IS the XP.
    var rawScore: Int {
        DailyXP.bingo(
            completed: game.status == .won,
            remaining: game.remainingPlayers,
            queueSize: game.playerQueue.count,
            tiles: game.categories.count
        )
    }

    var xpEarned: Int { rawScore }

    /// Snapshot for save/restore (board + the one-shot wildcard flag).
    var snapshot: FootballBingoProgress {
        FootballBingoProgress(game: game, wildcardUsed: wildcardUsed)
    }

    /// Mid-game and worth saving: at least one turn taken, not finished.
    var isResumable: Bool {
        game.status == .active && (game.completedCount > 0 || game.currentPlayerIndex > 0)
    }

    func restore(_ p: FootballBingoProgress) {
        game = p.game
        wildcardUsed = p.wildcardUsed
        shakeCategoryId = nil
        popCategoryId = nil
        playerPanelToken = UUID()
        confettiBurstToken = 0
        wrongFlashToken = 0
        showResult = false
    }

    func restart() {
        game = FootballBingoSeed.makeGame(from: serverPuzzle)
        shakeCategoryId = nil
        popCategoryId = nil
        playerPanelToken = UUID()
        confettiBurstToken = 0
        wrongFlashToken = 0
        showResult = false
        wildcardUsed = false
    }

    /// One-shot: instantly complete every remaining square the current player satisfies.
    func useWildcard() {
        guard game.isActive, !wildcardUsed, let player = game.currentPlayer else { return }
        wildcardUsed = true
        HapticManager.success()
        let toComplete = game.categories.filter {
            !game.completedCategoryIds.contains($0.id) && FootballBingoMatcher.matches(player: player, category: $0)
        }
        for category in toComplete {
            game.markCompleted(categoryId: category.id)
        }
        advanceTurn(by: 1)
        if game.status == .won { confettiBurstToken += 1 }
        presentResultIfNeeded()
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
        serverPuzzle: FootballBingoPuzzleDTO,
        allowReplay: Bool = false,
        onComplete: @escaping () -> Void
    ) {
        _viewModel = State(initialValue: FootballBingoViewModel(serverPuzzle: serverPuzzle))
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
                                onWildcard: { viewModel.useWildcard() },
                                wildcardAvailable: !viewModel.wildcardUsed,
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
        .persistsGameProgress(
            viewModel.snapshot,
            isResumable: viewModel.isResumable,
            modeId: GameModeID.footballBingo.rawValue,
            date: dailyDate,
            version: FootballBingoProgress.progressVersion,
            enabled: !allowReplay
        )
        .onAppear {
            guard !allowReplay, let dailyDate,
                  let saved = GameProgressStore.load(
                    FootballBingoProgress.self, modeId: GameModeID.footballBingo.rawValue,
                    date: dailyDate, version: FootballBingoProgress.progressVersion, context: modelContext) else { return }
            viewModel.restore(saved)
        }
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
                                score: viewModel.rawScore,
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
    var onWildcard: () -> Void
    let wildcardAvailable: Bool
    let isActive: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Text("\(remaining) PLAYERS LEFT")
                    .font(BKFont.caption(11))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.accent)
                Spacer()
                if isActive {
                    if wildcardAvailable {
                        Button(action: onWildcard) {
                            Text("WILDCARD")
                                .font(.system(size: 11, weight: .heavy, design: .rounded))
                                .foregroundStyle(BKTheme.background)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(BKTheme.streak)
                                .clipShape(Capsule())
                        }
                    }
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
                    PlayerAvatar(urlString: player.headshotUrl, size: 52)
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

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 0), count: 4)

    var body: some View {
        LazyVGrid(columns: columns, spacing: 0) {
            ForEach(Array(categories.enumerated()), id: \.element.id) { index, category in
                FootballBingoTileView(
                    category: category,
                    index: index,
                    isCompleted: completedIds.contains(category.id),
                    isShaking: shakeId == category.id,
                    isPopping: popId == category.id,
                    isEnabled: isEnabled && !completedIds.contains(category.id),
                    onTap: { onTap(category) }
                )
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.white.opacity(0.06), lineWidth: 1))
    }
}

private struct FootballBingoTileView: View {
    let category: FootballBingoCategory
    let index: Int
    let isCompleted: Bool
    let isShaking: Bool
    let isPopping: Bool
    let isEnabled: Bool
    var onTap: () -> Void

    @State private var shakeOffset: CGFloat = 0
    @State private var greenBurstScale: CGFloat = 0

    // Checkerboard of two greys (no gaps) so adjacent tiles stay distinct.
    private var baseColor: Color {
        let row = index / 4, col = index % 4
        return (row + col).isMultiple(of: 2) ? BKTheme.card : BKTheme.cardElevated
    }

    var body: some View {
        Button(action: onTap) {
            ZStack {
                Rectangle().fill(baseColor)

                if isCompleted {
                    Rectangle()
                        .fill(BKTheme.accent)
                        .scaleEffect(greenBurstScale)
                }

                VStack(spacing: 6) {
                    FootballBingoCategoryIcon(category: category, size: 40, isCompleted: isCompleted)
                    Text(BingoTileLabel.short(for: category))
                        .font(.system(size: 11, weight: .heavy, design: .rounded))
                        .foregroundStyle(isCompleted ? Color.black : BKTheme.textPrimary)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .minimumScaleFactor(0.6)
                }
                .padding(8)

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
            .aspectRatio(1, contentMode: .fit)
            // Clip inside the tile so the green burst can't bleed onto neighbours (tiles are flush).
            .clipShape(Rectangle())
            .overlay(
                Rectangle().stroke(
                    isCompleted ? Color.black.opacity(0.22) : BKTheme.background.opacity(0.45),
                    lineWidth: 0.75
                )
            )
            .offset(x: shakeOffset)
        }
        .buttonStyle(.plain)
        .allowsHitTesting(isEnabled)
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
    var size: CGFloat = 40
    var isCompleted: Bool = false

    var body: some View {
        Group {
            switch category.iconType {
            case .flag:
                Text(GuessWhoDisplay.nationalityFlag(category.iconValue))
                    .font(.system(size: size * 0.95))
            case .clubBadge:
                let parts = category.iconValue.split(separator: "|").map(String.init)
                let club = parts.first ?? category.iconValue
                let league = parts.count > 1 ? parts[1] : "Premier League"
                clubBadge(club: club, league: league, logo: category.logoUrl, teamId: category.teamId, size: size)
            case .nationClub:
                let parts = category.iconValue.split(separator: "|").map(String.init)
                let club = parts.first ?? category.iconValue
                let league = parts.count > 1 ? parts[1] : "Premier League"
                clubBadge(club: club, league: league, logo: category.logoUrl, teamId: category.teamId, size: size)
                    .overlay(alignment: .bottomTrailing) {
                        Text(GuessWhoDisplay.nationalityFlag(category.flag ?? ""))
                            .font(.system(size: size * 0.5))
                            .shadow(color: .black.opacity(0.5), radius: 1)
                            .offset(x: size * 0.18, y: size * 0.1)
                    }
            case .clubCombo:
                let parts = category.matchingRule.split(separator: "|").map(String.init)
                let a = parts.first ?? "", b = parts.count > 1 ? parts[1] : ""
                HStack(spacing: -size * 0.18) {
                    clubBadge(club: a, league: "", logo: category.logoUrl, teamId: category.teamId, size: size * 0.78)
                    clubBadge(club: b, league: "", logo: category.logo2Url, teamId: category.team2Id, size: size * 0.78)
                }
            case .league:
                LeagueBadgeImage(league: category.iconValue, size: size) {
                    iconFallback(GuessWhoDisplay.leagueAbbrev(category.iconValue))
                }
            case .trophy:
                Text("🏆").font(.system(size: size * 0.9))
            case .award:
                Text("🏅").font(.system(size: size * 0.9))
            case .custom:
                customIcon
            }
        }
        .frame(height: size)
    }

    private func clubBadge(club: String, league: String, logo: String?, teamId: Int?, size: CGFloat) -> some View {
        TeamBadgeImage(club: club, league: league, teamId: teamId, logoURL: logo.flatMap(URL.init(string:)), size: size) {
            iconFallback(GuessWhoDisplay.clubAbbrev(club), size: size)
        }
    }

    @ViewBuilder
    private var customIcon: some View {
        if category.matchingRule.contains("Messi") {
            Text("🐐").font(.system(size: size * 0.85))
        } else if category.matchingRule.contains("Guardiola") {
            Ph.users.fill
                .color(BKTheme.textSecondary)
                .frame(width: size * 0.75, height: size * 0.75)
        } else if category.type == .statThreshold || category.type == .position {
            Text(category.iconValue)
                .font(.system(size: size * 0.42, weight: .black, design: .rounded))
                .foregroundStyle(isCompleted ? Color.black : BKTheme.accent)
        } else {
            Ph.sealQuestion.fill
                .color(BKTheme.textMuted)
                .frame(width: size * 0.75, height: size * 0.75)
        }
    }

    private func iconFallback(_ text: String, size: CGFloat? = nil) -> some View {
        let s = size ?? self.size
        return Circle()
            .fill(BKTheme.background.opacity(0.5))
            .frame(width: s, height: s)
            .overlay(
                Text(text)
                    .font(.system(size: s * 0.3, weight: .heavy, design: .rounded))
                    .foregroundStyle(BKTheme.textSecondary)
            )
    }
}

/// Tile captions. Clubs get a short code (the crest carries the rest); everything else stays
/// readable: full nation/league/trophy names, and stat tiles describe what the number means.
private enum BingoTileLabel {
    private static let clubShort: [String: String] = [
        "borussia dortmund": "BVB", "chelsea": "CHE", "newcastle united": "NEW", "newcastle": "NEW",
        "manchester united": "MUN", "manchester city": "MCI", "liverpool": "LIV", "arsenal": "ARS",
        "tottenham hotspur": "TOT", "tottenham": "TOT", "everton": "EVE", "aston villa": "AVL",
        "west ham united": "WHU", "west ham": "WHU", "leicester city": "LEI", "leeds united": "LEE",
        "real madrid": "RMA", "barcelona": "BAR", "atletico madrid": "ATM", "atlético madrid": "ATM",
        "sevilla": "SEV", "valencia": "VAL", "villarreal": "VIL", "real sociedad": "RSO", "athletic club": "ATH",
        "juventus": "JUV", "ac milan": "MIL", "inter milan": "INT", "inter": "INT", "napoli": "NAP",
        "as roma": "ROM", "roma": "ROM", "lazio": "LAZ", "atalanta": "ATA", "fiorentina": "FIO",
        "bayern munich": "FCB", "bayer leverkusen": "B04", "rb leipzig": "RBL", "borussia monchengladbach": "BMG",
        "vfl wolfsburg": "WOB", "werder bremen": "SVW", "eintracht frankfurt": "SGE", "schalke 04": "S04",
        "paris saint-germain": "PSG", "paris saint germain": "PSG", "olympique marseille": "OM", "marseille": "OM",
        "olympique lyonnais": "OL", "lyon": "OL", "as monaco": "ASM", "monaco": "ASM", "lille": "LIL",
    ]

    private static func clubCode(_ name: String) -> String {
        let key = name.folding(options: .diacriticInsensitive, locale: .current).lowercased()
        return clubShort[key] ?? GuessWhoDisplay.clubAbbrev(name)
    }

    static func short(for c: FootballBingoCategory) -> String {
        switch c.type {
        case .playedForClub:
            return clubCode(c.matchingRule)
        case .nationClub:
            // "Nation|Club" -> "NAT · CLUB" (flag overlay carries the nation too).
            let parts = c.matchingRule.components(separatedBy: "|")
            let nat = String((parts.first ?? "").prefix(3)).uppercased()
            let club = parts.count > 1 ? clubCode(parts[1]) : ""
            return "\(nat) · \(club)"
        case .clubCombo:
            let parts = c.matchingRule.components(separatedBy: "|")
            let a = clubCode(parts.first ?? ""), b = parts.count > 1 ? clubCode(parts[1]) : ""
            return "\(a) + \(b)"
        case .statThreshold:
            // Icon already shows the number; the title is what it counts (e.g. "Champions League Apps").
            return c.title.uppercased()
        case .wonCompetition:
            if c.matchingRule.lowercased().contains("european championship") { return "EUROS WINNER" }
            return c.title.uppercased()
        case .nationality, .playedInLeague, .award, .position:
            return c.title.uppercased()
        default:
            return c.title.uppercased()
        }
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
                    XPResultSummary(earned: xpEarned, max: DailyXP.maxXP(.footballBingo))
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
                    XPResultSummary(earned: 0, max: DailyXP.maxXP(.footballBingo))
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

