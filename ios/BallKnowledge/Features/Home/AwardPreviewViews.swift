import SwiftUI

/// Preview-only trophy payloads — not wired to XP / league events yet.
struct TrophyUnlockPayload: Identifiable, Equatable {
    enum Hero: Equatable {
        case gameTile(modeId: String)
        case bundleImage(String)
        case symbol
    }

    var id: String
    let eyebrow: String
    let kicker: String
    let gameTitle: String
    let detail: String
    let xp: Int
    let timesEarned: Int
    let hero: Hero
    var playsUnlock: Bool = true

    static func perfect(mode: GameModeID, image: String, timesEarned: Int = 1) -> TrophyUnlockPayload {
        TrophyUnlockPayload(
            id: "perfect-\(mode.rawValue)",
            eyebrow: "TROPHY UNLOCKED",
            kicker: "PERFECT SCORE",
            gameTitle: mode.title,
            detail: "MAX XP",
            xp: DailyXP.maxXP(mode),
            timesEarned: timesEarned,
            hero: .bundleImage(image)
        )
    }

    static func weeklyLeague(title: String, image: String) -> TrophyUnlockPayload {
        imageOnly(title: title, subtitle: "WEEKLY LEAGUE", image: image)
    }

    static func imageOnly(title: String, subtitle: String, image: String) -> TrophyUnlockPayload {
        TrophyUnlockPayload(
            id: "badge-\(image)",
            eyebrow: "TROPHY UNLOCKED",
            kicker: subtitle,
            gameTitle: title,
            detail: "",
            xp: 0,
            timesEarned: 1,
            hero: .bundleImage(image),
            playsUnlock: false
        )
    }

    /// Home daily order. Image names match `Resources/GameTiles/`.
    static let previewGameTrophies: [TrophyUnlockPayload] = [
        .perfect(mode: .footballBingo, image: "bingotrophy"),
        .perfect(mode: .oneMore, image: "onemoretrophy"),
        .perfect(mode: .draftMaster, image: "draftxitrophy"),
        .perfect(mode: .clubChain, image: "clubchaintrophy"),
        .perfect(mode: .targetMan, image: "targetmantrophy"),
        .perfect(mode: .lastManStanding, image: "trophylms"),
        .perfect(mode: .backYourself, image: "backyourselftrophy"),
        .perfect(mode: .darts501, image: "trophydarts", timesEarned: 2),
        .weeklyLeague(title: "Champions League", image: "cltrophy"),
        .weeklyLeague(title: "Premier League", image: "pltrophy"),
        .weeklyLeague(title: "Championship", image: "championshiptrophy"),
        .weeklyLeague(title: "League One", image: "l1trophy"),
        .weeklyLeague(title: "League Two", image: "l2trophy"),
        .weeklyLeague(title: "Non-League", image: "nltrophy"),
        .weeklyLeague(title: "Sunday League", image: "sltrophy"),
        .imageOnly(title: "Daily Leaderboard", subtitle: "MOST XP", image: "dailytrophy"),
        .imageOnly(title: "6k Overall XP", subtitle: "IN A DAY", image: "6ktrophy"),
        .imageOnly(title: "50k Overall XP", subtitle: "OVERALL XP", image: "50ktrophy"),
        .imageOnly(title: "100k Overall XP", subtitle: "OVERALL XP", image: "100ktrophy"),
        .imageOnly(title: "250k Overall XP", subtitle: "OVERALL XP", image: "250ktrophy"),
        .imageOnly(title: "500k Overall XP", subtitle: "OVERALL XP", image: "500ktrophy"),
        .imageOnly(title: "1M Overall XP", subtitle: "OVERALL XP", image: "1mtrophy"),
    ]

    static let dartsPerfect = previewGameTrophies.first { $0.id == "perfect-darts_501" }!
    static let lmsPerfect = previewGameTrophies.first { $0.id == "perfect-last_man_standing" }!
}

struct TrophyUnlockView: View {
    let payload: TrophyUnlockPayload
    let onDismiss: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var progress: Double = 0
    @State private var displayedXP: Double = 0
    @State private var showTitle = false
    @State private var showHero = false
    @State private var showDetail = false
    @State private var showContinue = false
    @State private var confettiToken = 0

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()
            HomeAmbientBackground()

            Circle()
                .fill(BKTheme.accent.opacity(0.11))
                .frame(width: 280, height: 280)
                .blur(radius: 32)
                .offset(y: -70)

            VStack(spacing: 0) {
                Spacer()

                VStack(alignment: .center, spacing: 28) {
                    Text(payload.eyebrow)
                        .font(BKFont.title(32))
                        .tracking(1.2)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .foregroundStyle(BKTheme.textPrimary)
                        .opacity(showTitle ? 1 : 0)
                        .offset(y: showTitle ? 0 : 14)

                    hero
                        .opacity(showHero ? 1 : 0)
                        .scaleEffect(showHero ? 1 : 0.86)

                    VStack(spacing: 9) {
                        GeometryReader { geometry in
                            ZStack(alignment: .leading) {
                                Capsule()
                                    .fill(BKTheme.cardElevated)
                                Capsule()
                                    .fill(BKTheme.accent)
                                    .frame(width: geometry.size.width * progress)
                            }
                        }
                        .frame(height: 9)

                        HStack {
                            Text("\(max(0, payload.timesEarned - 1))")
                                .foregroundStyle(BKTheme.textMuted)
                            Spacer()
                            Text("\(payload.timesEarned)")
                                .foregroundStyle(BKTheme.textPrimary)
                        }
                        .font(BKFont.title(22))
                    }
                    .padding(.horizontal, 8)
                    .opacity(showHero ? 1 : 0)

                    VStack(spacing: 10) {
                        Text("")
                            .modifier(TrophyCountingNumber(value: displayedXP))
                            .font(BKFont.title(56))
                            .foregroundStyle(BKTheme.accent)
                            .tracking(-1.5)
                            .contentTransition(.numericText())
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)

                        Text("PERFECT SCORE")
                            .font(BKFont.title(22))
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                            .foregroundStyle(BKTheme.textPrimary)

                        Text(payload.gameTitle)
                            .font(BKFont.body(14))
                            .foregroundStyle(BKTheme.textSecondary)
                    }
                    .opacity(showDetail ? 1 : 0)
                    .scaleEffect(showDetail ? 1 : 0.78)
                }
                .padding(.horizontal, 30)

                Spacer()

                GameResultExitBar(title: "CONTINUE", action: onDismiss)
                    .opacity(showContinue ? 1 : 0)
                    .allowsHitTesting(showContinue)
            }

            FootballConfettiView(burstToken: confettiToken)
                .allowsHitTesting(false)
        }
        .task { await runSequence() }
    }

    @ViewBuilder
    private var hero: some View {
        switch payload.hero {
        case .gameTile(let modeId):
            TrophyArtTile(
                imageName: GameModeTileArt.bundleImageName(for: modeId),
                size: 188,
                fills: false,
                showsBackdrop: false
            )
        case .bundleImage(let name):
            TrophyArtTile(
                imageName: name,
                size: 200,
                fills: false,
                showsBackdrop: false
            )
        case .symbol:
            ZStack {
                Circle()
                    .fill(BKTheme.cardElevated)
                    .frame(width: 96, height: 96)
                Ph.lightning.fill
                    .color(BKTheme.accent)
                    .frame(width: 36, height: 36)
            }
        }
    }

    @MainActor
    private func runSequence() async {
        try? await Task.sleep(for: .milliseconds(160))
        withAnimation(.spring(response: 0.46, dampingFraction: 0.8)) {
            showTitle = true
        }

        try? await Task.sleep(for: .milliseconds(280))
        withAnimation(.spring(response: 0.5, dampingFraction: 0.76)) {
            showHero = true
        }

        try? await Task.sleep(for: .milliseconds(220))
        withAnimation(.easeInOut(duration: reduceMotion ? 0.01 : 1.05)) {
            progress = 1
            displayedXP = Double(payload.xp)
        }
        if !reduceMotion {
            for _ in 0..<5 {
                try? await Task.sleep(for: .milliseconds(175))
                HapticManager.light()
            }
        }

        try? await Task.sleep(for: .milliseconds(180))
        withAnimation(.spring(response: 0.55, dampingFraction: 0.7)) {
            showDetail = true
        }
        confettiToken += 1
        HapticManager.success()

        try? await Task.sleep(for: .milliseconds(520))
        withAnimation(.spring(response: 0.42, dampingFraction: 0.82)) {
            showContinue = true
        }
    }
}

struct TrophyCabinetView: View {
    var onDismiss: () -> Void

    @State private var unlock: TrophyUnlockPayload?

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("PREVIEW")
                            .font(BKFont.caption(12))
                            .tracking(1.6)
                            .foregroundStyle(BKTheme.textMuted)
                        Text("Tap a row to play the unlock.")
                            .font(BKFont.body(14))
                            .foregroundStyle(BKTheme.textSecondary)
                    }
                    .padding(.horizontal, 4)

                    VStack(spacing: 0) {
                        ForEach(Array(TrophyUnlockPayload.previewGameTrophies.enumerated()), id: \.element.id) { index, payload in
                            TrophyCabinetRow(
                                payload: payload,
                                isLocked: false,
                                showsDivider: index < TrophyUnlockPayload.previewGameTrophies.count - 1
                            ) {
                                guard payload.playsUnlock else { return }
                                unlock = payload
                            }
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(BKTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 28)
            }
            .background { HomeAmbientBackground() }
            .background(BKTheme.background.ignoresSafeArea())
            .navigationTitle("Trophy Cabinet")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { onDismiss() }
                        .fontWeight(.semibold)
                        .foregroundStyle(BKTheme.accent)
                }
            }
        }
        .preferredColorScheme(.dark)
        .fullScreenCover(item: $unlock) { payload in
            TrophyUnlockView(payload: payload) {
                unlock = nil
            }
        }
    }
}

struct TrophyCabinetEntryCard: View {
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                GameModeBundleImage(name: "trophycabinet")
                    .scaledToFill()
                    .frame(width: 64, height: 64)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                VStack(alignment: .leading, spacing: 3) {
                    Text("Trophy Cabinet")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(BKTheme.textPrimary)
                    Text("\(TrophyUnlockPayload.previewGameTrophies.count) unlocked")
                        .font(BKFont.caption(12))
                        .foregroundStyle(BKTheme.textSecondary)
                }

                Spacer(minLength: 8)

                Ph.caretRight.bold
                    .color(BKTheme.textMuted)
                    .frame(width: 12, height: 12)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 14)
            .background(BKTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct TrophyCabinetRow: View {
    let payload: TrophyUnlockPayload
    var isLocked: Bool
    var showsDivider: Bool
    var onTap: () -> Void

    private let iconSize: CGFloat = 76
    private let iconCornerRadius: CGFloat = 14

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 0) {
                HStack(spacing: 14) {
                    thumbnail

                    VStack(alignment: .leading, spacing: 3) {
                        Text(rowTitle)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(BKTheme.textPrimary)
                            .lineLimit(1)
                        Text(rowSubtitle)
                            .font(BKFont.caption(12))
                            .foregroundStyle(BKTheme.textSecondary)
                    }

                    Spacer(minLength: 8)

                    if payload.timesEarned > 1 {
                        Text("×\(payload.timesEarned)")
                            .font(BKFont.title(22))
                            .foregroundStyle(BKTheme.accent)
                    }

                    if payload.playsUnlock {
                        Ph.caretRight.bold
                            .color(BKTheme.textMuted)
                            .frame(width: 12, height: 12)
                    }
                }
                .padding(.vertical, 14)
                .opacity(isLocked ? 0.55 : 1)

                if showsDivider {
                    Rectangle()
                        .fill(BKTheme.cardElevated)
                        .frame(height: 1)
                        .padding(.leading, 90)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(isLocked)
    }

    private var rowTitle: String {
        switch payload.hero {
        case .gameTile, .bundleImage:
            return payload.gameTitle
        case .symbol:
            return payload.kicker
        }
    }

    private var rowSubtitle: String {
        switch payload.hero {
        case .gameTile, .bundleImage:
            return payload.kicker
        case .symbol:
            return payload.detail
        }
    }

    @ViewBuilder
    private var thumbnail: some View {
        switch payload.hero {
        case .gameTile(let modeId):
            TrophyArtTile(
                imageName: GameModeTileArt.bundleImageName(for: modeId),
                size: iconSize,
                fills: false,
                showsBackdrop: false
            )
            .saturation(isLocked ? 0.45 : 1)
        case .bundleImage(let name):
            TrophyArtTile(
                imageName: name,
                size: iconSize,
                fills: false,
                showsBackdrop: false
            )
            .saturation(isLocked ? 0.45 : 1)
        case .symbol:
            ZStack {
                RoundedRectangle(cornerRadius: iconCornerRadius, style: .continuous)
                    .fill(BKTheme.cardElevated)
                Ph.lightning.fill
                    .color(isLocked ? BKTheme.textMuted : BKTheme.accent)
                    .frame(width: 22, height: 22)
            }
            .frame(width: iconSize, height: iconSize)
        }
    }
}

private struct TrophyArtTile: View {
    let imageName: String?
    var size: CGFloat
    var fills: Bool = true
    var showsBackdrop: Bool = true

    var body: some View {
        Group {
            if let imageName {
                GameModeBundleImage(name: imageName)
                    .aspectRatio(contentMode: fills ? .fill : .fit)
                    .frame(width: size, height: size, alignment: fills ? .top : .center)
            }
        }
        .frame(width: size, height: size)
        .background {
            if showsBackdrop {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(BKTheme.tileIconBackdrop)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: showsBackdrop ? 14 : 0, style: .continuous))
    }
}

private struct TrophyCountingNumber: AnimatableModifier {
    var value: Double
    var animatableData: Double {
        get { value }
        set { value = newValue }
    }

    func body(content: Content) -> some View {
        Text("\(Int(value.rounded()).formatted())XP")
    }
}

#Preview("Unlock — LMS perfect") {
    TrophyUnlockView(payload: .lmsPerfect, onDismiss: {})
        .preferredColorScheme(.dark)
}

#Preview("Cabinet") {
    TrophyCabinetView(onDismiss: {})
}
