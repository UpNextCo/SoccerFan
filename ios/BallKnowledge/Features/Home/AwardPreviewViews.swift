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

    var bundleImageName: String? {
        if case .bundleImage(let name) = hero { return name }
        return nil
    }

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

    static func gameLevel(modeTitle: String, tier: String, image: String) -> TrophyUnlockPayload {
        TrophyUnlockPayload(
            id: "level-\(image)",
            eyebrow: "TROPHY UNLOCKED",
            kicker: tier.uppercased(),
            gameTitle: modeTitle,
            detail: "",
            xp: 0,
            timesEarned: 1,
            hero: .bundleImage(image)
        )
    }

    /// Target Man score tiers. Gold 1 file is `targetmantgold1` (extra t).
    static let targetManLevels: [TrophyUnlockPayload] = [
        .gameLevel(modeTitle: GameModeID.targetMan.title, tier: "Bronze", image: "targetmanlevels/targetmanbronze"),
        .gameLevel(modeTitle: GameModeID.targetMan.title, tier: "Silver", image: "targetmanlevels/targetmansilver"),
        .gameLevel(modeTitle: GameModeID.targetMan.title, tier: "Gold", image: "targetmanlevels/targetmantgold1"),
        .gameLevel(modeTitle: GameModeID.targetMan.title, tier: "Platinum", image: "targetmanlevels/targetmanplatinum"),
        .gameLevel(modeTitle: GameModeID.targetMan.title, tier: "Legendary", image: "targetmanlevels/targetmangold2"),
        .gameLevel(modeTitle: GameModeID.targetMan.title, tier: "Ultimate", image: "targetmanlevels/targetmanemerald"),
    ]

    static let oneMoreLevels: [TrophyUnlockPayload] = [
        .gameLevel(modeTitle: GameModeID.oneMore.title, tier: "Bronze", image: "onemorelevels/onemorebronze"),
        .gameLevel(modeTitle: GameModeID.oneMore.title, tier: "Silver", image: "onemorelevels/onemoresilver"),
        .gameLevel(modeTitle: GameModeID.oneMore.title, tier: "Gold", image: "onemorelevels/onemoregold1"),
        .gameLevel(modeTitle: GameModeID.oneMore.title, tier: "Platinum", image: "onemorelevels/onemoreplatinum"),
        .gameLevel(modeTitle: GameModeID.oneMore.title, tier: "Legendary", image: "onemorelevels/onemoregold2"),
        .gameLevel(modeTitle: GameModeID.oneMore.title, tier: "Ultimate", image: "onemorelevels/onemoreemerald"),
    ]

    static let bingoLevels: [TrophyUnlockPayload] = [
        .gameLevel(modeTitle: GameModeID.footballBingo.title, tier: "Bronze", image: "bingolevels/bingobronze"),
        .gameLevel(modeTitle: GameModeID.footballBingo.title, tier: "Silver", image: "bingolevels/bingosilver"),
        .gameLevel(modeTitle: GameModeID.footballBingo.title, tier: "Gold", image: "bingolevels/bingogold1"),
        .gameLevel(modeTitle: GameModeID.footballBingo.title, tier: "Platinum", image: "bingolevels/bingoplatinum"),
        .gameLevel(modeTitle: GameModeID.footballBingo.title, tier: "Legendary", image: "bingolevels/bingogold2"),
        .gameLevel(modeTitle: GameModeID.footballBingo.title, tier: "Ultimate", image: "bingolevels/bingoemerald"),
    ]

    static let clubChainLevels: [TrophyUnlockPayload] = [
        .gameLevel(modeTitle: GameModeID.clubChain.title, tier: "Bronze", image: "clubchainlevels/clubchainbronze"),
        .gameLevel(modeTitle: GameModeID.clubChain.title, tier: "Silver", image: "clubchainlevels/clubchainsilver"),
        .gameLevel(modeTitle: GameModeID.clubChain.title, tier: "Gold", image: "clubchainlevels/clubchaingold1"),
        .gameLevel(modeTitle: GameModeID.clubChain.title, tier: "Platinum", image: "clubchainlevels/clubchainplatinum"),
        .gameLevel(modeTitle: GameModeID.clubChain.title, tier: "Legendary", image: "clubchainlevels/clubchaingold2"),
        .gameLevel(modeTitle: GameModeID.clubChain.title, tier: "Ultimate", image: "clubchainlevels/clubchainemerald"),
    ]

    static let lmsLevels: [TrophyUnlockPayload] = [
        .gameLevel(modeTitle: GameModeID.lastManStanding.title, tier: "Bronze", image: "LMSlevels/LMSbronze"),
        .gameLevel(modeTitle: GameModeID.lastManStanding.title, tier: "Silver", image: "LMSlevels/LMSsilver"),
        .gameLevel(modeTitle: GameModeID.lastManStanding.title, tier: "Gold", image: "LMSlevels/LMSgold1"),
        .gameLevel(modeTitle: GameModeID.lastManStanding.title, tier: "Platinum", image: "LMSlevels/LMSplatinum"),
        .gameLevel(modeTitle: GameModeID.lastManStanding.title, tier: "Legendary", image: "LMSlevels/LMSgold2"),
        .gameLevel(modeTitle: GameModeID.lastManStanding.title, tier: "Ultimate", image: "LMSlevels/LMSemerald"),
    ]

    static let backYourselfLevels: [TrophyUnlockPayload] = [
        .gameLevel(modeTitle: GameModeID.backYourself.title, tier: "Bronze", image: "backyourselflevels/backyourselfbronze"),
        .gameLevel(modeTitle: GameModeID.backYourself.title, tier: "Silver", image: "backyourselflevels/backyourselfsilver"),
        .gameLevel(modeTitle: GameModeID.backYourself.title, tier: "Gold", image: "backyourselflevels/backyourselfgold1"),
        .gameLevel(modeTitle: GameModeID.backYourself.title, tier: "Platinum", image: "backyourselflevels/backyourselfplatinum"),
        .gameLevel(modeTitle: GameModeID.backYourself.title, tier: "Legendary", image: "backyourselflevels/backyourselfgold2"),
        .gameLevel(modeTitle: GameModeID.backYourself.title, tier: "Ultimate", image: "backyourselflevels/backyourselfemerald"),
    ]

    static let draftLevels: [TrophyUnlockPayload] = [
        .gameLevel(modeTitle: GameModeID.draftMaster.title, tier: "Bronze", image: "draftlevels/draftbronze"),
        .gameLevel(modeTitle: GameModeID.draftMaster.title, tier: "Silver", image: "draftlevels/draftsilver"),
        .gameLevel(modeTitle: GameModeID.draftMaster.title, tier: "Gold", image: "draftlevels/draftgold1"),
        .gameLevel(modeTitle: GameModeID.draftMaster.title, tier: "Platinum", image: "draftlevels/draftplatinum"),
        .gameLevel(modeTitle: GameModeID.draftMaster.title, tier: "Legendary", image: "draftlevels/draftgold2"),
        .gameLevel(modeTitle: GameModeID.draftMaster.title, tier: "Ultimate", image: "draftlevels/draftemerald"),
    ]

    static let football501Levels: [TrophyUnlockPayload] = [
        .gameLevel(modeTitle: GameModeID.darts501.title, tier: "Bronze", image: "501levels/501bronze"),
        .gameLevel(modeTitle: GameModeID.darts501.title, tier: "Silver", image: "501levels/501silver"),
        .gameLevel(modeTitle: GameModeID.darts501.title, tier: "Gold", image: "501levels/501gold1"),
        .gameLevel(modeTitle: GameModeID.darts501.title, tier: "Platinum", image: "501levels/501platinum"),
        .gameLevel(modeTitle: GameModeID.darts501.title, tier: "Legendary", image: "501levels/501gold2"),
        .gameLevel(modeTitle: GameModeID.darts501.title, tier: "Ultimate", image: "501levels/501emerald"),
    ]

    /// Preview earn depth: `-1` all locked, `5` fully unlocked (Bronze → Ultimate).
    static let previewLevelStrips: [(title: String, levels: [TrophyUnlockPayload], earnedThrough: Int)] = [
        ("\(GameModeID.targetMan.title) PERFECT SCORE", targetManLevels, 5),
        ("\(GameModeID.oneMore.title) PERFECT SCORE", oneMoreLevels, 0),
        ("\(GameModeID.footballBingo.title) PERFECT SCORE", bingoLevels, 2),
        ("\(GameModeID.clubChain.title) PERFECT SCORE", clubChainLevels, 1),
        ("\(GameModeID.lastManStanding.title) PERFECT SCORE", lmsLevels, 5),
        ("\(GameModeID.backYourself.title) PERFECT SCORE", backYourselfLevels, 0),
        ("\(GameModeID.draftMaster.title) PERFECT SCORE", draftLevels, 3),
        ("\(GameModeID.darts501.title) PERFECT SCORE", football501Levels, 1),
    ]

    static func leagueReached(title: String, image: String) -> TrophyUnlockPayload {
        TrophyUnlockPayload(
            id: "league-\(image)",
            eyebrow: "TROPHY UNLOCKED",
            kicker: title.uppercased(),
            gameTitle: title,
            detail: "",
            xp: 0,
            timesEarned: 1,
            hero: .bundleImage(image)
        )
    }

    static let leagueTrophies: [TrophyUnlockPayload] = [
        .leagueReached(title: "Sunday League", image: "sltrophy"),
        .leagueReached(title: "Non-League", image: "nltrophy"),
        .leagueReached(title: "League Two", image: "l2trophy"),
        .leagueReached(title: "League One", image: "l1trophy"),
        .leagueReached(title: "Championship", image: "championshiptrophy"),
        .leagueReached(title: "Premier League", image: "pltrophy"),
        .leagueReached(title: "Champions League", image: "cltrophy"),
    ]

    static let totalXpTrophies: [TrophyUnlockPayload] = [
        .leagueReached(title: "50k", image: "50ktrophy"),
        .leagueReached(title: "100k", image: "100ktrophy"),
        .leagueReached(title: "250k", image: "250ktrophy"),
        .leagueReached(title: "500k", image: "500ktrophy"),
        .leagueReached(title: "1M", image: "1mtrophy"),
    ]

    static let megaTrophies: [TrophyUnlockPayload] = [
        .leagueReached(title: GameModeID.footballBingo.title, image: "megas/bingomega"),
        .leagueReached(title: GameModeID.oneMore.title, image: "megas/onemoremega"),
        .leagueReached(title: GameModeID.draftMaster.title, image: "megas/draftmega"),
        .leagueReached(title: GameModeID.targetMan.title, image: "megas/targetmanmega"),
        .leagueReached(title: GameModeID.backYourself.title, image: "megas/backyourselfmega"),
        .leagueReached(title: GameModeID.darts501.title, image: "megas/dartsmega"),
    ]

    static let leagueWinnerTrophies: [TrophyUnlockPayload] = [
        .leagueReached(title: "Sunday League", image: "winnertrophy/sundayleaguewinner"),
        .leagueReached(title: "Non-League", image: "winnertrophy/nonleaguewinner"),
        .leagueReached(title: "League Two", image: "winnertrophy/league2winner"),
        .leagueReached(title: "League One", image: "winnertrophy/league1winner"),
        .leagueReached(title: "Premier League", image: "winnertrophy/plwinner"),
        .leagueReached(title: "Champions League", image: "winnertrophy/championsleaguewinner"),
    ]

    static let previewGameTrophies: [TrophyUnlockPayload] = [
        .imageOnly(title: "Daily Leaderboard", subtitle: "MOST XP", image: "dailytrophy"),
        .imageOnly(title: "6k Overall XP", subtitle: "IN A DAY", image: "6ktrophy"),
    ]

    static let megaEarnedThrough = 0
    static let leagueEarnedThrough = 2
    static let winnerEarnedThrough = 1
    static let totalXpEarnedThrough = 0

    static let dartsPerfect = TrophyUnlockPayload.perfect(mode: .darts501, image: "trophydarts", timesEarned: 2)
    static let lmsPerfect = TrophyUnlockPayload.perfect(mode: .lastManStanding, image: "trophylms")

    static func earned(from levels: [TrophyUnlockPayload], through index: Int) -> [TrophyUnlockPayload] {
        guard index >= 0 else { return [] }
        return Array(levels.prefix(index + 1))
    }

    static var earnedPreviewGroups: [(title: String, trophies: [TrophyUnlockPayload])] {
        var groups: [(String, [TrophyUnlockPayload])] = []
        for strip in previewLevelStrips {
            let earned = earned(from: strip.levels, through: strip.earnedThrough)
            if !earned.isEmpty { groups.append((strip.title, earned)) }
        }
        let mega = earned(from: megaTrophies, through: megaEarnedThrough)
        if !mega.isEmpty { groups.append(("MEGA TROPHIES", mega)) }
        let leagues = earned(from: leagueTrophies, through: leagueEarnedThrough)
        if !leagues.isEmpty { groups.append(("LEAGUES REACHED", leagues)) }
        let winners = earned(from: leagueWinnerTrophies, through: winnerEarnedThrough)
        if !winners.isEmpty { groups.append(("LEAGUE WINNER", winners)) }
        let xp = earned(from: totalXpTrophies, through: totalXpEarnedThrough)
        if !xp.isEmpty { groups.append(("TOTAL XP", xp)) }
        if !previewGameTrophies.isEmpty { groups.append(("MILESTONES", previewGameTrophies)) }
        return groups
    }

    static var earnedPreviewTrophies: [TrophyUnlockPayload] {
        earnedPreviewGroups.flatMap(\.trophies)
    }

    static func earnedTrophy(id: String) -> TrophyUnlockPayload? {
        earnedPreviewTrophies.first { $0.id == id }
    }
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

                    if payload.xp > 0 {
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
                    }

                    VStack(spacing: 10) {
                        if payload.xp > 0 {
                            Text("")
                                .modifier(TrophyCountingNumber(value: displayedXP))
                                .font(BKFont.title(56))
                                .foregroundStyle(BKTheme.accent)
                                .tracking(-1.5)
                                .contentTransition(.numericText())
                                .multilineTextAlignment(.center)
                                .frame(maxWidth: .infinity)
                        }

                        Text(payload.kicker)
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
                    ForEach(TrophyUnlockPayload.previewLevelStrips, id: \.title) { strip in
                        GameLevelsPreviewRow(
                            title: strip.title,
                            levels: strip.levels,
                            earnedThroughIndex: strip.earnedThrough
                        ) { payload in
                            unlock = payload
                        }
                    }

                    GameLevelsPreviewRow(
                        title: "MEGA TROPHIES",
                        levels: TrophyUnlockPayload.megaTrophies,
                        earnedThroughIndex: TrophyUnlockPayload.megaEarnedThrough
                    ) { payload in
                        unlock = payload
                    }

                    GameLevelsPreviewRow(
                        title: "LEAGUES REACHED",
                        levels: TrophyUnlockPayload.leagueTrophies,
                        earnedThroughIndex: TrophyUnlockPayload.leagueEarnedThrough
                    ) { payload in
                        unlock = payload
                    }

                    GameLevelsPreviewRow(
                        title: "LEAGUE WINNER",
                        levels: TrophyUnlockPayload.leagueWinnerTrophies,
                        earnedThroughIndex: TrophyUnlockPayload.winnerEarnedThrough
                    ) { payload in
                        unlock = payload
                    }

                    GameLevelsPreviewRow(
                        title: "TOTAL XP",
                        levels: TrophyUnlockPayload.totalXpTrophies,
                        earnedThroughIndex: TrophyUnlockPayload.totalXpEarnedThrough
                    ) { payload in
                        unlock = payload
                    }

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

private enum GameLevelReveal: Equatable {
    case earned
    case next
    case locked

    var opacity: Double {
        switch self {
        case .earned: return 1
        case .next: return 0.72
        case .locked: return 0.40
        }
    }
}

private struct GameLevelsPreviewRow: View {
    let title: String
    let levels: [TrophyUnlockPayload]
    /// Preview-only: last earned index so next-peek vs locked can be compared.
    var earnedThroughIndex: Int = 1
    var onSelect: (TrophyUnlockPayload) -> Void

    private let badgeSpacing: CGFloat = 12
    private let leadingInset: CGFloat = 14
    @State private var contentFrame: CGRect = .zero
    @State private var viewportWidth: CGFloat = 0

    /// Three full badges plus half of Platinum at the clip edge.
    private var badgeSize: CGFloat {
        guard viewportWidth > 0 else { return 84 }
        let reserved = leadingInset + badgeSpacing * 3
        return (viewportWidth - reserved) / 3.5
    }

    private var canScrollFurther: Bool {
        contentFrame.width > 0 && viewportWidth > 0 && contentFrame.maxX > viewportWidth + 8
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(BKTheme.textPrimary)
                .padding(.horizontal, 14)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: badgeSpacing) {
                    ForEach(Array(levels.enumerated()), id: \.element.id) { index, payload in
                        let reveal = revealState(at: index)
                        Button {
                            guard reveal == .earned else { return }
                            onSelect(payload)
                        } label: {
                            VStack(spacing: 8) {
                                ZStack(alignment: .bottomTrailing) {
                                    TrophyArtTile(
                                        imageName: payload.bundleImageName,
                                        size: badgeSize,
                                        fills: false,
                                        showsBackdrop: false
                                    )
                                    .opacity(reveal.opacity)

                                    if reveal != .earned {
                                        Image(systemName: "lock.fill")
                                            .font(.system(size: 10, weight: .bold))
                                            .foregroundStyle(BKTheme.textPrimary)
                                            .frame(width: 20, height: 20)
                                            .background(BKTheme.cardElevated)
                                            .clipShape(Circle())
                                            .offset(x: 2, y: 2)
                                    }
                                }
                                Text(payload.kicker)
                                    .font(BKFont.caption(11))
                                    .foregroundStyle(reveal == .earned ? BKTheme.textSecondary : BKTheme.textMuted)
                                    .lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.leading, leadingInset)
                .padding(.trailing, 4)
                .padding(.bottom, 4)
                .background {
                    GeometryReader { geo in
                        Color.clear.preference(
                            key: LevelStripContentFrameKey.self,
                            value: geo.frame(in: .named("levelStrip"))
                        )
                    }
                }
            }
            .coordinateSpace(name: "levelStrip")
            .background {
                GeometryReader { geo in
                    Color.clear.preference(key: LevelStripViewportWidthKey.self, value: geo.size.width)
                }
            }
            .onPreferenceChange(LevelStripContentFrameKey.self) { contentFrame = $0 }
            .onPreferenceChange(LevelStripViewportWidthKey.self) { viewportWidth = $0 }
            .overlay(alignment: .trailing) {
                if canScrollFurther {
                    LinearGradient(
                        colors: [BKTheme.card.opacity(0), BKTheme.card],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .frame(width: 20)
                    .allowsHitTesting(false)
                }
            }
        }
        .padding(.top, 12)
        .padding(.bottom, 10)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func revealState(at index: Int) -> GameLevelReveal {
        if index <= earnedThroughIndex { return .earned }
        if index == earnedThroughIndex + 1 { return .next }
        return .locked
    }
}

private struct LevelStripContentFrameKey: PreferenceKey {
    static var defaultValue: CGRect = .zero
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
        value = nextValue()
    }
}

private struct LevelStripViewportWidthKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
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

struct TrophyArtTile: View {
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

struct FeaturedTrophyBadge: View {
    let imageName: String
    var size: CGFloat = 38

    var body: some View {
        TrophyArtTile(imageName: imageName, size: size, fills: false, showsBackdrop: false)
            .frame(width: size, height: size)
            .background {
                Circle()
                    .fill(BKTheme.background)
                    .frame(width: size + 8, height: size + 8)
            }
            .overlay {
                Circle()
                    .stroke(BKTheme.background, lineWidth: 3)
                    .frame(width: size + 6, height: size + 6)
            }
            .shadow(color: .black.opacity(0.35), radius: 4, y: 1)
    }
}

struct FeaturedTrophyPicker: View {
    var selectedId: String?
    var onSelect: (TrophyUnlockPayload?) -> Void

    @Environment(\.dismiss) private var dismiss

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 4)

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 22) {
                    Text("Pick a trophy you've earned. It shows on your profile picture.")
                        .font(BKFont.body(14))
                        .foregroundStyle(BKTheme.textSecondary)

                    if selectedId != nil {
                        Button {
                            onSelect(nil)
                            dismiss()
                        } label: {
                            Text("Remove featured trophy")
                                .font(BKFont.headline(14))
                                .foregroundStyle(BKTheme.accent)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .background(BKTheme.card)
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }

                    ForEach(TrophyUnlockPayload.earnedPreviewGroups, id: \.title) { group in
                        VStack(alignment: .leading, spacing: 12) {
                            Text(group.title)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(BKTheme.textMuted)
                                .tracking(0.4)

                            LazyVGrid(columns: columns, spacing: 14) {
                                ForEach(group.trophies) { trophy in
                                    Button {
                                        onSelect(trophy)
                                        dismiss()
                                    } label: {
                                        VStack(spacing: 6) {
                                            TrophyArtTile(
                                                imageName: trophy.bundleImageName,
                                                size: 64,
                                                fills: false,
                                                showsBackdrop: false
                                            )
                                            .padding(6)
                                            .background {
                                                RoundedRectangle(cornerRadius: 16, style: .continuous)
                                                    .fill(BKTheme.card)
                                            }
                                            .overlay {
                                                RoundedRectangle(cornerRadius: 16, style: .continuous)
                                                    .stroke(
                                                        selectedId == trophy.id ? BKTheme.accent : .clear,
                                                        lineWidth: 2
                                                    )
                                            }

                                            Text(trophy.kicker)
                                                .font(BKFont.caption(9))
                                                .foregroundStyle(BKTheme.textSecondary)
                                                .lineLimit(1)
                                                .minimumScaleFactor(0.8)
                                        }
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 28)
            }
            .background(BKTheme.background.ignoresSafeArea())
            .navigationTitle("Featured Trophy")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                        .foregroundStyle(BKTheme.accent)
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}

#Preview("Unlock — LMS perfect") {
    TrophyUnlockView(payload: .lmsPerfect, onDismiss: {})
        .preferredColorScheme(.dark)
}

#Preview("Cabinet") {
    TrophyCabinetView(onDismiss: {})
}
