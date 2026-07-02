import SwiftUI

// MARK: - ViewModel

@MainActor
@Observable
final class WorldCupXIViewModel {
    var state: WorldCupXIGameState
    var searchQuery = ""
    var searchResults: [PlayerSearchResultDTO] = []
    var isSearching = false
    var showSlotSheet = false
    var showResult = false
    var confettiBurstToken = 0
    /// Slots whose "played for [club]" hint the player has chosen to reveal.
    var revealedClubs: Set<String> = []

    private let dailyBundle: DailyBundleDTO?
    private let dailyDate: String?

    init(dailyDate: String? = nil, dailyBundle: DailyBundleDTO? = nil) {
        self.dailyBundle = dailyBundle
        self.dailyDate = dailyDate
        self.state = WorldCupXIGameState(puzzle: Self.resolvePuzzle(dailyDate: dailyDate, dailyBundle: dailyBundle))
    }

    /// Prefer the server-generated puzzle; fall back to the local seed (offline).
    private static func resolvePuzzle(dailyDate: String?, dailyBundle: DailyBundleDTO?) -> WorldCupXIPuzzle {
        if let server = DailyChallengeResolver.worldCupXIPuzzle(from: dailyBundle) { return server }
        return WorldCupXISeed.puzzle(for: dailyDate)
    }

    var activeSlot: WorldCupXISlot? {
        guard let id = state.activeSlotId else { return nil }
        return state.puzzle.slots.first { $0.id == id }
    }

    /// A slot is locked once it's been answered (one attempt per clue).
    func isLocked(_ slot: WorldCupXISlot) -> Bool { state.fills[slot.id] != nil }

    func openSlot(_ slot: WorldCupXISlot) {
        guard state.phase == .playing, !isLocked(slot) else { return }
        HapticManager.light()
        state.activeSlotId = slot.id
        searchQuery = ""
        searchResults = []
        showSlotSheet = true
    }

    /// Reveal the club hint for the open slot (kept hidden by default so the badge isn't a giveaway).
    func revealClub() {
        guard let id = state.activeSlotId else { return }
        revealedClubs.insert(id)
        HapticManager.light()
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

    func selectPlayer(_ player: PlayerSearchResultDTO) {
        guard let slot = activeSlot else { return }
        let correct = WorldCupXIMatcher.matches(player, expected: slot.expectedName)
        state.fills[slot.id] = WorldCupXIFill(player: player, isCorrect: correct)
        searchQuery = ""
        searchResults = []
        if correct { HapticManager.success() } else { HapticManager.light() }
        showSlotSheet = false
        state.activeSlotId = nil
        if state.allAnswered { finish() }
    }

    func finish() {
        guard state.phase == .playing else { return }
        let result = WorldCupXIScoring.buildResult(puzzle: state.puzzle, state: state)
        state.result = result
        state.phase = .complete
        if result.correctCount >= 6 {
            confettiBurstToken += 1
            HapticManager.success()
        }
        showResult = true
    }

    func restart() {
        state = WorldCupXIGameState(puzzle: Self.resolvePuzzle(dailyDate: dailyDate, dailyBundle: dailyBundle))
        searchQuery = ""
        searchResults = []
        showSlotSheet = false
        showResult = false
        confettiBurstToken = 0
        revealedClubs = []
    }

    /// Mid-game and worth saving: named at least one player, not yet finished.
    var isResumable: Bool {
        state.phase == .playing && !state.fills.isEmpty
    }

    func restore(_ saved: WorldCupXIGameState) {
        state = saved
        searchQuery = ""
        searchResults = []
        showSlotSheet = false
        showResult = false
        revealedClubs = []
    }
}

// MARK: - Main View

struct WorldCupXIView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: WorldCupXIViewModel
    @FocusState private var isSearchFocused: Bool
    private let allowReplay: Bool
    private let dailyDate: String?
    var onComplete: () -> Void

    init(dailyDate: String? = nil, dailyBundle: DailyBundleDTO? = nil, allowReplay: Bool = false, onComplete: @escaping () -> Void) {
        _viewModel = State(initialValue: WorldCupXIViewModel(dailyDate: dailyDate, dailyBundle: dailyBundle))
        self.allowReplay = allowReplay
        self.dailyDate = dailyDate
        self.onComplete = onComplete
    }

    var body: some View {
        ZStack {
            NavigationStack {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 16) {
                        headerStrip
                        WorldCupXIPitchView(state: viewModel.state, onTapSlot: viewModel.openSlot)
                        answerSection
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                }
                .background(StadiumBackground())
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { dismiss() } label: {
                            Ph.x.bold.color(BKTheme.textPrimary).frame(width: 20, height: 20)
                        }
                    }
                    ToolbarItem(placement: .principal) {
                        Text("WORLD CUP XI")
                            .font(BKFont.caption(12))
                            .tracking(1.2)
                            .foregroundStyle(BKTheme.textPrimary)
                    }
                }
            }

            if viewModel.confettiBurstToken > 0, viewModel.state.result?.won == true {
                FootballConfettiView(burstToken: viewModel.confettiBurstToken)
                    .allowsHitTesting(false)
            }
        }
        .persistsGameProgress(
            viewModel.state,
            isResumable: viewModel.isResumable,
            modeId: GameModeID.worldCupXI.rawValue,
            date: dailyDate,
            version: WorldCupXIGameState.progressVersion,
            enabled: !allowReplay
        )
        .onAppear {
            guard !allowReplay, let dailyDate,
                  let saved = GameProgressStore.load(
                    WorldCupXIGameState.self, modeId: GameModeID.worldCupXI.rawValue,
                    date: dailyDate, version: WorldCupXIGameState.progressVersion, context: modelContext) else { return }
            viewModel.restore(saved)
        }
        .sheet(isPresented: $viewModel.showSlotSheet) {
            slotSheet
        }
        .fullScreenCover(isPresented: $viewModel.showResult) {
            if let result = viewModel.state.result {
                WorldCupXIResultView(
                    result: result,
                    allowReplay: allowReplay,
                    onPlayAgain: {
                        viewModel.showResult = false
                        viewModel.restart()
                    },
                    onHome: {
                        if !allowReplay, let dailyDate {
                            Task {
                                await DailyCompletionService.recordCompletion(
                                    modeId: GameModeID.worldCupXI.rawValue,
                                    date: dailyDate,
                                    score: result.score,
                                    won: result.won,
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

    private var headerStrip: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("MYSTERY XI")
                    .font(BKFont.caption(10))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.textMuted)
                Text(viewModel.state.puzzle.formation)
                    .font(BKFont.headline(16))
                    .foregroundStyle(BKTheme.textPrimary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text("NAMED")
                    .font(BKFont.caption(10))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.textMuted)
                Text("\(viewModel.state.correctCount)/\(WorldCupXIPuzzle.slotCount)")
                    .font(BKFont.headline(16))
                    .foregroundStyle(BKTheme.accent)
            }
            VStack(alignment: .trailing, spacing: 4) {
                Text("XP")
                    .font(BKFont.caption(10))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.textMuted)
                Text("\(DailyXP.projected(.worldCupXI, score: viewModel.state.correctCount * WorldCupXIScoring.perCorrect))")
                    .font(BKFont.headline(16))
                    .foregroundStyle(BKTheme.textPrimary)
            }
        }
        .padding(14)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private var answerSection: some View {
        VStack(spacing: 10) {
            Text("Tap a position, read the clue, and name the player. Get as many as you can.")
                .font(BKFont.caption(11))
                .foregroundStyle(BKTheme.textMuted)
                .multilineTextAlignment(.center)

            Button(action: viewModel.finish) {
                Text(viewModel.state.allAnswered ? "SEE RESULTS" : "FINISH")
                    .font(BKFont.headline(16))
                    .tracking(1)
                    .foregroundStyle(BKTheme.background)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(viewModel.state.answeredCount > 0 ? BKTheme.accent : BKTheme.cardElevated)
                    .clipShape(Capsule())
            }
            .disabled(viewModel.state.answeredCount == 0)
        }
        .padding(.top, 4)
    }

    private var slotSheet: some View {
        NavigationStack {
            VStack(spacing: 14) {
                if let slot = viewModel.activeSlot {
                    VStack(alignment: .leading, spacing: 10) {
                        if let year = slot.year {
                            Text("\(String(year)) WORLD CUP")
                                .font(BKFont.caption(11))
                                .tracking(1.2)
                                .foregroundStyle(BKTheme.accent)
                        }
                        if let club = slot.club, !club.isEmpty {
                            if viewModel.revealedClubs.contains(slot.id) {
                                HStack(spacing: 8) {
                                    Text(verbatim: slot.year.map { "In \(String($0)), played for" } ?? "Played for")
                                        .font(BKFont.caption(12))
                                        .foregroundStyle(BKTheme.textMuted)
                                    if let badge = slot.clubBadgeUrl, let url = URL(string: badge) {
                                        AsyncImage(url: url) { image in
                                            image.resizable().scaledToFit()
                                        } placeholder: {
                                            Color.clear
                                        }
                                        .frame(width: 18, height: 18)
                                    }
                                    Text(club)
                                        .font(BKFont.headline(13))
                                        .foregroundStyle(BKTheme.textPrimary)
                                }
                            } else {
                                // Club is a hint, not a giveaway — tap to reveal.
                                Button { viewModel.revealClub() } label: {
                                    Text("REVEAL CLUB")
                                        .font(BKFont.caption(11))
                                        .tracking(0.8)
                                        .foregroundStyle(BKTheme.accent)
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 7)
                                        .overlay(Capsule().stroke(BKTheme.accent.opacity(0.5), lineWidth: 1))
                                }
                                .buttonStyle(.plain)
                            }
                        }

                        Divider().overlay(BKTheme.textMuted.opacity(0.2))

                        HStack(alignment: .center, spacing: 12) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("CLUE")
                                    .font(BKFont.caption(10))
                                    .tracking(0.8)
                                    .foregroundStyle(BKTheme.textMuted)
                                Text(slot.primaryClue)
                                    .font(BKFont.headline(15))
                                    .foregroundStyle(BKTheme.textPrimary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)

                            if let nation = slot.nation, !nation.isEmpty {
                                Text(GuessWhoDisplay.nationalityFlag(nation))
                                    .font(.system(size: 40))
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(BKTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                }

                TextField("Search player…", text: $viewModel.searchQuery)
                    .font(BKFont.body())
                    .foregroundStyle(BKTheme.textPrimary)
                    .focused($isSearchFocused)
                    .submitLabel(.search)
                    .onSubmit { Task { await viewModel.search() } }
                    .padding(12)
                    .background(BKTheme.cardElevated)
                    .clipShape(RoundedRectangle(cornerRadius: 12))

                if viewModel.isSearching {
                    ProgressView()
                        .tint(BKTheme.accent)
                } else if !viewModel.searchResults.isEmpty {
                    PlayerSearchResultsList(players: viewModel.searchResults) { player in
                        viewModel.selectPlayer(player)
                    }
                }

                Spacer(minLength: 0)
            }
            .padding(16)
            .background(BKTheme.background)
            .navigationTitle(viewModel.activeSlot?.label ?? "Player")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { viewModel.showSlotSheet = false }
                        .foregroundStyle(BKTheme.accent)
                }
            }
            .onChange(of: viewModel.searchQuery) { _, _ in
                Task { await viewModel.search() }
            }
            .onAppear { isSearchFocused = true }
        }
        .presentationDetents([.medium, .large])
    }

}

// MARK: - Pitch (shared Battle-style turf + circular headshot slots)

private struct WorldCupXIPitchView: View {
    let state: WorldCupXIGameState
    var onTapSlot: (WorldCupXISlot) -> Void

    var body: some View {
        GeometryReader { geo in
            ZStack {
                PitchBackground()
                ForEach(state.puzzle.slots) { slot in
                    WorldCupXIPitchSlot(
                        slot: slot,
                        fill: state.fills[slot.id],
                        revealAnswer: state.phase == .complete,
                        onTap: { onTapSlot(slot) }
                    )
                    .position(x: slot.pitchPoint.x * geo.size.width, y: slot.pitchPoint.y * geo.size.height)
                }
            }
        }
        .frame(height: 440)
    }
}

private struct WorldCupXIPitchSlot: View {
    let slot: WorldCupXISlot
    let fill: WorldCupXIFill?
    let revealAnswer: Bool
    var onTap: () -> Void

    /// Soft whitish-green for empty slot rings + the position label (matches Battle Mode).
    private static let ringColor = Color(red: 0.80, green: 0.93, blue: 0.84).opacity(0.85)

    private var ring: Color {
        if let fill { return fill.isCorrect ? BKTheme.accent : BKTheme.wrong }
        return Self.ringColor
    }

    var body: some View {
        VStack(spacing: 3) {
            ZStack {
                Circle()
                    .fill(fill != nil ? Color.black.opacity(0.30) : Color(white: 0.14).opacity(0.72))
                    .frame(width: 46, height: 46)
                    .overlay(Circle().stroke(ring, lineWidth: 1.1))

                if let fill {
                    PlayerAvatar(urlString: fill.player.headshotUrl, size: 42)
                        .grayscale(fill.isCorrect ? 0 : 0.85)
                        .opacity(fill.isCorrect ? 1 : 0.55)
                        .overlay(alignment: .bottomTrailing) {
                            ZStack {
                                Circle().fill(.white).frame(width: 14, height: 14)
                                (fill.isCorrect ? Ph.checkCircle.fill : Ph.xCircle.fill)
                                    .color(fill.isCorrect ? BKTheme.accent : BKTheme.wrong)
                                    .frame(width: 16, height: 16)
                            }
                            .offset(x: 2, y: 2)
                        }
                } else {
                    Text(slot.label)
                        .font(.system(size: 12, weight: .heavy, design: .rounded))
                        .foregroundStyle(Self.ringColor)
                }
            }

            Text(slot.label)
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundStyle(Color.white.opacity(0.95))

            if let fill {
                Text(shortName(fill.player.name))
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .foregroundStyle(fill.isCorrect ? .white : BKTheme.wrong)
                    .lineLimit(1).frame(maxWidth: 72)
            } else if revealAnswer {
                // Game over — reveal the answer under any slot that was missed.
                Text(shortName(slot.expectedName))
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.white.opacity(0.6))
                    .lineLimit(1).frame(maxWidth: 72)
            }
        }
        .shadow(color: .black.opacity(0.55), radius: 2, x: 0, y: 1)
        .frame(width: 76)
        .contentShape(Rectangle())
        .onTapGesture { if fill == nil && !revealAnswer { onTap() } }
    }

    private func shortName(_ name: String) -> String {
        name.split(separator: " ").last.map(String.init) ?? name
    }
}

// MARK: - Result

private struct WorldCupXIResultView: View {
    let result: WorldCupXIResultSummary
    let allowReplay: Bool
    var onPlayAgain: () -> Void
    var onHome: () -> Void

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 20) {
                    Text(result.won ? "GREAT XI!" : "FULL TIME")
                        .font(BKFont.headline(28))
                        .foregroundStyle(result.won ? BKTheme.accent : BKTheme.textPrimary)

                    Text("You named \(result.correctCount) of \(WorldCupXIPuzzle.slotCount).")
                        .font(BKFont.body(15))
                        .foregroundStyle(BKTheme.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 8)

                    Text("+\(WorldCupXIScoring.xp(from: result.score)) XP")
                        .font(BKFont.headline(22))
                        .foregroundStyle(BKTheme.accent)

                    VStack(alignment: .leading, spacing: 10) {
                        Text("YOUR XI")
                            .font(BKFont.caption(10))
                            .tracking(0.8)
                            .foregroundStyle(BKTheme.textMuted)

                        ForEach(result.slotResults) { row in
                            HStack(spacing: 10) {
                                Text(row.isCorrect ? "✓" : "✗")
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundStyle(row.isCorrect ? BKTheme.guessCorrect : BKTheme.guessWrong)
                                    .frame(width: 20)

                                VStack(alignment: .leading, spacing: 2) {
                                    if let guess = row.guessedName {
                                        Text(guess)
                                            .font(BKFont.headline(14))
                                            .foregroundStyle(BKTheme.textPrimary)
                                    } else {
                                        Text("—")
                                            .font(BKFont.headline(14))
                                            .foregroundStyle(BKTheme.textMuted)
                                    }
                                    if !row.isCorrect {
                                        Text("Correct: \(row.slot.expectedName)")
                                            .font(BKFont.caption(11))
                                            .foregroundStyle(BKTheme.textMuted)
                                    }
                                }
                                Spacer()
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    .padding(16)
                    .background(BKTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 16))

                    HStack(spacing: 12) {
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
}
