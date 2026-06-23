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
    var showYearSheet = false
    var showResult = false
    var confettiBurstToken = 0
    var selectedYear = 2018

    private let practice: Bool

    init(practice: Bool = false, dailyDate: String? = nil) {
        self.practice = practice
        let puzzle = practice ? WorldCupXISeed.practicePuzzle() : WorldCupXISeed.puzzle(for: dailyDate)
        self.state = WorldCupXIGameState(puzzle: puzzle)
        self.selectedYear = 2010
    }

    var activeSlot: WorldCupXISlot? {
        guard let id = state.activeSlotId else { return nil }
        return state.puzzle.slots.first { $0.id == id }
    }

    var projectedScore: Int {
        guard state.phase == .playing else { return state.result?.score ?? 0 }
        var draft = state
        draft.guessedYear = state.puzzle.year
        return WorldCupXIScoring.buildResult(puzzle: state.puzzle, state: draft, guessedYear: state.puzzle.year).score
    }

    func openSlot(_ slot: WorldCupXISlot) {
        HapticManager.light()
        if !state.revealedSlotIds.contains(slot.id) {
            state.revealedSlotIds.insert(slot.id)
        }
        state.activeSlotId = slot.id
        searchQuery = state.fills[slot.id]?.player.name ?? ""
        searchResults = []
        showSlotSheet = true
    }

    func revealSpecial(_ reveal: WorldCupXISpecialReveal) {
        guard state.phase == .playing, !state.revealedSpecials.contains(reveal) else { return }
        HapticManager.light()
        state.revealedSpecials.insert(reveal)
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
        guard let slotId = state.activeSlotId else { return }
        state.fills[slotId] = WorldCupXIFill(player: player)
        searchQuery = ""
        searchResults = []
        HapticManager.success()
        showSlotSheet = false
        state.activeSlotId = nil
    }

    func clearActiveSlotSelection() {
        guard let slotId = state.activeSlotId else { return }
        state.fills.removeValue(forKey: slotId)
        searchQuery = ""
        searchResults = []
    }

    func presentYearGuess() {
        HapticManager.light()
        showYearSheet = true
    }

    func submitYearGuess() {
        guard state.phase == .playing else { return }
        let result = WorldCupXIScoring.buildResult(
            puzzle: state.puzzle,
            state: state,
            guessedYear: selectedYear
        )
        state.guessedYear = selectedYear
        state.result = result
        state.phase = .complete
        showYearSheet = false
        if result.won {
            confettiBurstToken += 1
            HapticManager.success()
        } else {
            HapticManager.error()
        }
        showResult = true
    }

    func restart() {
        let puzzle = practice ? WorldCupXISeed.practicePuzzle() : WorldCupXISeed.puzzle()
        state = WorldCupXIGameState(puzzle: puzzle)
        selectedYear = 2010
        searchQuery = ""
        searchResults = []
        showSlotSheet = false
        showYearSheet = false
        showResult = false
        confettiBurstToken = 0
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

    init(dailyDate: String? = nil, practice: Bool = false, allowReplay: Bool = true, onComplete: @escaping () -> Void) {
        _viewModel = State(initialValue: WorldCupXIViewModel(practice: practice, dailyDate: dailyDate))
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
                        specialRevealRow
                        answerSection
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
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
        .sheet(isPresented: $viewModel.showSlotSheet) {
            slotSheet
        }
        .sheet(isPresented: $viewModel.showYearSheet) {
            yearSheet
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
                Text("REVEALS")
                    .font(BKFont.caption(10))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.textMuted)
                Text("\(viewModel.state.revealCount)")
                    .font(BKFont.headline(16))
                    .foregroundStyle(BKTheme.accent)
            }
            VStack(alignment: .trailing, spacing: 4) {
                Text("POTENTIAL")
                    .font(BKFont.caption(10))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.textMuted)
                Text("\(viewModel.projectedScore)")
                    .font(BKFont.headline(16))
                    .foregroundStyle(BKTheme.textPrimary)
            }
        }
        .padding(14)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private var specialRevealRow: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("STRATEGIC REVEALS")
                .font(BKFont.caption(10))
                .tracking(0.8)
                .foregroundStyle(BKTheme.textMuted)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(WorldCupXISpecialReveal.allCases) { reveal in
                        let used = viewModel.state.revealedSpecials.contains(reveal)
                        Button {
                            viewModel.revealSpecial(reveal)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(reveal.title.uppercased())
                                    .font(BKFont.caption(10))
                                    .foregroundStyle(used ? BKTheme.textMuted : BKTheme.textPrimary)
                                Text(used ? "REVEALED" : reveal.costLabel)
                                    .font(BKFont.caption(9))
                                    .foregroundStyle(used ? BKTheme.accent : BKTheme.textMuted)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .background(used ? BKTheme.cardElevated : BKTheme.card)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .overlay {
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(used ? BKTheme.accent.opacity(0.4) : Color.clear, lineWidth: 1)
                            }
                        }
                        .disabled(used)
                    }
                }
            }

            if !viewModel.state.revealedSpecials.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(WorldCupXISpecialReveal.allCases.filter { viewModel.state.revealedSpecials.contains($0) }) { reveal in
                        Text(viewModel.state.puzzle.specialClue(for: reveal))
                            .font(BKFont.body(13))
                            .foregroundStyle(BKTheme.textSecondary)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(BKTheme.cardElevated.opacity(0.6))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private var answerSection: some View {
        VStack(spacing: 10) {
            Text("Guess the World Cup year whenever you're ready. Fewer reveals = higher score.")
                .font(BKFont.caption(11))
                .foregroundStyle(BKTheme.textMuted)
                .multilineTextAlignment(.center)

            Button(action: viewModel.presentYearGuess) {
                Text("ANSWER")
                    .font(BKFont.headline(16))
                    .tracking(1)
                    .foregroundStyle(BKTheme.background)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(BKTheme.accent)
                    .clipShape(Capsule())
            }
        }
        .padding(.top, 4)
    }

    private var slotSheet: some View {
        NavigationStack {
            VStack(spacing: 14) {
                if let slot = viewModel.activeSlot {
                    VStack(alignment: .leading, spacing: 8) {
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

                if viewModel.activeSlot != nil, viewModel.state.fills[viewModel.state.activeSlotId ?? ""] != nil {
                    Button("Clear selection") {
                        viewModel.clearActiveSlotSelection()
                    }
                    .font(BKFont.caption(12))
                    .foregroundStyle(BKTheme.textMuted)
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

    private var yearSheet: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Text("Which World Cup year is this XI from?")
                    .font(BKFont.body())
                    .foregroundStyle(BKTheme.textSecondary)
                    .multilineTextAlignment(.center)

                Picker("Year", selection: $viewModel.selectedYear) {
                    ForEach(WorldCupXIYearOptions.all, id: \.self) { year in
                        Text(String(year)).tag(year)
                    }
                }
                .pickerStyle(.wheel)
                .frame(height: 160)

                Button(action: viewModel.submitYearGuess) {
                    Text("LOCK IN \(viewModel.selectedYear)")
                        .font(BKFont.headline(15))
                        .foregroundStyle(BKTheme.background)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(BKTheme.accent)
                        .clipShape(Capsule())
                }

                Spacer(minLength: 0)
            }
            .padding(20)
            .background(BKTheme.background)
            .navigationTitle("Guess the year")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { viewModel.showYearSheet = false }
                        .foregroundStyle(BKTheme.textMuted)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - Pitch

private struct WorldCupXIPitchView: View {
    let state: WorldCupXIGameState
    var onTapSlot: (WorldCupXISlot) -> Void

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

                ForEach(state.puzzle.slots) { slot in
                    WorldCupXIPitchSlot(
                        slot: slot,
                        fill: state.fills[slot.id],
                        revealed: state.revealedSlotIds.contains(slot.id),
                        size: geo.size,
                        onTap: { onTapSlot(slot) }
                    )
                }
            }
        }
        .frame(height: 400)
    }
}

private struct WorldCupXIPitchSlot: View {
    let slot: WorldCupXISlot
    let fill: WorldCupXIFill?
    let revealed: Bool
    let size: CGSize
    var onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 4) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(fill == nil ? Color.black.opacity(0.35) : BKTheme.accent.opacity(0.92))
                        .frame(width: fill == nil ? 38 : 44, height: fill == nil ? 44 : 48)
                        .overlay {
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color.white.opacity(0.3), lineWidth: 1)
                        }

                    if fill == nil {
                        Text("?")
                            .font(.system(size: 18, weight: .bold, design: .rounded))
                            .foregroundStyle(Color.white.opacity(0.9))
                    }
                }

                if let fill {
                    Text(shortName(fill.player.name))
                        .font(.system(size: 9, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.white)
                        .lineLimit(1)
                        .frame(maxWidth: 72)
                } else if revealed {
                    Text(slot.label)
                        .font(.system(size: 8, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color.white.opacity(0.7))
                }
            }
        }
        .buttonStyle(.plain)
        .position(
            x: slot.pitchPoint.x * size.width,
            y: slot.pitchPoint.y * size.height
        )
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
                    Text(result.won ? "CORRECT!" : "GAME OVER")
                        .font(BKFont.headline(28))
                        .foregroundStyle(result.won ? BKTheme.accent : BKTheme.guessWrong)

                    Text(feedbackLine)
                        .font(BKFont.body(15))
                        .foregroundStyle(BKTheme.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 8)

                    if result.won {
                        Text("SCORE: \(result.score)")
                            .font(BKFont.headline(22))
                            .foregroundStyle(BKTheme.textPrimary)
                        Text("\(result.revealsUsed) reveals used")
                            .font(BKFont.caption(12))
                            .foregroundStyle(BKTheme.textMuted)
                    }

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

    private var feedbackLine: String {
        if result.won {
            return "You guessed \(result.guessedYear). Correct answer: \(result.puzzle.country) \(result.puzzle.year)."
        }
        return "You guessed \(result.guessedYear). Correct answer: \(result.puzzle.country) \(result.puzzle.year)."
    }
}

private enum WorldCupXIYearOptions {
    static let all: [Int] = Array(stride(from: 2022, through: 1950, by: -4))
}
