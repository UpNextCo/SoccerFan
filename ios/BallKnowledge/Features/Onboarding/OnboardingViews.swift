import SwiftUI

struct OnboardingContainerView: View {
    @Environment(AuthManager.self) private var auth
    @State private var page = 0

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()

            TabView(selection: $page) {
                WelcomeOnboardingPage(onContinue: { page = 1 })
                    .tag(0)
                ValuePropPage(
                    title: "One daily challenge",
                    subtitle: "Same puzzle for everyone. Share your score card and challenge mates.",
                    icon: {
                        Ph.calendar.fill
                            .color(BKTheme.accent)
                            .frame(width: 48, height: 48)
                    },
                    preview: DailySharePreview(),
                    onContinue: { page = 2 }
                )
                .tag(1)
                ValuePropPage(
                    title: "9 game modes",
                    subtitle: "Wordle, Bingo, Grid, Career Path and more — all football, all interactive.",
                    icon: {
                        Ph.gameController.fill
                            .color(BKTheme.accent)
                            .frame(width: 48, height: 48)
                    },
                    preview: GameModesPreview(),
                    onContinue: { page = 3 }
                )
                .tag(2)
                SignInOnboardingPage()
                    .tag(3)
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
        }
    }
}

struct WelcomeOnboardingPage: View {
    var onContinue: () -> Void

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            ZStack {
                Circle()
                    .fill(BKTheme.accent.opacity(0.15))
                    .frame(width: 140, height: 140)
                Ph.soccerBall.fill
                    .color(BKTheme.accent)
                    .frame(width: 64, height: 64)
            }

            VStack(spacing: 12) {
                Text("BALL KNOWLEDGE")
                    .font(BKFont.title(32))
                    .foregroundStyle(BKTheme.accent)
                Text("Daily football puzzles.\nTest your ball knowledge.")
                    .font(BKFont.body(17))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(BKTheme.textSecondary)
            }

            Spacer()

            Button(action: onContinue) {
                Text("Get Started")
                    .font(BKFont.headline())
                    .foregroundStyle(BKTheme.background)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(BKTheme.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 48)
        }
    }
}

struct ValuePropPage<Preview: View, Icon: View>: View {
    let title: String
    let subtitle: String
    let preview: Preview
    var onContinue: () -> Void
    private let icon: Icon

    init(
        title: String,
        subtitle: String,
        @ViewBuilder icon: () -> Icon,
        preview: Preview,
        onContinue: @escaping () -> Void
    ) {
        self.title = title
        self.subtitle = subtitle
        self.icon = icon()
        self.preview = preview
        self.onContinue = onContinue
    }

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            icon

            VStack(spacing: 12) {
                Text(title)
                    .font(BKFont.title(26))
                    .foregroundStyle(BKTheme.textPrimary)
                Text(subtitle)
                    .font(BKFont.body())
                    .multilineTextAlignment(.center)
                    .foregroundStyle(BKTheme.textSecondary)
                    .padding(.horizontal, 32)
            }

            preview
                .padding(.horizontal, 24)

            Spacer()

            Button(action: onContinue) {
                Text("Continue")
                    .font(BKFont.headline())
                    .foregroundStyle(BKTheme.background)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(BKTheme.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 48)
        }
    }
}

struct DailySharePreview: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Ball Knowledge — Jun 16")
                .font(BKFont.caption())
                .foregroundStyle(BKTheme.textSecondary)
            Text("🟩🟩🟥🟩🟨🟩🟩")
                .font(.title2)
            Text("4/8  ·  🔥 Streak: 12")
                .font(BKFont.caption())
                .foregroundStyle(BKTheme.accent)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

struct GameModesPreview: View {
    let modes = ["Wordle", "Bingo", "Grid", "Career", "Stat", "XI", "Chain", "Geo", "Rank"]

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
            ForEach(modes, id: \.self) { mode in
                Text(mode)
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textPrimary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(BKTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }
        }
        .padding(.horizontal, 8)
    }
}

struct SignInOnboardingPage: View {
    @Environment(AuthManager.self) private var auth

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            VStack(spacing: 12) {
                Text("Create your account")
                    .font(BKFont.title(26))
                    .foregroundStyle(BKTheme.textPrimary)
                Text("Sign in to save your streak, XP and daily progress.")
                    .font(BKFont.body())
                    .multilineTextAlignment(.center)
                    .foregroundStyle(BKTheme.textSecondary)
                    .padding(.horizontal, 32)
            }

            VStack(spacing: 12) {
                SignInWithAppleButtonView { token, name in
                    Task { await auth.signIn(identityToken: token, displayName: name) }
                }
                .padding(.horizontal, 24)

                #if DEBUG
                Button("Dev Sign In") {
                    Task { await auth.devSignIn() }
                }
                .font(BKFont.caption())
                .foregroundStyle(BKTheme.textMuted)
                #endif

                if let error = auth.errorMessage {
                    Text(error)
                        .font(BKFont.caption())
                        .foregroundStyle(BKTheme.wrong)
                }
            }

            Link("Privacy Policy", destination: AppConfig.privacyPolicyURL)
                .font(BKFont.caption())
                .foregroundStyle(BKTheme.textMuted)

            Spacer()
            Spacer()
        }
    }
}
