import SwiftUI

struct VsDraftLiveView: View {
    @Environment(\.dismiss) private var dismiss
    var viewModel: VsViewModel
    let battle: BattleChallenge
    @State private var draft: DraftMasterViewModel
    @State private var picksExpanded = false

    init(viewModel: VsViewModel, battle: BattleChallenge) {
        self.viewModel = viewModel
        self.battle = battle
        let draft = DraftMasterViewModel(challenge: battle)
        draft.state.phase = .building
        _draft = State(initialValue: draft)
    }

    private var live: VsLiveDTO? { viewModel.challenge?.live }
    private var namedPicks: [VsLivePickFeedDTO] { live?.picks ?? [] }
    private var latestPicks: [VsLivePickFeedDTO] { Array(namedPicks.suffix(2).reversed()) }
    private var picksBySlot: [(slot: BattleSlot, rows: [VsLivePickFeedDTO])] {
        battle.slots.compactMap { slot in
            let rows = namedPicks.filter { $0.slotId == slot.id }
            return rows.isEmpty ? nil : (slot, rows)
        }
    }
    private var turnName: String {
        live?.board.first(where: { $0.userId == live?.turnUserId })?.displayName ?? "Someone"
    }

    var body: some View {
        NavigationStack {
            GeometryReader { geo in
                let safeBottom = geo.safeAreaInsets.bottom
                let collapsedH = VsDraftPicksSheet.collapsedHeight(empty: namedPicks.isEmpty, safeBottom: safeBottom)
                let expandedH = min(geo.size.height * 0.78, geo.size.height - 72)

                ZStack(alignment: .bottom) {
                    VStack(spacing: 0) {
                        categoryHeader
                        scoreboard
                        BattleConstraintsStrip(
                            constraints: battle.constraints,
                            usedIds: draft.state.usedConstraintIds
                        )
                        BattlePitchView(
                            slots: battle.slots,
                            state: draft.state,
                            highlightedSlotId: live?.slotId,
                            interactiveSlotId: live?.yourTurn == true ? live?.slotId : "",
                            focusSlotId: live?.slotId,
                            visibleFraction: 0.36,
                            onTapSlot: { open($0) },
                            onDropConstraint: { id, slot in
                                guard live?.yourTurn == true, slot.id == live?.slotId else { return }
                                draft.assignConstraint(id: id, toSlot: slot.id)
                                draft.openSlot(slot)
                            }
                        )
                        .frame(maxHeight: .infinity)
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                        .padding(.bottom, collapsedH - 8)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)

                    VsDraftPicksSheet(
                        battle: battle,
                        live: live,
                        namedPicks: namedPicks,
                        latestPicks: latestPicks,
                        picksBySlot: picksBySlot,
                        turnName: turnName,
                        collapsedHeight: collapsedH,
                        expandedHeight: expandedH,
                        safeBottom: safeBottom,
                        expanded: $picksExpanded
                    )
                }
                .frame(width: geo.size.width, height: geo.size.height + safeBottom)
                .ignoresSafeArea(edges: .bottom)
            }
            .background {
                StadiumBackground().ignoresSafeArea()
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: {
                        Ph.x.bold.color(BKTheme.textPrimary).frame(width: 15, height: 15)
                    }
                }
                ToolbarItem(placement: .principal) {
                    Text("VS · DRAFT XI")
                        .font(BKFont.caption(13)).tracking(1)
                        .foregroundStyle(BKTheme.accent)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    VsChallengeOverflowMenu(viewModel: viewModel)
                }
            }
        }
        .sheet(item: Binding(
            get: { draft.activeSlot },
            set: { if $0 == nil { draft.closeSlot() } }
        )) { slot in
            BattleSearchSheet(viewModel: draft, slot: slot)
        }
        .onAppear { wireDraft() }
        .onChange(of: live?.yourPicks.map(\.id)) { _, _ in syncPitch() }
        .onChange(of: live?.usedPlayerIds) { _, ids in
            draft.extraUsedPlayerIds = Set(ids ?? [])
        }
        .onChange(of: live?.yourTurn) { _, yourTurn in
            if yourTurn != true { draft.closeSlot() }
        }
        .onChange(of: live?.slotId) { _, _ in
            draft.closeSlot()
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

    private var categoryHeader: some View {
        VStack(spacing: 3) {
            Text(battle.category.title.uppercased())
                .font(BKFont.headline(15)).tracking(1)
                .foregroundStyle(BKTheme.textPrimary)
                .lineLimit(2)
                .minimumScaleFactor(0.75)
                .multilineTextAlignment(.center)
            Text(BattleFormations.displayName(for: battle.formationId).uppercased())
                .font(BKFont.caption(11)).tracking(1.1)
                .foregroundStyle(BKTheme.textMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16)
        .padding(.top, 6)
        .padding(.bottom, 4)
    }

    private var scoreboard: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(live?.board ?? [], id: \.userId) { row in
                    let isTurn = row.userId == live?.turnUserId && live?.finished != true
                    VStack(spacing: 2) {
                        Text(row.isYou ? "YOU" : row.displayName.uppercased())
                            .font(BKFont.caption(9))
                            .foregroundStyle(BKTheme.textMuted)
                            .lineLimit(1)
                        Text("\(row.total)")
                            .font(BKFont.title(22))
                            .foregroundStyle(row.isYou ? BKTheme.accent : BKTheme.textPrimary)
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
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
        }
        .animation(.easeOut(duration: 0.25), value: live?.board.map(\.total))
    }

    private func wireDraft() {
        draft.extraUsedPlayerIds = Set(live?.usedPlayerIds ?? [])
        let model = draft
        model.confirmPick = { [weak model] dto in
            guard let model,
                  let live = viewModel.challenge?.live,
                  let slot = model.activeSlot,
                  let constraint = model.state.constraint(forSlot: slot.id) else { return false }
            if dto.satisfiesConstraint == false {
                model.selectionError = constraint.rejectReason(player: dto.name)
                return false
            }
            let ok = await viewModel.lockPick(slotId: live.slotId, constraintId: constraint.id, playerId: dto.id)
            if !ok {
                model.selectionError = viewModel.errorMessage ?? "Couldn't lock that pick"
            }
            return ok
        }
        syncPitch()
    }

    private func syncPitch() {
        draft.applyLockedPicks(live?.yourPicks ?? [], preservingSlot: live?.yourTurn == true ? live?.slotId : nil)
    }

    private func open(_ slot: BattleSlot) {
        guard live?.yourTurn == true, slot.id == live?.slotId else { return }
        draft.openSlot(slot)
    }
}

private struct VsDraftPicksSheet: View {
    let battle: BattleChallenge
    let live: VsLiveDTO?
    let namedPicks: [VsLivePickFeedDTO]
    let latestPicks: [VsLivePickFeedDTO]
    let picksBySlot: [(slot: BattleSlot, rows: [VsLivePickFeedDTO])]
    let turnName: String
    let collapsedHeight: CGFloat
    let expandedHeight: CGFloat
    let safeBottom: CGFloat
    @Binding var expanded: Bool

    @State private var drag: CGFloat = 0
    @State private var now = Date()

    static func collapsedHeight(empty: Bool, safeBottom: CGFloat) -> CGFloat {
        (empty ? 122 : 176) + safeBottom
    }

    private var sheetHeight: CGFloat {
        let resting = expanded ? expandedHeight : collapsedHeight
        return min(expandedHeight, max(collapsedHeight, resting - drag))
    }

    var body: some View {
        VStack(spacing: 0) {
            chrome
            if namedPicks.isEmpty {
                Text(live?.yourTurn == true
                     ? "Drag a chip onto the highlighted slot, then name a player."
                     : "Waiting for \(turnName) to pick.")
                    .font(BKFont.body(13))
                    .foregroundStyle(BKTheme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
            } else {
                ScrollView(showsIndicators: expanded) {
                    VStack(alignment: .leading, spacing: 14) {
                        VStack(spacing: 8) {
                            ForEach(latestPicks) { row in
                                pickRow(row, showSlot: true)
                            }
                        }
                        if !picksBySlot.isEmpty {
                            Text("BY POSITION")
                                .font(BKFont.caption(10)).tracking(0.8)
                                .foregroundStyle(BKTheme.textMuted)
                                .padding(.top, 2)
                        }
                        ForEach(picksBySlot, id: \.slot.id) { group in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(group.slot.position.uppercased())
                                    .font(BKFont.caption(10)).tracking(0.8)
                                    .foregroundStyle(BKTheme.textMuted)
                                ForEach(group.rows) { row in
                                    pickRow(row, showSlot: false)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
                }
                .scrollDisabled(!expanded)
            }
            Spacer(minLength: 0)
        }
        .padding(.bottom, safeBottom)
        .frame(height: sheetHeight, alignment: .top)
        .frame(maxWidth: .infinity)
        .background {
            UnevenRoundedRectangle(
                topLeadingRadius: 18,
                bottomLeadingRadius: 0,
                bottomTrailingRadius: 0,
                topTrailingRadius: 18,
                style: .continuous
            )
            .fill(BKTheme.card)
            .ignoresSafeArea(edges: .bottom)
        }
        .overlay(alignment: .top) {
            UnevenRoundedRectangle(
                topLeadingRadius: 18,
                bottomLeadingRadius: 0,
                bottomTrailingRadius: 0,
                topTrailingRadius: 18,
                style: .continuous
            )
            .stroke(BKTheme.cardElevated, lineWidth: 1)
        }
        .contentShape(Rectangle())
        .gesture(dragGesture, including: expanded ? .none : .all)
        .onReceive(Timer.publish(every: 0.25, on: .main, in: .common).autoconnect()) { now = $0 }
    }

    private var chrome: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(BKTheme.textMuted.opacity(0.55))
                .frame(width: 36, height: 4)
                .padding(.top, 10)
                .padding(.bottom, 10)

            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(live?.yourTurn == true ? "YOUR TURN" : "\(turnName.uppercased())'S TURN")
                        .font(BKFont.caption(11)).tracking(1)
                        .foregroundStyle(live?.yourTurn == true ? BKTheme.accent : BKTheme.textMuted)
                    Text((live?.slotPosition ?? "—").uppercased())
                        .font(BKFont.headline(16))
                        .foregroundStyle(BKTheme.textPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
                Spacer(minLength: 8)
                Text(timerLabel)
                    .font(BKFont.headline(16))
                    .foregroundStyle(secondsLeft <= 20 ? BKTheme.wrong : BKTheme.accent)
                    .monospacedDigit()
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 10)
        }
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
        .highPriorityGesture(dragGesture, including: expanded ? .gesture : .none)
        .onTapGesture {
            guard !namedPicks.isEmpty else { return }
            withAnimation(.interactiveSpring(response: 0.28, dampingFraction: 0.9)) {
                expanded.toggle()
            }
        }
    }

    private func pickRow(_ row: VsLivePickFeedDTO, showSlot: Bool) -> some View {
        HStack(spacing: 10) {
            if let constraint = battle.constraints.first(where: { $0.id == row.constraintId }) {
                ConstraintIcon(constraint: constraint, size: 28)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(row.isYou ? "YOU" : row.displayName.uppercased())
                    .font(BKFont.caption(9))
                    .foregroundStyle(BKTheme.textMuted)
                Text("\(row.playerName)  (\(row.statValue))")
                    .font(BKFont.headline(14))
                    .foregroundStyle(BKTheme.textPrimary)
                    .lineLimit(1)
            }
            Spacer()
            if showSlot {
                Text(row.slotLabel)
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textMuted)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(BKTheme.cardElevated)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 2, coordinateSpace: .global)
            .onChanged { value in
                var transaction = Transaction()
                transaction.animation = nil
                withTransaction(transaction) {
                    drag = value.translation.height
                }
            }
            .onEnded { value in
                let predicted = value.predictedEndTranslation.height
                withAnimation(.interactiveSpring(response: 0.28, dampingFraction: 0.9)) {
                    if expanded {
                        if predicted > 56 { expanded = false }
                    } else if predicted < -56 {
                        expanded = true
                    }
                    drag = 0
                }
            }
    }

    private var secondsLeft: Int {
        guard let live, let deadline = Self.parseDeadline(live.deadlineAt) else { return 0 }
        return max(0, Int(ceil(deadline.timeIntervalSince(now))))
    }

    private var timerLabel: String {
        let total = secondsLeft
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    private static func parseDeadline(_ raw: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: raw) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: raw)
    }
}
