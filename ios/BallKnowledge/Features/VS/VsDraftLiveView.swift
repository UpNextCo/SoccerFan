import SwiftUI

struct VsDraftLiveView: View {
    @Environment(\.dismiss) private var dismiss
    var viewModel: VsViewModel
    let battle: BattleChallenge
    @State private var draft: DraftMasterViewModel
    @State private var now = Date()

    init(viewModel: VsViewModel, battle: BattleChallenge) {
        self.viewModel = viewModel
        self.battle = battle
        let draft = DraftMasterViewModel(challenge: battle)
        draft.state.phase = .building
        _draft = State(initialValue: draft)
    }

    private var live: VsLiveDTO? { viewModel.challenge?.live }
    private var turnName: String {
        live?.board.first(where: { $0.userId == live?.turnUserId })?.displayName ?? "Someone"
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                categoryHeader
                scoreboard
                turnBar
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
                    visibleFraction: 0.28,
                    onTapSlot: { open($0) },
                    onDropConstraint: { id, slot in
                        guard live?.yourTurn == true, slot.id == live?.slotId else { return }
                        draft.assignConstraint(id: id, toSlot: slot.id)
                        draft.openSlot(slot)
                    }
                )
                .frame(height: 208)
                .padding(.horizontal, 16)
                .padding(.top, 6)
                .padding(.bottom, 4)

                pickFeed
                    .frame(maxHeight: .infinity, alignment: .top)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
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
        .onReceive(Timer.publish(every: 0.25, on: .main, in: .common).autoconnect()) { now = $0 }
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

    private var turnBar: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(live?.yourTurn == true ? "YOUR TURN" : "\(turnName.uppercased())'S TURN")
                    .font(BKFont.caption(11)).tracking(1)
                    .foregroundStyle(live?.yourTurn == true ? BKTheme.accent : BKTheme.textMuted)
                Text("\(live?.slotLabel ?? "—") · \((live?.slotPosition ?? "").uppercased())")
                    .font(BKFont.headline(16))
                    .foregroundStyle(BKTheme.textPrimary)
            }
            Spacer()
            Text(timerLabel)
                .font(BKFont.headline(16))
                .foregroundStyle(secondsLeft <= 20 ? BKTheme.wrong : BKTheme.accent)
                .monospacedDigit()
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 2)
    }

    private var pickFeed: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("PICKS")
                .font(BKFont.caption(10)).tracking(1)
                .foregroundStyle(BKTheme.textMuted)
            if live?.picks.isEmpty != false {
                Text(live?.yourTurn == true
                     ? "Drag a chip onto \(live?.slotLabel ?? "the slot"), then name a player."
                     : "Waiting for \(turnName) to pick.")
                    .font(BKFont.body(13))
                    .foregroundStyle(BKTheme.textSecondary)
            } else {
                ScrollView {
                    VStack(spacing: 8) {
                        ForEach((live?.picks ?? []).reversed()) { row in
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
                                Text(row.slotLabel)
                                    .font(BKFont.caption(11))
                                    .foregroundStyle(BKTheme.textMuted)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .background(BKTheme.card)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
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
