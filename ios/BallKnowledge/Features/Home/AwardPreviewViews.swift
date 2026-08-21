import SwiftUI

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
    var timesEarned: Int
    let hero: Hero
    var playsUnlock: Bool = true
    var ladderSteps: Int = 0
    var ladderFilled: Int = 0
    var ladderLabels: [String] = []
    var ladderFilledIndices: [Int] = []

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

    static let perfectScoreModes: [(mode: GameModeID, levels: [TrophyUnlockPayload])] = [
        (.targetMan, targetManLevels),
        (.oneMore, oneMoreLevels),
        (.footballBingo, bingoLevels),
        (.clubChain, clubChainLevels),
        (.lastManStanding, lmsLevels),
        (.backYourself, backYourselfLevels),
        (.draftMaster, draftLevels),
        (.darts501, football501Levels),
    ]

    static func levels(for mode: GameModeID) -> [TrophyUnlockPayload]? {
        perfectScoreModes.first { $0.mode == mode }?.levels
    }

    static func perfectScoreUnlock(mode: GameModeID, count: Int) -> TrophyUnlockPayload? {
        guard let levels = levels(for: mode), !levels.isEmpty else { return nil }
        let thresholds = PerfectScoreStore.thresholds(for: mode)
        let index = PerfectScoreStore.earnedThroughIndex(count: count, thresholds: thresholds)
        guard index >= 0, index < levels.count else { return nil }
        var payload = levels[index]
        payload.timesEarned = count
        payload.ladderSteps = levels.count
        payload.ladderFilled = index + 1
        payload.ladderLabels = thresholds.map { "\($0)" }
        return payload
    }

    /// Live earn depth: `-1` all locked, `5` fully unlocked (Bronze → Ultimate).
    static var previewLevelStrips: [(title: String, mode: GameModeID, levels: [TrophyUnlockPayload], earnedThrough: Int)] {
        perfectScoreModes.map { item in
            (
                item.mode.title,
                item.mode,
                item.levels,
                PerfectScoreStore.earnedThroughIndex(for: item.mode)
            )
        }
    }

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
        .imageOnly(title: GameModeID.footballBingo.title, subtitle: "Wildcard 5 players at once", image: "megas/bingomega"),
        .imageOnly(title: GameModeID.oneMore.title, subtitle: "Get 50 correct across 5 games", image: "megas/onemoremega"),
        .imageOnly(title: GameModeID.draftMaster.title, subtitle: "Score 98% or more on a draft", image: "megas/draftmega"),
        .imageOnly(title: GameModeID.targetMan.title, subtitle: "Hit the exact number", image: "megas/targetmanmega"),
        .imageOnly(title: GameModeID.backYourself.title, subtitle: "Name every player with lives left", image: "megas/backyourselfmega"),
        .imageOnly(title: GameModeID.darts501.title, subtitle: "Check out in 3 darts", image: "megas/dartsmega"),
    ]

    static let leagueWinnerTrophies: [TrophyUnlockPayload] = [
        .leagueReached(title: "Sunday League", image: "winnertrophy/sundayleaguewinner"),
        .leagueReached(title: "Non-League", image: "winnertrophy/nonleaguewinner"),
        .leagueReached(title: "League Two", image: "winnertrophy/league2winner"),
        .leagueReached(title: "League One", image: "winnertrophy/league1winner"),
        .leagueReached(title: "Championship", image: "winnertrophy/championshipwinner"),
        .leagueReached(title: "Premier League", image: "winnertrophy/plwinner"),
        .leagueReached(title: "Champions League", image: "winnertrophy/championsleaguewinner"),
    ]

    static let previewGameTrophies: [TrophyUnlockPayload] = [
        .imageOnly(title: "Daily Leaderboard", subtitle: "Finish the day #1 for XP", image: "dailytrophy"),
        .imageOnly(title: "Daily XP", subtitle: "Bank 6,000 XP in one day", image: "6ktrophy"),
    ]

    static var megaSectionTrophies: [TrophyUnlockPayload] {
        megaTrophies + previewGameTrophies
    }

    static let leagueReachedIds = [
        "sunday_league", "non_league", "league_two", "league_one",
        "championship", "premier_league", "champions_league",
    ]
    static let leagueReachedLabels = ["SL", "NL", "L2", "L1", "CH", "PL", "CL"]
    static let leagueWonIds = [
        "sunday_league", "non_league", "league_two", "league_one",
        "championship", "premier_league", "champions_league",
    ]
    static let leagueWonLabels = ["SL", "NL", "L2", "L1", "CH", "PL", "CL"]
    static let totalXpThresholds = [50_000, 100_000, 250_000, 500_000, 1_000_000]
    static let totalXpLabels = ["50k", "100k", "250k", "500k", "1M"]

    static func earnedThrough(value: Int, thresholds: [Int]) -> Int {
        PerfectScoreStore.earnedThroughIndex(count: value, thresholds: thresholds)
    }

    static func reachedThroughIndex(_ progress: LeagueTrophyProgressDTO?) -> Int {
        let highest = progress?.highestDivision ?? progress?.divisionsReached.last
        guard let highest, let index = leagueReachedIds.firstIndex(of: highest) else { return -1 }
        return index
    }

    static func wonIndices(_ progress: LeagueTrophyProgressDTO?) -> Set<Int> {
        Set((progress?.divisionsWon ?? []).compactMap { leagueWonIds.firstIndex(of: $0) })
    }

    static let dartsPerfect = TrophyUnlockPayload.perfect(mode: .darts501, image: "trophydarts", timesEarned: 2)
    static let lmsPerfect = TrophyUnlockPayload.perfect(mode: .lastManStanding, image: "trophylms")

    static func earned(from levels: [TrophyUnlockPayload], through index: Int) -> [TrophyUnlockPayload] {
        guard index >= 0 else { return [] }
        return Array(levels.prefix(index + 1))
    }

    static func earnedPreviewGroups(xp: Int, league: LeagueTrophyProgressDTO?) -> [(title: String, trophies: [TrophyUnlockPayload])] {
        var groups: [(String, [TrophyUnlockPayload])] = []
        for strip in previewLevelStrips {
            let earned = earned(from: strip.levels, through: strip.earnedThrough)
            if !earned.isEmpty { groups.append((strip.title, earned)) }
        }
        let mega = SignatureTrophyStore.unlockedPayloads()
        if !mega.isEmpty { groups.append(("SIGNATURE TROPHIES", mega)) }
        let leagues = earned(from: leagueTrophies, through: reachedThroughIndex(league))
        if !leagues.isEmpty { groups.append(("LEAGUES REACHED", leagues)) }
        let wonSet = wonIndices(league)
        let winners = leagueWinnerTrophies.enumerated().compactMap { wonSet.contains($0.offset) ? $0.element : nil }
        if !winners.isEmpty { groups.append(("LEAGUES WON", winners)) }
        let xpTrophies = earned(from: totalXpTrophies, through: earnedThrough(value: xp, thresholds: totalXpThresholds))
        if !xpTrophies.isEmpty { groups.append(("OVERALL XP", xpTrophies)) }
        return groups
    }

    static var earnedPreviewGroups: [(title: String, trophies: [TrophyUnlockPayload])] {
        earnedPreviewGroups(xp: 0, league: LeagueTrophyStore.latest)
    }

    static var earnedPreviewTrophies: [TrophyUnlockPayload] {
        earnedPreviewGroups.flatMap(\.trophies)
    }

    static func isEarned(_ payload: TrophyUnlockPayload, xp: Int, league: LeagueTrophyProgressDTO?) -> Bool {
        earnedPreviewGroups(xp: xp, league: league).contains { group in
            group.trophies.contains { $0.id == payload.id }
        }
    }

    static func earnedTrophy(id: String) -> TrophyUnlockPayload? {
        let catalog =
            previewLevelStrips.flatMap(\.levels)
            + megaSectionTrophies
            + leagueTrophies
            + leagueWinnerTrophies
            + totalXpTrophies
        return catalog.first { $0.id == id }
    }
}

struct TrophyUnlockView: View {
    let payload: TrophyUnlockPayload
    let onDismiss: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var progress: Double = 0
    @State private var ladderFill: Int = 0
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

                    if payload.ladderSteps > 0 {
                        PerfectScoreLadderBar(
                            steps: payload.ladderSteps,
                            filled: ladderFill,
                            labels: payload.ladderLabels,
                            filledIndices: Set(payload.ladderFilledIndices)
                        )
                        .padding(.horizontal, 8)
                        .opacity(showHero ? 1 : 0)
                    } else if payload.xp > 0 {
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
        .task {
            if payload.ladderSteps > 0 {
                ladderFill = max(0, payload.ladderFilled - 1)
            }
            await runSequence()
        }
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
            if payload.ladderSteps > 0 {
                ladderFill = payload.ladderFilled
            }
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

    @Environment(AuthManager.self) private var auth
    @State private var unlock: TrophyUnlockPayload?
    @State private var leagueProgress: LeagueTrophyProgressDTO?

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 30) {
                    VStack(alignment: .leading, spacing: 10) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("PERFECT SCORES")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(BKTheme.textPrimary)
                            Text("How many times have you got 1000XP?")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(BKTheme.textSecondary)
                        }
                        .padding(.horizontal, 2)

                        ForEach(TrophyUnlockPayload.previewLevelStrips, id: \.title) { strip in
                            GameLevelsPreviewRow(
                                title: strip.title,
                                titleSize: 13,
                                levels: strip.levels,
                                earnedThroughIndex: strip.earnedThrough,
                                ladderFilled: max(0, strip.earnedThrough + 1),
                                ladderLabels: PerfectScoreStore.thresholds(for: strip.mode).map { "\($0)" }
                            ) { payload in
                                var next = payload
                                if let live = TrophyUnlockPayload.perfectScoreUnlock(
                                    mode: strip.mode,
                                    count: PerfectScoreStore.count(for: strip.mode)
                                ) {
                                    next.timesEarned = live.timesEarned
                                    next.ladderSteps = live.ladderSteps
                                    next.ladderFilled = live.ladderFilled
                                    next.ladderLabels = live.ladderLabels
                                }
                                unlock = next
                            }
                        }
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("LEAGUES")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(BKTheme.textPrimary)
                            Text("How high you've climbed, and every #1 finish.")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(BKTheme.textSecondary)
                        }
                        .padding(.horizontal, 2)

                        GameLevelsPreviewRow(
                            title: "LEAGUES REACHED",
                            titleSize: 13,
                            levels: TrophyUnlockPayload.leagueTrophies,
                            earnedThroughIndex: reachedThrough,
                            ladderFilled: max(0, reachedThrough + 1),
                            ladderLabels: TrophyUnlockPayload.leagueReachedLabels
                        ) { payload in
                            unlock = withLadder(
                                payload,
                                steps: TrophyUnlockPayload.leagueTrophies.count,
                                filled: max(0, reachedThrough + 1),
                                labels: TrophyUnlockPayload.leagueReachedLabels
                            )
                        }

                        GameLevelsPreviewRow(
                            title: "LEAGUES WON",
                            titleSize: 13,
                            levels: TrophyUnlockPayload.leagueWinnerTrophies,
                            earnedThroughIndex: -1,
                            earnedIndices: wonSet,
                            ladderFilled: wonSet.count,
                            ladderLabels: TrophyUnlockPayload.leagueWonLabels,
                            ladderFilledIndices: wonSet
                        ) { payload in
                            unlock = withLadder(
                                payload,
                                steps: TrophyUnlockPayload.leagueWinnerTrophies.count,
                                filled: wonSet.count,
                                labels: TrophyUnlockPayload.leagueWonLabels,
                                filledIndices: wonSet
                            )
                        }
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("OVERALL XP")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(BKTheme.textPrimary)
                            Text("How much XP have you banked?")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(BKTheme.textSecondary)
                        }
                        .padding(.horizontal, 2)

                        GameLevelsPreviewRow(
                            title: "",
                            levels: TrophyUnlockPayload.totalXpTrophies,
                            earnedThroughIndex: xpThrough,
                            ladderFilled: max(0, xpThrough + 1),
                            ladderLabels: TrophyUnlockPayload.totalXpLabels
                        ) { payload in
                            unlock = withLadder(
                                payload,
                                steps: TrophyUnlockPayload.totalXpTrophies.count,
                                filled: max(0, xpThrough + 1),
                                labels: TrophyUnlockPayload.totalXpLabels
                            )
                        }
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("SIGNATURE TROPHIES")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(BKTheme.textPrimary)
                            Text("Rare trophies for the biggest feats.")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(BKTheme.textSecondary)
                        }
                        .padding(.horizontal, 2)

                        VStack(spacing: 0) {
                            ForEach(Array(TrophyUnlockPayload.megaSectionTrophies.enumerated()), id: \.element.id) { index, payload in
                                TrophyCabinetRow(
                                    payload: payload,
                                    isLocked: !SignatureTrophyStore.isUnlocked(payloadId: payload.id),
                                    showsDivider: index < TrophyUnlockPayload.megaSectionTrophies.count - 1
                                ) {
                                    unlock = payload
                                }
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(BKTheme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }
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
        .task { await loadLeagueProgress() }
        .fullScreenCover(item: $unlock) { payload in
            TrophyUnlockView(payload: payload) {
                unlock = nil
            }
        }
    }

    private var reachedThrough: Int {
        TrophyUnlockPayload.reachedThroughIndex(leagueProgress)
    }

    private var wonSet: Set<Int> {
        TrophyUnlockPayload.wonIndices(leagueProgress)
    }

    private var xpThrough: Int {
        TrophyUnlockPayload.earnedThrough(
            value: auth.user?.xp ?? 0,
            thresholds: TrophyUnlockPayload.totalXpThresholds
        )
    }

    private func loadLeagueProgress() async {
        do {
            let progress = try await APIClient.shared.leagueTrophies()
            LeagueTrophyStore.latest = progress
            leagueProgress = progress
        } catch {
            leagueProgress = LeagueTrophyStore.latest
        }
    }

    private func withLadder(
        _ payload: TrophyUnlockPayload,
        steps: Int,
        filled: Int,
        labels: [String],
        filledIndices: Set<Int> = []
    ) -> TrophyUnlockPayload {
        var next = payload
        next.ladderSteps = steps
        next.ladderFilled = filled
        next.ladderLabels = labels
        next.ladderFilledIndices = Array(filledIndices).sorted()
        return next
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

struct PerfectScoreLadderBar: View {
    let steps: Int
    var filled: Int
    var labels: [String] = []
    var filledIndices: Set<Int> = []
    var columnWidth: CGFloat? = nil
    var spacing: CGFloat = 12

    private var clampedFilled: Int {
        if !filledIndices.isEmpty {
            return (filledIndices.max() ?? -1) + 1
        }
        return min(max(filled, 0), steps)
    }
    private let notchSize: CGFloat = 24

    var body: some View {
        if let columnWidth {
            track {
                HStack(spacing: spacing) {
                    ForEach(0..<steps, id: \.self) { index in
                        notch(index)
                            .frame(width: columnWidth)
                    }
                }
            }
        } else {
            track {
                HStack(spacing: 0) {
                    ForEach(0..<steps, id: \.self) { index in
                        notch(index)
                        if index < steps - 1 { Spacer(minLength: 0) }
                    }
                }
            }
        }
    }

    private func track<Content: View>(@ViewBuilder notches: () -> Content) -> some View {
        notches()
            .background {
                GeometryReader { geometry in
                    let inset = columnWidth.map { $0 / 2 } ?? (notchSize / 2)
                    let trackWidth = max(0, geometry.size.width - inset * 2)
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(BKTheme.cardElevated)
                        Capsule()
                            .fill(BKTheme.accent)
                            .frame(width: steps > 0 ? trackWidth * CGFloat(clampedFilled) / CGFloat(steps) : 0)
                    }
                    .frame(height: 6)
                    .padding(.horizontal, inset)
                    .frame(maxHeight: .infinity, alignment: .center)
                }
            }
            .frame(height: notchSize)
    }

    private func notch(_ index: Int) -> some View {
        let isFilled = filledIndices.isEmpty ? index < clampedFilled : filledIndices.contains(index)
        let label = labels.indices.contains(index) ? labels[index] : "\(index + 1)"
        return Text(label)
            .font(BKFont.caption(label.count >= 3 ? 8 : 11))
            .fontWeight(.bold)
            .foregroundStyle(isFilled ? BKTheme.background : BKTheme.textMuted)
            .minimumScaleFactor(0.7)
            .frame(width: notchSize, height: notchSize)
            .background(isFilled ? BKTheme.accent : BKTheme.cardElevated, in: Circle())
            .overlay {
                Circle()
                    .stroke(BKTheme.card, lineWidth: 3)
            }
    }
}

private struct GameLevelsPreviewRow: View {
    let title: String
    var titleSize: CGFloat = 16
    let levels: [TrophyUnlockPayload]
    /// Last earned index. `-1` means none unlocked.
    var earnedThroughIndex: Int = 1
    var earnedIndices: Set<Int>? = nil
    var ladderFilled: Int? = nil
    var ladderLabels: [String] = []
    var ladderFilledIndices: Set<Int> = []
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
            if !title.isEmpty {
                Text(title)
                    .font(.system(size: titleSize, weight: .semibold))
                    .foregroundStyle(titleSize < 16 ? BKTheme.textSecondary : BKTheme.textPrimary)
                    .padding(.horizontal, 14)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 10) {
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
                                        .minimumScaleFactor(0.7)
                                }
                                .frame(width: badgeSize)
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    if let ladderFilled {
                        PerfectScoreLadderBar(
                            steps: levels.count,
                            filled: ladderFilled,
                            labels: ladderLabels,
                            filledIndices: ladderFilledIndices,
                            columnWidth: badgeSize,
                            spacing: badgeSpacing
                        )
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
        if let earnedIndices {
            if earnedIndices.contains(index) { return .earned }
            if let next = levels.indices.first(where: { !earnedIndices.contains($0) }), index == next {
                return .next
            }
            return .locked
        }
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

    @Environment(AuthManager.self) private var auth

    private var unlockedCount: Int {
        TrophyUnlockPayload.earnedPreviewGroups(
            xp: auth.user?.xp ?? 0,
            league: LeagueTrophyStore.latest
        ).reduce(0) { $0 + $1.trophies.count }
    }

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 14) {
                GameModeBundleImage(name: "trophycabinet")
                    .scaledToFill()
                    .frame(width: 70, height: 70)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                VStack(alignment: .leading, spacing: 3) {
                    Text("Trophy Cabinet")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(BKTheme.textPrimary)
                    Text(unlockedCount == 1 ? "1 unlocked" : "\(unlockedCount) unlocked")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(BKTheme.textSecondary)
                }

                Spacer(minLength: 8)

                Ph.caretRight.bold
                    .color(BKTheme.textPrimary.opacity(0.7))
                    .frame(width: 14, height: 14)
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
        Button {
            guard !isLocked else { return }
            onTap()
        } label: {
            VStack(spacing: 0) {
                HStack(spacing: 14) {
                    thumbnail

                    VStack(alignment: .leading, spacing: 3) {
                        Text(rowTitle)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(isLocked ? BKTheme.textSecondary : BKTheme.textPrimary)
                            .lineLimit(1)
                        Text(rowSubtitle)
                            .font(BKFont.caption(12))
                            .foregroundStyle(BKTheme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer(minLength: 8)

                    if payload.timesEarned > 1 {
                        Text("×\(payload.timesEarned)")
                            .font(BKFont.title(22))
                            .foregroundStyle(BKTheme.accent)
                    }

                    if !isLocked, payload.playsUnlock {
                        Ph.caretRight.bold
                            .color(BKTheme.textMuted)
                            .frame(width: 12, height: 12)
                    }
                }
                .padding(.vertical, 14)

                if showsDivider {
                    Rectangle()
                        .fill(BKTheme.cardElevated)
                        .frame(height: 1)
                        .padding(.leading, 90)
                }
            }
        }
        .buttonStyle(.plain)
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
        ZStack(alignment: .bottomTrailing) {
            switch payload.hero {
            case .gameTile(let modeId):
                TrophyArtTile(
                    imageName: GameModeTileArt.bundleImageName(for: modeId),
                    size: iconSize,
                    fills: false,
                    showsBackdrop: false
                )
                .opacity(isLocked ? GameLevelReveal.next.opacity : 1)
            case .bundleImage(let name):
                TrophyArtTile(
                    imageName: name,
                    size: iconSize,
                    fills: false,
                    showsBackdrop: false
                )
                .opacity(isLocked ? GameLevelReveal.next.opacity : 1)
            case .symbol:
                ZStack {
                    RoundedRectangle(cornerRadius: iconCornerRadius, style: .continuous)
                        .fill(BKTheme.cardElevated)
                    Ph.lightning.fill
                        .color(isLocked ? BKTheme.textMuted : BKTheme.accent)
                        .frame(width: 22, height: 22)
                }
                .frame(width: iconSize, height: iconSize)
                .opacity(isLocked ? GameLevelReveal.next.opacity : 1)
            }

            if isLocked {
                Image(systemName: "lock.fill")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(BKTheme.textPrimary)
                    .frame(width: 20, height: 20)
                    .background(BKTheme.cardElevated)
                    .clipShape(Circle())
                    .offset(x: 2, y: 2)
            }
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
    var size: CGFloat = 52

    var body: some View {
        TrophyArtTile(imageName: imageName, size: size, fills: false, showsBackdrop: false)
            .frame(width: size, height: size)
            .shadow(color: .black.opacity(0.28), radius: 5, y: 2)
    }
}

struct FeaturedTrophyPicker: View {
    var selectedId: String?
    var onSelect: (TrophyUnlockPayload?) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(AuthManager.self) private var auth

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

                    ForEach(TrophyUnlockPayload.earnedPreviewGroups(xp: auth.user?.xp ?? 0, league: LeagueTrophyStore.latest), id: \.title) { group in
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
