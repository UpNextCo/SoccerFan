import SwiftUI
import SwiftData

// MARK: - ViewModel

@MainActor
@Observable
final class GuessWhoViewModel {
    var state: GuessWhoGameState
    var searchQuery = ""
    var searchResults: [PlayerSearchResultDTO] = []
    var isSearching = false
    var isSubmitting = false
    var errorMessage: String?
    var completionResult: DailyCompleteResponseDTO?
    var showShare = false
    var confettiBurstToken = 0
    var isHinting = false
    var revealedAnswer: GuessWhoAnswerDTO?

    private let date: String

    init(puzzle: GuessWhoPuzzleDTO, date: String) {
        self.state = GuessWhoGameState(puzzle: puzzle)
        self.date = date
    }

    var currentGuessNumber: Int {
        min(state.guesses.count + 1, state.puzzle.maxGuesses)
    }

    /// Mid-game and worth saving: guessed at least once, not finished.
    var isResumable: Bool { !state.isComplete && !state.guesses.isEmpty }

    func restore(_ saved: GuessWhoGameState) {
        state = saved
        searchQuery = ""
        searchResults = []
        errorMessage = nil
        showShare = false
        completionResult = nil
        revealedAnswer = nil
    }

    var searchPlaceholder: String {
        if state.isComplete {
            return "GAME OVER"
        }
        return "GUESS \(currentGuessNumber) OF \(state.puzzle.maxGuesses)"
    }

    func search() async {
        let q = searchQuery.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else {
            searchResults = []
            return
        }
        isSearching = true
        defer { isSearching = false }
        do {
            searchResults = try await APIClient.shared.searchPlayers(query: q, currentTop5: true)
        } catch {
            searchResults = []
        }
    }

    func submitGuess(_ player: PlayerSearchResultDTO, context: ModelContext) async {
        guard !state.isComplete else { return }
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }

        do {
            let result = try await APIClient.shared.dailyGuess(DailyGuessRequestDTO(
                date: date,
                modeId: state.puzzle.modeId,
                playerId: player.id
            ))

            state.addGuess(player, feedback: result.feedback, correct: result.correct)
            searchQuery = ""
            searchResults = []

            if result.correct {
                HapticManager.success()
                Task {
                    try await Task.sleep(for: .seconds(GuessWhoTiming.flipSequenceDuration))
                    confettiBurstToken += 1
                }
            } else if state.isComplete {
                HapticManager.error()
            } else {
                HapticManager.light()
            }

            if state.isComplete {
                await completeGame(context: context)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func requestHint(context: ModelContext) async {
        guard state.canHint, !isHinting, !isSubmitting else { return }
        isHinting = true
        defer { isHinting = false }
        do {
            let hint = try await APIClient.shared.guessWhoHint(date: date, known: state.knownFields)
            guard let field = hint.field else { return }
            HapticManager.light()
            state.addHint(field: field, value: hint.value)
            if state.isComplete {
                await completeGame(context: context)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// A synthetic green row revealing the answer player, shown after a loss.
    var revealRow: GuessWhoGuessRow? {
        guard let answer = revealedAnswer else { return nil }
        let feedback = GuessWhoField.allCases.map { gf in
            GuessFeedbackFieldDTO(field: gf.rawValue, value: answer.attributes[gf.rawValue], status: "correct", hint: nil)
        }
        let player = PlayerSearchResultDTO(
            id: answer.id,
            name: answer.name,
            club: answer.attributes["club"]?.display ?? "",
            league: answer.attributes["league"]?.display ?? "",
            nationality: answer.attributes["nationality"]?.display ?? "",
            position: answer.attributes["position"]?.display ?? ""
        )
        return GuessWhoGuessRow(player: player, feedback: feedback, isCorrect: true)
    }

    private func completeGame(context: ModelContext?) async {
        if !state.won, revealedAnswer == nil {
            revealedAnswer = try? await APIClient.shared.revealGuessWhoAnswer(date: date)
        }
        let score = DailyXP.guessWho(guesses: state.guesses.count, solved: state.won)

        // Shared completion path (same as every other game): locks the daily locally first so it
        // can't be replayed even when the POST fails, then queues offline for a later sync.
        if let context {
            completionResult = await DailyCompletionService.recordCompletion(
                modeId: state.puzzle.modeId,
                date: date,
                score: score,
                guesses: state.guesses.count,
                won: state.won,
                shareGrid: state.shareGrid,
                context: context
            )
            if completionResult == nil {
                errorMessage = "Completed — will sync when online"
            }
        }

        if state.won {
            try? await Task.sleep(for: .seconds(GuessWhoTiming.winShareDelay))
        }
        showShare = true
    }

    var shareCard: ShareCard {
        ShareCard(
            title: "Ball Knowledge — Guess Who? \(formattedDate)",
            grid: state.shareGrid,
            scoreLine: "\(state.guesses.count)/\(state.puzzle.maxGuesses)",
            streakLine: "🔥 Ball Knowledge"
        )
    }

    private var formattedDate: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d"
        if let d = ISO8601DateFormatter().date(from: date + "T00:00:00Z") {
            return formatter.string(from: d)
        }
        return date
    }
}

// MARK: - Main View

struct GuessWhoView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase
    @State private var viewModel: GuessWhoViewModel
    @FocusState private var isSearchFocused: Bool
    var allowReplay: Bool
    private let date: String
    var onComplete: () -> Void

    init(puzzle: GuessWhoPuzzleDTO, date: String, allowReplay: Bool = false, onComplete: @escaping () -> Void) {
        _viewModel = State(initialValue: GuessWhoViewModel(puzzle: puzzle, date: date))
        self.allowReplay = allowReplay
        self.date = date
        self.onComplete = onComplete
    }

    var body: some View {
        ZStack {
            NavigationStack {
                VStack(spacing: 0) {
                    GuessWhoProgressBar(
                        guessesUsed: viewModel.state.guesses.count,
                        maxGuesses: viewModel.state.puzzle.maxGuesses
                    )
                    .onTapGesture {
                        isSearchFocused = false
                    }

                    GameXPBar(
                        current: viewModel.state.isComplete
                            ? DailyXP.guessWho(guesses: viewModel.state.guesses.count, solved: viewModel.state.won)
                            : DailyXP.guessWho(guesses: viewModel.state.guesses.count + 1, solved: true),
                        max: DailyXP.maxXP(.guessWho),
                        label: viewModel.state.isComplete ? "XP" : "SOLVE NOW"
                    )

                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 20) {
                            if viewModel.state.guesses.isEmpty && !viewModel.state.isComplete {
                                GuessWhoEmptyStateView()
                            }

                            ForEach(viewModel.state.guesses.reversed()) { row in
                                GuessWhoGuessCard(
                                    row: row,
                                    animateFlip: row.id == viewModel.state.guesses.last?.id
                                )
                                .transition(.move(edge: .top).combined(with: .opacity))
                            }

                            if viewModel.state.isComplete {
                                completionSection
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 24)
                        .frame(maxWidth: .infinity)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        isSearchFocused = false
                    }

                    if !viewModel.state.isComplete {
                        GuessWhoSearchSection(
                            viewModel: viewModel,
                            modelContext: modelContext,
                            isSearchFocused: $isSearchFocused
                        )
                    }
                }
                .background(StadiumBackground())
                .onAppear {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                        isSearchFocused = true
                    }
                }
                .onChange(of: viewModel.state.guesses.count) { oldCount, newCount in
                    if newCount > oldCount, !viewModel.state.isComplete {
                        DispatchQueue.main.asyncAfter(deadline: .now() + GuessWhoTiming.flipSequenceDuration) {
                            isSearchFocused = true
                        }
                    }
                }
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
                        Text("GUESS WHO?")
                            .font(BKFont.caption(13))
                            .tracking(1)
                            .foregroundStyle(BKTheme.accent)
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        if viewModel.state.canHint {
                            Button {
                                isSearchFocused = false
                                Task { await viewModel.requestHint(context: modelContext) }
                            } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "lightbulb.fill")
                                        .font(.system(size: 11, weight: .bold))
                                    Text("HINT (−1 GUESS)")
                                        .font(.system(size: 12, weight: .heavy, design: .rounded))
                                        .tracking(0.5)
                                }
                                .foregroundStyle(viewModel.isHinting ? BKTheme.textMuted : BKTheme.accent)
                            }
                            .disabled(viewModel.isHinting)
                        }
                    }
                }
            }

            FootballConfettiView(burstToken: viewModel.confettiBurstToken)
                .zIndex(999)
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.82), value: viewModel.state.guesses.count)
        .persistsGameProgress(
            viewModel.state,
            isResumable: viewModel.isResumable,
            modeId: GameModeID.guessWho.rawValue,
            date: date,
            version: GuessWhoGameState.progressVersion,
            enabled: !allowReplay
        )
        .onAppear {
            guard !allowReplay,
                  let saved = GameProgressStore.load(
                    GuessWhoGameState.self, modeId: GameModeID.guessWho.rawValue,
                    date: date, version: GuessWhoGameState.progressVersion, context: modelContext) else { return }
            viewModel.restore(saved)
        }
        .sheet(isPresented: $viewModel.showShare) {
            ShareResultSheet(shareCard: viewModel.shareCard) {
                viewModel.showShare = false
                onComplete()
                dismiss()
            }
        }
    }

    private var completionSection: some View {
        VStack(spacing: 16) {
            Group {
                if viewModel.state.won {
                    Ph.checkCircle.fill
                        .color(BKTheme.accent)
                } else {
                    Ph.xCircle.fill
                        .color(BKTheme.wrong)
                }
            }
            .frame(width: 56, height: 56)

            Text(viewModel.state.won ? "Got it!" : "Better luck tomorrow")
                .font(BKFont.title(22))
                .foregroundStyle(BKTheme.textPrimary)

            if !viewModel.state.won, let revealRow = viewModel.revealRow {
                VStack(spacing: 8) {
                    Text("THE ANSWER WAS")
                        .font(.system(size: 11, weight: .heavy, design: .rounded))
                        .tracking(1)
                        .foregroundStyle(BKTheme.textMuted)
                    GuessWhoGuessCard(row: revealRow, animateFlip: false)
                }
            }

            XPResultSummary(
                earned: viewModel.completionResult?.xpEarned
                    ?? DailyXP.guessWho(guesses: viewModel.state.guesses.count, solved: viewModel.state.won),
                max: DailyXP.maxXP(.guessWho)
            )

            Button("Share Result") {
                viewModel.showShare = true
            }
            .font(BKFont.headline())
            .foregroundStyle(BKTheme.background)
            .padding(.horizontal, 28)
            .padding(.vertical, 14)
            .background(BKTheme.accent)
            .clipShape(Capsule())
        }
        .padding(.vertical, 16)
    }
}

// MARK: - Progress

struct GuessWhoProgressBar: View {
    let guessesUsed: Int
    let maxGuesses: Int

    var body: some View {
        HStack(spacing: 8) {
            ForEach(0..<maxGuesses, id: \.self) { i in
                Capsule()
                    .fill(i < guessesUsed ? BKTheme.accent : BKTheme.cardElevated)
                    .frame(height: 4)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }
}

// MARK: - Empty State

struct GuessWhoEmptyStateView: View {
    private let labels = ["NAT", "LGE", "TEAM", "POS", "AGE", "FOOT"]

    var body: some View {
        VStack(spacing: 14) {
            Ph.sealQuestion.fill
                .color(BKTheme.textMuted.opacity(0.5))
                .frame(width: 28, height: 28)

            Text("YOUR FIRST GUESS")
                .font(.system(size: 13, weight: .heavy, design: .rounded))
                .tracking(1)
                .foregroundStyle(BKTheme.textMuted)

            HStack(spacing: 0) {
                ForEach(labels, id: \.self) { label in
                    VStack(spacing: 6) {
                        Circle()
                            .strokeBorder(BKTheme.cardElevated, lineWidth: 2)
                            .background(Circle().fill(BKTheme.card.opacity(0.5)))
                            .frame(width: 48, height: 48)

                        Text(label)
                            .font(.system(size: 9, weight: .bold, design: .rounded))
                            .tracking(0.3)
                            .foregroundStyle(BKTheme.textMuted.opacity(0.6))
                    }
                    .frame(maxWidth: .infinity)
                }
            }

            Text("Search for a player below")
                .font(BKFont.body(13))
                .foregroundStyle(BKTheme.textMuted)
                .padding(.top, 4)
        }
        .padding(.vertical, 28)
        .padding(.horizontal, 8)
        .background(BKTheme.card.opacity(0.35))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(BKTheme.cardElevated, style: StrokeStyle(lineWidth: 1, dash: [6, 4]))
        )
    }
}

// MARK: - Guess Card (Who Are Ya style)

struct GuessWhoGuessCard: View {
    let row: GuessWhoGuessRow
    let animateFlip: Bool

    @State private var revealedCount = 0
    @State private var didStartFlip = false

    static let flipStagger = GuessWhoTiming.flipStagger
    static let flipSpring = Animation.spring(response: 0.42, dampingFraction: 0.82)
    static var flipSequenceDuration: Double { GuessWhoTiming.flipSequenceDuration }

    private var fields: [GuessFeedbackFieldDTO] {
        displayFields(from: row.feedback)
    }

    var body: some View {
        VStack(spacing: 14) {
            if row.isHint {
                HStack(spacing: 6) {
                    Image(systemName: "lightbulb.fill")
                        .font(.system(size: 12, weight: .bold))
                    Text("HINT — USED A GUESS")
                        .font(.system(size: 15, weight: .heavy, design: .rounded))
                        .tracking(0.5)
                }
                .foregroundStyle(BKTheme.accent)
            } else {
                Text(row.player.name.uppercased())
                    .font(.system(size: 15, weight: .heavy, design: .rounded))
                    .tracking(0.5)
                    .foregroundStyle(BKTheme.textPrimary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
            }

            HStack(spacing: 0) {
                ForEach(Array(fields.enumerated()), id: \.element.field) { index, field in
                    GuessWhoFlipAttributeBadge(
                        field: field,
                        playerLeague: row.player.league,
                        playerTeamId: field.field == "club" ? row.player.teamId : nil,
                        playerTeamLogoUrl: field.field == "club" ? row.player.teamLogoUrl : nil,
                        isRevealed: !animateFlip || index < revealedCount
                    )
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(.vertical, 16)
        .padding(.horizontal, 8)
        .background(BKTheme.card.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .onAppear { startFlipSequenceIfNeeded() }
    }

    private func startFlipSequenceIfNeeded() {
        guard animateFlip else {
            revealedCount = fields.count
            return
        }
        guard !didStartFlip else { return }
        didStartFlip = true

        for index in fields.indices {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(index) * Self.flipStagger) {
                withAnimation(Self.flipSpring) {
                    revealedCount = index + 1
                }
            }
        }
    }
}

struct GuessWhoFlipAttributeBadge: View {
    let field: GuessFeedbackFieldDTO
    let playerLeague: String
    var playerTeamId: Int? = nil
    var playerTeamLogoUrl: String? = nil
    let isRevealed: Bool

    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                GuessWhoBadgePlaceholder()
                    .opacity(isRevealed ? 0 : 1)

                GuessWhoBadgeFace(
                    field: field,
                    playerLeague: playerLeague,
                    playerTeamId: playerTeamId,
                    playerTeamLogoUrl: playerTeamLogoUrl
                )
                    .rotation3DEffect(.degrees(180), axis: (x: 0, y: 1, z: 0))
                    .opacity(isRevealed ? 1 : 0)
            }
            .frame(width: 48, height: 48)
            .rotation3DEffect(
                .degrees(isRevealed ? 180 : 0),
                axis: (x: 0, y: 1, z: 0),
                perspective: 0.55
            )
            .animation(GuessWhoGuessCard.flipSpring, value: isRevealed)

            Text(fieldLabel(field.field))
                .font(.system(size: 9, weight: .bold, design: .rounded))
                .tracking(0.3)
                .foregroundStyle(BKTheme.textMuted)
        }
    }
}

struct GuessWhoBadgePlaceholder: View {
    var body: some View {
        Circle()
            .fill(BKTheme.guessWrong)
            .frame(width: 48, height: 48)
            .overlay(
                Circle()
                    .strokeBorder(BKTheme.cardElevated.opacity(0.45), lineWidth: 1)
            )
    }
}

struct GuessWhoBadgeFace: View {
    let field: GuessFeedbackFieldDTO
    var playerLeague: String = ""
    var playerTeamId: Int? = nil
    var playerTeamLogoUrl: String? = nil

    private var status: FeedbackStatus { FeedbackStatus(raw: field.status) }

    var body: some View {
        ZStack {
            Circle()
                .fill(status.badgeFill)
                .frame(width: 48, height: 48)

            badgeInner
        }
    }

    @ViewBuilder
    private var badgeInner: some View {
        if status == .hidden {
            Text("?")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(status.badgeText)
        } else if field.field == "club" {
            TeamBadgeImage(
                club: field.value?.display ?? "",
                league: playerLeague,
                teamId: playerTeamId,
                logoURL: playerTeamLogoUrl.flatMap(URL.init(string:)),
                size: 34
            ) {
                abbrevFallback
            }
            .padding(6)
        } else if field.field == "league" {
            LeagueBadgeImage(
                league: field.value?.display ?? "",
                size: 34
            ) {
                abbrevFallback
            }
            .padding(6)
        } else {
            abbrevFallback
        }
    }

    private var abbrevFallback: some View {
        Text(badgeContent)
            .font(.system(size: badgeFontSize, weight: .bold, design: .rounded))
            .foregroundStyle(status.badgeText)
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .minimumScaleFactor(0.55)
            .padding(4)
    }

    private var badgeFontSize: CGFloat {
        switch field.field {
        case "nationality": return 22
        case "league", "club": return 11
        default: return 13
        }
    }

    private var badgeContent: String {
        switch field.field {
        case "nationality":
            return GuessWhoDisplay.nationalityFlag(field.value?.display ?? "?")
        case "league":
            return GuessWhoDisplay.leagueAbbrev(field.value?.display ?? "?")
        case "club":
            return GuessWhoDisplay.clubAbbrev(field.value?.display ?? "?")
        case "position":
            return GuessWhoDisplay.positionAbbrev(field.value?.display ?? "?")
        case "foot":
            switch (field.value?.display ?? "").lowercased() {
            case "left": return "LEFT"
            case "right": return "RIGHT"
            case "both": return "BOTH"
            default: return "?"
            }
        case "age":
            return numericDisplay
        default:
            return field.value?.display ?? "?"
        }
    }

    private var numericDisplay: String {
        let value = field.value?.display ?? "?"
        guard field.field == "age" else { return value }

        if let hint = field.hint {
            let arrow = hint == "higher" ? "↑" : "↓"
            return "\(value)\(arrow)"
        }
        return value
    }
}

struct GuessWhoAttributeBadge: View {
    let field: GuessFeedbackFieldDTO
    var playerLeague: String = ""

    var body: some View {
        VStack(spacing: 6) {
            GuessWhoBadgeFace(field: field, playerLeague: playerLeague)

            Text(fieldLabel(field.field))
                .font(.system(size: 9, weight: .bold, design: .rounded))
                .tracking(0.3)
                .foregroundStyle(BKTheme.textMuted)
        }
    }
}

// MARK: - Display Helpers

enum GuessWhoDisplay {
    static func nationalityFlag(_ nationality: String) -> String {
        let raw = nationality.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.isEmpty { return "🌐" }
        let norm = normalizeCountry(raw)
        // UK home nations + a few territories have dedicated subdivision flag emoji.
        if let special = subdivisionFlags[norm] { return special }
        if let iso = countryISO[norm] { return flagEmoji(iso) }
        return "🌐" // unknown — a globe beats a "SE"-style letter placeholder
    }

    private static func normalizeCountry(_ s: String) -> String {
        s.lowercased()
            .folding(options: .diacriticInsensitive, locale: .current)
            .replacingOccurrences(of: "[^a-z ]", with: "", options: .regularExpression)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    /// Build a flag emoji from an ISO 3166-1 alpha-2 code via regional indicator symbols.
    private static func flagEmoji(_ iso: String) -> String {
        let base: UInt32 = 0x1F1E6 - 0x41 // regional indicator 'A' offset
        var view = String.UnicodeScalarView()
        for ch in iso.uppercased().unicodeScalars where ch.value >= 65 && ch.value <= 90 {
            if let scalar = UnicodeScalar(base + ch.value) { view.append(scalar) }
        }
        let flag = String(view)
        return flag.isEmpty ? "🌐" : flag
    }

    private static let subdivisionFlags: [String: String] = [
        "england": "🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
        "scotland": "🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",
        "wales": "🏴\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}",
    ]

    /// Normalized country name → ISO alpha-2. Covers footballing nations + common aliases.
    private static let countryISO: [String: String] = [
        "france": "fr", "spain": "es", "germany": "de", "italy": "it", "portugal": "pt",
        "brazil": "br", "argentina": "ar", "netherlands": "nl", "holland": "nl", "belgium": "be",
        "croatia": "hr", "serbia": "rs", "uruguay": "uy", "colombia": "co", "mexico": "mx",
        "japan": "jp", "south korea": "kr", "korea republic": "kr", "north korea": "kp",
        "korea dpr": "kp", "morocco": "ma", "nigeria": "ng", "ghana": "gh", "cameroon": "cm",
        "senegal": "sn", "ivory coast": "ci", "cote divoire": "ci", "cote d ivoire": "ci",
        "egypt": "eg", "algeria": "dz", "tunisia": "tn", "mali": "ml", "guinea": "gn",
        "dr congo": "cd", "congo dr": "cd", "democratic republic of congo": "cd", "congo": "cg",
        "gabon": "ga", "burkina faso": "bf", "cape verde": "cv", "cabo verde": "cv", "angola": "ao",
        "zambia": "zm", "zimbabwe": "zw", "south africa": "za", "kenya": "ke", "uganda": "ug",
        "togo": "tg", "benin": "bj", "equatorial guinea": "gq", "guinea bissau": "gw",
        "sierra leone": "sl", "liberia": "lr", "gambia": "gm", "mauritania": "mr", "madagascar": "mg",
        "mozambique": "mz", "comoros": "km", "libya": "ly", "sudan": "sd", "ethiopia": "et",
        "tanzania": "tz", "sweden": "se", "denmark": "dk", "norway": "no", "finland": "fi",
        "iceland": "is", "switzerland": "ch", "austria": "at", "poland": "pl", "czech republic": "cz",
        "czechia": "cz", "slovakia": "sk", "slovenia": "si", "hungary": "hu", "romania": "ro",
        "bulgaria": "bg", "ukraine": "ua", "russia": "ru", "turkey": "tr", "turkiye": "tr",
        "greece": "gr", "republic of ireland": "ie", "ireland": "ie", "northern ireland": "gb",
        "united states": "us", "usa": "us", "united states of america": "us", "canada": "ca",
        "chile": "cl", "peru": "pe", "ecuador": "ec", "paraguay": "py", "bolivia": "bo",
        "venezuela": "ve", "australia": "au", "new zealand": "nz", "iran": "ir", "iraq": "iq",
        "saudi arabia": "sa", "qatar": "qa", "united arab emirates": "ae", "uae": "ae",
        "china": "cn", "china pr": "cn", "israel": "il", "albania": "al", "north macedonia": "mk",
        "macedonia": "mk", "bosnia and herzegovina": "ba", "bosnia herzegovina": "ba", "bosnia": "ba",
        "montenegro": "me", "kosovo": "xk", "georgia": "ge", "armenia": "am", "azerbaijan": "az",
        "jamaica": "jm", "costa rica": "cr", "honduras": "hn", "panama": "pa", "el salvador": "sv",
        "guatemala": "gt", "trinidad and tobago": "tt", "suriname": "sr", "curacao": "cw",
        "haiti": "ht", "dominican republic": "do", "cuba": "cu", "nicaragua": "ni",
        "luxembourg": "lu", "malta": "mt", "cyprus": "cy", "estonia": "ee", "latvia": "lv",
        "lithuania": "lt", "belarus": "by", "moldova": "md", "faroe islands": "fo", "andorra": "ad",
        "san marino": "sm", "liechtenstein": "li", "gibraltar": "gi", "kazakhstan": "kz",
        "india": "in", "indonesia": "id", "thailand": "th", "vietnam": "vn", "malaysia": "my",
        "singapore": "sg", "philippines": "ph", "uzbekistan": "uz", "syria": "sy", "lebanon": "lb",
        "jordan": "jo", "palestine": "ps", "kuwait": "kw", "bahrain": "bh", "oman": "om", "yemen": "ye",
    ]

    static func leagueAbbrev(_ league: String) -> String {
        leagueAbbrevs[league] ?? String(league.prefix(3)).uppercased()
    }

    static func clubAbbrev(_ club: String) -> String {
        clubAbbrevs[club] ?? String(club.prefix(4)).uppercased()
    }

    static func positionAbbrev(_ position: String) -> String {
        switch position.lowercased() {
        case "goalkeeper": return "GK"
        case "defender": return "DEF"
        case "midfielder": return "MID"
        case "attacker": return "ATT"
        default: return String(position.prefix(3)).uppercased()
        }
    }

    private static let leagueAbbrevs: [String: String] = [
        "Premier League": "PL",
        "La Liga": "LL",
        "Serie A": "SA",
        "Ligue 1": "L1",
        "Bundesliga": "BL",
        "Super Lig": "SL",
        "MLS": "MLS",
        "Pro League": "SPL",
    ]

    private static let clubAbbrevs: [String: String] = [
        "Manchester City": "MCI",
        "Manchester United": "MUN",
        "Real Madrid": "RMA",
        "Barcelona": "BAR",
        "Liverpool": "LIV",
        "Arsenal": "ARS",
        "Chelsea": "CHE",
        "Tottenham": "TOT",
        "Bayern Munich": "BAY",
        "AC Milan": "MIL",
        "Paris Saint Germain": "PSG",
        "Atletico Madrid": "ATM",
        "Inter Miami": "MIA",
    ]
}

// MARK: - Search

struct GuessWhoSearchSection: View {
    @Bindable var viewModel: GuessWhoViewModel
    let modelContext: ModelContext
    var isSearchFocused: FocusState<Bool>.Binding

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 10) {
                HStack(spacing: 12) {
                    TextField("", text: $viewModel.searchQuery, prompt:
                        Text(viewModel.searchPlaceholder)
                            .foregroundStyle(BKTheme.textMuted)
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                    )
                    .textFieldStyle(.plain)
                    .foregroundStyle(BKTheme.textPrimary)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .focused(isSearchFocused)
                    .submitLabel(.search)
                    .onChange(of: viewModel.searchQuery) { _, _ in
                        Task { await viewModel.search() }
                    }

                    if viewModel.isSubmitting {
                        ProgressView()
                            .tint(BKTheme.textSecondary)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .background(BKTheme.cardElevated)
                .clipShape(RoundedRectangle(cornerRadius: 14))

                if !viewModel.searchResults.isEmpty {
                    PlayerSearchResultsList(
                        players: viewModel.searchResults,
                        onSelect: { player in
                            isSearchFocused.wrappedValue = false
                            Task { await viewModel.submitGuess(player, context: modelContext) }
                        }
                    )
                }

                if let error = viewModel.errorMessage {
                    Text(error)
                        .font(BKFont.caption())
                        .foregroundStyle(BKTheme.wrong)
                }
            }
            .padding(16)
            .background(BKTheme.background)
        }
    }
}

// MARK: - Share & Haptics

struct ShareResultSheet: View {
    let shareCard: ShareCard
    var onDone: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Text("Share your score")
                .font(BKFont.title(22))
                .foregroundStyle(BKTheme.textPrimary)

            VStack(alignment: .leading, spacing: 8) {
                Text(shareCard.title)
                Text(shareCard.grid).font(.title)
                Text(shareCard.scoreLine)
            }
            .font(BKFont.body())
            .foregroundStyle(BKTheme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            .background(BKTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal)

            ShareLink(item: shareCard.fullText) {
                Text("Share")
                    .font(BKFont.headline())
                    .foregroundStyle(BKTheme.background)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(BKTheme.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            }
            .padding(.horizontal)

            Button("Done", action: onDone)
                .foregroundStyle(BKTheme.textMuted)
        }
        .padding(.vertical, 32)
        .background(BKTheme.background)
        .presentationDetents([.medium])
    }
}

enum HapticManager {
    static func light() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    static func error() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }
}
