import SwiftUI
import SwiftData
import PhosphorSwift

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
            gameModes = try await APIClient.shared.gameModes()
        } catch {
            let today = ISO8601DateFormatter().string(from: Date()).prefix(10)
            if let cached = try? OfflineCache.loadDailyBundle(date: String(today), context: context) {
                dailyBundle = cached
            }
            if gameModes.isEmpty {
                gameModes = fallbackGameModes()
            }
            errorMessage = error.localizedDescription
        }

        await OfflineCache.syncPendingCompletions(context: context)
    }

    private func fallbackGameModes() -> [GameModeMetaDTO] {
        GameModeID.allCases.enumerated().map { index, mode in
            GameModeMetaDTO(
                id: mode.rawValue,
                title: mode.title,
                subtitle: "",
                playerCount: [12400, 8900, 15200, 22100, 7600, 9800, 11300, 6400, 8700][index],
                isAvailable: mode == .guessWho
            )
        }
    }
}

struct HomeView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel = HomeViewModel()
    @State private var showGuessWho = false
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
                        if mode.isAvailable && mode.id == GameModeID.guessWho.rawValue {
                            showGuessWho = true
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

            Text(alreadyPlayed ? "Completed today — play again tomorrow" : "8 guesses. Can you name today's player?")
                .font(BKFont.body(13))
                .foregroundStyle(BKTheme.textSecondary)

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
            ZStack(alignment: .bottomTrailing) {
                LinearGradient(
                    colors: [BKTheme.cardElevated, BKTheme.card],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )

                Image("banner1")
                    .resizable()
                    .scaledToFit()
                    .frame(height: 130)
                    .padding(.trailing, 6)
                    .blendMode(.screen)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 20))
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

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(mode.title)
                        .font(BKFont.caption(9))
                        .foregroundStyle(BKTheme.textPrimary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Spacer()
                }

                Spacer()

                HStack {
                    HStack(spacing: 4) {
                        Ph.users.fill
                            .color(BKTheme.textMuted)
                            .frame(width: 10, height: 10)
                        Text(formatCount(mode.playerCount))
                            .font(.system(size: 9))
                            .foregroundStyle(BKTheme.textMuted)
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
                            .foregroundStyle(BKTheme.textMuted)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(BKTheme.cardElevated)
                            .clipShape(Capsule())
                    }
                }
            }
            .padding(10)
            .frame(height: 110)
            .background(BKTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .opacity(mode.isAvailable ? 1 : 0.65)
        }
        .buttonStyle(.plain)
    }

    private func formatCount(_ count: Int) -> String {
        if count >= 1000 {
            return String(format: "%.1fK", Double(count) / 1000)
        }
        return "\(count)"
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
