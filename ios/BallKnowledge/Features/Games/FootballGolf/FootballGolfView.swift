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

/// There are many valid answers, so phrase prompts as a plural set rather than
/// "Name a …". e.g. "Name a footballer who has scored…" → "Footballers who have scored…".
private func displayPrompt(_ raw: String) -> String {
    var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    let lower = s.lowercased()
    if lower.hasPrefix("name an ") {
        s = String(s.dropFirst("name an ".count))
    } else if lower.hasPrefix("name a ") {
        s = String(s.dropFirst("name a ".count))
    } else {
        return s // unexpected shape — leave untouched
    }

    // Split the subject (e.g. "non-European defender") from the clause that follows.
    let connectors = [" who ", " whose ", " that ", " with "]
    let boundary = connectors.compactMap { s.range(of: $0)?.lowerBound }.min()

    let subject: String
    var rest: String
    if let b = boundary {
        subject = String(s[s.startIndex..<b])
        rest = String(s[b...])
    } else {
        subject = s
        rest = ""
    }

    rest = rest.replacingOccurrences(of: " who has ", with: " who have ")
               .replacingOccurrences(of: " that has ", with: " that have ")
               // the leading "have" already governs the next verb, so drop the second auxiliary:
               // "…have scored 10 CL goals and has won…" → "…and won…"
               .replacingOccurrences(of: " and has ", with: " and ")
               .replacingOccurrences(of: " and have ", with: " and ")

    var result = pluralizeLastWord(subject) + rest
    // The data uses both "Champions League" and "UEFA Champions League"; normalise so a
    // prompt mentioning both clauses doesn't read "…Champions League goals … UEFA Champions League".
    result = result.replacingOccurrences(of: "UEFA Champions League", with: "Champions League")
    result = result.prefix(1).uppercased() + result.dropFirst()
    return result
}

/// The DB only stores coarse buckets (Goalkeeper/Defender/Midfielder/Forward),
/// so map them to clean codes rather than truncating the full word.
private func golfPositionAbbrev(_ raw: String) -> String {
    let p = raw.lowercased()
    if p.isEmpty { return "—" }
    if p.contains("goal") || p == "gk" { return "GK" }
    if p.contains("def") || p.contains("back") { return "DEF" }
    if p.contains("mid") { return "MID" }
    if p.contains("forward") || p.contains("attack") || p.contains("strik") || p.contains("wing") { return "FWD" }
    return String(raw.prefix(3)).uppercased()
}

private func pluralizeLastWord(_ phrase: String) -> String {
    var core = phrase
    var trailing = ""
    while let last = core.last, ".!?,".contains(last) {
        trailing = String(last) + trailing
        core.removeLast()
    }
    var words = core.split(separator: " ").map(String.init)
    guard var last = words.popLast() else { return phrase }
    if !last.lowercased().hasSuffix("s") { last += "s" }
    words.append(last)
    return words.joined(separator: " ") + trailing
}

// MARK: - ViewModel

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

    // autocomplete
    var searchResults: [PlayerSearchResultDTO] = []
    var isSearching = false

    enum FootballGolfPhase: Equatable { case playing, holeResult, finished }

    init(course: FootballGolfCourse) {
        self.course = course
    }

    var currentHole: FootballGolfHole? {
        course.holes.indices.contains(currentHoleIndex) ? course.holes[currentHoleIndex] : nil
    }

    var totalScore: Int { results.map(\.relativeToPar).reduce(0, +) }
    var xpEarned: Int { FootballGolfScoring.xp(total: totalScore) }

    // Golf scoring: par is the POINTS target; every guess is a shot.
    var par: Int { currentHole?.par ?? 0 }
    var points: Int { matched.reduce(0) { $0 + $1.rarity.points } }
    var shots: Int { matched.count + wrongGuesses }
    var totalShots: Int { par + footballGolfShotCap }
    var shotsRemaining: Int { max(0, totalShots - shots) }

    private var matchedIds: Set<String> { Set(matched.map(\.id)) }

    /// End the hole if par points are reached; the shot cap force-settles the rest.
    private func checkComplete() {
        if points >= par {
            completeHole(skipped: false, effectiveShots: shots)
        } else if shots >= par + footballGolfShotCap {
            settle()
        }
    }

    /// Stop the hole and "fill" the remaining points at +2 shots each (the skip penalty).
    private func settle() {
        let remaining = max(0, par - points)
        completeHole(skipped: true, effectiveShots: shots + 2 * remaining)
    }

    func submitGuess() {
        guard phase == .playing, let hole = currentHole else { return }
        let trimmed = guess.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

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
        guard phase == .playing, let hole = currentHole else { return }
        searchResults = []
        guess = ""
        if let answer = hole.answers.first(where: { $0.id == r.id && !matchedIds.contains($0.id) }) {
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

    init(dailyDate: String? = nil, serverPuzzle: FootballGolfPuzzleDTO? = nil, allowReplay: Bool = true, onComplete: @escaping () -> Void) {
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
                FootballGolfScorecardStrip(holes: vm.course.holes, results: vm.results, currentIndex: vm.currentHoleIndex)

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
            .background(BKTheme.background)
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
            .confirmationDialog("Give up this hole?", isPresented: $showGiveUp, titleVisibility: .visible) {
                Button("Give up", role: .destructive) { withAnimation { vm.skipHole() } }
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

    // MARK: prompt card — the hero (league · hole · par, then the prompt)

    private func promptCard(_ vm: FootballGolfViewModel, _ hole: FootballGolfHole) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(hole.category.uppercased())
                    .font(BKFont.caption(11)).tracking(1.4)
                    .foregroundStyle(BKTheme.textPrimary)
                Text("HOLE \(hole.holeNumber) / \(vm.course.holes.count)")
                    .font(BKFont.caption(11)).tracking(1.4)
                    .foregroundStyle(BKTheme.textMuted)
                Spacer(minLength: 8)
                Text("PAR \(hole.par)")
                    .font(.system(size: 17, weight: .heavy, design: .rounded))
                    .foregroundStyle(golfGreen)
            }
            Text(displayPrompt(hole.prompt))
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .foregroundStyle(BKTheme.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .lineSpacing(2)
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

    // Shots remaining as depleting pips — lives above the keyboard.
    private func shotsCounter(_ vm: FootballGolfViewModel) -> some View {
        HStack(spacing: 5) {
            Text("SHOTS").font(BKFont.caption(9)).tracking(0.5).foregroundStyle(BKTheme.textMuted)
            ForEach(0..<vm.totalShots, id: \.self) { i in
                Circle()
                    .fill(i < vm.shotsRemaining
                          ? (vm.shotsRemaining <= 2 ? BKTheme.wrong : BKTheme.textPrimary)
                          : BKTheme.cardElevated)
                    .frame(width: 7, height: 7)
            }
        }
        .animation(GolfMotion.quick, value: vm.shotsRemaining)
    }

    // MARK: input bar (dark field with focus border)

    private func inputBar(_ vm: FootballGolfViewModel) -> some View {
        VStack(spacing: 10) {
            if !vm.searchResults.isEmpty {
                VStack(spacing: 0) {
                    ForEach(vm.searchResults) { r in
                        Button { withAnimation { vm.pick(r) }; inputFocused = true } label: {
                            HStack(spacing: 12) {
                                Text(golfPositionAbbrev(r.position))
                                    .font(.system(size: 11, weight: .heavy, design: .rounded)).tracking(0.5)
                                    .foregroundStyle(BKTheme.textMuted)
                                    .frame(width: 36, alignment: .leading)
                                Text(r.name.uppercased())
                                    .font(.system(size: 15, weight: .bold, design: .rounded))
                                    .foregroundStyle(BKTheme.textPrimary).lineLimit(1)
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 16).padding(.vertical, 15)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if r.id != vm.searchResults.last?.id { Divider().background(Color.white.opacity(0.06)) }
                    }
                }
                .background(BKTheme.cardElevated)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.white.opacity(0.06), lineWidth: 1))
            }

            if vm.searchResults.isEmpty {
                HStack {
                    shotsCounter(vm)
                    Spacer(minLength: 8)
                    Button { showGiveUp = true } label: {
                        Text("Give up hole")
                            .font(BKFont.caption(12))
                            .foregroundStyle(BKTheme.textMuted)
                            .underline()
                    }
                }
            }

            TextField("", text: Binding(get: { vm.guess }, set: { vm.guess = $0 }), prompt:
                Text("NAME A PLAYER").foregroundStyle(BKTheme.textMuted).font(.system(size: 14, weight: .semibold, design: .rounded)))
                .textFieldStyle(.plain)
                .foregroundStyle(BKTheme.textPrimary)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.words)
                .focused($inputFocused)
                .submitLabel(.go)
                .onSubmit { withAnimation { vm.submitGuess() }; inputFocused = true }
                .onChange(of: vm.guess) { _, _ in Task { await vm.search() } }
                .padding(.horizontal, 16).padding(.vertical, 14)
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
        .padding(16)
        .background(BKTheme.background)
    }

    private func finish(_ vm: FootballGolfViewModel) {
        if !allowReplay, let dailyDate {
            let total = vm.totalScore
            Task {
                await DailyCompletionService.recordCompletion(
                    modeId: GameModeID.footballGolf.rawValue,
                    date: dailyDate,
                    score: max(0, 40 - total * 4),
                    won: total <= 0,
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

// MARK: - Scorecard strip (the "course map")

private struct FootballGolfScorecardStrip: View {
    let holes: [FootballGolfHole]
    let results: [FootballGolfHoleResult]
    let currentIndex: Int

    var body: some View {
        HStack(spacing: 5) {
            ForEach(Array(holes.enumerated()), id: \.element.id) { index, hole in
                let result = results.first { $0.holeNumber == hole.holeNumber }
                VStack(spacing: 4) {
                    Capsule()
                        .fill(barColor(result, index: index))
                        .frame(height: 4)
                    Text(cell(result, par: hole.par))
                        .font(.system(size: 9, weight: .bold, design: .rounded))
                        .foregroundStyle(textColor(result, index: index))
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    private func cell(_ result: FootballGolfHoleResult?, par: Int) -> String {
        guard let result else { return "\(par)" }
        return FootballGolfScoring.scoreLabel(result.relativeToPar)
    }

    private func barColor(_ result: FootballGolfHoleResult?, index: Int) -> Color {
        if let result {
            if result.relativeToPar < 0 { return golfGreen }
            if result.relativeToPar == 0 { return BKTheme.textSecondary }
            return BKTheme.wrong.opacity(0.7)
        }
        return index == currentIndex ? golfGreen.opacity(0.5) : BKTheme.cardElevated
    }

    private func textColor(_ result: FootballGolfHoleResult?, index: Int) -> Color {
        guard let result else { return index == currentIndex ? BKTheme.textPrimary : BKTheme.textMuted }
        if result.relativeToPar < 0 { return golfGreen }
        if result.relativeToPar == 0 { return BKTheme.textSecondary }
        return BKTheme.wrong
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
                Text("\(FootballGolfScoring.scoreLabel(result.relativeToPar)) on Hole \(result.holeNumber) · \(result.shots) shots")
                    .font(BKFont.headline(15)).foregroundStyle(BKTheme.textPrimary)

                if result.skipped {
                    Text("Gave up — \(result.pointsReached)/\(result.par) pts")
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
        ZStack {
            BKTheme.background.ignoresSafeArea()
            ScrollView(showsIndicators: false) {
                VStack(spacing: 20) {
                    VStack(spacing: 8) {
                        Text("ROUND COMPLETE").font(BKFont.caption(11)).tracking(1).foregroundStyle(BKTheme.textMuted)
                        Text("You finished \(FootballGolfScoring.scoreLabel(totalScore))")
                            .font(BKFont.title(40)).foregroundStyle(totalScore <= 0 ? golfGreen : BKTheme.textPrimary)
                        Text(FootballGolfScoring.finishMessage(totalScore))
                            .font(BKFont.headline(16)).foregroundStyle(BKTheme.textPrimary)
                        Text("+\(xpEarned) XP").font(BKFont.headline(15)).foregroundStyle(golfGreen)
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

                    Button(action: onDone) {
                        Text("DONE").font(BKFont.headline()).foregroundStyle(BKTheme.background)
                            .frame(maxWidth: .infinity).padding(.vertical, 16)
                            .background(golfGreen).clipShape(RoundedRectangle(cornerRadius: 16))
                    }
                    .padding(.horizontal, 24).padding(.bottom, 32)
                }
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
