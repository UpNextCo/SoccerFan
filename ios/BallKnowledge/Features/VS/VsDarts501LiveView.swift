import SwiftUI

struct VsDarts501LiveView: View {
    @Environment(\.dismiss) private var dismiss
    var viewModel: VsViewModel
    @State private var search = VsHotseatSearch()
    @FocusState private var searchFocused: Bool
    @State private var now = Date()

    private var live: VsDarts501DTO? { viewModel.challenge?.darts501 }
    private var turnPlayer: VsDarts501BoardDTO? {
        live?.board.first { $0.userId == live?.turnUserId }
    }

    private var showResult: Bool {
        live?.finished == true || viewModel.challenge?.result.allDone == true
    }

    var body: some View {
        NavigationStack {
            ZStack {
                VStack(spacing: 0) {
                    scoreboard
                    turnBar
                    formulaCard
                    history
                    Spacer(minLength: 0)
                    turnFooter
                }
                .background(StadiumBackground(glowIntensity: 0.32))

                if showResult {
                    resultScreen
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: leaveToLobby) {
                        Ph.x.bold.color(BKTheme.textPrimary).frame(width: 15, height: 15)
                    }
                }
                ToolbarItem(placement: .principal) {
                    Text("VS · FOOTBALL 501")
                        .font(BKFont.caption(13)).tracking(1)
                        .foregroundStyle(BKTheme.accent)
                }
                if !showResult {
                    ToolbarItem(placement: .topBarTrailing) {
                        VsChallengeOverflowMenu(viewModel: viewModel)
                    }
                }
            }
        }
        .onReceive(Timer.publish(every: 0.25, on: .main, in: .common).autoconnect()) { now = $0 }
        .onChange(of: live?.yourTurn) { _, yourTurn in
            if yourTurn != true {
                search.reset()
                searchFocused = false
            }
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
    }

    private var scoreboard: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(live?.board ?? [], id: \.userId) { row in
                    let isTurn = row.userId == live?.turnUserId && live?.finished != true
                    VStack(spacing: 4) {
                        Text(row.isYou ? "YOU" : row.displayName.uppercased())
                            .font(BKFont.caption(9))
                            .foregroundStyle(BKTheme.textMuted)
                            .lineLimit(1)
                        Text("\(row.remaining)")
                            .font(BKFont.title(22))
                            .foregroundStyle(row.inCheckout ? BKTheme.partial : (row.isYou ? BKTheme.accent : BKTheme.textPrimary))
                            .contentTransition(.numericText())
                        hearts(filled: row.livesLeft, total: live?.checkoutLives ?? 3)
                    }
                    .frame(minWidth: 72)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 8)
                    .background(BKTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(isTurn ? BKTheme.accent : Color.clear, lineWidth: 1.5)
                    )
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 4)
        }
        .animation(.easeOut(duration: 0.25), value: live?.board.map(\.remaining))
    }

    private var turnBar: some View {
        HStack(spacing: 8) {
            Text(live?.yourTurn == true ? "YOUR TURN" : "\(turnName.uppercased())'S TURN")
                .font(BKFont.caption(11)).tracking(1)
                .foregroundStyle(live?.yourTurn == true ? BKTheme.accent : BKTheme.textMuted)
            if turnPlayer?.inCheckout == true {
                Text("CHECKOUT")
                    .font(BKFont.caption(10)).tracking(1)
                    .foregroundStyle(BKTheme.partial)
            }
            Spacer()
            Text(timerLabel)
                .font(BKFont.headline(16))
                .foregroundStyle(secondsLeft <= 12 ? BKTheme.wrong : BKTheme.accent)
                .monospacedDigit()
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
    }

    private var formulaCard: some View {
        VStack(spacing: 4) {
            Text((live?.audience ?? "Any player").uppercased())
                .font(BKFont.caption(10)).tracking(0.8)
                .foregroundStyle(BKTheme.textMuted)
            Text(live?.formulaLabel ?? "Football 501")
                .font(BKFont.headline(15))
                .foregroundStyle(BKTheme.textPrimary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(14)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private var history: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 8) {
                Text("THROWS")
                    .font(BKFont.caption(10)).tracking(0.8)
                    .foregroundStyle(BKTheme.textMuted)
                if live?.throwLog.isEmpty != false {
                    Text("Name a player. Shared names. First to checkout wins.")
                        .font(BKFont.body(13))
                        .foregroundStyle(BKTheme.textSecondary)
                } else {
                    ForEach((live?.throwLog ?? []).reversed()) { row in
                        HStack(spacing: 10) {
                            PlayerAvatar(urlString: row.headshotUrl, size: 28)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.playerName)
                                    .font(BKFont.headline(14))
                                    .foregroundStyle(isBust(row) ? BKTheme.wrong : BKTheme.textPrimary)
                                    .lineLimit(1)
                                Text(row.isYou ? "YOU" : row.displayName.uppercased())
                                    .font(BKFont.caption(9))
                                    .foregroundStyle(BKTheme.textMuted)
                            }
                            Spacer()
                            throwValueLabel(row)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .background(BKTheme.cardElevated)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(BKTheme.card.opacity(0.92))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .padding(.horizontal, 16)
        }
    }

    @ViewBuilder
    private var turnFooter: some View {
        if live?.yourTurn == true {
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
                        set: { search.update($0, namedIds: Set(live?.usedPlayerIds ?? [])) }
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
                        isDisabled: { viewModel.isBusy || (live?.usedPlayerIds.contains($0.id) == true) }
                    ) { hit in
                        Task { await throwPlayer(hit) }
                    }
                    .frame(maxHeight: 200)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 16)
            .background(BKTheme.background.opacity(0.92))
        } else {
            Text(live?.finished == true ? "Challenge over" : "Waiting for \(turnName)")
                .font(BKFont.body(14))
                .foregroundStyle(BKTheme.textSecondary)
                .padding(18)
        }
    }

    private var turnName: String { turnPlayer?.displayName ?? "Someone" }

    private func hearts(filled: Int, total: Int) -> some View {
        HStack(spacing: 3) {
            ForEach(0..<total, id: \.self) { index in
                Image(systemName: index < filled ? "heart.fill" : "heart")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(
                        index < filled
                            ? Color(red: 0.95, green: 0.28, blue: 0.38)
                            : BKTheme.textMuted.opacity(0.35)
                    )
            }
        }
    }

    private func isBust(_ row: VsDarts501ThrowDTO) -> Bool {
        row.kind == "bust" || row.bustReason != nil
    }

    @ViewBuilder
    private func throwValueLabel(_ row: VsDarts501ThrowDTO) -> some View {
        if row.bustReason == "wrong_category" {
            Text("MISS")
                .font(BKFont.headline(14))
                .foregroundStyle(BKTheme.wrong)
        } else if isBust(row) {
            VStack(alignment: .trailing, spacing: 1) {
                Text("\(row.score)")
                    .font(BKFont.headline(14))
                    .foregroundStyle(BKTheme.wrong)
                Text("BUST")
                    .font(BKFont.caption(9))
                    .tracking(0.6)
                    .foregroundStyle(BKTheme.wrong)
            }
        } else {
            Text(row.kind == "perfect" ? "0" : row.kind == "checkout" ? "\(row.remainingAfter)" : "\(row.score)")
                .font(BKFont.headline(14))
                .foregroundStyle(BKTheme.textPrimary)
        }
    }

    private var secondsLeft: Int {
        guard let live, let deadline = Self.parseDeadline(live.deadlineAt) else { return 0 }
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

    private var resultScreen: some View {
        GameResultScreen(exitTitle: "BACK TO VS", onExit: leaveToLobby) {
            VStack(spacing: 20) {
                VStack(spacing: 8) {
                    Text("FOOTBALL 501")
                        .font(BKFont.caption(11))
                        .tracking(1)
                        .foregroundStyle(BKTheme.textMuted)
                    Text(resultHeadline)
                        .font(BKFont.title(32))
                        .foregroundStyle(resultHeadline == "YOU LOSE" ? BKTheme.wrong : BKTheme.accent)
                        .multilineTextAlignment(.center)
                    Text(resultSubline)
                        .font(BKFont.body(14))
                        .foregroundStyle(BKTheme.textSecondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 24)

                VStack(spacing: 10) {
                    ForEach(live?.board ?? [], id: \.userId) { row in
                        HStack {
                            Text(row.isYou ? "YOU" : row.displayName.uppercased())
                                .font(BKFont.headline(14))
                                .foregroundStyle(BKTheme.textPrimary)
                            Spacer()
                            Text("\(row.remaining)")
                                .font(BKFont.title(22))
                                .foregroundStyle(row.userId == live?.winnerUserId || resultHeadline == "IT'S A DRAW"
                                                 ? BKTheme.accent : BKTheme.textPrimary)
                        }
                    }
                }
                .padding(18)
                .background(BKTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

                Text("REMAINING")
                    .font(BKFont.caption(10)).tracking(1)
                    .foregroundStyle(BKTheme.textMuted)
            }
            .padding(.horizontal, 16)
        }
    }

    private var resultHeadline: String {
        switch viewModel.challenge?.result.winner {
        case "draw": return "IT'S A DRAW"
        case "you": return "YOU WIN"
        case "other": return "YOU LOSE"
        default:
            guard let live else { return "CHALLENGE COMPLETE" }
            if live.winnerUserId == nil { return "IT'S A DRAW" }
            return live.board.first(where: \.isYou)?.userId == live.winnerUserId ? "YOU WIN" : "YOU LOSE"
        }
    }

    private var resultSubline: String {
        if live?.board.contains(where: { $0.livesLeft == 0 }) == true,
           live?.board.allSatisfy({ $0.livesLeft == 0 }) == true {
            return "Everyone’s out of lives. Closest remaining wins."
        }
        if live?.throwLog.last?.kind == "perfect" { return "Perfect checkout." }
        if live?.throwLog.last?.kind == "checkout" { return "Checked out." }
        return "Challenge complete."
    }

    private func leaveToLobby() {
        viewModel.playing = false
        dismiss()
    }

    private func throwPlayer(_ hit: PlayerSearchResultDTO) async {
        if live?.usedPlayerIds.contains(hit.id) == true {
            search.feedback = "Someone already named that player"
            HapticManager.error()
            return
        }
        let ok = await viewModel.throwDarts501(playerId: hit.id)
        if ok {
            HapticManager.success()
            search.reset()
        } else {
            search.feedback = viewModel.errorMessage ?? "Couldn't lock that throw"
            HapticManager.error()
        }
    }
}
