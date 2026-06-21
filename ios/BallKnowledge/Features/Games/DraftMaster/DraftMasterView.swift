import SwiftUI

// MARK: - ViewModel

@MainActor
@Observable
final class DraftMasterViewModel {
    var state: DraftMasterGameState
    var searchQuery = ""
    var searchResults: [PlayerSearchResultDTO] = []
    var isSearching = false
    var showResult = false
    var showLeaderboard = false
    var showShare = false
    var confettiBurstToken = 0
    var resultSummary: DraftMasterResultSummary?
    var animatedScore = 0

    private let practice: Bool

    init(practice: Bool = false) {
        self.practice = practice
        let challenge = practice ? DraftMasterSeed.makePracticeChallenge() : DraftMasterSeed.makeDailyChallenge()
        self.state = DraftMasterGameState(challenge: challenge)
    }

    func startDraft() {
        HapticManager.light()
        state.phase = .drafting
        state.currentPromptIndex = 0
    }

    func search() async {
        guard let prompt = state.currentPrompt else {
            searchResults = []
            return
        }

        let query = searchQuery.trimmingCharacters(in: .whitespaces)
        guard query.count >= 2 else {
            searchResults = []
            return
        }

        isSearching = true
        defer { isSearching = false }

        do {
            let results = try await APIClient.shared.searchPlayers(query: query)
            searchResults = results.filter { player in
                DraftMasterMatcher.matches(player, prompt: prompt)
                    && !state.usedPlayerIds.contains(player.id)
            }
        } catch {
            searchResults = []
        }
    }

    func selectPlayer(_ player: PlayerSearchResultDTO) {
        guard let prompt = state.currentPrompt else { return }
        if let error = DraftMasterMatcher.validationError(
            for: player,
            prompt: prompt,
            usedIds: state.usedPlayerIds
        ) {
            HapticManager.error()
            return
        }

        HapticManager.light()
        state.pendingPlayer = player
        state.phase = .assigningPlayer(promptIndex: state.currentPromptIndex)
        searchQuery = ""
        searchResults = []
    }

    func assignPosition(_ position: DraftMasterPosition) {
        guard let player = state.pendingPlayer,
              let prompt = state.currentPrompt,
              let league = DraftMasterMatcher.league(from: prompt),
              !state.filledPositions.contains(position) else { return }

        let contribution = DraftMasterScoring.contribution(
            for: player,
            league: league,
            category: state.challenge.category
        )

        state.picks.append(
            DraftMasterPick(
                prompt: prompt,
                player: player,
                position: position,
                contribution: contribution
            )
        )
        state.pendingPlayer = nil
        HapticManager.success()

        if state.picks.count >= DraftMasterChallenge.promptCount {
            finishDraft()
        } else {
            state.currentPromptIndex += 1
            state.phase = .drafting
        }
    }

    func cancelAssignment() {
        state.pendingPlayer = nil
        state.phase = .drafting
    }

    func restart() {
        let challenge = practice ? DraftMasterSeed.makePracticeChallenge() : DraftMasterSeed.makeDailyChallenge()
        state = DraftMasterGameState(challenge: challenge)
        searchQuery = ""
        searchResults = []
        showResult = false
        showLeaderboard = false
        showShare = false
        confettiBurstToken = 0
        resultSummary = nil
        animatedScore = 0
    }

    func newPracticeDraft() {
        state = DraftMasterGameState(challenge: DraftMasterSeed.makePracticeChallenge())
        searchQuery = ""
        searchResults = []
        showResult = false
        resultSummary = nil
        animatedScore = 0
    }

    private func finishDraft() {
        let score = DraftMasterScoring.teamScore(picks: state.picks)
        let summary = DraftMasterSeed.resultSummary(teamScore: score, picks: state.picks)
        state.teamScore = score
        state.rank = summary.rank
        state.percentile = summary.percentile
        state.xpEarned = summary.xpEarned
        state.phase = .complete
        resultSummary = summary

        if score >= DraftMasterTiming.confettiThreshold {
            confettiBurstToken += 1
        }

        Task {
            try? await Task.sleep(for: .seconds(DraftMasterTiming.resultReveal))
            animatedScore = score
            showResult = true
        }
    }
}

// MARK: - Main View

struct DraftMasterView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var viewModel: DraftMasterViewModel
    @FocusState private var isSearchFocused: Bool
    var onComplete: () -> Void

    init(practice: Bool = false, onComplete: @escaping () -> Void) {
        _viewModel = State(initialValue: DraftMasterViewModel(practice: practice))
        self.onComplete = onComplete
    }

    var body: some View {
        ZStack {
            NavigationStack {
                Group {
                    switch viewModel.state.phase {
                    case .intro:
                        DraftMasterIntroView(
                            challenge: viewModel.state.challenge,
                            onStart: viewModel.startDraft,
                            onNewPractice: viewModel.newPracticeDraft
                        )
                    case .drafting, .assigningPlayer:
                        draftScreen
                    case .complete:
                        draftScreen
                    }
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
                        Text("DRAFT MASTER")
                            .font(BKFont.caption(13))
                            .tracking(1)
                            .foregroundStyle(BKTheme.accent)
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        if viewModel.state.phase == .intro {
                            Button { viewModel.newPracticeDraft() } label: {
                                Text("NEW")
                                    .font(BKFont.caption(10))
                                    .foregroundStyle(BKTheme.textMuted)
                            }
                        }
                    }
                }
            }

            if case .assigningPlayer = viewModel.state.phase,
               let player = viewModel.state.pendingPlayer {
                DraftMasterPositionPicker(
                    player: player,
                    availablePositions: viewModel.state.availablePositions,
                    onSelect: viewModel.assignPosition,
                    onCancel: viewModel.cancelAssignment
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .zIndex(20)
            }

            FootballConfettiView(burstToken: viewModel.confettiBurstToken)
                .zIndex(999)
        }
        .animation(.spring(response: 0.38, dampingFraction: 0.82), value: viewModel.state.phase)
        .fullScreenCover(isPresented: $viewModel.showResult) {
            if let summary = viewModel.resultSummary {
                DraftMasterResultView(
                    challenge: viewModel.state.challenge,
                    picks: viewModel.state.picks,
                    summary: summary,
                    onLeaderboard: {
                        viewModel.showResult = false
                        viewModel.showLeaderboard = true
                    },
                    onShare: { viewModel.showShare = true },
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
        .sheet(isPresented: $viewModel.showLeaderboard) {
            if let summary = viewModel.resultSummary {
                DraftMasterLeaderboardSheet(
                    daily: summary.dailyBoard,
                    weekly: summary.weeklyBoard
                )
            }
        }
        .sheet(isPresented: $viewModel.showShare) {
            if let summary = viewModel.resultSummary {
                DraftMasterShareSheet(
                    challenge: viewModel.state.challenge,
                    picks: viewModel.state.picks,
                    summary: summary
                )
            }
        }
    }

    private var draftScreen: some View {
        VStack(spacing: 0) {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 14) {
                    DraftMasterCategoryStrip(challenge: viewModel.state.challenge)

                    if let prompt = viewModel.state.currentPrompt,
                       viewModel.state.phase != .complete {
                        DraftMasterPromptCard(
                            prompt: prompt,
                            index: viewModel.state.currentPromptIndex + 1,
                            total: DraftMasterChallenge.promptCount
                        )
                    }

                    DraftMasterPitchView(
                        picks: viewModel.state.picks,
                        highlightAvailable: isAssigningPosition
                    )

                    if !viewModel.state.picks.isEmpty {
                        DraftMasterPickList(
                            picks: viewModel.state.picks,
                            category: viewModel.state.challenge.category
                        )
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 16)
            }

            if viewModel.state.phase == .drafting {
                DraftMasterSearchSection(
                    viewModel: viewModel,
                    isSearchFocused: $isSearchFocused
                )
            }
        }
    }

    private var isAssigningPosition: Bool {
        if case .assigningPlayer = viewModel.state.phase { return true }
        return false
    }
}

// MARK: - Intro

private struct DraftMasterIntroView: View {
    let challenge: DraftMasterChallenge
    var onStart: () -> Void
    var onNewPractice: () -> Void

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 20) {
                VStack(spacing: 10) {
                    Text("DAILY DRAFT")
                        .font(BKFont.caption(11))
                        .tracking(1.2)
                        .foregroundStyle(BKTheme.accent)

                    Text("Build the highest-scoring XI")
                        .font(BKFont.headline(18))
                        .foregroundStyle(BKTheme.textPrimary)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 12)

                VStack(spacing: 12) {
                    introRow(label: "TODAY'S CATEGORY", value: challenge.category.title.uppercased(), accent: true)
                    introRow(label: "FORMATION", value: challenge.formation.rawValue, accent: false)
                    introRow(label: "REWARD", value: "XP + LEADERBOARD RANK", accent: false)
                }
                .padding(16)
                .background(BKTheme.cardElevated.opacity(0.9))
                .clipShape(RoundedRectangle(cornerRadius: 16))

                VStack(alignment: .leading, spacing: 10) {
                    Text("TODAY'S 11 PROMPTS")
                        .font(BKFont.caption(11))
                        .tracking(0.8)
                        .foregroundStyle(BKTheme.textMuted)

                    ForEach(Array(challenge.prompts.enumerated()), id: \.element.id) { index, prompt in
                        HStack(spacing: 10) {
                            Text("\(index + 1)")
                                .font(BKFont.caption(10))
                                .foregroundStyle(BKTheme.accent)
                                .frame(width: 18)
                            Text(prompt.label)
                                .font(BKFont.body(13))
                                .foregroundStyle(BKTheme.textPrimary)
                            Spacer()
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(BKTheme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }

                Button(action: onStart) {
                    HStack(spacing: 8) {
                        Text("START DRAFT")
                            .font(BKFont.headline(15))
                        Ph.arrowRight.bold
                            .color(BKTheme.background)
                            .frame(width: 14, height: 14)
                    }
                    .foregroundStyle(BKTheme.background)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(BKTheme.accent)
                    .clipShape(Capsule())
                }
                .padding(.top, 4)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 32)
        }
    }

    private func introRow(label: String, value: String, accent: Bool) -> some View {
        VStack(spacing: 4) {
            Text(label)
                .font(BKFont.caption(10))
                .tracking(0.6)
                .foregroundStyle(BKTheme.textMuted)
            Text(value)
                .font(accent ? BKFont.headline(18) : BKFont.headline(15))
                .foregroundStyle(accent ? BKTheme.accent : BKTheme.textPrimary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Category Strip

private struct DraftMasterCategoryStrip: View {
    let challenge: DraftMasterChallenge

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("CATEGORY")
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.textMuted)
                Text(challenge.category.title.uppercased())
                    .font(BKFont.headline(14))
                    .foregroundStyle(BKTheme.accent)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text("FORMATION")
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.textMuted)
                Text(challenge.formation.rawValue)
                    .font(BKFont.headline(14))
                    .foregroundStyle(BKTheme.textPrimary)
            }
        }
        .padding(14)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

// MARK: - Prompt Card

private struct DraftMasterPromptCard: View {
    let prompt: DraftMasterPrompt
    let index: Int
    let total: Int

    var body: some View {
        VStack(spacing: 10) {
            Text("PICK \(index) OF \(total)")
                .font(BKFont.caption(10))
                .tracking(0.8)
                .foregroundStyle(BKTheme.textMuted)

            HStack(spacing: 12) {
                Text(GuessWhoDisplay.nationalityFlag(prompt.nationality))
                    .font(.system(size: 28))
                VStack(alignment: .leading, spacing: 4) {
                    Text(prompt.nationality.uppercased())
                        .font(BKFont.headline(16))
                        .foregroundStyle(BKTheme.textPrimary)
                    HStack(spacing: 6) {
                        LeagueBadgeImage(league: prompt.league, size: 16) {
                            Text(GuessWhoDisplay.leagueAbbrev(prompt.league))
                                .font(.system(size: 7, weight: .bold))
                        }
                        Text(prompt.league.uppercased())
                            .font(BKFont.caption(10))
                            .foregroundStyle(BKTheme.textSecondary)
                    }
                }
                Spacer()
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BKTheme.cardElevated.opacity(0.95))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay {
            RoundedRectangle(cornerRadius: 16)
                .stroke(BKTheme.accent.opacity(0.35), lineWidth: 1)
        }
    }
}

// MARK: - Pitch

private struct DraftMasterPitchView: View {
    let picks: [DraftMasterPick]
    var highlightAvailable = false

    var body: some View {
        GeometryReader { geo in
            ZStack {
                RoundedRectangle(cornerRadius: 18)
                    .fill(
                        LinearGradient(
                            colors: [Color(hex: "0D3B1A"), Color(hex: "145A27"), Color(hex: "0D3B1A")],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )

                RoundedRectangle(cornerRadius: 18)
                    .stroke(Color.white.opacity(0.18), lineWidth: 1.5)

                Circle()
                    .stroke(Color.white.opacity(0.15), lineWidth: 1)
                    .frame(width: geo.size.width * 0.22)

                Rectangle()
                    .fill(Color.white.opacity(0.12))
                    .frame(height: 1)

                ForEach(DraftMasterPosition.allCases) { position in
                    let pick = picks.first { $0.position == position }
                    DraftMasterPitchSlot(
                        position: position,
                        pick: pick,
                        highlight: highlightAvailable && pick == nil,
                        size: geo.size
                    )
                }
            }
        }
        .frame(height: 360)
    }
}

private struct DraftMasterPitchSlot: View {
    let position: DraftMasterPosition
    let pick: DraftMasterPick?
    let highlight: Bool
    let size: CGSize

    var body: some View {
        let point = position.pitchPoint
        VStack(spacing: 3) {
            ZStack {
                Circle()
                    .fill(pick == nil ? Color.black.opacity(0.28) : BKTheme.accent.opacity(0.92))
                    .frame(width: pick == nil ? 34 : 40, height: pick == nil ? 34 : 40)
                    .overlay {
                        Circle()
                            .stroke(highlight ? BKTheme.accent : Color.white.opacity(0.25), lineWidth: highlight ? 2 : 1)
                    }

                if pick == nil {
                    Text(position.label)
                        .font(.system(size: 9, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.white.opacity(0.85))
                }
            }

            if let pick {
                Text(shortName(pick.player.name))
                    .font(.system(size: 8, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.white)
                    .lineLimit(1)
                    .frame(maxWidth: 64)
                Text("\(pick.contribution)")
                    .font(.system(size: 8, weight: .semibold, design: .rounded))
                    .foregroundStyle(BKTheme.accent)
            }
        }
        .position(
            x: point.x * size.width,
            y: point.y * size.height
        )
    }

    private func shortName(_ name: String) -> String {
        name.split(separator: " ").last.map(String.init) ?? name
    }
}

// MARK: - Pick List

private struct DraftMasterPickList: View {
    let picks: [DraftMasterPick]
    let category: DraftMasterCategory

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("YOUR XI")
                    .font(BKFont.caption(11))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.textMuted)
                Spacer()
                Text("\(picks.count)/\(DraftMasterChallenge.promptCount)")
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.accent)
            }

            ForEach(picks) { pick in
                HStack(spacing: 10) {
                    Text(pick.position.label)
                        .font(BKFont.caption(10))
                        .foregroundStyle(BKTheme.accent)
                        .frame(width: 28, alignment: .leading)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(pick.player.name)
                            .font(BKFont.headline(13))
                            .foregroundStyle(BKTheme.textPrimary)
                            .lineLimit(1)
                        Text(pick.prompt.label)
                            .font(BKFont.caption(9))
                            .foregroundStyle(BKTheme.textMuted)
                            .lineLimit(1)
                    }
                    Spacer()
                    Text("+\(pick.contribution)")
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.accent)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(BKTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
        }
    }
}

// MARK: - Search

private struct DraftMasterSearchSection: View {
    @Bindable var viewModel: DraftMasterViewModel
    var isSearchFocused: FocusState<Bool>.Binding

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                TextField("", text: $viewModel.searchQuery, prompt:
                    Text("SEARCH PLAYERS")
                        .foregroundStyle(BKTheme.textMuted)
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                )
                .textFieldStyle(.plain)
                .foregroundStyle(BKTheme.background)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .focused(isSearchFocused)
                .submitLabel(.search)
                .onChange(of: viewModel.searchQuery) { _, _ in
                    Task { await viewModel.search() }
                }

                if viewModel.isSearching {
                    ProgressView().tint(BKTheme.accent)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(BKTheme.accent.opacity(0.35), lineWidth: 1.5)
            )

            if !viewModel.searchResults.isEmpty {
                VStack(spacing: 0) {
                    ForEach(viewModel.searchResults) { player in
                        Button {
                            isSearchFocused.wrappedValue = false
                            viewModel.selectPlayer(player)
                        } label: {
                            HStack(spacing: 12) {
                                TeamBadgeImage(club: player.club, league: player.league, size: 28) {
                                    Circle()
                                        .fill(BKTheme.cardElevated)
                                        .frame(width: 28, height: 28)
                                        .overlay(
                                            Text(GuessWhoDisplay.clubAbbrev(player.club))
                                                .font(.system(size: 8, weight: .bold, design: .rounded))
                                                .foregroundStyle(BKTheme.textMuted)
                                        )
                                }

                                VStack(alignment: .leading, spacing: 3) {
                                    Text(player.name.uppercased())
                                        .font(.system(size: 13, weight: .bold, design: .rounded))
                                        .foregroundStyle(BKTheme.textPrimary)
                                    Text("\(player.nationality) · \(player.league)")
                                        .font(BKFont.caption(11))
                                        .foregroundStyle(BKTheme.textMuted)
                                }
                                Spacer()
                                Ph.caretRight.bold
                                    .color(BKTheme.textMuted)
                                    .frame(width: 12, height: 12)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)
                        }

                        if player.id != viewModel.searchResults.last?.id {
                            Divider().background(BKTheme.cardElevated)
                        }
                    }
                }
                .background(BKTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(BKTheme.background)
    }
}

// MARK: - Position Picker

private struct DraftMasterPositionPicker: View {
    let player: PlayerSearchResultDTO
    let availablePositions: [DraftMasterPosition]
    var onSelect: (DraftMasterPosition) -> Void
    var onCancel: () -> Void

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.opacity(0.55).ignoresSafeArea()
                .onTapGesture { onCancel() }

            VStack(spacing: 16) {
                Capsule()
                    .fill(BKTheme.textMuted.opacity(0.5))
                    .frame(width: 36, height: 4)

                VStack(spacing: 6) {
                    Text("ASSIGN POSITION")
                        .font(BKFont.caption(10))
                        .tracking(0.8)
                        .foregroundStyle(BKTheme.textMuted)
                    Text(player.name)
                        .font(BKFont.headline(18))
                        .foregroundStyle(BKTheme.textPrimary)
                    Text("Pick where they play in your XI")
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.textSecondary)
                }

                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                    ForEach(DraftMasterPosition.allCases) { position in
                        let isAvailable = availablePositions.contains(position)
                        Button {
                            if isAvailable { onSelect(position) }
                        } label: {
                            Text(position.label)
                                .font(BKFont.headline(13))
                                .foregroundStyle(isAvailable ? BKTheme.background : BKTheme.textMuted)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .background(isAvailable ? BKTheme.accent : BKTheme.cardElevated)
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                        .disabled(!isAvailable)
                    }
                }

                Button("Cancel", action: onCancel)
                    .font(BKFont.body(13))
                    .foregroundStyle(BKTheme.textMuted)
            }
            .padding(20)
            .background(BKTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
        }
    }
}

// MARK: - Result

private struct DraftMasterResultView: View {
    let challenge: DraftMasterChallenge
    let picks: [DraftMasterPick]
    let summary: DraftMasterResultSummary
    var onLeaderboard: () -> Void
    var onShare: () -> Void
    var onPlayAgain: () -> Void
    var onHome: () -> Void

    @State private var revealStep = 0

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 20) {
                    VStack(spacing: 8) {
                        Text("DAILY DRAFT COMPLETE")
                            .font(BKFont.caption(11))
                            .tracking(1)
                            .foregroundStyle(BKTheme.accent)
                        Text(challenge.category.title.uppercased())
                            .font(BKFont.headline(16))
                            .foregroundStyle(BKTheme.textSecondary)
                    }
                    .padding(.top, 24)

                    if revealStep >= 1 {
                        Text("\(summary.teamScore.formatted())")
                            .font(BKFont.title(52))
                            .foregroundStyle(BKTheme.accent)
                            .contentTransition(.numericText())
                            .transition(.scale.combined(with: .opacity))
                    }

                    if revealStep >= 2 {
                        HStack(spacing: 16) {
                            statPill("RANK", value: "#\(summary.rank)")
                            statPill("PERCENTILE", value: DraftMasterScoring.percentileLabel(summary.percentile))
                        }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    }

                    if revealStep >= 3 {
                        Text("+\(summary.xpEarned) XP")
                            .font(BKFont.headline(20))
                            .foregroundStyle(BKTheme.accent)
                            .transition(.opacity)
                    }

                    DraftMasterShareCardView(
                        challenge: challenge,
                        picks: picks,
                        summary: summary
                    )
                    .padding(.horizontal, 4)

                    VStack(spacing: 10) {
                        Button(action: onLeaderboard) {
                            Text("VIEW LEADERBOARD")
                                .font(BKFont.headline(14))
                                .foregroundStyle(BKTheme.background)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(BKTheme.accent)
                                .clipShape(Capsule())
                        }

                        Button(action: onShare) {
                            Text("SHARE TEAM")
                                .font(BKFont.headline(14))
                                .foregroundStyle(BKTheme.textPrimary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(BKTheme.card)
                                .clipShape(Capsule())
                        }

                        Button(action: onPlayAgain) {
                            Text("PLAY AGAIN")
                                .font(BKFont.headline(14))
                                .foregroundStyle(BKTheme.textMuted)
                        }
                        .padding(.top, 4)

                        Button(action: onHome) {
                            Text("BACK TO GAMES")
                                .font(BKFont.caption(11))
                                .foregroundStyle(BKTheme.textMuted)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
            }
        }
        .task {
            for step in 1...3 {
                try? await Task.sleep(for: .seconds(0.45))
                withAnimation(.spring(response: 0.42, dampingFraction: 0.78)) {
                    revealStep = step
                }
                HapticManager.light()
            }
        }
    }

    private func statPill(_ label: String, value: String) -> some View {
        VStack(spacing: 4) {
            Text(label)
                .font(BKFont.caption(9))
                .foregroundStyle(BKTheme.textMuted)
            Text(value)
                .font(BKFont.headline(14))
                .foregroundStyle(BKTheme.textPrimary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - Share Card

struct DraftMasterShareCardView: View {
    let challenge: DraftMasterChallenge
    let picks: [DraftMasterPick]
    let summary: DraftMasterResultSummary

    var body: some View {
        VStack(spacing: 14) {
            HStack {
                Text("DAILY DRAFT")
                    .font(BKFont.caption(10))
                    .tracking(1)
                    .foregroundStyle(BKTheme.accent)
                Spacer()
                Text(challenge.formation.rawValue)
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.textMuted)
            }

            Text(challenge.category.title.uppercased())
                .font(BKFont.headline(15))
                .foregroundStyle(BKTheme.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)

            DraftMasterPitchView(picks: picks)
                .frame(height: 260)

            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("SCORE")
                        .font(BKFont.caption(9))
                        .foregroundStyle(BKTheme.textMuted)
                    Text(summary.teamScore.formatted())
                        .font(BKFont.headline(22))
                        .foregroundStyle(BKTheme.accent)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text(DraftMasterScoring.percentileLabel(summary.percentile))
                        .font(BKFont.caption(10))
                        .foregroundStyle(BKTheme.textPrimary)
                    Text("Rank #\(summary.rank)")
                        .font(BKFont.caption(10))
                        .foregroundStyle(BKTheme.textMuted)
                }
            }
        }
        .padding(16)
        .background(
            LinearGradient(
                colors: [BKTheme.cardElevated, BKTheme.card],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay {
            RoundedRectangle(cornerRadius: 18)
                .stroke(BKTheme.accent.opacity(0.25), lineWidth: 1)
        }
    }
}

private struct DraftMasterShareSheet: View {
    let challenge: DraftMasterChallenge
    let picks: [DraftMasterPick]
    let summary: DraftMasterResultSummary
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                DraftMasterShareCardView(
                    challenge: challenge,
                    picks: picks,
                    summary: summary
                )
                .padding(.horizontal, 16)

                ShareLink(item: DraftMasterSeed.shareText(
                    challenge: challenge,
                    picks: picks,
                    summary: summary
                )) {
                    Text("SHARE")
                        .font(BKFont.headline(14))
                        .foregroundStyle(BKTheme.background)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(BKTheme.accent)
                        .clipShape(Capsule())
                }
                .padding(.horizontal, 16)

                Spacer()
            }
            .padding(.top, 16)
            .background(BKTheme.background)
            .navigationTitle("Share Team")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(BKTheme.accent)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Leaderboard

private struct DraftMasterLeaderboardSheet: View {
    let daily: [DraftMasterLeaderboardEntry]
    let weekly: [DraftMasterLeaderboardEntry]
    @State private var tab = 0
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Picker("Board", selection: $tab) {
                    Text("Daily").tag(0)
                    Text("Weekly").tag(1)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)

                List(tab == 0 ? daily : weekly) { entry in
                    HStack {
                        Text("#\((tab == 0 ? daily : weekly).firstIndex(of: entry)! + 1)")
                            .font(BKFont.caption(11))
                            .foregroundStyle(BKTheme.textMuted)
                            .frame(width: 28, alignment: .leading)
                        Text(entry.name)
                            .font(BKFont.headline(14))
                            .foregroundStyle(entry.isUser ? BKTheme.accent : BKTheme.textPrimary)
                        Spacer()
                        Text(entry.score.formatted())
                            .font(BKFont.headline(14))
                            .foregroundStyle(BKTheme.textPrimary)
                    }
                    .listRowBackground(entry.isUser ? BKTheme.cardElevated : BKTheme.card)
                }
                .scrollContentBackground(.hidden)
            }
            .background(BKTheme.background)
            .navigationTitle("Leaderboards")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(BKTheme.accent)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
