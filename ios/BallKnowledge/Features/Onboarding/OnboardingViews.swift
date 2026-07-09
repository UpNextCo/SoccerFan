import SwiftUI
import PhotosUI

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
            VStack(spacing: 8) {
                Text("Pick your club")
                    .font(BKFont.title(26))
                    .foregroundStyle(BKTheme.textPrimary)
                Text("Earn XP for your team and climb the club league against rival fans.")
                    .font(BKFont.body(14))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(BKTheme.textSecondary)
                    .padding(.horizontal, 32)
            }
            .padding(.top, 24)
            .padding(.bottom, 16)

            searchField
                .padding(.horizontal, 16)

            resultsList

            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BKTheme.background)
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
        .padding(.vertical, 12)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
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
            .padding(16)
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
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(isSelected ? BKTheme.accent : .clear, lineWidth: 1.5)
        )
    }

    private var footer: some View {
        VStack(spacing: 12) {
            Button(action: confirm) {
                Text(isSaving ? "Saving…" : "Continue")
                    .font(BKFont.headline())
                    .foregroundStyle(BKTheme.background)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(selected == nil ? BKTheme.cardElevated : BKTheme.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            }
            .disabled(selected == nil || isSaving)

            Button("Skip for now") { skip() }
                .font(BKFont.caption())
                .foregroundStyle(BKTheme.textMuted)
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 24)
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

// MARK: - Post sign-in setup (club → profile → reminders)

struct PostSignInSetupView: View {
    @Environment(AuthManager.self) private var auth
    @AppStorage(UserDefaultsKeys.completedPostSignInSetup) private var completedSetup = false

    enum Step { case club, profile, reminders }
    @State private var step: Step = .club

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()
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
            // Returning users who already have a club skip straight to profile.
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

struct ProfileSetupStep: View {
    @Environment(AuthManager.self) private var auth
    var onContinue: () -> Void

    @State private var name = ""
    @State private var avatarImage: UIImage?
    @State private var photoItem: PhotosPickerItem?
    @State private var showPhotoPicker = false

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                Text("Set up your profile")
                    .font(BKFont.title(26))
                    .foregroundStyle(BKTheme.textPrimary)
                Text("This is how you'll show up on the leaderboards.")
                    .font(BKFont.body(14))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(BKTheme.textSecondary)
                    .padding(.horizontal, 32)
            }
            .padding(.top, 24)

            Spacer()

            Button { showPhotoPicker = true } label: {
                ZStack(alignment: .bottomTrailing) {
                    Group {
                        if let avatarImage {
                            Image(uiImage: avatarImage).resizable().scaledToFill()
                        } else {
                            BKTheme.cardElevated.overlay {
                                Ph.userCircle.fill.color(BKTheme.accent).frame(width: 48, height: 48)
                            }
                        }
                    }
                    .frame(width: 110, height: 110)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(BKTheme.accent.opacity(0.4), lineWidth: 2))

                    Circle().fill(BKTheme.accent).frame(width: 34, height: 34)
                        .overlay { Image(systemName: "camera.fill").font(.system(size: 14, weight: .bold)).foregroundStyle(BKTheme.background) }
                        .overlay(Circle().stroke(BKTheme.background, lineWidth: 3))
                }
            }
            .buttonStyle(.plain)

            TextField("Your name", text: $name)
                .font(BKFont.headline(17))
                .foregroundStyle(BKTheme.textPrimary)
                .multilineTextAlignment(.center)
                .padding(.vertical, 14)
                .padding(.horizontal, 16)
                .background(BKTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .padding(.horizontal, 40)
                .padding(.top, 24)

            Spacer()
            Spacer()

            Button(action: save) {
                Text("Continue")
                    .font(BKFont.headline())
                    .foregroundStyle(BKTheme.background)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(BKTheme.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            }
            .padding(.horizontal, 24)
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
                    LocalProfile.saveAvatar(data)
                    avatarImage = image
                }
            }
        }
    }

    private func save() {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty, trimmed != auth.user?.displayName {
            LocalProfile.nameOverride = trimmed
        }
        onContinue()
    }
}

struct ReminderSetupStep: View {
    var onFinish: () -> Void
    @State private var isWorking = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            ZStack {
                Circle().fill(BKTheme.accent.opacity(0.15)).frame(width: 130, height: 130)
                Image(systemName: "bell.badge.fill")
                    .font(.system(size: 52, weight: .bold))
                    .foregroundStyle(BKTheme.accent)
            }

            VStack(spacing: 12) {
                Text("Never lose your streak")
                    .font(BKFont.title(26))
                    .foregroundStyle(BKTheme.textPrimary)
                Text("Get a daily nudge when your games are ready — finish all 7 to keep your streak.")
                    .font(BKFont.body(15))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(BKTheme.textSecondary)
                    .padding(.horizontal, 32)
            }
            .padding(.top, 28)

            Spacer()
            Spacer()

            VStack(spacing: 12) {
                Button(action: enable) {
                    Text(isWorking ? "…" : "Turn on reminders")
                        .font(BKFont.headline())
                        .foregroundStyle(BKTheme.background)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(BKTheme.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                }
                .disabled(isWorking)

                Button("Not now") { onFinish() }
                    .font(BKFont.caption())
                    .foregroundStyle(BKTheme.textMuted)
            }
            .padding(.horizontal, 24)
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

struct WelcomeOnboardingPage: View {
    var onContinue: () -> Void

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            GameModeBundleImage(name: "balllsss")
                .scaledToFill()
                .frame(width: 200, height: 200)
                .clipShape(RoundedRectangle(cornerRadius: 28))

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
    private let tiles = [
        "guess_who", "football_bingo", "draft_master",
        "blind_rank", "one_more", "football_golf",
        "world_cup_xi", "target_man", "football_tower",
    ]

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 3)

    var body: some View {
        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(tiles, id: \.self) { tile in
                GameModeBundleImage(name: tile)
                    .scaledToFill()
                    .frame(height: 72)
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
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
