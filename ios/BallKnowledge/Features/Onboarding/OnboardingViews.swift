import SwiftUI
import PhotosUI

struct OnboardingContainerView: View {
    @State private var page = 0
    private let pageCount = 4

    var body: some View {
        ZStack {
            HomeAmbientBackground()

            VStack(spacing: 0) {
                OnboardingProgressHeader(page: page, pageCount: pageCount)

                TabView(selection: $page) {
                    WelcomeOnboardingPage()
                        .tag(0)
                    DailyChallengeOnboardingPage()
                        .tag(1)
                    GamesOnboardingPage()
                        .tag(2)
                    SignInOnboardingPage()
                        .tag(3)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))

                if page < pageCount - 1 {
                    OnboardingPrimaryButton(
                        title: page == 0 ? "SHOW ME" : "KEEP GOING",
                        action: advance
                    )
                    .padding(.horizontal, 20)
                    .padding(.top, 10)
                    .padding(.bottom, 12)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
        }
        .animation(.snappy(duration: 0.35), value: page)
        .onChange(of: page) { _, _ in HapticManager.light() }
    }

    private func advance() {
        guard page < pageCount - 1 else { return }
        withAnimation(.snappy(duration: 0.4)) {
            page += 1
        }
    }
}

// MARK: - Shared chrome

private struct OnboardingProgressHeader: View {
    let page: Int
    let pageCount: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<pageCount, id: \.self) { index in
                Capsule()
                    .fill(index <= page ? BKTheme.accent : Color.white.opacity(0.1))
                    .frame(height: 3)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 2)
    }
}

private struct OnboardingPrimaryButton: View {
    let title: String
    var enabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Text(title)
                Image(systemName: "arrow.right")
                    .font(.system(size: 14, weight: .black))
            }
            .font(BKFont.headline(15))
            .foregroundStyle(enabled ? BKTheme.background : BKTheme.textMuted)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(enabled ? BKTheme.accent : BKTheme.cardElevated)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .shadow(color: enabled ? BKTheme.accent.opacity(0.18) : .clear, radius: 18, y: 8)
        }
        .buttonStyle(OnboardingButtonStyle())
        .disabled(!enabled)
    }
}

private struct OnboardingButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.975 : 1)
            .opacity(configuration.isPressed ? 0.88 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

private struct OnboardingFloatMotion: ViewModifier {
    let amplitude: CGFloat
    let duration: TimeInterval
    var phase: Double = 0
    var enabled = true

    func body(content: Content) -> some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: !enabled)) { timeline in
            let elapsed = timeline.date.timeIntervalSinceReferenceDate
            let wave = sin(((elapsed / duration) + phase) * 2 * .pi)
            content.offset(y: enabled ? CGFloat(wave) * amplitude : 0)
        }
    }
}

private struct OnboardingTitleBlock: View {
    let eyebrow: String?
    let title: String
    let subtitle: String
    var alignment: TextAlignment = .leading

    var body: some View {
        VStack(alignment: alignment == .leading ? .leading : .center, spacing: 12) {
            Text(title)
                .font(BKFont.title(34))
                .foregroundStyle(BKTheme.textPrimary)
                .multilineTextAlignment(alignment)
                .fixedSize(horizontal: false, vertical: true)
            Text(subtitle)
                .font(BKFont.body(16))
                .foregroundStyle(BKTheme.textSecondary)
                .multilineTextAlignment(alignment)
                .lineSpacing(3)
        }
        .frame(maxWidth: .infinity, alignment: alignment == .leading ? .leading : .center)
    }
}

// MARK: - Welcome

struct WelcomeOnboardingPage: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Circle()
                    .stroke(BKTheme.accent.opacity(0.12), lineWidth: 1)
                    .frame(width: 270, height: 270)

                Circle()
                    .fill(BKTheme.accent.opacity(0.09))
                    .frame(width: 230, height: 230)
                    .blur(radius: 36)

                GameModeBundleImage(name: "balllsss")
                    .scaledToFill()
                    .frame(width: 190, height: 190)
                    .clipShape(RoundedRectangle(cornerRadius: 40, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 40, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.1), lineWidth: 1)
                    )
                    .shadow(color: BKTheme.accent.opacity(0.24), radius: 30, y: 14)
                    .scaleEffect(appeared ? 1 : 0.78)
                    .opacity(appeared ? 1 : 0)
                    .modifier(
                        OnboardingFloatMotion(
                            amplitude: 2,
                            duration: 3.6,
                            enabled: !reduceMotion
                        )
                    )

                OnboardingFloatingChip(icon: "bolt.fill", text: "XP", tint: BKTheme.accent)
                    .offset(x: -112, y: 84)
                    .rotationEffect(.degrees(-7))
                    .opacity(appeared ? 1 : 0)
                    .offset(y: appeared ? 0 : 18)
                    .modifier(
                        OnboardingFloatMotion(
                            amplitude: 2.5,
                            duration: 3.2,
                            phase: 0.12,
                            enabled: !reduceMotion
                        )
                    )

                OnboardingFloatingChip(icon: "flame.fill", text: "STREAK", tint: BKTheme.streak)
                    .offset(x: 104, y: -88)
                    .rotationEffect(.degrees(7))
                    .opacity(appeared ? 1 : 0)
                    .offset(y: appeared ? 0 : -18)
                    .modifier(
                        OnboardingFloatMotion(
                            amplitude: 2,
                            duration: 3.7,
                            phase: 0.58,
                            enabled: !reduceMotion
                        )
                    )
            }
            .frame(maxHeight: .infinity)

            OnboardingTitleBlock(
                eyebrow: nil,
                title: "Think you know\nfootball?",
                subtitle: "Test your ball knowledge with seven new football quiz games each day."
            )
            .padding(.horizontal, 24)
            .padding(.bottom, 16)
        }
        .onAppear {
            withAnimation(.spring(response: 0.65, dampingFraction: 0.76)) {
                appeared = true
            }
        }
    }
}

private struct OnboardingFloatingChip: View {
    let icon: String
    let text: String
    let tint: Color

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(tint)
            Text(text)
                .font(BKFont.caption(10))
                .tracking(0.8)
                .foregroundStyle(BKTheme.textPrimary)
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 9)
        .background(.ultraThinMaterial)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(Color.white.opacity(0.1), lineWidth: 1))
    }
}

// MARK: - Daily challenge

struct DailyChallengeOnboardingPage: View {
    @State private var revealed = false

    var body: some View {
        VStack(spacing: 0) {
            DailyChallengeHeroCard()
                .padding(.horizontal, 20)
                .frame(maxHeight: .infinity)
                .scaleEffect(revealed ? 1 : 0.92)
                .opacity(revealed ? 1 : 0)
                .offset(y: revealed ? 0 : 24)

            OnboardingTitleBlock(
                eyebrow: nil,
                title: "Track your daily progress",
                subtitle: "Complete games to earn XP and build your streak."
            )
            .padding(.horizontal, 24)
            .padding(.bottom, 16)
        }
        .onAppear {
            withAnimation(.spring(response: 0.55, dampingFraction: 0.8).delay(0.08)) {
                revealed = true
            }
        }
    }
}

private struct DailyChallengeHeroCard: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var filledSegments = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .lastTextBaseline, spacing: 5) {
                        Text("7")
                            .font(.system(size: 42, weight: .black, design: .rounded))
                            .foregroundStyle(BKTheme.accent)
                        Text("/ 7")
                            .font(BKFont.headline(17))
                            .foregroundStyle(BKTheme.textMuted)
                            .padding(.bottom, 5)
                    }
                    Text("GAMES CLEARED")
                        .font(BKFont.caption(10))
                        .tracking(1.2)
                        .foregroundStyle(BKTheme.textMuted)
                }

                Spacer(minLength: 12)

                HStack(spacing: 9) {
                    Ph.lightning.fill
                        .color(BKTheme.accent)
                        .frame(width: 19, height: 19)

                    VStack(alignment: .leading, spacing: 3) {
                        Text("+2,840")
                            .font(BKFont.title(24))
                            .foregroundStyle(BKTheme.accent)
                            .fixedSize(horizontal: true, vertical: false)
                        Text("XP EARNED")
                            .font(BKFont.caption(9))
                            .tracking(1)
                            .foregroundStyle(BKTheme.textMuted)
                    }
                }
            }

            HStack(spacing: 5) {
                ForEach(0..<7, id: \.self) { index in
                    Capsule()
                        .fill(
                            index < filledSegments
                                ? AnyShapeStyle(
                                    LinearGradient(
                                        colors: [BKTheme.accent, BKTheme.accentMuted],
                                        startPoint: .leading,
                                        endPoint: .trailing
                                    )
                                )
                                : AnyShapeStyle(Color.white.opacity(0.22))
                        )
                        .frame(height: 7)
                        .shadow(
                            color: index < filledSegments ? BKTheme.accent.opacity(0.55) : .clear,
                            radius: 4
                        )
                        .animation(
                            .spring(response: 0.58, dampingFraction: 0.78)
                                .delay(Double(index) * 0.18),
                            value: filledSegments
                        )
                }
            }

            HStack(spacing: 13) {
                Ph.fire.fill
                    .color(BKTheme.streak)
                    .frame(width: 30, height: 30)

                VStack(alignment: .leading, spacing: 2) {
                    Text("12")
                        .font(BKFont.title(25))
                        .foregroundStyle(BKTheme.textPrimary)
                    Text("DAY STREAK")
                        .font(BKFont.caption(9))
                        .tracking(1.1)
                        .foregroundStyle(BKTheme.textMuted)
                }

                Spacer()

                Text("KEEP IT GOING")
                    .font(BKFont.caption(10))
                    .tracking(1)
                    .foregroundStyle(BKTheme.streak)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { dailyHubBackground }
        .shadow(color: .black.opacity(0.25), radius: 20, y: 12)
        .modifier(
            OnboardingFloatMotion(
                amplitude: 2,
                duration: 3.8,
                phase: 0.3,
                enabled: !reduceMotion
            )
        )
        .onAppear {
            filledSegments = 0
            withAnimation {
                filledSegments = 7
            }
        }
    }

    private var dailyHubBackground: some View {
        ZStack {
            Color(hex: "141414")
            dailyHubHeroImage
            dailyHubTextScrim
            BKGlass.roundedRect(cornerRadius: 20)
        }
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var dailyHubHeroImage: some View {
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

    private var dailyHubTextScrim: some View {
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
}

// MARK: - Games

struct GamesOnboardingPage: View {
    var body: some View {
        VStack(spacing: 0) {
            GameModesPreview()
                .padding(.horizontal, 18)
                .frame(maxHeight: .infinity)

            OnboardingTitleBlock(
                eyebrow: nil,
                title: "Seven different football games",
                subtitle: "Build teams, connect players, hit targets and answer questions across seven game modes."
            )
            .padding(.horizontal, 24)
            .padding(.bottom, 16)
        }
    }
}

struct GameModesPreview: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let modes = DailyPlayOrder.playableModes
    @State private var revealed = false
    @State private var carouselStartedAt = Date()

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { timeline in
            let elapsed = max(0, timeline.date.timeIntervalSince(carouselStartedAt))
            let rotationStep = reduceMotion ? 0 : Int(elapsed / 2.2) % modes.count

            ZStack {
                ForEach(Array(modes.enumerated()), id: \.element.rawValue) { index, mode in
                    let slot = (index + rotationStep) % modes.count

                    GameModeBundleImage(name: mode.rawValue)
                        .scaledToFill()
                        .frame(width: 104, height: 138)
                        .clipped()
                        .frame(width: 104, height: 138)
                        .background(BKTheme.tileIconBackdrop)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
                        )
                        .shadow(color: .black.opacity(0.5), radius: 10, y: 7)
                        .rotationEffect(.degrees(Double(slot - 3) * 4.2))
                        .offset(
                            x: CGFloat(slot - 3) * 41,
                            y: CGFloat(abs(slot - 3)) * 9
                        )
                        .zIndex(Double(4 - abs(slot - 3)))
                        .opacity(revealed ? 1 : 0)
                        .scaleEffect(revealed ? 1 : 0.76)
                        .offset(y: revealed ? 0 : 28)
                        .animation(
                            .spring(response: 0.58, dampingFraction: 0.72)
                                .delay(Double(index) * 0.06),
                            value: revealed
                        )
                        .animation(
                            .spring(response: 0.72, dampingFraction: 0.8),
                            value: rotationStep
                        )
                }
            }
        }
        .frame(height: 225)
        .onAppear {
            carouselStartedAt = Date()
            withAnimation {
                revealed = true
            }
        }
    }
}

// MARK: - Sign in

struct SignInOnboardingPage: View {
    @Environment(AuthManager.self) private var auth
    @State private var appeared = false

    var body: some View {
        VStack(spacing: 0) {
            OnboardingLeaguePreview()
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .frame(maxHeight: .infinity)
                .opacity(appeared ? 1 : 0)
                .offset(y: appeared ? 0 : 18)

            OnboardingTitleBlock(
                eyebrow: nil,
                title: "Create your account",
                subtitle: "Save your progress, climb the leagues and earn XP for your club."
            )
            .padding(.horizontal, 24)
            .padding(.bottom, 20)

            VStack(spacing: 12) {
                SignInWithAppleButtonView { token, name in
                    Task { await auth.signIn(identityToken: token, displayName: name) }
                }

                if let error = auth.errorMessage {
                    Text(error)
                        .font(BKFont.caption())
                        .foregroundStyle(BKTheme.wrong)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }

                Link("Privacy Policy", destination: AppConfig.privacyPolicyURL)
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textMuted)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
            .opacity(appeared ? 1 : 0)
        }
        .onAppear {
            withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) {
                appeared = true
            }
        }
    }
}

private struct OnboardingLeaguePreview: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var startedAt = Date()

    private let players = [
        OnboardingLeaguePlayer(id: "jordan", name: "Jordan", initials: "JR", imageName: "league1", xp: 3_520),
        OnboardingLeaguePlayer(id: "theo", name: "Theo", initials: "TH", imageName: "league3", xp: 3_050),
        OnboardingLeaguePlayer(id: "lewis", name: "Lewis", initials: "LW", imageName: "league4", xp: 2_510),
        OnboardingLeaguePlayer(id: "you", name: "You", initials: "YOU", imageName: nil, xp: 1_860),
    ]
    private let youXP = [1_860, 2_280, 2_740, 3_260, 3_890, 3_890]

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { timeline in
            let elapsed = max(0, timeline.date.timeIntervalSince(startedAt))
            let stage = reduceMotion ? 4 : Int(elapsed / 1.45) % youXP.count
            let rankedPlayers = rankedPlayers(at: stage)

            VStack(spacing: 8) {
                HStack {
                    Text("OVERALL LEAGUE")
                        .font(BKFont.caption(10))
                        .tracking(1.2)
                        .foregroundStyle(BKTheme.textMuted)
                    Spacer()
                    HStack(spacing: 5) {
                        Ph.lightning.fill
                            .color(BKTheme.accent)
                            .frame(width: 12, height: 12)
                        Text("XP")
                            .font(BKFont.caption(10))
                            .foregroundStyle(BKTheme.accent)
                    }
                }
                .padding(.horizontal, 4)
                .padding(.bottom, 2)

                ForEach(Array(rankedPlayers.enumerated()), id: \.element.id) { index, player in
                    OnboardingLeagueRow(
                        rank: index + 1,
                        player: player,
                        isYou: player.id == "you"
                    )
                }
            }
            .animation(.spring(response: 0.68, dampingFraction: 0.78), value: stage)
        }
        .onAppear { startedAt = Date() }
    }

    private func rankedPlayers(at stage: Int) -> [OnboardingLeaguePlayer] {
        players
            .map { player in
                guard player.id == "you" else { return player }
                return OnboardingLeaguePlayer(
                    id: player.id,
                    name: player.name,
                    initials: player.initials,
                    imageName: player.imageName,
                    xp: youXP[stage]
                )
            }
            .sorted { $0.xp > $1.xp }
    }
}

private struct OnboardingLeaguePlayer: Identifiable {
    let id: String
    let name: String
    let initials: String
    let imageName: String?
    let xp: Int
}

private struct OnboardingLeagueRow: View {
    let rank: Int
    let player: OnboardingLeaguePlayer
    let isYou: Bool

    var body: some View {
        HStack(spacing: 10) {
            Text("\(rank)")
                .font(.system(size: 14, weight: .black, design: .rounded))
                .foregroundStyle(rank <= 3 ? BKTheme.accent : BKTheme.textMuted)
                .frame(width: 24)

            Group {
                if let imageName = player.imageName {
                    BundleResourceImage(name: imageName, subdirectory: "leaguepics")
                        .scaledToFill()
                } else {
                    Circle()
                        .fill(BKTheme.accent.opacity(0.16))
                        .overlay {
                            Text(player.initials)
                                .font(BKFont.caption(9))
                                .foregroundStyle(BKTheme.accent)
                        }
                }
            }
            .frame(width: 34, height: 34)
            .clipShape(Circle())

            Text(player.name)
                .font(BKFont.headline(14))
                .foregroundStyle(BKTheme.textPrimary)

            Spacer(minLength: 8)

            HStack(spacing: 4) {
                Ph.lightning.fill
                    .color(BKTheme.accent)
                    .frame(width: 11, height: 11)
                Text("\(player.xp)")
                    .font(BKFont.headline(13))
                    .foregroundStyle(BKTheme.textPrimary)
                    .monospacedDigit()
                    .contentTransition(.numericText())
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(isYou ? BKTheme.cardElevated : BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(isYou ? BKTheme.accent.opacity(0.6) : .clear, lineWidth: 1.5)
        )
    }
}

// MARK: - Post sign-in setup (club → profile → reminders)

struct PostSignInSetupView: View {
    @Environment(AuthManager.self) private var auth
    @AppStorage(UserDefaultsKeys.completedPostSignInSetup) private var completedSetup = false

    enum Step { case club, profile, reminders }
    @State private var step: Step = .club

    var body: some View {
        ZStack {
            HomeAmbientBackground()
            switch step {
            case .club:
                TeamPickerView(onDone: { advance(from: .club) })
            case .profile:
                ProfileSetupStep(onContinue: { advance(from: .profile) })
            case .reminders:
                ReminderSetupStep(onFinish: finish)
            }
        }
        .onAppear {
            if auth.user?.favoriteTeamId != nil { step = .profile }
        }
        .animation(.easeInOut(duration: 0.25), value: step)
    }

    private func advance(from current: Step) {
        switch current {
        case .club: step = .profile
        case .profile: step = .reminders
        case .reminders: finish()
        }
    }

    private func finish() {
        completedSetup = true
    }
}

struct TeamPickerView: View {
    @Environment(AuthManager.self) private var auth
    var onDone: () -> Void

    @State private var query = ""
    @State private var results: [TeamSearchResultDTO] = []
    @State private var selected: TeamSearchResultDTO?
    @State private var isSaving = false
    @State private var isSearching = false

    var body: some View {
        VStack(spacing: 0) {
            OnboardingTitleBlock(
                eyebrow: "Your club",
                title: "Pick your team",
                subtitle: "Earn XP for your club and climb the Teams leaderboard against rival fans."
            )
            .padding(.top, 28)
            .padding(.bottom, 18)
            .padding(.horizontal, 20)

            searchField
                .padding(.horizontal, 20)

            resultsList

            VStack(spacing: 12) {
                OnboardingPrimaryButton(
                    title: isSaving ? "SAVING…" : "CONTINUE",
                    enabled: selected != nil && !isSaving,
                    action: confirm
                )
                Button("Skip for now", action: skip)
                    .font(BKFont.caption())
                    .foregroundStyle(BKTheme.textMuted)
            }
            .padding(.bottom, 24)
        }
        .task(id: query) { await runSearch() }
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(BKTheme.textMuted)
            TextField("Search teams", text: $query)
                .foregroundStyle(BKTheme.textPrimary)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.words)
            if isSearching {
                ProgressView().scaleEffect(0.7).tint(BKTheme.accent)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var resultsList: some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(spacing: 8) {
                ForEach(results) { team in
                    Button { selected = team } label: {
                        teamRow(team)
                    }
                    .buttonStyle(.plain)
                }

                if results.isEmpty && !isSearching {
                    Text(query.isEmpty ? "Start typing to find your club." : "No teams found.")
                        .font(BKFont.body(13))
                        .foregroundStyle(BKTheme.textMuted)
                        .padding(.top, 40)
                }
            }
            .padding(20)
        }
    }

    private func teamRow(_ team: TeamSearchResultDTO) -> some View {
        let isSelected = selected?.id == team.id
        return HStack(spacing: 12) {
            AsyncImage(url: URL(string: team.logoUrl ?? "")) { image in
                image.resizable().scaledToFit()
            } placeholder: {
                Image(systemName: "shield.fill").foregroundStyle(BKTheme.textMuted)
            }
            .frame(width: 32, height: 32)

            Text(team.name)
                .font(BKFont.headline(15))
                .foregroundStyle(BKTheme.textPrimary)
                .lineLimit(1)

            Spacer(minLength: 8)

            if isSelected {
                Ph.checkCircle.fill
                    .color(BKTheme.accent)
                    .frame(width: 22, height: 22)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(isSelected ? BKTheme.cardElevated : BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(isSelected ? BKTheme.accent : .clear, lineWidth: 1.5)
        )
    }

    private func runSearch() async {
        isSearching = true
        defer { isSearching = false }
        try? await Task.sleep(for: .milliseconds(250))
        if Task.isCancelled { return }
        results = (try? await APIClient.shared.searchTeams(query: query)) ?? []
    }

    private func confirm() {
        guard let selected else { return }
        isSaving = true
        Task {
            try? await APIClient.shared.setFavoriteTeam(selected.id)
            await auth.refreshProfile()
            isSaving = false
            onDone()
        }
    }

    private func skip() {
        onDone()
    }
}

struct ProfileSetupStep: View {
    @Environment(AuthManager.self) private var auth
    var onContinue: () -> Void

    @State private var name = ""
    @State private var avatarImage: UIImage?
    @State private var photoItem: PhotosPickerItem?
    @State private var showPhotoPicker = false

    var body: some View {
        VStack(spacing: 0) {
            OnboardingTitleBlock(
                eyebrow: "Profile",
                title: "How you'll show up",
                subtitle: "This name and photo appear on Overall and Teams leaderboards."
            )
            .padding(.top, 28)

            Spacer()

            Button { showPhotoPicker = true } label: {
                ZStack(alignment: .bottomTrailing) {
                    Group {
                        if let avatarImage {
                            Image(uiImage: avatarImage).resizable().scaledToFill()
                        } else {
                            BKTheme.cardElevated.overlay {
                                Ph.userCircle.fill.color(BKTheme.accent).frame(width: 52, height: 52)
                            }
                        }
                    }
                    .frame(width: 124, height: 124)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(BKTheme.accent.opacity(0.35), lineWidth: 2))
                    .shadow(color: BKTheme.accent.opacity(0.18), radius: 20, y: 8)

                    Circle().fill(BKTheme.accent).frame(width: 36, height: 36)
                        .overlay {
                            Image(systemName: "camera.fill")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(BKTheme.background)
                        }
                        .overlay(Circle().stroke(BKTheme.background, lineWidth: 3))
                }
            }
            .buttonStyle(.plain)

            TextField("Your name", text: $name)
                .font(BKFont.headline(17))
                .foregroundStyle(BKTheme.textPrimary)
                .multilineTextAlignment(.center)
                .padding(.vertical, 16)
                .padding(.horizontal, 16)
                .background(BKTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .padding(.horizontal, 40)
                .padding(.top, 28)

            Spacer()
            Spacer()

            OnboardingPrimaryButton(title: "CONTINUE", action: save)
                .padding(.bottom, 24)
        }
        .onAppear {
            name = LocalProfile.nameOverride ?? auth.user?.displayName ?? ""
            avatarImage = LocalProfile.loadAvatar()
        }
        .photosPicker(isPresented: $showPhotoPicker, selection: $photoItem, matching: .images)
        .onChange(of: photoItem) { _, newItem in
            guard let newItem else { return }
            Task {
                if let data = try? await newItem.loadTransferable(type: Data.self),
                   let image = UIImage(data: data) {
                    await ProfileSync.saveAvatarImage(image, auth: auth)
                    avatarImage = LocalProfile.loadAvatar()
                }
            }
        }
    }

    private func save() {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            if !trimmed.isEmpty {
                await ProfileSync.saveName(trimmed, auth: auth)
            }
            await MainActor.run { onContinue() }
        }
    }
}

struct ReminderSetupStep: View {
    var onFinish: () -> Void
    @State private var isWorking = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            ZStack {
                Circle()
                    .fill(BKTheme.accent.opacity(0.12))
                    .frame(width: 160, height: 160)
                    .blur(radius: 20)
                Image(systemName: "bell.badge.fill")
                    .font(.system(size: 54, weight: .bold))
                    .foregroundStyle(BKTheme.accent)
            }

            OnboardingTitleBlock(
                eyebrow: "Stay sharp",
                title: "Never lose your streak",
                subtitle: "Get a daily nudge when the games are ready — finish all 7 to keep your streak."
            )
            .padding(.top, 28)

            Spacer()
            Spacer()

            VStack(spacing: 12) {
                OnboardingPrimaryButton(
                    title: isWorking ? "…" : "TURN ON REMINDERS",
                    enabled: !isWorking,
                    action: enable
                )
                Button("Not now") { onFinish() }
                    .font(BKFont.caption())
                    .foregroundStyle(BKTheme.textMuted)
            }
            .padding(.bottom, 24)
        }
    }

    private func enable() {
        isWorking = true
        Task {
            let granted = await DailyReminder.enable()
            LocalProfile.remindersOn = granted
            isWorking = false
            onFinish()
        }
    }
}
