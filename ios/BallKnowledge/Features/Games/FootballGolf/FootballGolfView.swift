import SwiftUI

// MARK: - ViewModel

@MainActor
@Observable
final class FootballGolfViewModel {
    var state: FootballGolfGameState
    var showResult = false
    var confettiBurstToken = 0
    var searchResults: [FootballGolfAnswerSuggestion] = []
    var isSearching = false

    init(course: FootballGolfCourse = FootballGolfSeed.weeklyCourse()) {
        self.state = FootballGolfGameState(course: course)
    }

    var xpEarned: Int {
        FootballGolfScoring.xp(from: state.totalScore, par: state.course.totalPar)
    }

    var leaderboard: [FootballGolfLeaderboardEntry] {
        FootballGolfSeed.mockLeaderboard(userScore: state.totalScore)
    }

    var canSubmitHole: Bool {
        guard state.phase == .playing, let hole = state.currentHole else { return false }
        guard state.draftAnswers.count == hole.par else { return false }
        return state.draftAnswers.allSatisfy {
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    func restart() {
        state = FootballGolfGameState(course: FootballGolfSeed.weeklyCourse())
        showResult = false
        confettiBurstToken = 0
        searchResults = []
    }

    func clearSearch() {
        searchResults = []
    }

    func search(for fieldIndex: Int) async {
        guard state.phase == .playing, let hole = state.currentHole else {
            searchResults = []
            return
        }

        let query = state.draftAnswers.indices.contains(fieldIndex)
            ? state.draftAnswers[fieldIndex].trimmingCharacters(in: .whitespacesAndNewlines)
            : ""

        guard query.count >= 2 else {
            searchResults = []
            return
        }

        isSearching = true
        defer { isSearching = false }

        let results = await FootballGolfAnswerSearch.search(query: query, answerType: hole.answerType)
        let used = usedAnswerNames(excluding: fieldIndex)
        searchResults = results.filter { !used.contains(normalizedToken($0.name)) }
    }

    func selectSuggestion(
        _ suggestion: FootballGolfAnswerSuggestion,
        for fieldIndex: Int,
        focusNext: (Int?) -> Void
    ) {
        while state.draftAnswers.count <= fieldIndex {
            state.draftAnswers.append("")
        }
        state.draftAnswers[fieldIndex] = suggestion.name
        searchResults = []
        HapticManager.light()

        if let next = nextEmptyField(after: fieldIndex) {
            focusNext(next)
        } else {
            focusNext(nil)
        }
    }

    func submitHole() {
        guard canSubmitHole, let hole = state.currentHole else { return }
        searchResults = []

        let grading = FootballGolfMatcher.grade(hole: hole, submittedAnswers: state.draftAnswers)
        let outcome = FootballGolfScoring.outcome(correctCount: grading.correctCount, par: hole.par)

        let result = FootballGolfHoleResult(
            id: hole.id,
            holeId: hole.id,
            holeNumber: hole.holeNumber,
            par: hole.par,
            submittedAnswers: state.draftAnswers.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) },
            matchedAnswers: grading.matched,
            correctCount: grading.correctCount,
            outcome: outcome
        )

        state.holeResults.append(result)
        state.lastHoleResult = result
        state.phase = .holeResult

        switch outcome {
        case .birdie:
            HapticManager.success()
        case .par:
            HapticManager.light()
        case .bogey:
            HapticManager.error()
        }

        Task {
            try? await Task.sleep(for: .seconds(FootballGolfTiming.holeResultAutoAdvance))
            advanceFromHoleResult()
        }
    }

    func advanceFromHoleResult() {
        guard state.phase == .holeResult else { return }

        if state.holeResults.count >= state.course.holes.count {
            state.phase = .finished
            if state.totalScore <= -3 {
                confettiBurstToken += 1
                HapticManager.success()
            }
            showResult = true
            return
        }

        state.currentHoleIndex += 1
        if let hole = state.currentHole {
            state.draftAnswers = Array(repeating: "", count: hole.par)
        }
        state.lastHoleResult = nil
        state.phase = .playing
        searchResults = []
    }

    private func usedAnswerNames(excluding index: Int) -> Set<String> {
        Set(
            state.draftAnswers.enumerated().compactMap { fieldIndex, answer in
                guard fieldIndex != index else { return nil }
                let trimmed = answer.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { return nil }
                return normalizedToken(trimmed)
            }
        )
    }

    private func nextEmptyField(after index: Int) -> Int? {
        guard let hole = state.currentHole else { return nil }

        if index + 1 < hole.par {
            for fieldIndex in (index + 1)..<hole.par {
                if !filled(fieldIndex) { return fieldIndex }
            }
        }

        for fieldIndex in 0..<index where !filled(fieldIndex) {
            return fieldIndex
        }

        return nil
    }

    private func filled(_ fieldIndex: Int) -> Bool {
        guard state.draftAnswers.indices.contains(fieldIndex) else { return false }
        return !state.draftAnswers[fieldIndex].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func normalizedToken(_ value: String) -> String {
        value
            .lowercased()
            .folding(options: .diacriticInsensitive, locale: .current)
            .replacingOccurrences(of: "[^a-z0-9 ]", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// MARK: - Main View

struct FootballGolfView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var viewModel = FootballGolfViewModel()
    @FocusState private var focusedField: Int?
    var onComplete: () -> Void

    private var isKeyboardActive: Bool { focusedField != nil }

    var body: some View {
        ZStack {
            NavigationStack {
                VStack(spacing: 0) {
                    FootballGolfProgressBar(
                        holes: viewModel.state.course.holes,
                        completedResults: viewModel.state.holeResults,
                        currentHoleIndex: viewModel.state.currentHoleIndex
                    )

                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 20) {
                            FootballGolfCourseHeader(course: viewModel.state.course)

                            if let hole = viewModel.state.currentHole, viewModel.state.phase == .playing {
                                FootballGolfHoleCard(
                                    hole: hole,
                                    answers: $viewModel.state.draftAnswers,
                                    focusedField: $focusedField,
                                    onFieldChange: { fieldIndex in
                                        Task { await viewModel.search(for: fieldIndex) }
                                    }
                                )
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 24)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        focusedField = nil
                        viewModel.clearSearch()
                    }

                    if viewModel.state.phase == .playing {
                        if isKeyboardActive {
                            FootballGolfSearchDock(
                                viewModel: viewModel,
                                focusedField: focusedField,
                                onSelect: { suggestion in
                                    guard let fieldIndex = focusedField else { return }
                                    viewModel.selectSuggestion(suggestion, for: fieldIndex) { next in
                                        focusedField = next
                                    }
                                }
                            )
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                        } else {
                            FootballGolfSubmitButton(
                                enabled: viewModel.canSubmitHole,
                                label: "SUBMIT HOLE"
                            ) {
                                viewModel.submitHole()
                            }
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                        }
                    }
                }
                .animation(.spring(response: 0.32, dampingFraction: 0.82), value: isKeyboardActive)
                .onChange(of: focusedField) { _, fieldIndex in
                    if let fieldIndex {
                        Task { await viewModel.search(for: fieldIndex) }
                    } else {
                        viewModel.clearSearch()
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
                        Text("FOOTBALL GOLF")
                            .font(BKFont.caption(13))
                            .tracking(1)
                            .foregroundStyle(BKTheme.accent)
                    }
                }
            }

            if viewModel.state.phase == .holeResult, let result = viewModel.state.lastHoleResult {
                FootballGolfHoleResultOverlay(result: result) {
                    viewModel.advanceFromHoleResult()
                }
                .transition(.opacity.combined(with: .scale(scale: 0.96)))
                .zIndex(10)
            }

            FootballConfettiView(burstToken: viewModel.confettiBurstToken)
                .zIndex(999)
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.82), value: viewModel.state.phase)
        .fullScreenCover(isPresented: $viewModel.showResult) {
            FootballGolfScorecardView(
                course: viewModel.state.course,
                results: viewModel.state.holeResults,
                totalScore: viewModel.state.totalScore,
                xpEarned: viewModel.xpEarned,
                leaderboard: viewModel.leaderboard,
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

// MARK: - Progress

private struct FootballGolfProgressBar: View {
    let holes: [FootballGolfHole]
    let completedResults: [FootballGolfHoleResult]
    let currentHoleIndex: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(holes.enumerated()), id: \.element.id) { index, hole in
                VStack(spacing: 4) {
                    Capsule()
                        .fill(fillColor(for: index))
                        .frame(height: 4)

                    if let result = completedResults.first(where: { $0.holeNumber == hole.holeNumber }) {
                        Text(result.outcome == .birdie ? "-1" : result.outcome == .par ? "0" : "+1")
                            .font(.system(size: 8, weight: .bold, design: .rounded))
                            .foregroundStyle(outcomeColor(result.outcome))
                    } else {
                        Text("\(hole.holeNumber)")
                            .font(.system(size: 8, weight: .bold, design: .rounded))
                            .foregroundStyle(index == currentHoleIndex ? BKTheme.accent : BKTheme.textMuted)
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    private func fillColor(for index: Int) -> Color {
        if completedResults.contains(where: { $0.holeNumber == holes[index].holeNumber }) {
            return BKTheme.accent
        }
        if index == currentHoleIndex {
            return BKTheme.accent.opacity(0.45)
        }
        return BKTheme.cardElevated
    }

    private func outcomeColor(_ outcome: FootballGolfHoleOutcome) -> Color {
        switch outcome {
        case .birdie: return BKTheme.accent
        case .par: return BKTheme.textSecondary
        case .bogey: return BKTheme.wrong
        }
    }
}

// MARK: - Course Header

private struct FootballGolfCourseHeader: View {
    let course: FootballGolfCourse

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("WEEKLY COURSE")
                .font(BKFont.caption(10))
                .tracking(0.8)
                .foregroundStyle(BKTheme.accent)
            Text(course.title.uppercased())
                .font(BKFont.headline(18))
                .foregroundStyle(BKTheme.textPrimary)
            Text(course.theme)
                .font(BKFont.caption(11))
                .foregroundStyle(BKTheme.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(BKTheme.cardElevated.opacity(0.9))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

// MARK: - Hole Card

private struct FootballGolfHoleCard: View {
    let hole: FootballGolfHole
    @Binding var answers: [String]
    var focusedField: FocusState<Int?>.Binding
    var onFieldChange: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("HOLE \(hole.holeNumber)")
                    .font(BKFont.caption(11))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.textMuted)
                Spacer()
                Text("PAR \(hole.par)")
                    .font(BKFont.caption(11))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.accent)
            }

            Text(hole.question)
                .font(BKFont.body(15))
                .foregroundStyle(BKTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 10) {
                ForEach(0..<hole.par, id: \.self) { index in
                    HStack(spacing: 10) {
                        Text("\(index + 1)")
                            .font(.system(size: 11, weight: .heavy, design: .rounded))
                            .foregroundStyle(BKTheme.background)
                            .frame(width: 22, height: 22)
                            .background(BKTheme.accent.opacity(0.85))
                            .clipShape(Circle())

                        TextField("", text: binding(for: index), prompt:
                            Text("Search answer \(index + 1)")
                                .foregroundStyle(BKTheme.textMuted)
                                .font(.system(size: 14, weight: .semibold, design: .rounded))
                        )
                        .textFieldStyle(.plain)
                        .foregroundStyle(BKTheme.background)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.words)
                        .focused(focusedField, equals: index)
                        .submitLabel(index == hole.par - 1 ? .done : .next)
                        .onSubmit {
                            if index < hole.par - 1 {
                                focusedField.wrappedValue = index + 1
                            } else {
                                focusedField.wrappedValue = nil
                            }
                        }
                        .onChange(of: binding(for: index).wrappedValue) { _, _ in
                            onFieldChange(index)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(
                                focusedField.wrappedValue == index
                                    ? BKTheme.accent.opacity(0.65)
                                    : BKTheme.accent.opacity(0.2),
                                lineWidth: 1.5
                            )
                    )
                }
            }
        }
        .padding(16)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func binding(for index: Int) -> Binding<String> {
        Binding(
            get: {
                guard answers.indices.contains(index) else { return "" }
                return answers[index]
            },
            set: { newValue in
                while answers.count <= index {
                    answers.append("")
                }
                answers[index] = newValue
            }
        )
    }
}

// MARK: - Search Dock

private struct FootballGolfSearchDock: View {
    @Bindable var viewModel: FootballGolfViewModel
    let focusedField: Int?
    var onSelect: (FootballGolfAnswerSuggestion) -> Void

    var body: some View {
        VStack(spacing: 0) {
            if viewModel.isSearching {
                HStack {
                    ProgressView().tint(BKTheme.accent)
                    Text("SEARCHING...")
                        .font(BKFont.caption(10))
                        .foregroundStyle(BKTheme.textMuted)
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }

            if viewModel.searchResults.isEmpty && !viewModel.isSearching {
                Text("TYPE TO SEARCH PLAYERS, CLUBS & MORE")
                    .font(BKFont.caption(10))
                    .tracking(0.5)
                    .foregroundStyle(BKTheme.textMuted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 0) {
                        ForEach(viewModel.searchResults) { suggestion in
                            Button {
                                onSelect(suggestion)
                            } label: {
                                HStack(spacing: 12) {
                                    FootballGolfSuggestionIcon(suggestion: suggestion)

                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(suggestion.name.uppercased())
                                            .font(.system(size: 13, weight: .bold, design: .rounded))
                                            .foregroundStyle(BKTheme.textPrimary)
                                            .lineLimit(1)
                                        if let subtitle = suggestion.subtitle {
                                            Text(subtitle)
                                                .font(BKFont.caption(11))
                                                .foregroundStyle(BKTheme.textMuted)
                                                .lineLimit(1)
                                        }
                                    }

                                    Spacer()

                                    Ph.caretRight.bold
                                        .color(BKTheme.textMuted)
                                        .frame(width: 12, height: 12)
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 12)
                            }

                            if suggestion.id != viewModel.searchResults.last?.id {
                                Divider().background(BKTheme.cardElevated)
                            }
                        }
                    }
                }
                .frame(maxHeight: 220)
                .background(BKTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal, 16)
            }
        }
        .padding(.bottom, 8)
        .background(BKTheme.background)
    }
}

private struct FootballGolfSuggestionIcon: View {
    let suggestion: FootballGolfAnswerSuggestion

    var body: some View {
        Group {
            switch suggestion.answerType {
            case .player:
                if let player = suggestion.player {
                    TeamBadgeImage(club: player.club, league: player.league, size: 28) {
                        playerFallback
                    }
                } else {
                    playerFallback
                }
            case .team:
                TeamBadgeImage(club: suggestion.club ?? suggestion.name, league: suggestion.league ?? "Premier League", size: 28) {
                    abbrevFallback(suggestion.club ?? suggestion.name)
                }
            case .country:
                Text(GuessWhoDisplay.nationalityFlag(suggestion.country ?? suggestion.name))
                    .font(.system(size: 22))
                    .frame(width: 28, height: 28)
            case .manager:
                if let country = suggestion.country {
                    Text(GuessWhoDisplay.nationalityFlag(country))
                        .font(.system(size: 22))
                        .frame(width: 28, height: 28)
                } else {
                    Ph.users.fill
                        .color(BKTheme.textSecondary)
                        .frame(width: 22, height: 22)
                        .frame(width: 28, height: 28)
                }
            case .stadium:
                Ph.soccerBall.fill
                    .color(BKTheme.accent)
                    .frame(width: 20, height: 20)
                    .frame(width: 28, height: 28)
            }
        }
    }

    private var playerFallback: some View {
        Circle()
            .fill(BKTheme.cardElevated)
            .frame(width: 28, height: 28)
            .overlay(
                Text(GuessWhoDisplay.clubAbbrev(suggestion.club ?? suggestion.name))
                    .font(.system(size: 8, weight: .bold, design: .rounded))
                    .foregroundStyle(BKTheme.textMuted)
            )
    }

    private func abbrevFallback(_ label: String) -> some View {
        Circle()
            .fill(BKTheme.cardElevated)
            .frame(width: 28, height: 28)
            .overlay(
                Text(GuessWhoDisplay.clubAbbrev(label))
                    .font(.system(size: 8, weight: .bold, design: .rounded))
                    .foregroundStyle(BKTheme.textMuted)
            )
    }
}

// MARK: - Hole Result Overlay

private struct FootballGolfHoleResultOverlay: View {
    let result: FootballGolfHoleResult
    var onContinue: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.72)
                .ignoresSafeArea()
                .onTapGesture(perform: onContinue)

            VStack(spacing: 18) {
                Text(result.outcome.label)
                    .font(BKFont.title(36))
                    .foregroundStyle(outcomeColor)

                Text("\(result.correctCount)/\(result.par) correct")
                    .font(BKFont.headline(18))
                    .foregroundStyle(BKTheme.textPrimary)

                Text(holeScoreLabel)
                    .font(BKFont.caption(12))
                    .foregroundStyle(BKTheme.textSecondary)

                if !result.matchedAnswers.isEmpty {
                    VStack(spacing: 6) {
                        Text("MATCHED")
                            .font(BKFont.caption(10))
                            .foregroundStyle(BKTheme.textMuted)
                        ForEach(result.matchedAnswers, id: \.self) { answer in
                            Text(answer.uppercased())
                                .font(BKFont.caption(11))
                                .foregroundStyle(BKTheme.accent)
                        }
                    }
                }

                Button(action: onContinue) {
                    Text("NEXT HOLE")
                        .font(BKFont.headline())
                        .foregroundStyle(BKTheme.background)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(BKTheme.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .padding(.top, 8)
            }
            .padding(24)
            .frame(maxWidth: 320)
            .background(BKTheme.cardElevated)
            .clipShape(RoundedRectangle(cornerRadius: 20))
            .padding(.horizontal, 24)
        }
    }

    private var outcomeColor: Color {
        switch result.outcome {
        case .birdie: return BKTheme.accent
        case .par: return BKTheme.textPrimary
        case .bogey: return BKTheme.wrong
        }
    }

    private var holeScoreLabel: String {
        switch result.outcome {
        case .birdie: return "Hole score: -1"
        case .par: return "Hole score: E"
        case .bogey: return "Hole score: +1"
        }
    }
}

// MARK: - Submit

private struct FootballGolfSubmitButton: View {
    let enabled: Bool
    let label: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(BKFont.headline())
                .foregroundStyle(BKTheme.background)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(enabled ? BKTheme.accent : BKTheme.cardElevated)
                .clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .disabled(!enabled)
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
        .background(BKTheme.background)
    }
}

// MARK: - Scorecard

private struct FootballGolfScorecardView: View {
    let course: FootballGolfCourse
    let results: [FootballGolfHoleResult]
    let totalScore: Int
    let xpEarned: Int
    let leaderboard: [FootballGolfLeaderboardEntry]
    var onPlayAgain: () -> Void
    var onHome: () -> Void

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 20) {
                    VStack(spacing: 8) {
                        Text("ROUND COMPLETE")
                            .font(BKFont.caption(11))
                            .tracking(1)
                            .foregroundStyle(BKTheme.textMuted)
                        Text(FootballGolfScoring.scoreLabel(totalScore))
                            .font(BKFont.title(48))
                            .foregroundStyle(BKTheme.accent)
                        Text(FootballGolfScoring.relativeToParLabel(total: totalScore, par: course.totalPar))
                            .font(BKFont.body())
                            .foregroundStyle(BKTheme.textSecondary)
                        Text("+\(xpEarned) XP")
                            .font(BKFont.headline(18))
                            .foregroundStyle(BKTheme.accent)
                    }
                    .padding(.top, 24)

                    VStack(alignment: .leading, spacing: 10) {
                        Text("SCORECARD")
                            .font(BKFont.caption(11))
                            .tracking(0.8)
                            .foregroundStyle(BKTheme.textMuted)

                        ForEach(results) { result in
                            HStack {
                                Text("HOLE \(result.holeNumber)")
                                    .font(BKFont.caption(10))
                                    .foregroundStyle(BKTheme.textMuted)
                                    .frame(width: 56, alignment: .leading)
                                Text("Par \(result.par)")
                                    .font(BKFont.caption(10))
                                    .foregroundStyle(BKTheme.textSecondary)
                                Spacer()
                                Text(result.outcome.label)
                                    .font(BKFont.caption(10))
                                    .foregroundStyle(outcomeColor(result.outcome))
                                Text(result.outcome == .birdie ? "-1" : result.outcome == .par ? "E" : "+1")
                                    .font(BKFont.headline(14))
                                    .foregroundStyle(BKTheme.textPrimary)
                                    .frame(width: 28, alignment: .trailing)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(BKTheme.card)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                    }
                    .padding(.horizontal, 20)

                    VStack(alignment: .leading, spacing: 10) {
                        Text("LEADERBOARD")
                            .font(BKFont.caption(11))
                            .tracking(0.8)
                            .foregroundStyle(BKTheme.textMuted)

                        ForEach(Array(leaderboard.enumerated()), id: \.element.id) { index, entry in
                            HStack {
                                Text("\(index + 1)")
                                    .font(BKFont.caption(10))
                                    .foregroundStyle(BKTheme.textMuted)
                                    .frame(width: 20, alignment: .leading)
                                Text(entry.name.uppercased())
                                    .font(BKFont.caption(11))
                                    .foregroundStyle(entry.isUser ? BKTheme.accent : BKTheme.textPrimary)
                                Spacer()
                                Text(FootballGolfScoring.scoreLabel(entry.score))
                                    .font(BKFont.headline(14))
                                    .foregroundStyle(entry.isUser ? BKTheme.accent : BKTheme.textPrimary)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(entry.isUser ? BKTheme.accent.opacity(0.12) : BKTheme.card)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                    }
                    .padding(.horizontal, 20)

                    VStack(spacing: 12) {
                        Button(action: onPlayAgain) {
                            Text("PLAY AGAIN")
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

    private func outcomeColor(_ outcome: FootballGolfHoleOutcome) -> Color {
        switch outcome {
        case .birdie: return BKTheme.accent
        case .par: return BKTheme.textSecondary
        case .bogey: return BKTheme.wrong
        }
    }
}
