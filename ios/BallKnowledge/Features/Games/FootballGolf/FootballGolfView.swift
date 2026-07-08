import SwiftUI
#if canImport(Pow)
import Pow
#endif

// Single success accent — reuse the app green. No second neon.
private let golfGreen = BKTheme.accent
private let golfGold = Color(hex: "F5C451")

/// One motion vocabulary for the whole screen so animations feel deliberate, not random.
/// `layout` = structural changes, `pop` = celebratory emphasis, `quick` = small state ticks.
private enum GolfMotion {
    static let layout = Animation.spring(response: 0.34, dampingFraction: 0.82)
    static let pop = Animation.spring(response: 0.32, dampingFraction: 0.6)
    static let quick = Animation.snappy(duration: 0.22)
}

/// Rarity colour scale (drives the answer tick + badge): green → gold → orange → purple,
/// climbing from the most common to the rarest answer.
private func golfRarityColor(_ rarity: FootballGolfRarity) -> Color {
    switch rarity {
    case .common:    return golfGreen
    case .uncommon:  return golfGold
    case .rare:      return Color(hex: "FF8A3D")   // orange — hotter than gold
    case .ultraRare: return Color(hex: "C56BFF")   // purple — the top tier
    }
}

// MARK: - ViewModel

/// Persisted mid-round progress for resume (the course is rebuilt from the daily puzzle on open).
struct FootballGolfProgress: Equatable, Codable {
    static let progressVersion = 3
    var currentHoleIndex: Int
    var results: [FootballGolfHoleResult]
    var matched: [FootballGolfAnswer]
    var wrongGuesses: Int
    var phase: FootballGolfViewModel.FootballGolfPhase
}

@MainActor
@Observable
final class FootballGolfViewModel {
    let course: FootballGolfCourse
    var currentHoleIndex = 0
    var results: [FootballGolfHoleResult] = []
    var phase: FootballGolfPhase = .playing

    // current-hole working state
    var matched: [FootballGolfAnswer] = []
    var wrongGuesses = 0
    var guess = ""

    // transient UI signals
    var lastRevealed: FootballGolfAnswer?
    var wrongFlashToken = 0
    var revealToken = 0
    var showResult = false
    var confettiToken = 0

    /// Guards against a single tap registering multiple guesses: the suggestion list / reveal
    /// animate out over a few frames and stay hit-testable, so fast taps could double-count.
    var isResolving = false

    // autocomplete
    var searchResults: [PlayerSearchResultDTO] = []
    var isSearching = false

    enum FootballGolfPhase: Equatable, Codable { case playing, holeResult, finished }

    init(course: FootballGolfCourse) {
        self.course = course
    }

    var currentHole: FootballGolfHole? {
        course.holes.indices.contains(currentHoleIndex) ? course.holes[currentHoleIndex] : nil
    }

    var totalScore: Int { results.map(\.relativeToPar).reduce(0, +) }
    var xpEarned: Int { FootballGolfScoring.xp(results: results) }

    /// Snapshot for save/restore (the course is rebuilt from the daily puzzle on resume).
    var snapshot: FootballGolfProgress {
        FootballGolfProgress(
            currentHoleIndex: currentHoleIndex,
            results: results,
            matched: matched,
            wrongGuesses: wrongGuesses,
            phase: phase
        )
    }

    /// Mid-round and worth saving: past the first shot of the first hole, not finished.
    var isResumable: Bool {
        phase != .finished && (currentHoleIndex > 0 || !results.isEmpty || !matched.isEmpty || wrongGuesses > 0)
    }

    func restore(_ p: FootballGolfProgress) {
        currentHoleIndex = p.currentHoleIndex
        results = p.results
        matched = p.matched
        wrongGuesses = p.wrongGuesses
        phase = p.phase
        guess = ""
        searchResults = []
        lastRevealed = nil
        isResolving = false
        showResult = false
    }

    // Par = expected shots on an all-common run; target ≤ par (max 4 pts).
    var par: Int { currentHole?.par ?? 0 }
    var target: Int { currentHole?.target ?? FootballGolfRules.targetPoints(forPar: par) }
    var points: Int { matched.reduce(0) { $0 + $1.rarity.points } }
    var shots: Int { matched.count + wrongGuesses }
    var shotAllowance: Int { target + footballGolfShotCap }
    var shotsRemaining: Int { max(0, shotAllowance - shots) }

    private var matchedIds: Set<String> { Set(matched.map(\.id)) }

    /// End the hole when the point target is reached; force-settle after the shot cap.
    private func checkComplete() {
        if points >= target {
            completeHole(skipped: false, effectiveShots: shots)
        } else if shots >= shotAllowance {
            settle()
        }
    }

    /// Stop the hole and "fill" the remaining points at +2 shots each (the skip penalty).
    private func settle() {
        let remaining = max(0, target - points)
        completeHole(skipped: true, effectiveShots: shots + 2 * remaining)
    }

    func submitGuess() {
        guard phase == .playing, !isResolving, let hole = currentHole else { return }
        let trimmed = guess.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        lockResolve()

        if let answer = FootballGolfMatcher.match(guess: trimmed, in: hole.answers, alreadyMatched: matchedIds) {
            matched.append(answer)
            lastRevealed = answer
            revealToken += 1
            guess = ""
            searchResults = []
            HapticManager.success()
        } else {
            wrongGuesses += 1
            wrongFlashToken += 1
            guess = ""
            searchResults = []
            HapticManager.error()
        }
        checkComplete()
    }

    func search() async {
        guard phase == .playing else { searchResults = []; return }
        let q = guess.trimmingCharacters(in: .whitespacesAndNewlines)
        guard q.count >= 2 else { searchResults = []; return }
        isSearching = true
        defer { isSearching = false }
        let results = (try? await APIClient.shared.searchPlayers(query: q)) ?? []
        let used = matchedIds
        searchResults = Array(results.filter { !used.contains($0.id) }.prefix(6))
    }

    /// Tapped an autocomplete suggestion — validate by id against the hole's answers.
    func pick(_ r: PlayerSearchResultDTO) {
        guard phase == .playing, !isResolving, let hole = currentHole else { return }
        // Re-tapping an answer you've already scored is an accidental double-tap, not a wrong guess.
        guard !matchedIds.contains(r.id) else { return }
        lockResolve()
        searchResults = []
        guess = ""
        if let answer = hole.answers.first(where: { $0.id == r.id }) {
            matched.append(answer)
            lastRevealed = answer
            revealToken += 1
            HapticManager.success()
        } else {
            wrongGuesses += 1
            wrongFlashToken += 1
            HapticManager.error()
        }
        checkComplete()
    }

    /// Briefly ignore further guesses while the current one's reveal/list animates out.
    private func lockResolve() {
        isResolving = true
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(350))
            isResolving = false
        }
    }

    func skipHole() {
        guard phase == .playing else { return }
        settle()
    }

    private func completeHole(skipped: Bool, effectiveShots: Int) {
        guard let hole = currentHole else { return }
        let result = FootballGolfHoleResult(
            id: hole.id,
            holeNumber: hole.holeNumber,
            par: hole.par,
            target: hole.target,
            matched: matched,
            shots: effectiveShots,
            skipped: skipped
        )
        results.append(result)
        phase = .holeResult
        if result.relativeToPar <= -1 { HapticManager.success() }
        else if result.relativeToPar == 0 { HapticManager.light() }
        else { HapticManager.error() }
    }

    func advance() {
        guard phase == .holeResult else { return }
        if results.count >= course.holes.count {
            phase = .finished
            if totalScore <= -2 { confettiToken += 1 }
            showResult = true
            return
        }
        currentHoleIndex += 1
        matched = []
        wrongGuesses = 0
        guess = ""
        searchResults = []
        lastRevealed = nil
        isResolving = false
        phase = .playing
    }

    var lastResult: FootballGolfHoleResult? { results.last }
}

// MARK: - Main View

struct FootballGolfView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: FootballGolfViewModel?
    @State private var showGiveUp = false
    @FocusState private var inputFocused: Bool
    private let allowReplay: Bool
    private let dailyDate: String?
    private let serverPuzzle: FootballGolfPuzzleDTO?
    var onComplete: () -> Void

    init(dailyDate: String? = nil, serverPuzzle: FootballGolfPuzzleDTO? = nil, allowReplay: Bool = false, onComplete: @escaping () -> Void) {
        self.dailyDate = dailyDate
        self.serverPuzzle = serverPuzzle
        self.allowReplay = allowReplay
        self.onComplete = onComplete
        if let serverPuzzle {
            _viewModel = State(initialValue: FootballGolfViewModel(course: FootballGolfCourse(dto: serverPuzzle)))
        } else {
            _viewModel = State(initialValue: nil)
        }
    }

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()
            if let viewModel {
                content(viewModel)
                    .persistsGameProgress(
                        viewModel.snapshot,
                        isResumable: viewModel.isResumable,
                        modeId: GameModeID.footballGolf.rawValue,
                        date: dailyDate,
                        version: FootballGolfProgress.progressVersion,
                        enabled: !allowReplay
                    )
                    .onAppear {
                        guard !allowReplay, let dailyDate,
                              let saved = GameProgressStore.load(
                                FootballGolfProgress.self, modeId: GameModeID.footballGolf.rawValue,
                                date: dailyDate, version: FootballGolfProgress.progressVersion, context: modelContext) else { return }
                        viewModel.restore(saved)
                    }
            } else {
                unavailableState
            }
        }
    }

    private var unavailableState: some View {
        VStack(spacing: 14) {
            Image(systemName: "flag.fill").font(.system(size: 34)).foregroundStyle(golfGreen)
            Text("TODAY'S COURSE ISN'T READY")
                .font(BKFont.headline(16))
                .foregroundStyle(BKTheme.textPrimary)
            Text("Pull the daily again in a moment.")
                .font(BKFont.caption(12))
                .foregroundStyle(BKTheme.textMuted)
            Button("CLOSE") { dismiss() }
                .font(BKFont.headline())
                .foregroundStyle(BKTheme.background)
                .padding(.horizontal, 28).padding(.vertical, 12)
                .background(golfGreen).clipShape(Capsule())
                .padding(.top, 8)
        }
    }

    @ViewBuilder
    private func content(_ vm: FootballGolfViewModel) -> some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView(showsIndicators: false) {
                    if let hole = vm.currentHole, vm.phase != .finished {
                        VStack(spacing: 18) {
                            promptCard(vm, hole)
                            matchedChips(vm)
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 14)
                        .padding(.bottom, 24)
                    }
                }
                .scrollDismissesKeyboard(.interactively)

                if vm.phase == .playing { inputBar(vm) }
            }
            .background(StadiumBackground())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: {
                        Ph.x.bold.color(BKTheme.textPrimary).frame(width: 15, height: 15)
                    }
                }
                ToolbarItem(placement: .principal) {
                    Text("FOOTBALL GOLF").font(BKFont.caption(13)).tracking(1.5).foregroundStyle(BKTheme.textSecondary)
                }
            }
            .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { inputFocused = true } }
            .onChange(of: vm.currentHoleIndex) { _, _ in
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { inputFocused = true }
            }
            .confirmationDialog("Skip this hole?", isPresented: $showGiveUp, titleVisibility: .visible) {
                Button("Skip hole", role: .destructive) { withAnimation { vm.skipHole() } }
                Button("Keep playing", role: .cancel) {}
            } message: {
                Text("Each point you're still missing counts as 2 shots.")
            }
        }
        .overlay {
            if vm.phase == .holeResult, let result = vm.lastResult {
                FootballGolfHoleResultOverlay(result: result, onNext: { withAnimation { vm.advance() } })
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
            }
        }
        .overlay { FootballConfettiView(burstToken: vm.confettiToken).allowsHitTesting(false) }
        .animation(GolfMotion.layout, value: vm.phase)
        .fullScreenCover(isPresented: Binding(get: { vm.showResult }, set: { vm.showResult = $0 })) {
            FootballGolfFinalView(
                course: vm.course,
                results: vm.results,
                totalScore: vm.totalScore,
                xpEarned: vm.xpEarned,
                onDone: { finish(vm) }
            )
        }
    }

    // MARK: prompt card — question hero, then target progress beneath

    private func promptCard(_ vm: FootballGolfViewModel, _ hole: FootballGolfHole) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(hole.category.uppercased())
                    .font(BKFont.caption(11)).tracking(1.4)
                    .foregroundStyle(BKTheme.textPrimary)
                Text("HOLE \(hole.holeNumber) / \(vm.course.holes.count)")
                    .font(BKFont.caption(11)).tracking(1.4)
                    .foregroundStyle(BKTheme.textMuted)
            }

            Text(PromptDisplay.golf(hole.prompt))
                .font(.system(size: 24, weight: .bold, design: .rounded))
                .foregroundStyle(BKTheme.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .lineSpacing(3)

            Divider().overlay(Color.white.opacity(0.08))

            FootballGolfHoleStatus(
                target: hole.target,
                points: vm.points,
                par: hole.par
            )
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Color.white.opacity(0.06), lineWidth: 1))
    }

    // MARK: matched answers — chips appear as you score them

    private func matchedChips(_ vm: FootballGolfViewModel) -> some View {
        VStack(spacing: 10) {
            ForEach(Array(vm.matched.enumerated()), id: \.element.id) { idx, answer in
                FootballGolfAnswerChip(answer: answer, justRevealed: idx == vm.matched.count - 1)
                    .id("\(answer.id)-\(vm.revealToken)")
                    .transition(.asymmetric(
                        insertion: .move(edge: .top).combined(with: .opacity),
                        removal: .opacity))
            }
        }
        .animation(GolfMotion.layout, value: vm.matched.count)
    }

    // Shots taken — one dot per guess, starting empty.
    private func shotsRow(_ vm: FootballGolfViewModel) -> some View {
        HStack(alignment: .center, spacing: 8) {
            Text("SHOTS")
                .font(BKFont.caption(9)).tracking(0.5)
                .foregroundStyle(BKTheme.textMuted)
            HStack(spacing: 5) {
                ForEach(0..<vm.shots, id: \.self) { _ in
                    Circle()
                        .fill(BKTheme.textPrimary)
                        .frame(width: 7, height: 7)
                }
            }
            .animation(GolfMotion.quick, value: vm.shots)
            Spacer(minLength: 8)
            Button { showGiveUp = true } label: {
                Text("Skip hole")
                    .font(BKFont.caption(12))
                    .foregroundStyle(BKTheme.textMuted)
                    .underline()
            }
        }
    }

    // MARK: input bar (dark field with focus border)

    private func inputBar(_ vm: FootballGolfViewModel) -> some View {
        VStack(spacing: 10) {
            if !vm.searchResults.isEmpty {
                VStack(spacing: 0) {
                    ForEach(vm.searchResults) { r in
                        Button { vm.pick(r); inputFocused = true } label: {
                            HStack(spacing: 12) {
                                PlayerAvatar(urlString: r.headshotUrl, size: 32)
                                Text(r.name.uppercased())
                                    .font(.system(size: 15, weight: .bold, design: .rounded))
                                    .foregroundStyle(BKTheme.textPrimary).lineLimit(1)
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 16).padding(.vertical, 12)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if r.id != vm.searchResults.last?.id { Divider().background(Color.white.opacity(0.06)) }
                    }
                }
                .background(BKTheme.cardElevated)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.white.opacity(0.06), lineWidth: 1))
                // Once a guess is being resolved, stop the (now-clearing) list from taking more taps.
                .allowsHitTesting(!vm.isResolving)
            }

            if vm.searchResults.isEmpty {
                shotsRow(vm)
            }

            TextField("", text: Binding(get: { vm.guess }, set: { vm.guess = $0 }), prompt:
                Text("Name a player").foregroundStyle(BKTheme.textMuted).font(.system(size: 14, weight: .medium, design: .rounded)))
                .textFieldStyle(.plain)
                .foregroundStyle(BKTheme.textPrimary)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.words)
                .focused($inputFocused)
                .submitLabel(.go)
                .onSubmit { vm.submitGuess(); inputFocused = true }
                .onChange(of: vm.guess) { _, _ in Task { await vm.search() } }
                .padding(.horizontal, 14).padding(.vertical, 11)
                .padding(.trailing, vm.isSearching ? 28 : 0)
                .background(BKTheme.cardElevated)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(alignment: .trailing) {
                    if vm.isSearching {
                        ProgressView()
                            .controlSize(.small)
                            .tint(BKTheme.textSecondary)
                            .padding(.trailing, 14)
                    }
                }
                .modifier(ShakeEffect(animatableData: CGFloat(vm.wrongFlashToken)))
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 12)
        .background(BKTheme.background)
    }

    private func finish(_ vm: FootballGolfViewModel) {
        if !allowReplay, let dailyDate {
            let total = vm.totalScore
            Task {
                await DailyCompletionService.recordCompletion(
                    modeId: GameModeID.footballGolf.rawValue,
                    date: dailyDate,
                    score: vm.xpEarned,   // per-hole XP summed (this IS the XP)
                    won: total <= 0,      // under/at par counts as a win for messaging
                    context: modelContext
                )
            }
        }
        vm.showResult = false
        onComplete()
        dismiss()
    }
}

// MARK: - Answer chip (with rarity reveal)

private struct FootballGolfAnswerChip: View {
    let answer: FootballGolfAnswer
    let justRevealed: Bool
    @State private var appeared = false

    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                Circle().fill(rarityColor)
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .black))
                    .foregroundStyle(BKTheme.background)
                    .symbolEffect(.bounce, value: appeared)
            }
            .frame(width: 22, height: 22)
            Text(answer.name.uppercased())
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundStyle(BKTheme.textPrimary)
                .lineLimit(1)
            Spacer(minLength: 8)
            Text("\(answer.rarity.label) · +\(answer.rarity.points)")
                .font(.system(size: 9, weight: .heavy, design: .rounded))
                .tracking(0.5)
                .foregroundStyle(rarityColor)
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(rarityColor.opacity(0.15))
                .clipShape(Capsule())
        }
        .padding(.horizontal, 14).padding(.vertical, 13)
        .background(BKTheme.cardElevated)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12)
            .strokeBorder(answer.rarity.isStandout ? rarityColor.opacity(0.45) : Color.white.opacity(0.05), lineWidth: 1))
        .scaleEffect(appeared ? 1 : (justRevealed ? 0.85 : 1))
        .modifier(GolfRarityReward(rarity: answer.rarity, trigger: appeared))
        .onAppear { withAnimation(GolfMotion.pop) { appeared = true } }
    }

    private var rarityColor: Color { golfRarityColor(answer.rarity) }
}

// MARK: - Rare/ultra answer reward (Pow spray, with a built-in glow fallback)

private struct GolfRarityReward: ViewModifier {
    let rarity: FootballGolfRarity
    let trigger: Bool

    func body(content: Content) -> some View {
        #if canImport(Pow)
        if rarity.isStandout {
            content.changeEffect(
                .spray(origin: UnitPoint(x: 0.5, y: 0.5)) {
                    Image(systemName: rarity == .ultraRare ? "star.fill" : "sparkle")
                        .foregroundStyle(golfRarityColor(rarity))
                },
                value: trigger)
        } else {
            content
        }
        #else
        content.modifier(GolfGlowPulse(active: rarity.isStandout, color: golfRarityColor(rarity)))
        #endif
    }
}

/// Built-in stand-in for Pow: a quick coloured glow flash on standout answers.
private struct GolfGlowPulse: ViewModifier {
    let active: Bool
    let color: Color
    @State private var glow = false

    func body(content: Content) -> some View {
        content
            .shadow(color: glow ? color.opacity(0.7) : .clear, radius: glow ? 14 : 0)
            .onAppear {
                guard active else { return }
                withAnimation(.easeOut(duration: 0.22)) { glow = true }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
                    withAnimation(.easeIn(duration: 0.6)) { glow = false }
                }
            }
    }
}

// MARK: - Target progress — the only prominent stat during play

private struct FootballGolfHoleStatus: View {
    let target: Int
    let points: Int
    let par: Int

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text("TARGET")
                    .font(BKFont.caption(10))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.textMuted)
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    Text("\(points)")
                        .font(.system(size: 28, weight: .heavy, design: .rounded))
                        .foregroundStyle(golfGreen)
                        .contentTransition(.numericText())
                    Text("/\(target)")
                        .font(.system(size: 28, weight: .heavy, design: .rounded))
                        .foregroundStyle(BKTheme.textPrimary)
                    Text(" pts")
                        .font(BKFont.caption(12))
                        .foregroundStyle(BKTheme.textMuted)
                }
            }
            Spacer(minLength: 16)
            VStack(alignment: .trailing, spacing: 4) {
                Text("PAR")
                    .font(BKFont.caption(10))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.textMuted)
                Text("\(par)")
                    .font(.system(size: 28, weight: .heavy, design: .rounded))
                    .foregroundStyle(BKTheme.textPrimary)
            }
        }
    }
}

// MARK: - Hole result overlay

private struct FootballGolfHoleResultOverlay: View {
    let result: FootballGolfHoleResult
    var onNext: () -> Void
    @State private var labelIn = false

    var body: some View {
        ZStack {
            Color.black.opacity(0.78).ignoresSafeArea().onTapGesture(perform: onNext)
            VStack(spacing: 16) {
                Text(result.label)
                    .font(BKFont.title(38)).foregroundStyle(outcomeColor)
                    .scaleEffect(labelIn ? 1 : 0.7)
                    .opacity(labelIn ? 1 : 0)
                Text("\(result.pointsReached)/\(result.target) pts · \(result.shots) shots · par \(result.par)")
                    .font(BKFont.headline(15)).foregroundStyle(BKTheme.textPrimary)
                Text("\(FootballGolfScoring.scoreLabel(result.relativeToPar)) · Hole \(result.holeNumber)")
                    .font(BKFont.caption(12)).foregroundStyle(BKTheme.textMuted)

                let holeXP = FootballGolfScoring.holeXP(result)
                Text("+\(holeXP) XP")
                    .font(BKFont.title(28))
                    .foregroundStyle(holeXP > 0 ? golfGreen : BKTheme.textMuted)
                    .scaleEffect(labelIn ? 1 : 0.7)
                    .opacity(labelIn ? 1 : 0)

                if result.skipped {
                    Text("Gave up — \(result.pointsReached)/\(result.target) pts")
                        .font(BKFont.caption(12)).foregroundStyle(BKTheme.textMuted)
                }
                if !result.matched.isEmpty {
                    VStack(spacing: 6) {
                        ForEach(result.matched) { a in
                            HStack {
                                Text(a.name).font(BKFont.caption(12)).foregroundStyle(BKTheme.textSecondary)
                                Spacer()
                                Text(a.rarity.label).font(.system(size: 9, weight: .heavy, design: .rounded))
                                    .foregroundStyle(golfRarityColor(a.rarity))
                            }
                        }
                    }
                    .frame(maxWidth: 240)
                }

                Button(action: onNext) {
                    Text("NEXT HOLE").font(BKFont.headline()).foregroundStyle(BKTheme.background)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(golfGreen).clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .padding(.top, 6)
            }
            .padding(24).frame(maxWidth: 320)
            .background(BKTheme.cardElevated).clipShape(RoundedRectangle(cornerRadius: 20))
            .padding(.horizontal, 24)
        }
        .onAppear { withAnimation(GolfMotion.pop) { labelIn = true } }
    }

    private var outcomeColor: Color {
        if result.relativeToPar < 0 { return golfGreen }
        if result.relativeToPar == 0 { return BKTheme.textPrimary }
        return BKTheme.wrong
    }
}

// MARK: - Final scorecard

private struct FootballGolfFinalView: View {
    let course: FootballGolfCourse
    let results: [FootballGolfHoleResult]
    let totalScore: Int
    let xpEarned: Int
    var onDone: () -> Void

    var body: some View {
        GameResultScreen(onExit: onDone) {
            VStack(spacing: 20) {
                VStack(spacing: 8) {
                    Text("ROUND COMPLETE").font(BKFont.caption(11)).tracking(1).foregroundStyle(BKTheme.textMuted)
                    Text("You finished \(FootballGolfScoring.scoreLabel(totalScore))")
                        .font(BKFont.title(40)).foregroundStyle(totalScore <= 0 ? golfGreen : BKTheme.textPrimary)
                    Text(FootballGolfScoring.finishMessage(totalScore))
                        .font(BKFont.headline(16)).foregroundStyle(BKTheme.textPrimary)
                    XPResultSummary(earned: xpEarned, max: DailyXP.maxXP(.footballGolf))
                }
                .padding(.top, 28)

                VStack(spacing: 8) {
                    ForEach(results) { result in
                        HStack {
                            Text("HOLE \(result.holeNumber)").font(BKFont.caption(10)).foregroundStyle(BKTheme.textMuted).frame(width: 56, alignment: .leading)
                            Text("Par \(result.par)").font(BKFont.caption(10)).foregroundStyle(BKTheme.textSecondary)
                            Spacer()
                            Text(result.label).font(BKFont.caption(10))
                                .foregroundStyle(result.relativeToPar < 0 ? golfGreen : (result.relativeToPar == 0 ? BKTheme.textSecondary : BKTheme.wrong))
                            Text(FootballGolfScoring.scoreLabel(result.relativeToPar))
                                .font(BKFont.headline(14)).foregroundStyle(BKTheme.textPrimary).frame(width: 32, alignment: .trailing)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 11)
                        .background(BKTheme.card).clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }
}

// MARK: - Shake effect for wrong guesses

private struct ShakeEffect: GeometryEffect {
    var animatableData: CGFloat
    func effectValue(size: CGSize) -> ProjectionTransform {
        let translation = 6 * sin(animatableData * .pi * 4)
        return ProjectionTransform(CGAffineTransform(translationX: translation, y: 0))
    }
}
