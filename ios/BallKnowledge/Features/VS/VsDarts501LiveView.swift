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

    var body: some View {
        NavigationStack {
            GeometryReader { geo in
                let safeBottom = geo.safeAreaInsets.bottom
                let showingResults = live?.yourTurn == true && !search.results.isEmpty
                let sheetH = (showingResults ? 286 : 118) + safeBottom
                ZStack(alignment: .bottom) {
                    VStack(spacing: 0) {
                        scoreboard
                        formulaCard
                        history
                        Spacer(minLength: 0)
                    }
                    .padding(.bottom, sheetH)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .background(StadiumBackground(glowIntensity: 0.32))

                    turnSheet(safeBottom: safeBottom)
                        .frame(height: sheetH, alignment: .top)
                }
                .frame(width: geo.size.width, height: geo.size.height + safeBottom)
                .ignoresSafeArea(edges: .bottom)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
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
        .liftsForKeyboard()
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
        let rows = live?.board ?? []
        let nameSize: CGFloat = rows.count >= 4 ? 11 : rows.count == 3 ? 13 : 15
        let scoreSize: CGFloat = rows.count >= 4 ? 24 : rows.count == 3 ? 30 : 38
        let hyphenSize: CGFloat = rows.count >= 4 ? 14 : rows.count == 3 ? 16 : 20
        let gap: CGFloat = rows.count >= 4 ? 8 : rows.count == 3 ? 12 : 16
        return HStack(spacing: gap) {
            ForEach(Array(rows.enumerated()), id: \.element.userId) { index, row in
                if index > 0 {
                    Text("–")
                        .font(BKFont.headline(hyphenSize))
                        .foregroundStyle(BKTheme.textMuted)
                }
                let isTurn = row.userId == live?.turnUserId && live?.finished != true
                VStack(spacing: 3) {
                    Text(row.isYou ? "YOU" : row.displayName.uppercased())
                        .font(BKFont.caption(nameSize))
                        .tracking(0.7)
                        .lineLimit(1)
                        .minimumScaleFactor(0.65)
                    Text("\(row.remaining)")
                        .font(BKFont.title(scoreSize))
                        .contentTransition(.numericText())
                        .minimumScaleFactor(0.7)
                        .lineLimit(1)
                    hearts(filled: row.livesLeft, total: live?.checkoutLives ?? 3)
                }
                .foregroundStyle(isTurn ? BKTheme.accent : BKTheme.textPrimary)
                .opacity(isTurn ? 1 : 0.55)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16)
        .padding(.top, 28)
        .padding(.bottom, 26)
        .animation(.easeOut(duration: 0.25), value: live?.turnUserId)
        .animation(.easeOut(duration: 0.25), value: live?.board.map(\.remaining))
    }

    private var category: Darts501CategoryDisplay {
        if let cat = viewModel.darts501Puzzle?.category { return cat }
        let audience = live?.audience ?? "Any player"
        let formula = {
            if let detail = live?.formulaDetail, !detail.isEmpty { return detail }
            return live?.formulaLabel ?? "Football 501"
        }()
        return Darts501CategoryDisplay(nationality: nil, audience: audience, formula: formula)
    }

    private var formulaCard: some View {
        let cat = category
        return VStack(spacing: 8) {
            if cat.hasNationFilter {
                VStack(spacing: 3) {
                    Text(cat.flag)
                        .font(.system(size: 40))
                    Text(cat.audience.uppercased())
                        .font(BKFont.headline(15))
                        .tracking(0.6)
                        .foregroundStyle(BKTheme.textPrimary)
                        .multilineTextAlignment(.center)
                }
            } else {
                Text("TODAY'S STAT")
                    .font(BKFont.caption(11))
                    .tracking(1.2)
                    .foregroundStyle(BKTheme.textMuted)
            }
            Text(cat.formula)
                .font(BKFont.body(13))
                .foregroundStyle(BKTheme.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 260)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
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
                VStack(alignment: .leading, spacing: 3) {
                    Text(live?.yourTurn == true ? "YOUR TURN" : "\(turnName.uppercased())'S TURN")
                        .font(BKFont.headline(13)).tracking(0.8)
                        .foregroundStyle(live?.yourTurn == true ? BKTheme.accent : BKTheme.textMuted)
                    if turnPlayer?.inCheckout == true {
                        Text("CHECKOUT")
                            .font(BKFont.caption(10)).tracking(1)
                            .foregroundStyle(BKTheme.partial)
                    }
                }
                Spacer(minLength: 8)
                Text(timerLabel)
                    .font(BKFont.title(22))
                    .foregroundStyle(secondsLeft <= 12 ? BKTheme.wrong : BKTheme.accent)
                    .monospacedDigit()
            }
            .padding(.horizontal, 24)
            .padding(.top, 16)
            .padding(.bottom, 12)

            if live?.yourTurn == true {
                if !search.results.isEmpty {
                    PlayerSearchResultsList(
                        players: search.results,
                        isDisabled: { viewModel.isBusy || (live?.usedPlayerIds.contains($0.id) == true) }
                    ) { hit in
                        Task { await throwPlayer(hit) }
                    }
                    .frame(maxHeight: 160)
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
                .background(BKTheme.cardElevated)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .padding(.horizontal, 24)
            } else {
                Text(live?.finished == true ? "Challenge over" : "Waiting for \(turnName)")
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
