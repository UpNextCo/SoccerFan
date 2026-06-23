import SwiftUI
import SwiftData

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
    @Binding var selectedTab: AppTab

    private var allowsUnlimitedDailyPlay: Bool { auth.allowsUnlimitedDailyPlay }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 20) {
                HomeHeaderView(
                    user: auth.user,
                    streak: auth.user?.streak ?? 0,
                    onLeagues: { selectedTab = .leagues }
                )

                if viewModel.dailyBundle != nil || !viewModel.gameModes.isEmpty {
                    DailySection(
                        modes: viewModel.gameModes,
                        bundle: viewModel.dailyBundle,
                        allowUnlimitedPlay: allowsUnlimitedDailyPlay,
                        todayXp: auth.user?.todayXp ?? 0,
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
            .padding(.bottom, 24)
        }
        .background(BKTheme.background)
        .refreshable {
            await viewModel.load(context: modelContext)
            await auth.refreshProfile()
        }
        .task {
            await viewModel.load(context: modelContext)
        }
        .fullScreenCover(item: $presentedMode) { mode in
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
        Task {
            await auth.refreshProfile()
            await viewModel.load(context: modelContext)
        }
    }
}

struct HomeHeaderView: View {
    let user: UserProfileDTO?
    let streak: Int
    var onLeagues: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(BKTheme.cardElevated)
                .frame(width: 44, height: 44)
                .overlay {
                    Text(initials)
                        .font(BKFont.headline(14))
                        .foregroundStyle(BKTheme.accent)
                }

            VStack(alignment: .leading, spacing: 4) {
                Text("BALL KNOWLEDGE")
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.accent)
                HStack(spacing: 8) {
                    HStack(spacing: 4) {
                        Ph.lightning.fill
                            .color(BKTheme.textPrimary)
                            .frame(width: 12, height: 12)
                        Text("\(user?.xp ?? 0)")
                            .font(BKFont.caption())
                            .foregroundStyle(BKTheme.textPrimary)
                    }
                    HStack(spacing: 4) {
                        Ph.fire.fill
                            .color(BKTheme.streak)
                            .frame(width: 12, height: 12)
                        Text("\(streak) \(streak == 1 ? "DAY" : "DAYS")")
                            .font(BKFont.caption())
                            .foregroundStyle(BKTheme.textPrimary)
                    }
                }
            }

            Spacer()

            Button(action: onLeagues) {
                Ph.trophy.fill
                    .color(.yellow)
                    .frame(width: 20, height: 20)
                    .frame(width: 40, height: 40)
                    .background(BKTheme.card)
                    .clipShape(Circle())
            }

            Ph.bell.fill
                .color(BKTheme.textSecondary)
                .frame(width: 18, height: 18)
                .frame(width: 40, height: 40)
                .background(BKTheme.card)
                .clipShape(Circle())
                .overlay(alignment: .topTrailing) {
                    Circle()
                        .fill(BKTheme.accent)
                        .frame(width: 8, height: 8)
                        .offset(x: -2, y: 2)
                }
        }
        .padding(.top, 8)
    }

    private var initials: String {
        let parts = (user?.displayName ?? "BK").split(separator: " ")
        return parts.prefix(2).compactMap { $0.first.map(String.init) }.joined().uppercased()
    }
}

struct DailySection: View {
    let modes: [GameModeMetaDTO]
    let bundle: DailyBundleDTO?
    var allowUnlimitedPlay = false
    let todayXp: Int
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
        VStack(spacing: 12) {
            hub
            VStack(spacing: 10) {
                ForEach(orderedModes) { mode in
                    DailyGameCard(
                        mode: mode,
                        state: state(for: mode),
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
                    Text((allComplete ? "New in " : "Resets in ") + DailyTime.untilMidnight(from: context.date))
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.textMuted)
                }
            }

            VStack(spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\(completedCount)")
                        .font(.system(size: 40, weight: .black, design: .rounded))
                        .foregroundStyle(BKTheme.textPrimary)
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
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private var progressBar: some View {
        HStack(spacing: 5) {
            ForEach(0..<totalCount, id: \.self) { i in
                Capsule()
                    .fill(i < completedCount ? BKTheme.accent : BKTheme.cardElevated)
                    .frame(height: 6)
            }
        }
    }

    private var dateline: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE d MMM"
        return formatter.string(from: Date())
    }

    private func state(for mode: GameModeMetaDTO) -> DailyTileState {
        let modeId = GameModeID(rawValue: GameModeCatalog.normalizedModeId(mode.id))
        if let bundle, !allowUnlimitedPlay, let modeId, bundle.isCompleted(modeId) {
            return .completed
        }
        return .available
    }
}

struct DailyGameCard: View {
    let mode: GameModeMetaDTO
    let state: DailyTileState
    var onTap: () -> Void

    private let cornerRadius: CGFloat = 18
    private let height: CGFloat = 128

    private var tileArtImageName: String? {
        GameModeTileArt.bundleImageName(for: GameModeCatalog.normalizedModeId(mode.id))
    }

    var body: some View {
        Button(action: onTap) {
            ZStack(alignment: .bottomLeading) {
                artLayer
                gradientLayer

                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(mode.title)
                            .font(.system(size: 19, weight: .black, design: .rounded))
                            .foregroundStyle(.white)
                            .shadow(color: .black.opacity(0.5), radius: 3, y: 1)
                        Text(DailyGameCard.blurb(for: mode))
                            .font(BKFont.body(12))
                            .foregroundStyle(.white.opacity(0.85))
                            .shadow(color: .black.opacity(0.5), radius: 2, y: 1)
                    }
                    Spacer(minLength: 8)
                    trailingBadge
                }
                .padding(14)
            }
            .frame(height: height)
            .frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .stroke(Color.white.opacity(0.06), lineWidth: 1)
            )
            .saturation(state == .completed ? 0.25 : 1)
        }
        .buttonStyle(TilePressStyle())
    }

    private let artVerticalShift: CGFloat = 40

    private var artLayer: some View {
        GeometryReader { geo in
            ZStack {
                BKTheme.cardElevated
                if let tileArtImageName {
                    GameModeBundleImage(name: tileArtImageName)
                        .scaledToFill()
                        .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
                        .offset(y: -artVerticalShift)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
            .clipped()
        }
        .allowsHitTesting(false)
    }

    private var gradientLayer: some View {
        LinearGradient(
            colors: [
                .black.opacity(state == .completed ? 0.5 : 0.05),
                .black.opacity(state == .completed ? 0.65 : 0.4),
                .black.opacity(0.82),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private var trailingBadge: some View {
        switch state {
        case .completed:
            HStack(spacing: 5) {
                Ph.checkCircle.fill.color(BKTheme.accent).frame(width: 16, height: 16)
                Text("DONE").font(BKFont.caption(10)).foregroundStyle(.white)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(.black.opacity(0.45))
            .clipShape(Capsule())
        case .available:
            Ph.play.fill
                .color(.white)
                .frame(width: 13, height: 13)
                .padding(10)
                .background(.black.opacity(0.4))
                .clipShape(Circle())
        }
    }

    static func blurb(for mode: GameModeMetaDTO) -> String {
        guard let id = GameModeID(rawValue: GameModeCatalog.normalizedModeId(mode.id)) else {
            return mode.subtitle
        }
        switch id {
        case .guessWho: return "Crack the mystery player"
        case .targetMan: return "Hit the stat target"
        case .blindRank: return "Rank them blind"
        case .footballBingo: return "Fill the grid"
        case .oneMore: return "Name one more"
        case .draftMaster: return "Draft the best XI"
        case .worldCupXI: return "Build the World Cup XI"
        case .footballGolf: return "Fewest guesses wins"
        case .footballTower: return "Climb the tower"
        }
    }
}

enum DailyTime {
    static func untilMidnight(from date: Date, calendar: Calendar = .current) -> String {
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
    case available
}

private struct TilePressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.spring(response: 0.28, dampingFraction: 0.62), value: configuration.isPressed)
    }
}

struct DailyGameHost: View {
    let mode: GameModeID
    let dailyBundle: DailyBundleDTO?
    let allowReplay: Bool
    let onFinished: () -> Void

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
                TargetManView(dailyBundle: dailyBundle, allowReplay: allowReplay, onComplete: onFinished)
            case .blindRank:
                BlindRankView(dailyBundle: dailyBundle, allowReplay: allowReplay, onComplete: onFinished)
            case .footballBingo:
                FootballBingoView(dailyDate: dailyBundle?.date, allowReplay: allowReplay, onComplete: onFinished)
            case .oneMore:
                OneMoreView(dailyDate: dailyBundle?.date, allowReplay: allowReplay, onComplete: onFinished)
            case .draftMaster:
                DraftMasterView(dailyDate: dailyBundle?.date, allowReplay: allowReplay, onComplete: onFinished)
            case .footballGolf:
                FootballGolfView(dailyDate: dailyBundle?.date, allowReplay: allowReplay, onComplete: onFinished)
            case .footballTower:
                FootballTowerView(dailyOnly: true, allowReplay: allowReplay, onComplete: onFinished)
            case .worldCupXI:
                WorldCupXIView(dailyDate: dailyBundle?.date, allowReplay: allowReplay, onComplete: onFinished)
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
