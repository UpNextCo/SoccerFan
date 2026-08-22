import SwiftUI

@MainActor
@Observable
final class BackYourselfViewModel {
    var state: BackYourselfGameState
    var searchText = ""
    var searchResults: [PlayerSearchResultDTO] = []
    var isSearching = false
    var isSubmitting = false
    var feedback: String?
    var showResult = false
    var confettiBurstToken = 0
    private var searchTask: Task<Void, Never>?

    init(puzzle: BackYourselfPuzzle) {
        self.state = BackYourselfGameState(puzzle: puzzle)
    }

    func lockPledge() {
        guard state.phase == .pledge else { return }
        state.pledge = max(1, min(state.puzzle.maxPool, state.pledge))
        state.phase = .naming
        Feedback.play(.lock)
    }

    func setPledge(_ value: Int) {
        guard state.phase == .pledge else { return }
        state.pledge = max(1, min(state.puzzle.maxPool, value))
    }

    func updateSearch(_ query: String) {
        searchText = query
        searchTask?.cancel()
        feedback = nil
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2, state.phase == .naming else {
            searchResults = []
            isSearching = false
            return
        }
        isSearching = true
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(220))
            guard !Task.isCancelled else { return }
            do {
                let rows = try await APIClient.shared.searchPlayers(query: trimmed)
                guard !Task.isCancelled else { return }
                searchResults = rows
                isSearching = false
            } catch {
                guard !Task.isCancelled else { return }
                searchResults = []
                isSearching = false
            }
        }
    }

    func selectPlayer(_ hit: PlayerSearchResultDTO) async {
        guard state.phase == .naming, !isSubmitting else { return }
        if state.namedCount >= state.puzzle.maxPool {
            state.phase = .won
            showResult = true
            return
        }
        if state.usedIds.contains(hit.id) {
            feedback = "Already named"
            Feedback.play(.deny)
            return
        }
        isSubmitting = true
        feedback = nil
        defer { isSubmitting = false }

        do {
            let result = try await APIClient.shared.backYourselfGuess(
                date: state.puzzle.date,
                playerId: hit.id,
                alreadyNamedIds: Array(state.usedIds)
            )
            if result.duplicate {
                feedback = "Already named"
                Feedback.play(.deny)
                return
            }
            if result.correct {
                let player = result.player.map(BackYourselfPlayer.init(dto:)) ?? BackYourselfPlayer(search: hit)
                state.named.append(player)
                searchText = ""
                searchResults = []
                if state.namedCount >= state.pledge || state.namedCount >= state.puzzle.maxPool {
                    state.phase = .won
                    SignatureTrophyStore.evaluateBackYourself(
                        named: state.namedCount,
                        maxPool: state.puzzle.maxPool,
                        livesLeft: state.livesRemaining,
                        won: true
                    )
                    confettiBurstToken += 1
                    Feedback.play(.win)
                    try? await Task.sleep(for: .milliseconds(800))
                    showResult = true
                } else {
                    Feedback.play(.success)
                }
            } else {
                state.livesRemaining = max(0, state.livesRemaining - 1)
                state.heartLossToken += 1
                searchText = ""
                searchResults = []
                feedback = "Doesn't fit the category"
                if state.livesRemaining <= 0 {
                    state.phase = .lost
                    Feedback.play(.lose)
                    showResult = true
                } else {
                    Feedback.play(.lifeLost)
                }
            }
        } catch {
            feedback = "Couldn't check that pick — try again"
        }
    }

    func restore(_ saved: BackYourselfGameState) {
        state = saved
        if state.phase == .won || state.phase == .lost {
            showResult = true
        }
    }
}

struct BackYourselfView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: BackYourselfViewModel
    @State private var showHelp = false
    @FocusState private var isSearchFocused: Bool
    private let allowReplay: Bool
    private let showsXp: Bool
    private let dailyDate: String?
    private let onSubmit: ((BackYourselfGameState) async -> Void)?
    var onComplete: () -> Void

    init(
        dailyDate: String? = nil,
        puzzle: BackYourselfPuzzle,
        allowReplay: Bool = false,
        showsXp: Bool = true,
        onSubmit: ((BackYourselfGameState) async -> Void)? = nil,
        onComplete: @escaping () -> Void
    ) {
        _viewModel = State(initialValue: BackYourselfViewModel(puzzle: puzzle))
        self.allowReplay = allowReplay
        self.showsXp = showsXp
        self.dailyDate = dailyDate
        self.onSubmit = onSubmit
        self.onComplete = onComplete
    }

    private var state: BackYourselfGameState { viewModel.state }

    var body: some View {
        ZStack {
            NavigationStack {
                VStack(spacing: 0) {
                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 16) {
                            categoryCard
                            if state.phase == .pledge {
                                pledgeCard
                            } else {
                                namingHero
                                namedList
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                        .padding(.bottom, 16)
                    }

                    if state.phase == .naming {
                        searchArea
                            .padding(.horizontal, 16)
                            .padding(.top, 4)
                            .padding(.bottom, 16)
                            .background(BKTheme.background.opacity(0.92))
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(StadiumBackground(glowIntensity: 0.32))
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
                        Text("BACK YOURSELF")
                            .font(BKFont.caption(13))
                            .tracking(1.5)
                            .foregroundStyle(BKTheme.textSecondary)
                    }
                    GameHelpToolbarButton(isPresented: $showHelp)
                }
                .scrollDismissesKeyboard(.interactively)
            }

            if viewModel.confettiBurstToken > 0, state.won {
                FootballConfettiView(burstToken: viewModel.confettiBurstToken)
                    .allowsHitTesting(false)
            }
        }
        .gameHelpOverlay(mode: .backYourself, isPresented: $showHelp)
        .persistsGameProgress(
            viewModel.state,
            isResumable: viewModel.state.isResumable,
            modeId: GameModeID.backYourself.rawValue,
            date: dailyDate,
            version: BackYourselfGameState.progressVersion,
            enabled: !allowReplay
        )
        .onAppear {
            SoundManager.shared.prepare()
            guard !allowReplay, let dailyDate,
                  let saved = GameProgressStore.load(
                    BackYourselfGameState.self,
                    modeId: GameModeID.backYourself.rawValue,
                    date: dailyDate,
                    version: BackYourselfGameState.progressVersion,
                    context: modelContext
                  ) else { return }
            viewModel.restore(saved)
        }
        .fullScreenCover(isPresented: $viewModel.showResult) {
            BackYourselfResultView(
                state: viewModel.state,
                date: dailyDate ?? viewModel.state.puzzle.date,
                showsXp: showsXp,
                onHome: {
                    if onSubmit == nil, !allowReplay, let dailyDate {
                        let s = viewModel.state
                        Task {
                            await DailyCompletionService.recordCompletion(
                                modeId: GameModeID.backYourself.rawValue,
                                date: dailyDate,
                                score: s.score,
                                guesses: s.namedCount,
                                won: s.won,
                                shareGrid: s.shareText(date: dailyDate),
                                answer: s.answerPayload(),
                                context: modelContext
                            )
                        }
                    }
                    onComplete()
                }
            )
            .task {
                if let onSubmit {
                    await onSubmit(viewModel.state)
                }
            }
        }
    }

    private var categoryCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("CATEGORY")
                .font(BKFont.caption(11))
                .tracking(1.2)
                .foregroundStyle(BKTheme.textMuted)
            HStack(spacing: 12) {
                categoryIcon
                VStack(alignment: .leading, spacing: 4) {
                    Text(state.puzzle.category.label)
                        .font(BKFont.title(22))
                        .foregroundStyle(BKTheme.textPrimary)
                    Text(poolCaption)
                        .font(BKFont.body(13))
                        .foregroundStyle(BKTheme.textSecondary)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BKTheme.card.opacity(0.92))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var categoryIcon: some View {
        BackYourselfCategoryArt(category: state.puzzle.category, size: 44)
    }

    private var poolCaption: String {
        let maxPool = state.puzzle.maxPool
        let xpCap = state.puzzle.xpCap
        if maxPool > xpCap {
            return "\(maxPool) for a perfect · Max XP at \(xpCap)+"
        }
        return "\(maxPool) for a perfect score"
    }

    private var pledgeCard: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("HOW MANY CAN YOU NAME?")
                .font(BKFont.caption(11))
                .tracking(1.2)
                .foregroundStyle(BKTheme.textMuted)

            HStack {
                Text("\(state.pledge)")
                    .font(BKFont.title(42))
                    .foregroundStyle(BKTheme.textPrimary)
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(state.projectedXP) XP")
                        .font(BKFont.title(20))
                        .foregroundStyle(BKTheme.accent)
                    Text("if you hit it")
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.textMuted)
                }
            }

            BackYourselfPledgeSlider(
                value: Binding(
                    get: { state.pledge },
                    set: { viewModel.setPledge($0) }
                ),
                maxValue: state.puzzle.maxPool
            )

            Button {
                viewModel.lockPledge()
            } label: {
                Text("Back yourself")
                    .font(BKFont.headline(16))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .foregroundStyle(BKTheme.onAccent)
                    .background(BKTheme.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)

            Text("Three lives. Wrong picks cost a heart. Miss your number and you get 0 XP.")
                .font(BKFont.caption(12))
                .foregroundStyle(BKTheme.textMuted)
        }
        .padding(16)
        .background(BKTheme.card.opacity(0.92))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var namingHero: some View {
        HStack(spacing: 12) {
            VStack(spacing: 4) {
                Text("\(state.namedCount)/\(state.pledge)")
                    .font(BKFont.title(28))
                    .foregroundStyle(BKTheme.textPrimary)
                Text("named")
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textMuted)
            }
            .frame(maxWidth: .infinity)

            BackYourselfHeartsRow(
                total: state.puzzle.mistakesAllowed,
                remaining: state.livesRemaining,
                lossToken: state.heartLossToken
            )
            .frame(maxWidth: .infinity)

            VStack(spacing: 4) {
                Text("\(state.projectedXP)")
                    .font(BKFont.title(28))
                    .foregroundStyle(BKTheme.accent)
                Text("XP")
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textMuted)
            }
            .frame(maxWidth: .infinity)
        }
        .padding(16)
        .background(BKTheme.card.opacity(0.92))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var namedList: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("YOUR PICKS")
                .font(BKFont.caption(11))
                .tracking(1.2)
                .foregroundStyle(BKTheme.textMuted)
            if state.named.isEmpty {
                Text("Search players who fit the category.")
                    .font(BKFont.body(14))
                    .foregroundStyle(BKTheme.textSecondary)
            } else {
                ForEach(state.named) { player in
                    HStack(spacing: 10) {
                        PlayerAvatar(urlString: player.headshotUrl, size: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(player.name)
                                .font(BKFont.headline(15))
                                .foregroundStyle(BKTheme.textPrimary)
                            Text([player.club, player.nationality].filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(BKFont.caption(12))
                                .foregroundStyle(BKTheme.textMuted)
                        }
                        Spacer()
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BKTheme.card.opacity(0.92))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var searchArea: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let feedback = viewModel.feedback {
                Text(feedback)
                    .font(BKFont.caption(12))
                    .foregroundStyle(Color(red: 0.95, green: 0.28, blue: 0.38))
            }
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(BKTheme.textMuted)
                TextField("Search a player", text: Binding(
                    get: { viewModel.searchText },
                    set: { viewModel.updateSearch($0) }
                ))
                .font(BKFont.body())
                .foregroundStyle(BKTheme.textPrimary)
                .focused($isSearchFocused)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .submitLabel(.search)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(BKTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(BKTheme.hairline, lineWidth: 1)
            )

            if !viewModel.searchResults.isEmpty {
                PlayerSearchResultsList(
                    players: viewModel.searchResults,
                    isDisabled: { state.usedIds.contains($0.id) },
                    onSelect: { hit in
                        Task { await viewModel.selectPlayer(hit) }
                    }
                )
                .frame(maxHeight: 220)
            } else if viewModel.isSearching {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
        }
    }
}

// MARK: - Slider

private struct BackYourselfPledgeSlider: View {
    @Binding var value: Int
    let maxValue: Int

    var body: some View {
        VStack(spacing: 8) {
            GeometryReader { geo in
                let width = geo.size.width
                let progress = maxValue <= 1 ? 1.0 : CGFloat(value - 1) / CGFloat(maxValue - 1)
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(BKTheme.cardElevated)
                        .frame(height: 10)
                    Capsule()
                        .fill(BKTheme.accent)
                        .frame(width: max(10, width * progress), height: 10)
                    Circle()
                        .fill(Color.white)
                        .frame(width: 24, height: 24)
                        .shadow(color: .black.opacity(0.2), radius: 3, y: 1)
                        .offset(x: max(0, min(width - 24, width * progress - 12)))
                }
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { drag in
                            let ratio = min(1, max(0, drag.location.x / max(width, 1)))
                            let next = 1 + Int((ratio * CGFloat(maxValue - 1)).rounded())
                            value = min(maxValue, max(1, next))
                        }
                )
            }
            .frame(height: 24)

            HStack {
                Text("1")
                Spacer()
                Text("\(maxValue)")
            }
            .font(BKFont.caption(11))
            .foregroundStyle(BKTheme.textMuted)
        }
    }
}

// MARK: - Hearts

private struct BackYourselfHeartsRow: View {
    let total: Int
    let remaining: Int
    let lossToken: Int

    @State private var breakingIndex: Int?
    @State private var breakScale: CGFloat = 1
    @State private var breakOpacity: Double = 1

    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<total, id: \.self) { index in
                let filled = index < remaining
                let isBreaking = breakingIndex == index
                Image(systemName: filled || isBreaking ? "heart.fill" : "heart")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(filled || isBreaking ? Color(red: 0.95, green: 0.28, blue: 0.38) : BKTheme.textMuted.opacity(0.35))
                    .scaleEffect(isBreaking ? breakScale : 1)
                    .opacity(isBreaking ? breakOpacity : 1)
                    .offset(y: isBreaking ? -6 : 0)
            }
        }
        .onChange(of: lossToken) { _, _ in
            guard remaining < total else { return }
            let index = remaining
            breakingIndex = index
            breakScale = 1.35
            breakOpacity = 1
            withAnimation(.spring(response: 0.28, dampingFraction: 0.45)) {
                breakScale = 0.35
                breakOpacity = 0
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.32) {
                breakingIndex = nil
                breakScale = 1
                breakOpacity = 1
            }
        }
    }
}

// MARK: - Result

private struct BackYourselfResultView: View {
    let state: BackYourselfGameState
    let date: String
    var showsXp: Bool = true
    let onHome: () -> Void

    var body: some View {
        GameResultScreen(onExit: onHome) {
            VStack(spacing: 18) {
                Text(state.won ? "YOU BACKED YOURSELF" : "SHORT OF THE MARK")
                    .font(BKFont.headline(26))
                    .foregroundStyle(state.won ? BKTheme.accent : BKTheme.textPrimary)
                    .padding(.top, 8)

                Text(
                    state.won
                        ? (state.namedCount >= state.puzzle.maxPool
                            ? "Perfect score - \(state.namedCount) of \(state.puzzle.maxPool)"
                            : "Named \(state.namedCount) of \(state.pledge)")
                        : "Needed \(state.pledge) — got \(state.namedCount)"
                )
                .font(BKFont.body(14))
                .foregroundStyle(BKTheme.textSecondary)

                if showsXp {
                    XPResultSummary(earned: state.score, max: DailyXP.maxXP(.backYourself))
                }

                ShareLink(item: state.shareText(date: date)) {
                    Text("SHARE")
                        .font(BKFont.headline(14))
                        .foregroundStyle(BKTheme.textPrimary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(BKTheme.card)
                        .clipShape(Capsule())
                }
            }
            .padding(.horizontal, 20)
        }
    }
}

struct BackYourselfCategoryArt: View {
    let category: BackYourselfCategory
    var size: CGFloat = 44

    private var urls: [String] {
        [category.logoUrl, category.logo2Url].compactMap { url in
            guard let url, !url.isEmpty else { return nil }
            return url
        }
    }

    private var circular: Bool {
        category.type == "played_with_both"
    }

    private var flagText: String? {
        let name = category.nationality ?? category.wcCountry
        guard let name, !name.isEmpty else { return nil }
        switch category.type {
        case "nationality", "nat_club", "nat_league", "wc_squad":
            return GuessWhoDisplay.nationalityFlag(name)
        default:
            return nil
        }
    }

    var body: some View {
        HStack(spacing: urls.count >= 2 ? -size * 0.3 : 6) {
            if let flagText, urls.count < 2 {
                Text(flagText)
                    .font(.system(size: size * 0.72))
            }
            ForEach(Array(urls.enumerated()), id: \.offset) { _, url in
                media(url)
            }
            if urls.isEmpty, flagText == nil {
                Image(systemName: symbol)
                    .font(.system(size: size * 0.5, weight: .semibold))
                    .foregroundStyle(BKTheme.accent)
                    .frame(width: size, height: size)
            }
        }
        .frame(minWidth: size, minHeight: size)
    }

    @ViewBuilder
    private func media(_ url: String) -> some View {
        if circular {
            PlayerAvatar(urlString: url, size: size * (urls.count >= 2 ? 0.88 : 1))
        } else if let imageURL = URL(string: url) {
            AsyncImage(url: imageURL) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFit()
                default:
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(BKTheme.cardElevated)
                }
            }
            .frame(width: size * (urls.count >= 2 ? 0.88 : 1), height: size * (urls.count >= 2 ? 0.88 : 1))
        }
    }

    private var symbol: String {
        switch category.type {
        case "award", "final": return "trophy.fill"
        case "stat": return "chart.bar.fill"
        case "managed_by": return "person.badge.key.fill"
        case "wc_squad": return "globe.europe.africa.fill"
        case "club_combo": return "arrow.left.arrow.right"
        case "played_with_both": return "person.2.fill"
        default: return "person.3.fill"
        }
    }
}
