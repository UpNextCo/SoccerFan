import SwiftUI
import SwiftData
import UIKit

@MainActor
@Observable
final class HomeViewModel {
    var dailyBundle: DailyBundleDTO?
    var gameModes: [GameModeMetaDTO] = []
    var isLoading = false
    var errorMessage: String?

    func load(context: ModelContext) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            dailyBundle = try await APIClient.shared.dailyToday()
            if let bundle = dailyBundle {
                try OfflineCache.saveDailyBundle(bundle, context: context)
            }
            let apiModes = try await APIClient.shared.gameModes()
            gameModes = GameModeCatalog.resolve(from: apiModes)
        } catch {
            let today = ISO8601DateFormatter().string(from: Date()).prefix(10)
            if let cached = try? OfflineCache.loadDailyBundle(date: String(today), context: context) {
                dailyBundle = cached
            }
            if gameModes.isEmpty {
                gameModes = GameModeCatalog.resolve(from: nil)
            }
            errorMessage = error.localizedDescription
        }

        await OfflineCache.syncPendingCompletions(context: context)
    }
}

struct HomeView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel = HomeViewModel()
    @State private var presentedMode: GameModeID?
    @State private var showAlreadyPlayedAlert = false
    @State private var alreadyPlayedTitle = ""
    @State private var inProgressModes: Set<String> = []
    @Binding var selectedTab: AppTab

    private var allowsUnlimitedDailyPlay: Bool { auth.allowsUnlimitedDailyPlay }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 20) {
                HomeHeaderView(
                    user: auth.user,
                    streak: auth.user?.streak ?? 0
                )

                if viewModel.dailyBundle != nil || !viewModel.gameModes.isEmpty {
                    DailySection(
                        modes: viewModel.gameModes,
                        bundle: viewModel.dailyBundle,
                        allowUnlimitedPlay: allowsUnlimitedDailyPlay,
                        todayXp: auth.user?.todayXp ?? 0,
                        inProgressModes: inProgressModes,
                        onSelect: { mode in
                            guard let bundle = viewModel.dailyBundle else { return }
                            openMode(mode, bundle: bundle)
                        }
                    )
                } else if viewModel.isLoading {
                    ProgressView()
                        .tint(BKTheme.accent)
                        .frame(height: 200)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, BKTabBar.scrollClearance)
        }
        .background { HomeAmbientBackground() }
        .refreshable {
            await viewModel.load(context: modelContext)
            await auth.refreshProfile()
        }
        .task {
            await viewModel.load(context: modelContext)
            refreshInProgress()
        }
        .onReceive(NotificationCenter.default.publisher(for: .dailyCompletionRecorded)) { _ in
            // The completion POST has landed on the server — refresh XP (top bar + card) and the
            // games-completed count now that the write is durable, avoiding the dismiss-time race.
            Task {
                await auth.refreshProfile()
                await viewModel.load(context: modelContext)
                refreshInProgress()
            }
        }
        .fullScreenCover(item: $presentedMode, onDismiss: {
            // Fires however the game closes — including tapping X mid-game — so an "In Progress"
            // tile shows up immediately (not only after a force-close + relaunch).
            refreshInProgress()
        }) { mode in
            DailyGameHost(
                mode: mode,
                dailyBundle: viewModel.dailyBundle,
                allowReplay: allowsUnlimitedDailyPlay,
                onFinished: { handleModeFinished(mode) }
            )
        }
        .alert("Already played today", isPresented: $showAlreadyPlayedAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("You've finished \(alreadyPlayedTitle) for today. Come back tomorrow for a new daily.")
        }
    }

    private func openMode(_ mode: GameModeMetaDTO, bundle: DailyBundleDTO) {
        guard mode.isAvailable else { return }
        guard let modeId = GameModeID(rawValue: GameModeCatalog.normalizedModeId(mode.id)) else { return }
        guard DailyPlayOrder.playableModes.contains(modeId) else { return }

        if !allowsUnlimitedDailyPlay, bundle.isCompleted(modeId) {
            alreadyPlayedTitle = mode.title
            showAlreadyPlayedAlert = true
            return
        }

        presentedMode = modeId
    }

    private func handleModeFinished(_ mode: GameModeID) {
        presentedMode = nil
        refreshInProgress()
        Task {
            await auth.refreshProfile()
            await viewModel.load(context: modelContext)
            refreshInProgress()
        }
    }

    /// Recompute which games have saved mid-game progress for today, and drop stale (past-day) snapshots.
    private func refreshInProgress() {
        guard let date = viewModel.dailyBundle?.date else {
            inProgressModes = []
            return
        }
        GameProgressStore.clearStale(keepingDate: date, context: modelContext)
        inProgressModes = GameProgressStore.inProgressModes(date: date, context: modelContext)
    }
}

struct HomeHeaderView: View {
    let user: UserProfileDTO?
    let streak: Int
    @State private var avatarImage: UIImage?
    @State private var showNotifications = false

    private var activityEvents: [ActivityEvent] {
        HomeActivity.events(user: user, streak: streak)
    }

    private var hasUnread: Bool {
        activityEvents.contains { $0.unread }
    }

    var body: some View {
        HStack(spacing: 12) {
            avatarCircle

            VStack(alignment: .leading, spacing: 4) {
                Text(headerName)
                    .font(BKFont.headline(15))
                    .foregroundStyle(BKTheme.textPrimary)
                HStack(spacing: 8) {
                    HStack(spacing: 4) {
                        Ph.lightning.fill
                            .color(BKTheme.accent)
                            .frame(width: 12, height: 12)
                        Text("\(user?.xp ?? 0)")
                            .font(BKFont.caption())
                            .foregroundStyle(BKTheme.textPrimary)
                        Text("XP")
                            .font(BKFont.caption())
                            .foregroundStyle(BKTheme.textSecondary)
                    }
                    HStack(spacing: 4) {
                        Ph.fire.fill
                            .color(BKTheme.streak)
                            .frame(width: 12, height: 12)
                        Text("\(streak)")
                            .font(BKFont.caption())
                            .foregroundStyle(BKTheme.textPrimary)
                        Text(streak == 1 ? "DAY" : "DAYS")
                            .font(BKFont.caption())
                            .foregroundStyle(BKTheme.textSecondary)
                    }
                }
            }

            Spacer()

            Button { showNotifications = true } label: {
                Ph.bell.fill
                    .color(BKTheme.textSecondary)
                    .frame(width: 18, height: 18)
                    .frame(width: 40, height: 40)
                    .background(BKTheme.card)
                    .clipShape(Circle())
                    .overlay(alignment: .topTrailing) {
                        if hasUnread {
                            Circle()
                                .fill(BKTheme.accent)
                                .frame(width: 8, height: 8)
                                .offset(x: -2, y: 2)
                        }
                    }
            }
            .buttonStyle(.plain)
        }
        .padding(.top, 8)
        .onAppear { avatarImage = LocalProfile.loadAvatar() }
        .sheet(isPresented: $showNotifications) {
            NotificationsView(events: activityEvents)
        }
    }

    private var headerName: String {
        LocalProfile.nameOverride ?? user?.displayName ?? "Player"
    }

    private var avatarCircle: some View {
        Group {
            if let avatarImage {
                Image(uiImage: avatarImage)
                    .resizable()
                    .scaledToFill()
            } else {
                BKTheme.cardElevated
                    .overlay {
                        Ph.userCircle.fill
                            .color(BKTheme.accent)
                            .frame(width: 26, height: 26)
                    }
            }
        }
        .frame(width: 44, height: 44)
        .clipShape(Circle())
    }
}

struct ActivityEvent: Identifiable {
    let id = UUID()
    let icon: String
    let tint: Color
    let title: String
    let message: String
    let unread: Bool
}

/// Builds the in-app activity feed from current profile state (client-derived for now —
/// swap to a server activity endpoint later without changing NotificationsView).
enum HomeActivity {
    static func events(user: UserProfileDTO?, streak: Int) -> [ActivityEvent] {
        var events: [ActivityEvent] = []
        let todayXp = user?.todayXp ?? 0
        let level = user?.level ?? 1
        let xp = user?.xp ?? 0

        if todayXp == 0 {
            events.append(ActivityEvent(
                icon: "flame.fill",
                tint: BKTheme.streak,
                title: streak > 0 ? "Keep your \(streak)-day streak alive" : "Start your streak today",
                message: "Play today's games before the daily resets to \(streak > 0 ? "extend" : "begin") your streak.",
                unread: true
            ))
        } else {
            events.append(ActivityEvent(
                icon: "checkmark.circle.fill",
                tint: BKTheme.accent,
                title: "You've played today",
                message: "Nice — \(todayXp) XP banked so far today.",
                unread: false
            ))
        }

        if streak >= 3 {
            events.append(ActivityEvent(
                icon: "flame.fill",
                tint: BKTheme.streak,
                title: "\(streak)-day streak",
                message: "You're on a roll — don't break the chain.",
                unread: false
            ))
        }

        events.append(ActivityEvent(
            icon: "star.fill",
            tint: BKTheme.accent,
            title: "Level \(level)",
            message: "\(xp) total XP earned. Keep climbing.",
            unread: false
        ))

        events.append(ActivityEvent(
            icon: "chart.bar.fill",
            tint: .yellow,
            title: "Leagues are coming",
            message: "Weekly Bronze, Silver and Gold leagues launch soon.",
            unread: false
        ))

        return events
    }
}

struct NotificationsView: View {
    let events: [ActivityEvent]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 10) {
                    ForEach(events) { event in
                        HStack(spacing: 14) {
                            Image(systemName: event.icon)
                                .font(.system(size: 16, weight: .bold))
                                .foregroundStyle(event.tint)
                                .frame(width: 40, height: 40)
                                .background(BKTheme.cardElevated)
                                .clipShape(Circle())

                            VStack(alignment: .leading, spacing: 3) {
                                Text(event.title)
                                    .font(BKFont.headline(15))
                                    .foregroundStyle(BKTheme.textPrimary)
                                Text(event.message)
                                    .font(BKFont.body(13))
                                    .foregroundStyle(BKTheme.textSecondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }

                            Spacer(minLength: 0)

                            if event.unread {
                                Circle().fill(BKTheme.accent).frame(width: 8, height: 8)
                            }
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(BKTheme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                    }
                }
                .padding(16)
            }
            .background(BKTheme.background)
            .navigationTitle("Activity")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(BKTheme.accent)
                }
            }
        }
    }
}

struct DailySection: View {
    let modes: [GameModeMetaDTO]
    let bundle: DailyBundleDTO?
    var allowUnlimitedPlay = false
    let todayXp: Int
    var inProgressModes: Set<String> = []
    var onSelect: (GameModeMetaDTO) -> Void

    private var orderedModes: [GameModeMetaDTO] {
        DailyPlayOrder.playableModes.compactMap { id in
            modes.first { GameModeCatalog.normalizedModeId($0.id) == id.rawValue }
        }
    }

    private var totalCount: Int { DailyPlayOrder.playableModes.count }

    private var completedCount: Int {
        guard let bundle, !allowUnlimitedPlay else { return 0 }
        return DailyPlayOrder.completedCount(in: bundle)
    }

    private var allComplete: Bool {
        guard let bundle, !allowUnlimitedPlay else { return false }
        return DailyPlayOrder.allComplete(in: bundle)
    }

    var body: some View {
        VStack(spacing: 0) {
            hub
                .padding(.bottom, 20)

            VStack(spacing: 0) {
                ForEach(Array(orderedModes.enumerated()), id: \.element.id) { index, mode in
                    DailyGameCard(
                        mode: mode,
                        state: state(for: mode),
                        showsDivider: index < orderedModes.count - 1,
                        onTap: { onSelect(mode) }
                    )
                }
            }
        }
    }

    private var hub: some View {
        VStack(spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("TODAY'S DAILY")
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.accent)
                    Text(dateline)
                        .font(BKFont.title(20))
                        .foregroundStyle(BKTheme.textPrimary)
                }
                Spacer()
                TimelineView(.periodic(from: .now, by: 60)) { context in
                    Text((allComplete ? "New in " : "Resets in ") + DailyTime.untilReset(from: context.date))
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.textMuted)
                }
            }

            VStack(spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\(completedCount)")
                        .font(.system(size: 40, weight: .black, design: .rounded))
                        .foregroundStyle(completedCount > 0 ? BKTheme.accent : BKTheme.textPrimary)
                        .contentTransition(.numericText())
                        .animation(.spring(response: 0.45, dampingFraction: 0.7), value: completedCount)
                    Text("/ \(totalCount) games completed")
                        .font(BKFont.body(14))
                        .foregroundStyle(BKTheme.textSecondary)
                    Spacer()
                    HStack(spacing: 6) {
                        Ph.lightning.fill
                            .color(BKTheme.accent)
                            .frame(width: 16, height: 16)
                        Text("\(todayXp)")
                            .font(BKFont.headline(17))
                            .foregroundStyle(BKTheme.textPrimary)
                        Text("XP TODAY")
                            .font(BKFont.caption(10))
                            .foregroundStyle(BKTheme.textMuted)
                    }
                }
                progressBar
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { hubBackground }
    }

    private var hubBackground: some View {
        ZStack {
            Color(hex: "141414")

            hubHeroImage

            hubTextScrim

            BKGlass.roundedRect(cornerRadius: 20)
        }
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var hubHeroImage: some View {
        GeometryReader { geo in
            GameModeBundleImage(name: "hero")
                .scaledToFill()
                .frame(width: geo.size.width * 1.45, height: geo.size.height * 1.35)
                .position(x: geo.size.width * 0.76, y: geo.size.height * 0.34)
                .frame(width: geo.size.width, height: geo.size.height)
                .mask {
                    LinearGradient(
                        stops: [
                            .init(color: .clear, location: 0),
                            .init(color: .clear, location: 0.3),
                            .init(color: .white.opacity(0.25), location: 0.42),
                            .init(color: .white.opacity(0.65), location: 0.55),
                            .init(color: .white, location: 0.7),
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                }
        }
    }

    private var hubTextScrim: some View {
        GeometryReader { geo in
            ZStack {
                LinearGradient(
                    stops: [
                        .init(color: Color(hex: "141414").opacity(0.55), location: 0),
                        .init(color: Color(hex: "141414").opacity(0.18), location: 0.38),
                        .init(color: .clear, location: 0.62),
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )

                VStack(spacing: 0) {
                    Spacer(minLength: 0)
                    LinearGradient(
                        colors: [.clear, Color(hex: "141414").opacity(0.3)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: geo.size.height * 0.35)
                }
            }
        }
    }

    private var progressBar: some View {
        HStack(spacing: 5) {
            ForEach(0..<totalCount, id: \.self) { i in
                Capsule()
                    .fill(i < completedCount
                          ? AnyShapeStyle(LinearGradient(colors: [BKTheme.accent, BKTheme.accentMuted],
                                                         startPoint: .leading, endPoint: .trailing))
                          : AnyShapeStyle(Color.white.opacity(0.22)))
                    .frame(height: 6)
                    .shadow(color: i < completedCount ? BKTheme.accent.opacity(0.55) : .clear,
                            radius: 4)
            }
        }
        .animation(.spring(response: 0.45, dampingFraction: 0.7), value: completedCount)
    }

    private var dateline: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE d MMM"
        // Show the daily's actual (UTC) date from the bundle — around UTC midnight the device's
        // local date can differ from the puzzle day the player is completing.
        if let bundleDate = bundle?.date {
            let parser = DateFormatter()
            parser.dateFormat = "yyyy-MM-dd"
            parser.timeZone = TimeZone(identifier: "UTC")
            formatter.timeZone = TimeZone(identifier: "UTC")
            if let d = parser.date(from: bundleDate) {
                return formatter.string(from: d)
            }
        }
        return formatter.string(from: Date())
    }

    private func state(for mode: GameModeMetaDTO) -> DailyTileState {
        let normalized = GameModeCatalog.normalizedModeId(mode.id)
        let modeId = GameModeID(rawValue: normalized)
        if let bundle, !allowUnlimitedPlay, let modeId, bundle.isCompleted(modeId) {
            return .completed
        }
        if inProgressModes.contains(normalized) {
            return .inProgress
        }
        return .available
    }
}

struct DailyGameCard: View {
    let mode: GameModeMetaDTO
    let state: DailyTileState
    var showsDivider = true
    var onTap: () -> Void

    private let iconSize: CGFloat = 64
    private let iconCornerRadius: CGFloat = 14

    private var normalizedModeId: String {
        GameModeCatalog.normalizedModeId(mode.id)
    }

    private var tileArtImageName: String? {
        GameModeTileArt.bundleImageName(for: normalizedModeId)
    }

    private var displayTitle: String {
        Self.displayTitle(for: mode)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 12) {
                thumbnail

                VStack(alignment: .leading, spacing: 2) {
                    Text(displayTitle)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(BKTheme.textPrimary)
                        .lineLimit(1)

                    Text(Self.blurb(for: mode))
                        .font(.system(size: 13))
                        .foregroundStyle(BKTheme.textSecondary)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                playAction
            }
            .padding(.vertical, 10)
            .opacity(state == .completed ? 0.65 : 1)

            if showsDivider {
                Divider()
                    .overlay(Color.white.opacity(0.02))
                    .padding(.leading, iconSize + 12)
            }
        }
    }

    private var thumbnail: some View {
        ZStack {
            BKTheme.tileIconBackdrop
            if let tileArtImageName {
                GameModeBundleImage(name: tileArtImageName)
                    .scaledToFill()
                    .frame(width: iconSize, height: iconSize, alignment: .top)
                    .brightness(BKTheme.tileIconBrightness)
            }
        }
        .frame(width: iconSize, height: iconSize)
        .clipShape(RoundedRectangle(cornerRadius: iconCornerRadius, style: .continuous))
        .saturation(state == .completed ? 0.45 : 1)
    }

    private var playAction: some View {
        VStack(spacing: 3) {
            Button(action: onTap) {
                Text(playLabel)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(playForeground)
                    .frame(minWidth: 58)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(BKTheme.cardElevated)
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)

            if let sublabel = playSublabel {
                Text(sublabel)
                    .font(.system(size: 10))
                    .foregroundStyle(BKTheme.textMuted)
            }
        }
    }

    private var playLabel: String {
        switch state {
        case .completed: return "Done"
        case .inProgress: return "Resume"
        case .available: return "Play"
        }
    }

    private var playForeground: Color {
        switch state {
        case .completed: return BKTheme.textMuted
        case .inProgress, .available: return BKTheme.accent
        }
    }

    private var playSublabel: String? {
        switch state {
        case .inProgress: return "In Progress"
        case .completed, .available: return nil
        }
    }

    static func displayTitle(for mode: GameModeMetaDTO) -> String {
        guard let id = GameModeID(rawValue: GameModeCatalog.normalizedModeId(mode.id)) else {
            return mode.title.localizedCapitalized
        }
        switch id {
        case .footballBingo: return "Football Bingo"
        case .oneMore: return "One More"
        case .draftMaster: return "Draft XI"
        case .footballGolf: return "Football Golf"
        case .clubChain: return "Club Chain"
        case .guessWho: return "Guess Who?"
        case .targetMan: return "Target Man"
        case .worldCupXI: return "World Cup XI"
        case .blindRank: return "Blind Rank"
        case .footballTower: return "Football Tower"
        }
    }

    static func blurb(for mode: GameModeMetaDTO) -> String {
        guard let id = GameModeID(rawValue: GameModeCatalog.normalizedModeId(mode.id)) else {
            return mode.subtitle
        }
        switch id {
        case .guessWho:
            return "Guess the mystery player"
        case .targetMan:
            return "Hit the stat target"
        case .blindRank:
            return "Rank before stats drop"
        case .footballBingo:
            return "Complete the grid"
        case .oneMore:
            return "Streak or cash out"
        case .draftMaster:
            return "Draft the best squad"
        case .worldCupXI:
            return "Build the World Cup XI"
        case .footballGolf:
            return "Rarer answers win"
        case .clubChain:
            return "Find the missing links"
        case .footballTower:
            return "Climb the tower"
        }
    }
}

enum DailyTime {
    /// Time until the next daily reset. The server rolls puzzles + streaks at **UTC midnight**
    /// (`todayUTC()` in dailyService.ts), so the countdown must use a UTC calendar — a local-time
    /// countdown would promise players hours they don't actually have.
    static func untilReset(from date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        let startOfToday = calendar.startOfDay(for: date)
        guard let midnight = calendar.date(byAdding: .day, value: 1, to: startOfToday) else {
            return "tomorrow"
        }

        let seconds = max(0, midnight.timeIntervalSince(date))
        let totalMinutes = Int(seconds / 60)
        let hours = totalMinutes / 60
        let minutes = totalMinutes % 60

        if hours >= 1 {
            return hours == 1 ? "1 hour" : "\(hours) hours"
        }
        if minutes <= 1 { return "1 minute" }
        return "\(minutes) minutes"
    }
}

enum DailyTileState {
    case completed
    case inProgress
    case available
}

struct DailyGameHost: View {
    let mode: GameModeID
    let dailyBundle: DailyBundleDTO?
    let allowReplay: Bool
    let onFinished: () -> Void

    // Every game is server-puzzle-only: if today's puzzle isn't in the bundle we show the
    // "unavailable" placeholder rather than silently swapping in a local practice puzzle that
    // wouldn't match what everyone else is playing.
    var body: some View {
        Group {
            switch mode {
            case .guessWho:
                if let bundle = dailyBundle, let puzzle = bundle.guessWhoPuzzle {
                    GuessWhoView(
                        puzzle: puzzle,
                        date: bundle.date,
                        allowReplay: allowReplay,
                        onComplete: onFinished
                    )
                } else {
                    DailyUnavailablePlaceholder(modeTitle: mode.title, onClose: onFinished)
                }
            case .targetMan:
                if let challenge = DailyChallengeResolver.targetManChallenge(from: dailyBundle) {
                    TargetManView(challenge: challenge, allowReplay: allowReplay, onComplete: onFinished)
                } else {
                    DailyUnavailablePlaceholder(modeTitle: mode.title, onClose: onFinished)
                }
            case .blindRank:
                if let challenge = DailyChallengeResolver.blindRankChallenge(from: dailyBundle) {
                    BlindRankView(challenge: challenge, allowReplay: allowReplay, onComplete: onFinished)
                } else {
                    DailyUnavailablePlaceholder(modeTitle: mode.title, onClose: onFinished)
                }
            case .footballBingo:
                if let bundle = dailyBundle, let puzzle = bundle.footballBingoPuzzle {
                    FootballBingoView(
                        dailyDate: bundle.date,
                        serverPuzzle: puzzle,
                        allowReplay: allowReplay,
                        onComplete: onFinished
                    )
                } else {
                    DailyUnavailablePlaceholder(modeTitle: mode.title, onClose: onFinished)
                }
            case .oneMore:
                if let bundle = dailyBundle, let puzzle = bundle.oneMorePuzzle,
                   let prompt = OneMoreSeed.makeServerPrompt(from: puzzle) {
                    OneMoreView(
                        dailyDate: bundle.date,
                        prompt: prompt,
                        allowReplay: allowReplay,
                        onComplete: onFinished
                    )
                } else {
                    DailyUnavailablePlaceholder(modeTitle: mode.title, onClose: onFinished)
                }
            case .draftMaster:
                if let bundle = dailyBundle, let challenge = DailyChallengeResolver.battleChallenge(from: bundle) {
                    DraftMasterView(dailyDate: bundle.date, challenge: challenge, allowReplay: allowReplay, onComplete: onFinished)
                } else {
                    DailyUnavailablePlaceholder(modeTitle: mode.title, onClose: onFinished)
                }
            case .footballGolf:
                FootballGolfView(
                    dailyDate: dailyBundle?.date,
                    serverPuzzle: dailyBundle?.footballGolfPuzzle,
                    allowReplay: allowReplay,
                    onComplete: onFinished
                )
            case .footballTower:
                FootballTowerView(
                    dailyOnly: true,
                    serverPuzzle: dailyBundle?.footballTowerPuzzle,
                    allowReplay: allowReplay,
                    onComplete: onFinished
                )
            case .worldCupXI:
                if let bundle = dailyBundle, let puzzle = DailyChallengeResolver.worldCupXIPuzzle(from: bundle) {
                    WorldCupXIView(dailyDate: bundle.date, puzzle: puzzle, allowReplay: allowReplay, onComplete: onFinished)
                } else {
                    DailyUnavailablePlaceholder(modeTitle: mode.title, onClose: onFinished)
                }
            case .clubChain:
                if let bundle = dailyBundle, let puzzle = DailyChallengeResolver.clubChainPuzzle(from: bundle) {
                    ClubChainView(dailyDate: bundle.date, puzzle: puzzle, allowReplay: allowReplay, onComplete: onFinished)
                } else {
                    DailyUnavailablePlaceholder(modeTitle: mode.title, onClose: onFinished)
                }
            }
        }
    }
}

private struct DailyUnavailablePlaceholder: View {
    let modeTitle: String
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text(modeTitle)
                .font(BKFont.headline())
                .foregroundStyle(BKTheme.textPrimary)
            Text("Today's daily isn't available yet.")
                .font(BKFont.body())
                .foregroundStyle(BKTheme.textSecondary)
            Button("Close", action: onClose)
                .font(BKFont.headline())
                .foregroundStyle(BKTheme.background)
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
                .background(BKTheme.accent)
                .clipShape(Capsule())
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BKTheme.background)
    }
}
