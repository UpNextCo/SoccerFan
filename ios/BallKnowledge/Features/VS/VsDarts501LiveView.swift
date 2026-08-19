import SwiftUI

struct VsDarts501LiveView: View {
    @Environment(\.dismiss) private var dismiss
    var viewModel: VsViewModel
    @State private var search = VsHotseatSearch()
    @FocusState private var searchFocused: Bool
    @State private var now = Date()

    private var live: VsDarts501DTO? { viewModel.challenge?.darts501 }
    private var you: VsDarts501BoardDTO? { live?.board.first(where: \.isYou) }
    private var turnPlayer: VsDarts501BoardDTO? {
        live?.board.first { $0.userId == live?.turnUserId }
    }
    private var latestThrow: VsDarts501ThrowDTO? { live?.throwLog.last }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                scoreboard
                remainingHero
                formulaCard
                history
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
                    Text("VS · FOOTBALL 501")
                        .font(BKFont.caption(13)).tracking(1)
                        .foregroundStyle(BKTheme.accent)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    VsChallengeOverflowMenu(viewModel: viewModel)
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

    private var remainingHero: some View {
        let focus = live?.yourTurn == true ? you : turnPlayer
        return VStack(spacing: 6) {
            HStack {
                Text(live?.yourTurn == true ? "YOUR TURN" : "\(turnName.uppercased())'S TURN")
                    .font(BKFont.caption(11)).tracking(1)
                    .foregroundStyle(live?.yourTurn == true ? BKTheme.accent : BKTheme.textMuted)
                Spacer()
                Text(timerLabel)
                    .font(BKFont.headline(16))
                    .foregroundStyle(secondsLeft <= 12 ? BKTheme.wrong : BKTheme.accent)
                    .monospacedDigit()
            }
            .padding(.horizontal, 20)

            if focus?.inCheckout == true {
                Text("CHECKOUT")
                    .font(BKFont.caption(12)).tracking(2)
                    .foregroundStyle(BKTheme.partial)
            }
            Text("\(focus?.remaining ?? live?.startScore ?? 501)")
                .font(BKFont.title(52))
                .foregroundStyle(BKTheme.textPrimary)
                .contentTransition(.numericText())
            Text("REMAINING")
                .font(BKFont.caption(11)).tracking(1.4)
                .foregroundStyle(BKTheme.textMuted)

            if let latest = latestThrow {
                Text(latestLine(latest))
                    .font(BKFont.caption(12))
                    .foregroundStyle(isBust(latest) ? BKTheme.wrong : BKTheme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16)
            }
        }
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
            if let detail = live?.formulaDetail, !detail.isEmpty, detail != live?.formulaLabel {
                Text(detail)
                    .font(BKFont.caption(12))
                    .foregroundStyle(BKTheme.textSecondary)
                    .multilineTextAlignment(.center)
            }
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
                            Text(throwValue(row))
                                .font(BKFont.headline(14))
                                .foregroundStyle(isBust(row) ? BKTheme.wrong : BKTheme.textPrimary)
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

    private func throwValue(_ row: VsDarts501ThrowDTO) -> String {
        if row.kind == "perfect" { return "0" }
        if row.kind == "checkout" { return "\(row.remainingAfter)" }
        if row.bustReason == "wrong_category" { return "MISS" }
        if isBust(row) { return "BUST" }
        return "\(row.score)"
    }

    private func latestLine(_ row: VsDarts501ThrowDTO) -> String {
        let who = row.isYou ? "You" : row.displayName
        if row.kind == "perfect" { return "\(who) — perfect checkout" }
        if row.kind == "checkout" { return "\(who) checked out" }
        if row.bustReason == "wrong_category" { return "\(who) missed — \(row.playerName) doesn’t fit" }
        if isBust(row) { return "\(who) bust on \(row.playerName)" }
        return "\(who) scored \(row.score) with \(row.playerName)"
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
