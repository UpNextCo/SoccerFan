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

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                scoreboard
                categoryHero
                namedList
                Spacer(minLength: 0)
                turnFooter
            }
            .background(StadiumBackground(glowIntensity: 0.32))
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
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(hotseat?.players ?? [], id: \.userId) { row in
                    let isTurn = row.userId == hotseat?.turnUserId && hotseat?.finished != true
                    VStack(spacing: 2) {
                        Text(row.isYou ? "YOU" : row.displayName.uppercased())
                            .font(BKFont.caption(9))
                            .foregroundStyle(row.alive ? BKTheme.textMuted : BKTheme.wrong)
                            .lineLimit(1)
                        Text(row.alive ? "\(row.namedCount)" : "OUT")
                            .font(BKFont.title(20))
                            .foregroundStyle(row.alive ? (row.isYou ? BKTheme.accent : BKTheme.textPrimary) : BKTheme.wrong)
                            .contentTransition(.numericText())
                    }
                    .frame(minWidth: 64)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 8)
                    .background(BKTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(isTurn ? BKTheme.accent : Color.clear, lineWidth: 1.5)
                    )
                    .opacity(row.alive ? 1 : 0.55)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 4)
        }
        .animation(.easeOut(duration: 0.25), value: hotseat?.players.map(\.namedCount))
    }

    private var categoryHero: some View {
        VStack(spacing: 8) {
            HStack {
                Text(hotseat?.yourTurn == true ? "YOUR TURN" : turnCaption)
                    .font(BKFont.caption(11)).tracking(1)
                    .foregroundStyle(hotseat?.yourTurn == true ? BKTheme.accent : BKTheme.textMuted)
                Spacer()
                Text(timerLabel)
                    .font(BKFont.headline(16))
                    .foregroundStyle(secondsLeft <= 8 ? BKTheme.wrong : BKTheme.accent)
                    .monospacedDigit()
            }
            .padding(.horizontal, 20)

            Text(puzzle.category.label)
                .font(BKFont.title(28))
                .foregroundStyle(BKTheme.textPrimary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)

            Text("A miss knocks you out · last one standing wins")
                .font(BKFont.caption(12))
                .foregroundStyle(BKTheme.textSecondary)
        }
        .padding(.vertical, 10)
    }

    private var namedList: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 10) {
                Text("NAMED")
                    .font(BKFont.caption(11))
                    .tracking(1.2)
                    .foregroundStyle(BKTheme.textMuted)
                if hotseat?.named.isEmpty != false {
                    Text("Name a player who fits. A miss knocks you out. Once named, nobody else can use them.")
                        .font(BKFont.body(14))
                        .foregroundStyle(BKTheme.textSecondary)
                } else {
                    ForEach(hotseat?.named.reversed() ?? []) { row in
                        HStack(spacing: 10) {
                            PlayerAvatar(urlString: row.headshotUrl, size: 36)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.playerName)
                                    .font(BKFont.headline(15))
                                    .foregroundStyle(BKTheme.textPrimary)
                                Text(row.displayName)
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
            .padding(.horizontal, 16)
            .padding(.top, 4)
        }
    }

    @ViewBuilder
    private var turnFooter: some View {
        if you?.alive == false {
            Text("You're out — last one standing wins.")
                .font(BKFont.body(14))
                .foregroundStyle(BKTheme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(18)
        } else if hotseat?.yourTurn == true {
            VStack(spacing: 10) {
                if let feedback = search.feedback ?? viewModel.errorMessage {
                    Text(feedback)
                        .font(BKFont.caption(12))
                        .foregroundStyle(BKTheme.wrong)
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
                .background(BKTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                if !search.results.isEmpty {
                    PlayerSearchResultsList(
                        players: search.results,
                        isDisabled: { viewModel.isBusy || (hotseat?.namedPlayerIds.contains($0.id) == true) }
                    ) { hit in
                        Task { await name(hit) }
                    }
                    .frame(maxHeight: 220)
                }

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
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 16)
            .background(BKTheme.background.opacity(0.92))
        } else {
            Text(turnCaption)
                .font(BKFont.body(14))
                .foregroundStyle(BKTheme.textSecondary)
                .padding(18)
        }
    }

    private var turnCaption: String {
        if hotseat?.finished == true { return "Challenge over" }
        if let name = turnPlayer?.displayName {
            return "\(name)'s turn"
        }
        return "Waiting for the next turn"
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
        return String(format: "0:%02d", min(99, total))
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
