import SwiftUI
import PhotosUI

struct OnboardingContainerView: View {
    @Environment(AuthManager.self) private var auth
    @State private var page = 0

    var body: some View {
        ZStack {
            HomeAmbientBackground()

            TabView(selection: $page) {
                WelcomeOnboardingPage(onContinue: { withAnimation(.easeInOut(duration: 0.28)) { page = 1 } })
                    .tag(0)
                DailyChallengeOnboardingPage(onContinue: { withAnimation(.easeInOut(duration: 0.28)) { page = 2 } })
                    .tag(1)
                GamesOnboardingPage(onContinue: { withAnimation(.easeInOut(duration: 0.28)) { page = 3 } })
                    .tag(2)
                SignInOnboardingPage()
                    .tag(3)
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
            .indexViewStyle(.page(backgroundDisplayMode: .always))
        }
    }
}

// MARK: - Shared chrome

private struct OnboardingPrimaryButton: View {
    let title: String
    var enabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(BKFont.headline(16))
                .foregroundStyle(enabled ? BKTheme.background : BKTheme.textMuted)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 18)
                .background(enabled ? BKTheme.accent : BKTheme.cardElevated)
                .clipShape(Capsule())
        }
        .disabled(!enabled)
        .padding(.horizontal, 24)
    }
}

private struct OnboardingTitleBlock: View {
    let eyebrow: String?
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 12) {
            if let eyebrow {
                Text(eyebrow.uppercased())
                    .font(BKFont.caption(11))
                    .tracking(1.6)
                    .foregroundStyle(BKTheme.accent)
            }
            Text(title)
                .font(BKFont.title(28))
                .foregroundStyle(BKTheme.textPrimary)
                .multilineTextAlignment(.center)
            Text(subtitle)
                .font(BKFont.body(15))
                .foregroundStyle(BKTheme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 8)
        }
        .padding(.horizontal, 28)
    }
}

// MARK: - Welcome

struct WelcomeOnboardingPage: View {
    var onContinue: () -> Void
    @State private var appeared = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)

            ZStack {
                Circle()
                    .fill(BKTheme.accent.opacity(0.12))
                    .frame(width: 260, height: 260)
                    .blur(radius: 40)

                GameModeBundleImage(name: "balllsss")
                    .scaledToFill()
                    .frame(width: 196, height: 196)
                    .clipShape(RoundedRectangle(cornerRadius: 36, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 36, style: .continuous)
                            .strokeBorder(BKTheme.accent.opacity(0.22), lineWidth: 1)
                    )
                    .shadow(color: BKTheme.accent.opacity(0.22), radius: 28, y: 10)
                    .scaleEffect(appeared ? 1 : 0.92)
                    .opacity(appeared ? 1 : 0)
            }
            .padding(.bottom, 36)

            VStack(spacing: 14) {
                Text("BALL KNOWLEDGE")
                    .font(BKFont.title(34))
                    .foregroundStyle(BKTheme.accent)
                    .tracking(0.5)
                Text("Daily football puzzles.\nProve your ball knowledge.")
                    .font(BKFont.body(16))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(BKTheme.textSecondary)
            }
            .opacity(appeared ? 1 : 0)
            .offset(y: appeared ? 0 : 12)

            Spacer(minLength: 32)

            OnboardingPrimaryButton(title: "GET STARTED", action: onContinue)
                .padding(.bottom, 56)
                .opacity(appeared ? 1 : 0)
        }
        .onAppear {
            withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) {
                appeared = true
            }
        }
    }
}

// MARK: - Daily challenge

struct DailyChallengeOnboardingPage: View {
    var onContinue: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 20)

            OnboardingTitleBlock(
                eyebrow: "Every day",
                title: "Same games.\nSame chance.",
                subtitle: "Seven fresh puzzles drop for everyone. Finish the set, bank XP, and keep your streak alive."
            )

            Spacer(minLength: 28)

            DailyChallengeHeroCard()
                .padding(.horizontal, 24)

            Spacer(minLength: 28)

            OnboardingPrimaryButton(title: "CONTINUE", action: onContinue)
                .padding(.bottom, 56)
        }
    }
}

private struct DailyChallengeHeroCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("TODAY")
                    .font(BKFont.caption(11))
                    .tracking(1.4)
                    .foregroundStyle(BKTheme.accent)
                Spacer()
                Text("Resets at midnight")
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textMuted)
            }

            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("7")
                    .font(BKFont.title(44))
                    .foregroundStyle(BKTheme.accent)
                Text("/ 7")
                    .font(BKFont.headline(18))
                    .foregroundStyle(BKTheme.textMuted)
                Text("games cleared")
                    .font(BKFont.body(14))
                    .foregroundStyle(BKTheme.textSecondary)
            }

            // Progress segments — matches the home daily hub vibe.
            HStack(spacing: 5) {
                ForEach(0..<7, id: \.self) { _ in
                    Capsule()
                        .fill(BKTheme.accent)
                        .frame(height: 6)
                }
            }

            HStack(spacing: 10) {
                OnboardingStatChip(
                    icon: { Ph.lightning.fill.color(BKTheme.accent).frame(width: 14, height: 14) },
                    value: "2,840",
                    label: "XP TODAY"
                )
                OnboardingStatChip(
                    icon: { Ph.fire.fill.color(BKTheme.streak).frame(width: 14, height: 14) },
                    value: "12",
                    label: "DAY STREAK"
                )
            }
        }
        .padding(22)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(BKTheme.accent.opacity(0.14), lineWidth: 1)
        )
    }
}

private struct OnboardingStatChip<Icon: View>: View {
    @ViewBuilder var icon: () -> Icon
    let value: String
    let label: String

    var body: some View {
        HStack(spacing: 10) {
            icon()
            VStack(alignment: .leading, spacing: 2) {
                Text(value)
                    .font(BKFont.headline(16))
                    .foregroundStyle(BKTheme.textPrimary)
                Text(label)
                    .font(BKFont.caption(10))
                    .tracking(1.0)
                    .foregroundStyle(BKTheme.textMuted)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
        .background(BKTheme.cardElevated)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

// MARK: - Games

struct GamesOnboardingPage: View {
    var onContinue: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 16)

            OnboardingTitleBlock(
                eyebrow: "The set",
                title: "7 daily games",
                subtitle: "Bingo, Draft XI, Club Chain, Last Man Standing and more — a new lineup every day."
            )

            Spacer(minLength: 22)

            GameModesPreview()
                .padding(.horizontal, 20)

            Spacer(minLength: 22)

            OnboardingPrimaryButton(title: "CONTINUE", action: onContinue)
                .padding(.bottom, 56)
        }
    }
}

struct GameModesPreview: View {
    private let modes = DailyPlayOrder.playableModes
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 3)

    var body: some View {
        LazyVGrid(columns: columns, spacing: 10) {
            ForEach(modes, id: \.rawValue) { mode in
                VStack(spacing: 8) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .fill(BKTheme.tileIconBackdrop)
                        GameModeBundleImage(name: mode.rawValue)
                            .scaledToFill()
                            .padding(8)
                    }
                    .frame(height: 88)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.06), lineWidth: 1)
                    )

                    Text(shortTitle(for: mode))
                        .font(BKFont.caption(10))
                        .tracking(0.6)
                        .foregroundStyle(BKTheme.textSecondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
        }
    }

    private func shortTitle(for mode: GameModeID) -> String {
        switch mode {
        case .footballBingo: return "BINGO"
        case .oneMore: return "ONE MORE"
        case .draftMaster: return "DRAFT XI"
        case .footballGolf: return "GOLF"
        case .clubChain: return "CHAIN"
        case .targetMan: return "TARGET"
        case .lastManStanding: return "LMS"
        default: return mode.title
        }
    }
}

// MARK: - Sign in

struct SignInOnboardingPage: View {
    @Environment(AuthManager.self) private var auth

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 28)

            ZStack {
                Circle()
                    .fill(BKTheme.accent.opacity(0.1))
                    .frame(width: 140, height: 140)
                    .blur(radius: 24)
                Ph.soccerBall.fill
                    .color(BKTheme.accent)
                    .frame(width: 56, height: 56)
            }
            .padding(.bottom, 28)

            OnboardingTitleBlock(
                eyebrow: "Almost there",
                title: "Create your account",
                subtitle: "Save your streak, XP and daily progress — then climb the leaderboards."
            )

            VStack(spacing: 12) {
                signInBenefit(icon: "flame.fill", tint: BKTheme.streak, text: "Protect your day streak")
                signInBenefit(icon: "bolt.fill", tint: BKTheme.accent, text: "Bank XP across all 7 games")
                signInBenefit(icon: "trophy.fill", tint: Color.yellow, text: "Show up on Overall & Teams")
            }
            .padding(.horizontal, 28)
            .padding(.top, 28)

            Spacer(minLength: 24)

            VStack(spacing: 14) {
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
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }

                Link("Privacy Policy", destination: AppConfig.privacyPolicyURL)
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textMuted)
            }
            .padding(.bottom, 48)
        }
    }

    private func signInBenefit(icon: String, tint: Color, text: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(tint)
                .frame(width: 36, height: 36)
                .background(BKTheme.cardElevated)
                .clipShape(Circle())
            Text(text)
                .font(BKFont.headline(14))
                .foregroundStyle(BKTheme.textPrimary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(BKTheme.card.opacity(0.72))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
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
