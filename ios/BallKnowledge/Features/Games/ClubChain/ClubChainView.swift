import SwiftUI

// MARK: - ViewModel

@MainActor
@Observable
final class ClubChainViewModel {
    var state: ClubChainGameState
    var searchQuery = ""
    var searchResults: [PlayerSearchResultDTO] = []
    var isSearching = false
    var isValidating = false
    /// Transient feedback under the search box ("Not teammates at club level").
    var invalidMessage: String?
    var showResult = false
    var confettiBurstToken = 0

    init(puzzle: ClubChainPuzzle) {
        self.state = ClubChainGameState(puzzle: puzzle)
    }

    func search() async {
        let query = searchQuery.trimmingCharacters(in: .whitespaces)
        guard query.count >= 2 else {
            searchResults = []
            return
        }
        isSearching = true
        defer { isSearching = false }
        do {
            searchResults = try await APIClient.shared.searchPlayers(query: query)
        } catch {
            searchResults = []
        }
    }

    /// Is this player already locked into the chain (start or an added step)? The target stays
    /// selectable — picking it is the winning move.
    func isPlaced(_ id: String) -> Bool {
        id == state.puzzle.start.id || state.steps.contains { $0.player.id == id }
    }

    func addPlayer(_ player: PlayerSearchResultDTO) async {
        guard state.phase == .playing, !isValidating else { return }
        invalidMessage = nil

        if isPlaced(player.id) {
            invalidMessage = "\(shortName(player.name)) is already in the chain"
            return
        }

        let prevId = state.tailId
        isValidating = true
        defer { isValidating = false }

        let result: ClubChainLinkResultDTO
        do {
            result = try await APIClient.shared.clubChainLink(
                fromId: prevId, toId: player.id, targetId: state.puzzle.target.id
            )
        } catch {
            invalidMessage = "Couldn't check that link — try again"
            return
        }

        guard let link = result.link else {
            // Not club teammates → spend a life.
            state.livesRemaining -= 1
            HapticManager.error()
            invalidMessage = "Not teammates at club level"
            searchQuery = ""
            searchResults = []
            if state.livesRemaining <= 0 { finish(won: false) }
            return
        }

        // Valid move.
        searchQuery = ""
        searchResults = []
        HapticManager.success()

        // Linked straight to the target → that link closes the chain.
        if player.id == state.puzzle.target.id {
            state.closingLink = link
            finish(won: true)
            return
        }

        withAnimation(.spring(response: 0.4, dampingFraction: 0.75)) {
            state.steps.append(ClubChainStep(player: ClubChainPlayer(search: player), link: link))
        }

        // The just-added player also connects to the target → chain complete.
        if let targetLink = result.targetLink {
            state.closingLink = targetLink
            finish(won: true)
            return
        }

        if state.steps.count >= state.puzzle.maxMoves {
            finish(won: false)
        }
    }

    private func finish(won: Bool) {
        state.phase = won ? .won : .lost
        if won {
            confettiBurstToken += 1
            HapticManager.success()
        } else {
            HapticManager.error()
        }
        showResult = true
    }

    func restart() {
        state = ClubChainGameState(puzzle: state.puzzle)
        searchQuery = ""
        searchResults = []
        invalidMessage = nil
        showResult = false
        confettiBurstToken = 0
    }

    func restore(_ saved: ClubChainGameState) {
        state = saved
        searchQuery = ""
        searchResults = []
        invalidMessage = nil
        showResult = false
    }
}

private func shortName(_ name: String) -> String {
    name.split(separator: " ").last.map(String.init) ?? name
}

// MARK: - Main View

struct ClubChainView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: ClubChainViewModel
    @FocusState private var isSearchFocused: Bool
    private let allowReplay: Bool
    private let dailyDate: String?
    var onComplete: () -> Void

    init(dailyDate: String? = nil, puzzle: ClubChainPuzzle, allowReplay: Bool = false, onComplete: @escaping () -> Void) {
        _viewModel = State(initialValue: ClubChainViewModel(puzzle: puzzle))
        self.allowReplay = allowReplay
        self.dailyDate = dailyDate
        self.onComplete = onComplete
    }

    private var state: ClubChainGameState { viewModel.state }

    var body: some View {
        ZStack {
            NavigationStack {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 14) {
                        GameXPBar(current: viewModel.state.score, max: DailyXP.maxXP(.clubChain))
                        headerStrip
                        instruction
                        chainColumn
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 32)
                }
                .background(BKTheme.background)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { dismiss() } label: {
                            Ph.x.bold.color(BKTheme.textPrimary).frame(width: 20, height: 20)
                        }
                    }
                    ToolbarItem(placement: .principal) {
                        Text("CLUB CHAIN")
                            .font(BKFont.caption(12))
                            .tracking(1.2)
                            .foregroundStyle(BKTheme.textPrimary)
                    }
                }
                .scrollDismissesKeyboard(.interactively)
            }

            if viewModel.confettiBurstToken > 0, state.won {
                FootballConfettiView(burstToken: viewModel.confettiBurstToken)
                    .allowsHitTesting(false)
            }
        }
        .persistsGameProgress(
            viewModel.state,
            isResumable: viewModel.state.isResumable,
            modeId: GameModeID.clubChain.rawValue,
            date: dailyDate,
            version: ClubChainGameState.progressVersion,
            enabled: !allowReplay
        )
        .onAppear {
            guard !allowReplay, let dailyDate,
                  let saved = GameProgressStore.load(
                    ClubChainGameState.self, modeId: GameModeID.clubChain.rawValue,
                    date: dailyDate, version: ClubChainGameState.progressVersion, context: modelContext) else { return }
            viewModel.restore(saved)
        }
        .fullScreenCover(isPresented: $viewModel.showResult) {
            ClubChainResultView(
                state: viewModel.state,
                date: dailyDate ?? viewModel.state.puzzle.date,
                allowReplay: allowReplay,
                onPlayAgain: {
                    viewModel.showResult = false
                    viewModel.restart()
                },
                onHome: {
                    if !allowReplay, let dailyDate {
                        let s = viewModel.state
                        Task {
                            await DailyCompletionService.recordCompletion(
                                modeId: GameModeID.clubChain.rawValue,
                                date: dailyDate,
                                score: s.score,
                                guesses: s.moves,
                                won: s.won,
                                shareGrid: s.shareText(date: dailyDate),
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

    // MARK: Header

    private var headerStrip: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(state.puzzle.difficulty.label)
                    .font(BKFont.caption(10)).tracking(0.8)
                    .foregroundStyle(BKTheme.accent)
                Text("\(state.moves) / \(state.puzzle.maxMoves) MOVES")
                    .font(BKFont.headline(15))
                    .foregroundStyle(BKTheme.textPrimary)
            }
            Spacer()
            VStack(alignment: .center, spacing: 4) {
                Text("PAR").font(BKFont.caption(10)).tracking(0.8).foregroundStyle(BKTheme.textMuted)
                Text("\(state.optimalMoves)").font(BKFont.headline(15)).foregroundStyle(BKTheme.textPrimary)
            }
            VStack(alignment: .trailing, spacing: 4) {
                Text("LIVES").font(BKFont.caption(10)).tracking(0.8).foregroundStyle(BKTheme.textMuted)
                HStack(spacing: 3) {
                    ForEach(0..<state.puzzle.mistakesAllowed, id: \.self) { i in
                        Image(systemName: i < state.livesRemaining ? "heart.fill" : "heart")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(i < state.livesRemaining ? BKTheme.wrong : BKTheme.textMuted)
                    }
                }
            }
        }
        .padding(14)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private var instruction: some View {
        Text("Connect the two players. Add teammates one at a time — each must have shared a club at the same time as the player above.")
            .font(BKFont.caption(11))
            .foregroundStyle(BKTheme.textMuted)
            .multilineTextAlignment(.center)
    }

    // MARK: Chain

    private var chainColumn: some View {
        VStack(spacing: 0) {
            ClubChainPlayerCard(player: state.puzzle.start, role: .start)

            ForEach(state.steps) { step in
                ClubChainConnector(link: step.link, style: .confirmed)
                ClubChainPlayerCard(player: step.player, role: .added)
            }

            if state.phase == .playing {
                searchArea
            }

            if state.phase == .won, let closing = state.closingLink {
                ClubChainConnector(link: closing, style: .confirmed)
            } else if state.phase == .playing {
                ClubChainConnector(link: nil, style: .pending)
            } else {
                ClubChainConnector(link: nil, style: .broken)
            }

            ClubChainPlayerCard(player: state.puzzle.target, role: state.won ? .targetSolved : .target)
        }
    }

    private var searchArea: some View {
        VStack(spacing: 8) {
            ClubChainConnector(link: nil, style: .pending)

            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(BKTheme.textMuted)
                TextField("Add the next player…", text: $viewModel.searchQuery)
                    .font(BKFont.body())
                    .foregroundStyle(BKTheme.textPrimary)
                    .focused($isSearchFocused)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .onSubmit { Task { await viewModel.search() } }
                if viewModel.isValidating {
                    ProgressView().tint(BKTheme.accent).scaleEffect(0.8)
                }
            }
            .padding(12)
            .background(BKTheme.cardElevated)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(BKTheme.accent.opacity(0.35), lineWidth: 1)
            )
            .onChange(of: viewModel.searchQuery) { _, _ in
                Task { await viewModel.search() }
            }

            if let message = viewModel.invalidMessage {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(BKTheme.wrong)
                    Text(message)
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.wrong)
                }
                .transition(.opacity)
            }

            if viewModel.isSearching {
                ProgressView().tint(BKTheme.accent).padding(.vertical, 4)
            } else if !viewModel.searchResults.isEmpty {
                PlayerSearchResultsList(
                    players: viewModel.searchResults,
                    isDisabled: { viewModel.isPlaced($0.id) },
                    onSelect: { player in
                        isSearchFocused = false
                        Task { await viewModel.addPlayer(player) }
                    }
                )
            }
        }
        .animation(.easeInOut(duration: 0.2), value: viewModel.invalidMessage)
    }
}

// MARK: - Player card

private enum ClubChainNodeRole {
    case start, added, target, targetSolved
}

private struct ClubChainPlayerCard: View {
    let player: ClubChainPlayer
    let role: ClubChainNodeRole

    private var tag: String {
        switch role {
        case .start: return "START"
        case .added: return "ADDED"
        case .target, .targetSolved: return "TARGET"
        }
    }

    private var accentColor: Color {
        switch role {
        case .start: return BKTheme.textSecondary
        case .added: return BKTheme.accent
        case .target: return BKTheme.streak
        case .targetSolved: return BKTheme.accent
        }
    }

    private var subtitle: String {
        [player.position, player.nationality].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: 12) {
            PlayerAvatar(urlString: player.headshotUrl, size: 46)
                .overlay(Circle().stroke(accentColor.opacity(0.6), lineWidth: 1.5))

            VStack(alignment: .leading, spacing: 3) {
                Text(tag)
                    .font(BKFont.caption(9)).tracking(0.8)
                    .foregroundStyle(accentColor)
                Text(player.name.uppercased())
                    .font(.system(size: 15, weight: .black, design: .rounded))
                    .foregroundStyle(BKTheme.textPrimary)
                    .lineLimit(1).minimumScaleFactor(0.8)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(BKFont.caption(10))
                        .foregroundStyle(BKTheme.textMuted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)

            if role == .targetSolved {
                Ph.checkCircle.fill.color(BKTheme.accent).frame(width: 22, height: 22)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(role == .targetSolved ? BKTheme.accent.opacity(0.12) : BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(accentColor.opacity(role == .start || role == .target ? 0.25 : 0.5), lineWidth: 1)
        )
    }
}

// MARK: - Connector between nodes

private enum ClubChainConnectorStyle { case confirmed, pending, broken }

private struct ClubChainConnector: View {
    let link: TeammateLinkDTO?
    let style: ClubChainConnectorStyle

    private var lineColor: Color {
        switch style {
        case .confirmed: return BKTheme.accent
        case .pending: return BKTheme.accent.opacity(0.4)
        case .broken: return BKTheme.wrong.opacity(0.5)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(lineColor).frame(width: 2, height: 10)

            if let link {
                HStack(spacing: 7) {
                    if let badge = link.clubBadgeUrl, let url = URL(string: badge) {
                        AsyncImage(url: url) { image in
                            image.resizable().scaledToFit()
                        } placeholder: { Color.clear }
                        .frame(width: 18, height: 18)
                    }
                    Text("Shared \(link.clubName)")
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.textPrimary)
                    Text(link.yearsText)
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.textMuted)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(BKTheme.accent.opacity(0.12))
                .clipShape(Capsule())
                .overlay(Capsule().stroke(BKTheme.accent.opacity(0.4), lineWidth: 1))
            } else {
                Image(systemName: style == .broken ? "xmark" : "arrow.down")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(lineColor)
                    .frame(width: 24, height: 24)
                    .background(BKTheme.cardElevated)
                    .clipShape(Circle())
            }

            Rectangle().fill(lineColor).frame(width: 2, height: 10)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Result

private struct ClubChainResultView: View {
    let state: ClubChainGameState
    let date: String
    let allowReplay: Bool
    var onPlayAgain: () -> Void
    var onHome: () -> Void

    private var won: Bool { state.won }

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()
            ScrollView(showsIndicators: false) {
                VStack(spacing: 18) {
                    Text(won ? "CONNECTED!" : "CHAIN BROKEN")
                        .font(BKFont.headline(28))
                        .foregroundStyle(won ? BKTheme.accent : BKTheme.textPrimary)

                    if won {
                        Text("\(state.medal.emoji) \(state.medal.title)")
                            .font(BKFont.title(22))
                            .foregroundStyle(BKTheme.textPrimary)
                    } else {
                        Text("You ran out of \(state.livesRemaining <= 0 ? "lives" : "moves").")
                            .font(BKFont.body(14))
                            .foregroundStyle(BKTheme.textSecondary)
                    }

                    Text("+\(DailyXP.xp(mode: GameModeID.clubChain.rawValue, score: state.score, guesses: state.moves, won: won)) XP")
                        .font(BKFont.headline(20))
                        .foregroundStyle(BKTheme.accent)

                    HStack(spacing: 24) {
                        statBlock(value: "\(state.moves)", label: won ? "YOUR MOVES" : "MOVES USED")
                        statBlock(value: "\(state.optimalMoves)", label: "SHORTEST")
                    }

                    chainSummary

                    HStack(spacing: 12) {
                        ShareLink(item: state.shareText(date: date)) {
                            Text("SHARE")
                                .font(BKFont.headline(14))
                                .foregroundStyle(BKTheme.textPrimary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(BKTheme.card)
                                .clipShape(Capsule())
                        }
                        if allowReplay {
                            Button(action: onPlayAgain) {
                                Text("PLAY AGAIN")
                                    .font(BKFont.headline(14))
                                    .foregroundStyle(BKTheme.textPrimary)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 14)
                                    .background(BKTheme.card)
                                    .clipShape(Capsule())
                            }
                        }
                        Button(action: onHome) {
                            Text(allowReplay ? "CONTINUE" : "DONE")
                                .font(BKFont.headline(14))
                                .foregroundStyle(BKTheme.background)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(BKTheme.accent)
                                .clipShape(Capsule())
                        }
                    }
                }
                .padding(20)
            }
        }
    }

    private func statBlock(value: String, label: String) -> some View {
        VStack(spacing: 4) {
            Text(value).font(.system(size: 28, weight: .black, design: .rounded)).foregroundStyle(BKTheme.textPrimary)
            Text(label).font(BKFont.caption(9)).tracking(0.6).foregroundStyle(BKTheme.textMuted)
        }
    }

    private var chainSummary: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("YOUR CHAIN")
                .font(BKFont.caption(10)).tracking(0.8)
                .foregroundStyle(BKTheme.textMuted)

            summaryRow(name: state.puzzle.start.name, badge: nil, connectorAbove: false)
            ForEach(state.steps) { step in
                connectorRow(step.link)
                summaryRow(name: step.player.name, badge: nil, connectorAbove: true)
            }
            if won, let closing = state.closingLink {
                connectorRow(closing)
                summaryRow(name: state.puzzle.target.name, badge: nil, connectorAbove: true)
            } else {
                connectorRow(nil)
                summaryRow(name: state.puzzle.target.name, badge: nil, connectorAbove: true, dimmed: true)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func summaryRow(name: String, badge: String?, connectorAbove: Bool, dimmed: Bool = false) -> some View {
        HStack(spacing: 8) {
            Circle().fill(dimmed ? BKTheme.textMuted : BKTheme.accent).frame(width: 8, height: 8)
            Text(name)
                .font(BKFont.headline(14))
                .foregroundStyle(dimmed ? BKTheme.textMuted : BKTheme.textPrimary)
            Spacer(minLength: 0)
        }
    }

    private func connectorRow(_ link: TeammateLinkDTO?) -> some View {
        HStack(spacing: 8) {
            Text("↓")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(link == nil ? BKTheme.wrong : BKTheme.accent)
                .frame(width: 8)
            if let link {
                Text("Shared \(link.clubName), \(link.yearsText)")
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textSecondary)
            } else {
                Text("Never connected")
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.wrong)
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, 2)
    }
}
