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
    @State private var showGuessWho = false
    @State private var showFootballBingo = false
    @State private var showTargetMan = false
    @State private var showFootballGolf = false
    @Binding var selectedTab: AppTab

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 20) {
                HomeHeaderView(user: auth.user, onLeagues: { selectedTab = .leagues })

                if let bundle = viewModel.dailyBundle {
                    DailyChallengeCard(
                        streak: auth.user?.streak ?? 0,
                        game: bundle.games.first,
                        alreadyPlayed: bundle.alreadyPlayed,
                        onPlay: { showGuessWho = true }
                    )
                } else if viewModel.isLoading {
                    ProgressView()
                        .tint(BKTheme.accent)
                        .frame(height: 200)
                }

                GamesGridSection(
                    modes: viewModel.gameModes,
                    onSelect: { mode in
                        guard mode.isAvailable else { return }
                        switch GameModeCatalog.normalizedModeId(mode.id) {
                        case GameModeID.guessWho.rawValue:
                            showGuessWho = true
                        case GameModeID.footballBingo.rawValue:
                            showFootballBingo = true
                        case GameModeID.targetMan.rawValue:
                            showTargetMan = true
                        case GameModeID.footballGolf.rawValue:
                            showFootballGolf = true
                        default:
                            break
                        }
                    }
                )

                ProgressStripView(
                    streak: auth.user?.streak ?? 0,
                    todayXp: auth.user?.todayXp ?? 0,
                    xpGoal: AppConfig.dailyXpGoal
                )
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
        .fullScreenCover(isPresented: $showGuessWho) {
            if let bundle = viewModel.dailyBundle, let game = bundle.games.first {
                GuessWhoView(
                    puzzle: game.puzzle,
                    date: bundle.date,
                    onComplete: {
                        showGuessWho = false
                        Task {
                            await auth.refreshProfile()
                            await viewModel.load(context: modelContext)
                        }
                    }
                )
            }
        }
        .fullScreenCover(isPresented: $showFootballBingo) {
            FootballBingoView(onComplete: {
                showFootballBingo = false
            })
        }
        .fullScreenCover(isPresented: $showTargetMan) {
            TargetManView(onComplete: {
                showTargetMan = false
            })
        }
        .fullScreenCover(isPresented: $showFootballGolf) {
            FootballGolfView(onComplete: {
                showFootballGolf = false
            })
        }
    }
}

struct HomeHeaderView: View {
    let user: UserProfileDTO?
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
                    Text("Level \(user?.level ?? 1)")
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.background)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(BKTheme.accent)
                        .clipShape(Capsule())
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

struct DailyChallengeCard: View {
    let streak: Int
    let game: DailyGameDTO?
    let alreadyPlayed: Bool
    var onPlay: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("DAILY CHALLENGE")
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.accent)
                Spacer()
                    HStack(spacing: 4) {
                        Ph.fire.fill
                            .color(BKTheme.streak)
                            .frame(width: 14, height: 14)
                        Text("\(streak) DAY STREAK")
                        .font(BKFont.caption(10))
                        .foregroundStyle(BKTheme.textPrimary)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(BKTheme.background.opacity(0.6))
                .clipShape(Capsule())
            }

            Text(game?.title ?? "GUESS WHO?")
                .font(BKFont.title(24))
                .foregroundStyle(BKTheme.textPrimary)

            if alreadyPlayed {
                TimelineView(.periodic(from: .now, by: 60)) { context in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Ph.checkCircle.fill
                                .color(BKTheme.accent)
                                .frame(width: 16, height: 16)
                            Text("Completed")
                                .font(BKFont.headline(13))
                                .foregroundStyle(BKTheme.textPrimary)
                        }
                        Text("Play again in \(Self.timeUntilMidnight(from: context.date))")
                            .font(BKFont.body(13))
                            .foregroundStyle(BKTheme.textSecondary)
                    }
                }
            } else {
                Text("8 guesses. Can you name today's player?")
                    .font(BKFont.body(13))
                    .foregroundStyle(BKTheme.textSecondary)
            }

            Button(action: onPlay) {
                    HStack {
                        Text(alreadyPlayed ? "VIEW RESULT" : "PLAY NOW")
                            .font(BKFont.headline(14))
                        Ph.arrowRight.bold
                            .color(BKTheme.background)
                            .frame(width: 16, height: 16)
                    }
                .foregroundStyle(BKTheme.background)
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .background(BKTheme.accent)
                .clipShape(Capsule())
            }
            .padding(.top, 4)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            GeometryReader { geo in
                ZStack(alignment: .trailing) {
                    LinearGradient(
                        colors: [BKTheme.cardElevated, BKTheme.card],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )

                    Image("banner2")
                        .resizable()
                        .scaledToFill()
                        .frame(width: geo.size.width * 0.55, height: geo.size.height, alignment: .trailing)
                        .clipped()

                    LinearGradient(
                        colors: [BKTheme.card.opacity(0.92), BKTheme.card.opacity(0.55), .clear],
                        startPoint: .leading,
                        endPoint: UnitPoint(x: 0.65, y: 0.5)
                    )
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private static func timeUntilMidnight(from date: Date, calendar: Calendar = .current) -> String {
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

struct GamesGridSection: View {
    let modes: [GameModeMetaDTO]
    var onSelect: (GameModeMetaDTO) -> Void

    let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 3)

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("GAMES")
                    .font(BKFont.headline(18))
                    .foregroundStyle(BKTheme.textPrimary)
                Spacer()
                Text("View all >")
                    .font(BKFont.caption())
                    .foregroundStyle(BKTheme.accent)
            }

            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(modes) { mode in
                    GameModeTile(mode: mode) {
                        onSelect(mode)
                    }
                }
            }
        }
    }
}

struct GameModeTile: View {
    let mode: GameModeMetaDTO
    var onTap: () -> Void

    private let cornerRadius: CGFloat = 14

    private var tileArtImageName: String? {
        GameModeTileArt.bundleImageName(for: mode.id)
    }

    private var usesImageArt: Bool { tileArtImageName != nil }

    var body: some View {
        Button(action: onTap) {
            ZStack(alignment: .topLeading) {
                BKTheme.card

                if usesImageArt {
                    tileArtLayer
                    tileBottomFade
                }

                tileContent
                    .zIndex(2)
            }
            .frame(height: 110)
            .frame(maxWidth: .infinity, alignment: .leading)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
            .opacity(usesImageArt ? 1 : (mode.isAvailable ? 1 : 0.65))
        }
        .buttonStyle(TilePressStyle())
    }

    private var tileArtLayer: some View {
        GeometryReader { geo in
            if let tileArtImageName {
                GameModeBundleImage(name: tileArtImageName)
                    .scaledToFill()
                    .frame(width: geo.size.width, height: geo.size.height)
                    .opacity(mode.isAvailable ? 1 : 0.75)
            }
        }
        .allowsHitTesting(false)
    }

    private var tileBottomFade: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            LinearGradient(
                colors: [Color.clear, Color.black.opacity(0.55), Color.black.opacity(0.88)],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 54)
        }
        .allowsHitTesting(false)
        .zIndex(1)
    }

    private var tileContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            tileTitle

            Spacer(minLength: 0)

            tileFooter
        }
        .padding(10)
    }

    private var tileTitle: some View {
        Text(mode.title)
            .font(usesImageArt
                ? .system(size: 15, weight: .black, design: .rounded)
                : BKFont.caption(9))
            .foregroundStyle(BKTheme.textPrimary)
            .shadow(color: usesImageArt ? Color.black.opacity(0.45) : .clear, radius: 3, y: 1)
            .lineLimit(2)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var tileFooter: some View {
        HStack {
            HStack(spacing: 4) {
                Ph.users.fill
                    .color(footerMetaColor)
                    .frame(width: 10, height: 10)
                Text(formatCount(mode.playerCount))
                    .font(.system(size: 9, weight: usesImageArt ? .semibold : .regular))
                    .foregroundStyle(footerMetaColor)
            }
            Spacer()
            if mode.isAvailable {
                Ph.play.fill
                    .color(BKTheme.background)
                    .frame(width: 10, height: 10)
                    .padding(6)
                    .background(BKTheme.accent)
                    .clipShape(Circle())
            } else {
                Text("SOON")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(usesImageArt ? footerMetaColor : BKTheme.textMuted)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(usesImageArt ? Color.black.opacity(0.2) : BKTheme.cardElevated)
                    .clipShape(Capsule())
            }
        }
    }

    private var footerMetaColor: Color {
        usesImageArt ? Color(hex: "D4D4D4") : BKTheme.textMuted
    }

    private func formatCount(_ count: Int) -> String {
        if count >= 1000 {
            return String(format: "%.1fK", Double(count) / 1000)
        }
        return "\(count)"
    }
}

private struct TilePressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.spring(response: 0.28, dampingFraction: 0.62), value: configuration.isPressed)
    }
}

struct ProgressStripView: View {
    let streak: Int
    let todayXp: Int
    let xpGoal: Int

    var body: some View {
        HStack(spacing: 16) {
            VStack(spacing: 6) {
                ZStack {
                    Circle()
                        .stroke(BKTheme.cardElevated, lineWidth: 4)
                        .frame(width: 56, height: 56)
                    Circle()
                        .trim(from: 0, to: min(1, Double(streak % 7) / 7))
                        .stroke(BKTheme.streak, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                        .frame(width: 56, height: 56)
                        .rotationEffect(.degrees(-90))
                    Ph.fire.fill
                        .color(BKTheme.streak)
                        .frame(width: 22, height: 22)
                }
                Text("\(streak) DAY")
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.textSecondary)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("TODAY'S XP")
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.textMuted)
                Text("\(todayXp) / \(xpGoal) XP")
                    .font(BKFont.headline(14))
                    .foregroundStyle(BKTheme.textPrimary)
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(BKTheme.cardElevated)
                        Capsule()
                            .fill(BKTheme.accent)
                            .frame(width: geo.size.width * min(1, Double(todayXp) / Double(xpGoal)))
                    }
                }
                .frame(height: 8)
            }

            Ph.gift.fill
                .color(BKTheme.accent)
                .frame(width: 24, height: 24)
                .frame(width: 48, height: 48)
                .background(BKTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .padding(16)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}
