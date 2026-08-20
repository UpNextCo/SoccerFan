import SwiftUI

@MainActor
@Observable
final class VsHotseatSearch {
    var query = ""
    var results: [PlayerSearchResultDTO] = []
    var isSearching = false
    var feedback: String?
    private var searchTask: Task<Void, Never>?

    func reset() {
        query = ""
        results = []
        feedback = nil
        searchTask?.cancel()
        isSearching = false
    }

    func update(_ text: String, namedIds: Set<String>) {
        query = text
        feedback = nil
        searchTask?.cancel()
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else {
            results = []
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
                results = rows.filter { !namedIds.contains($0.id) }
                isSearching = false
            } catch {
                guard !Task.isCancelled else { return }
                results = []
                isSearching = false
            }
        }
    }
}

struct VsHotseatView: View {
    @Environment(\.dismiss) private var dismiss
    var viewModel: VsViewModel
    let puzzle: BackYourselfPuzzle
    @State private var search = VsHotseatSearch()
    @FocusState private var searchFocused: Bool
    @State private var now = Date()
    @State private var confirmGiveUp = false

    private var hotseat: VsHotseatDTO? { viewModel.challenge?.hotseat }
    private var you: VsHotseatPlayerDTO? { hotseat?.players.first(where: \.isYou) }
    private var turnPlayer: VsHotseatPlayerDTO? {
        guard let hotseat else { return nil }
        return hotseat.players.first { $0.userId == hotseat.turnUserId }
    }

    private var canPlay: Bool { hotseat?.yourTurn == true && you?.alive != false }
    private var turnName: String { turnPlayer?.displayName ?? "Someone" }
    private var searchResultsHeight: CGFloat {
        guard canPlay, !search.results.isEmpty else { return 0 }
        let row: CGFloat = 58
        return min(CGFloat(search.results.count) * row, row * 3) + 10
    }

    var body: some View {
        NavigationStack {
            GeometryReader { geo in
                let safeBottom = geo.safeAreaInsets.bottom
                let sheetH = (canPlay ? 138 : 110) + searchResultsHeight + safeBottom
                ZStack(alignment: .bottom) {
                    VStack(spacing: 0) {
                        scoreboard
                        categoryHero
                        namedList
                        Spacer(minLength: 0)
                    }
                    .padding(.bottom, sheetH)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .background(StadiumBackground(glowIntensity: 0.32))

                    if hotseat?.finished != true {
                        turnSheet(safeBottom: safeBottom)
                            .frame(height: sheetH, alignment: .top)
                    }
                }
                .frame(width: geo.size.width, height: geo.size.height + safeBottom)
                .ignoresSafeArea(edges: .bottom)
                .animation(.easeOut(duration: 0.25), value: sheetH)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: {
                        Ph.x.bold.color(BKTheme.textPrimary).frame(width: 15, height: 15)
                    }
                }
                ToolbarItem(placement: .principal) {
                    Text("VS · BACK YOURSELF")
                        .font(BKFont.caption(13)).tracking(1)
                        .foregroundStyle(BKTheme.accent)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    VsChallengeOverflowMenu(viewModel: viewModel)
                }
            }
        }
        .onReceive(Timer.publish(every: 0.25, on: .main, in: .common).autoconnect()) { now = $0 }
        .onChange(of: hotseat?.yourTurn) { _, yourTurn in
            if yourTurn != true {
                search.reset()
                searchFocused = false
            }
        }
        .onChange(of: viewModel.challenge?.result.allDone) { _, done in
            if done == true { dismiss() }
        }
        .onChange(of: viewModel.challenge?.id) { _, id in
            if id == nil { dismiss() }
        }
        .task(id: viewModel.challenge?.id) {
            while !Task.isCancelled {
                await viewModel.poll()
                if viewModel.challenge?.result.allDone == true { break }
                try? await Task.sleep(for: .seconds(1))
            }
        }
        .alert("Give up?", isPresented: $confirmGiveUp) {
            Button("Stay in", role: .cancel) {}
            Button("I'm out", role: .destructive) {
                Task { await giveUp() }
            }
        } message: {
            Text("You'll be eliminated. Last player standing wins.")
        }
    }

    private var scoreboard: some View {
        let rows = hotseat?.players ?? []
        let nameSize: CGFloat = rows.count >= 4 ? 10 : rows.count == 3 ? 12 : 13
        let scoreSize: CGFloat = rows.count >= 4 ? 20 : rows.count == 3 ? 24 : 30
        let hyphenSize: CGFloat = rows.count >= 4 ? 12 : rows.count == 3 ? 14 : 16
        let gap: CGFloat = rows.count >= 4 ? 8 : rows.count == 3 ? 12 : 16
        return HStack(spacing: gap) {
            ForEach(Array(rows.enumerated()), id: \.element.userId) { index, row in
                if index > 0 {
                    Text("–")
                        .font(BKFont.headline(hyphenSize))
                        .foregroundStyle(BKTheme.textMuted)
                }
                let isTurn = row.userId == hotseat?.turnUserId && hotseat?.finished != true
                VStack(spacing: 3) {
                    Text(row.isYou ? "YOU" : row.displayName.uppercased())
                        .font(BKFont.caption(nameSize))
                        .tracking(0.7)
                        .lineLimit(1)
                        .minimumScaleFactor(0.65)
                    Text(row.alive ? "\(row.namedCount)" : "OUT")
                        .font(BKFont.title(scoreSize))
                        .contentTransition(.numericText())
                        .minimumScaleFactor(0.7)
                        .lineLimit(1)
                }
                .foregroundStyle(
                    !row.alive ? BKTheme.wrong : isTurn ? BKTheme.accent : BKTheme.textPrimary
                )
                .opacity(isTurn ? 1 : 0.55)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16)
        .padding(.top, 18)
        .padding(.bottom, 16)
        .animation(.easeOut(duration: 0.25), value: hotseat?.turnUserId)
        .animation(.easeOut(duration: 0.25), value: hotseat?.players.map(\.namedCount))
    }

    private var categoryHero: some View {
        Text(puzzle.category.label)
            .font(BKFont.title(28))
            .foregroundStyle(BKTheme.textPrimary)
            .multilineTextAlignment(.center)
            .lineLimit(nil)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 220)
            .padding(.bottom, 18)
            .frame(maxWidth: .infinity)
    }

    private var namedList: some View {
        GeometryReader { geo in
            let names = hotseat?.named ?? []
            let cap = max(0, geo.size.height - 12)
            let boxH = min(namedContentHeight(count: names.count), cap)
            ScrollViewReader { proxy in
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 16) {
                        if names.isEmpty {
                            Text("Wrong guess and you’re eliminated. Last one standing wins.")
                                .font(BKFont.body(14))
                                .foregroundStyle(BKTheme.textSecondary)
                        } else {
                            ForEach(names) { row in
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(namedCaption(row))
                                        .font(BKFont.caption(12))
                                        .foregroundStyle(BKTheme.textMuted)
                                    HStack(spacing: 10) {
                                        PlayerAvatar(urlString: row.headshotUrl, size: 36)
                                        Text(row.playerName)
                                            .font(BKFont.headline(15))
                                            .foregroundStyle(BKTheme.textPrimary)
                                        Spacer()
                                    }
                                }
                                .id(row.id)
                            }
                        }
                        Color.clear
                            .frame(height: 1)
                            .id("namedTail")
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .scrollBounceBehavior(.basedOnSize)
                .defaultScrollAnchor(.bottom)
                .onAppear { pinNamedToLatest(proxy) }
                .onChange(of: names.last?.id) { _, _ in pinNamedToLatest(proxy) }
                .onChange(of: canPlay) { _, _ in pinNamedToLatest(proxy) }
            }
            .frame(height: boxH)
            .background(BKTheme.card.opacity(0.92))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 8)
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
            .animation(.easeOut(duration: 0.28), value: names.count)
        }
    }

    private func pinNamedToLatest(_ proxy: ScrollViewProxy) {
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(20))
            withAnimation(.easeOut(duration: 0.28)) {
                proxy.scrollTo("namedTail", anchor: .bottom)
            }
            try? await Task.sleep(for: .milliseconds(120))
            withAnimation(.easeOut(duration: 0.2)) {
                proxy.scrollTo("namedTail", anchor: .bottom)
            }
        }
    }

    private func namedContentHeight(count: Int) -> CGFloat {
        if count == 0 { return 64 }
        let row: CGFloat = 56
        let gap: CGFloat = 16
        let pad: CGFloat = 32
        return pad + CGFloat(count) * row + CGFloat(max(0, count - 1)) * gap
    }

    private func namedCaption(_ row: VsHotseatNamedDTO) -> String {
        if row.userId == you?.userId { return "You named" }
        return "\(row.displayName) named"
    }

    private var sheetShape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: 18,
            bottomLeadingRadius: 0,
            bottomTrailingRadius: 0,
            topTrailingRadius: 18,
            style: .continuous
        )
    }

    private func turnSheet(safeBottom: CGFloat) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 12) {
                Text(canPlay ? "YOUR TURN" : "\(turnName.uppercased())'S TURN")
                    .font(BKFont.headline(13)).tracking(0.8)
                    .foregroundStyle(canPlay ? BKTheme.accent : BKTheme.textMuted)
                Spacer(minLength: 8)
                Text(timerLabel)
                    .font(BKFont.title(22))
                    .foregroundStyle(secondsLeft <= 12 ? BKTheme.wrong : BKTheme.accent)
                    .monospacedDigit()
            }
            .padding(.horizontal, 24)
            .padding(.top, 16)
            .padding(.bottom, 12)

            if canPlay {
                if !search.results.isEmpty {
                    ScrollView(showsIndicators: false) {
                        PlayerSearchResultsList(
                            players: search.results,
                            isDisabled: { viewModel.isBusy || (hotseat?.namedPlayerIds.contains($0.id) == true) }
                        ) { hit in
                            Task { await name(hit) }
                        }
                    }
                    .frame(height: searchResultsHeight - 10)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 10)
                }
                if let feedback = search.feedback ?? viewModel.errorMessage {
                    Text(feedback)
                        .font(BKFont.caption(12))
                        .foregroundStyle(BKTheme.wrong)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 24)
                        .padding(.bottom, 8)
                }
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(BKTheme.textMuted)
                    TextField("Search a player", text: Binding(
                        get: { search.query },
                        set: { search.update($0, namedIds: Set(hotseat?.namedPlayerIds ?? [])) }
                    ))
                    .font(BKFont.body())
                    .foregroundStyle(BKTheme.textPrimary)
                    .focused($searchFocused)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(BKTheme.cardElevated)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .padding(.horizontal, 24)

                Button {
                    confirmGiveUp = true
                } label: {
                    Text("GIVE UP")
                        .font(BKFont.caption(12))
                        .tracking(0.8)
                        .foregroundStyle(BKTheme.textMuted)
                }
                .buttonStyle(.plain)
                .disabled(viewModel.isBusy)
                .padding(.top, 16)
                .padding(.bottom, 2)
            } else {
                Text(you?.alive == false
                     ? "You're out — last one standing wins."
                     : "Waiting for \(turnName)")
                    .font(BKFont.body(14))
                    .foregroundStyle(BKTheme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 24)
            }
            Spacer(minLength: 0)
        }
        .padding(.bottom, safeBottom)
        .frame(maxWidth: .infinity)
        .background(BKTheme.card)
        .clipShape(sheetShape)
        .overlay {
            sheetShape.stroke(BKTheme.cardElevated, lineWidth: 1)
        }
    }

    private var secondsLeft: Int {
        guard let hotseat, let deadline = Self.parseDeadline(hotseat.deadlineAt) else { return 0 }
        return max(0, Int(ceil(deadline.timeIntervalSince(now))))
    }

    private static func parseDeadline(_ raw: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: raw) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: raw)
    }

    private var timerLabel: String {
        let total = secondsLeft
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    private func name(_ hit: PlayerSearchResultDTO) async {
        if hotseat?.namedPlayerIds.contains(hit.id) == true {
            search.feedback = "Already named"
            HapticManager.error()
            return
        }
        let ok = await viewModel.namePlayer(playerId: hit.id)
        if ok {
            let stillAlive = viewModel.challenge?.hotseat?.players.first(where: \.isYou)?.alive != false
            if stillAlive { HapticManager.success() } else { HapticManager.error() }
            search.reset()
        } else {
            search.feedback = viewModel.errorMessage ?? "Doesn't fit the category"
            HapticManager.error()
        }
    }

    private func giveUp() async {
        _ = await viewModel.giveUpHotseat()
        HapticManager.error()
        search.reset()
    }
}
