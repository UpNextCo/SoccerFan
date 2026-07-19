import SwiftUI
import PhotosUI
import StoreKit
import UserNotifications
import UIKit

enum AppTab: Hashable {
    case today, leagues, you
}

struct MainTabView: View {
    @State private var selectedTab: AppTab = .today

    var body: some View {
        ZStack(alignment: .bottom) {
            Group {
                switch selectedTab {
                case .today:
                    HomeView(selectedTab: $selectedTab)
                case .leagues:
                    LeaguesTabView()
                case .you:
                    ProfileTabView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            bottomFadeLayer

            BKTabBar(selection: $selectedTab)
        }
        .background(BKTheme.background.ignoresSafeArea())
    }

    private var bottomFadeLayer: some View {
        GeometryReader { geo in
            let safeBottom = resolvedBottomInset(from: geo)

            VStack(spacing: 0) {
                Spacer(minLength: 0)
                tabBarBottomFade(safeBottom: safeBottom)
            }
        }
        .ignoresSafeArea(edges: .bottom)
        .allowsHitTesting(false)
    }

    private func resolvedBottomInset(from geo: GeometryProxy) -> CGFloat {
        let fromGeo = geo.safeAreaInsets.bottom
        if fromGeo > 0 { return fromGeo }
        return Self.uiKitBottomInset()
    }

    private func tabBarBottomFade(safeBottom: CGFloat) -> some View {
        let fadeHeight: CGFloat = 130 + safeBottom

        return LinearGradient(
            stops: [
                .init(color: .clear, location: 0),
                .init(color: BKTheme.background.opacity(0.18), location: 0.28),
                .init(color: BKTheme.background.opacity(0.52), location: 0.58),
                .init(color: BKTheme.background.opacity(0.82), location: 0.8),
                .init(color: BKTheme.background, location: 1),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .frame(height: fadeHeight)
        .frame(maxWidth: .infinity)
    }

    private static func uiKitBottomInset() -> CGFloat {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?
            .safeAreaInsets.bottom ?? 0
    }
}

enum LeagueScope: String, CaseIterable, Identifiable {
    case overall = "Overall"
    case teams = "Teams"
    var id: String { rawValue }
}

@MainActor
@Observable
final class LeaguesViewModel {
    var players: [PlayerStandingDTO] = []
    var teams: [TeamStandingDTO] = []
    var caption: String = ""
    var isLoading = false
    var loadedScope: LeagueScope?

    func load(_ scope: LeagueScope) async {
        isLoading = true
        defer { isLoading = false }
        do {
            switch scope {
            case .overall:
                let result = try await APIClient.shared.leaguesOverall()
                players = result.standings
                teams = []
                caption = "All-time XP leaders"
            case .teams:
                let result = try await APIClient.shared.leaguesTeams()
                teams = result.standings
                players = []
                caption = "Clubs ranked by combined XP of their fans"
            }
            loadedScope = scope
        } catch {
            players = []
            teams = []
            caption = ""
            loadedScope = scope
        }
    }
}

struct LeaguesTabView: View {
    @Environment(AuthManager.self) private var auth
    @State private var scope: LeagueScope = .overall
    @State private var viewModel = LeaguesViewModel()

    var body: some View {
        VStack(spacing: 14) {
            Picker("League", selection: $scope) {
                ForEach(LeagueScope.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.top, 8)

            if !viewModel.caption.isEmpty {
                Text(viewModel.caption)
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textMuted)
            }

            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(BKTheme.background)
        .task(id: scope) { await viewModel.load(scope) }
    }

    @ViewBuilder
    private var content: some View {
        if viewModel.isLoading && viewModel.loadedScope != scope {
            Spacer()
            ProgressView().tint(BKTheme.accent)
            Spacer()
        } else if scope == .teams {
            if viewModel.teams.isEmpty {
                emptyState(
                    icon: "shield.lefthalf.filled",
                    title: "No clubs ranked yet",
                    message: "Pick the team you support, then earn XP to put them on the table."
                )
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 8) {
                        ForEach(viewModel.teams) { team in
                            ExpandableTeamStandingRow(
                                team: team,
                                currentUserId: auth.user?.id
                            )
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, BKTabBar.scrollClearance)
                }
            }
        } else {
            if viewModel.players.isEmpty {
                emptyState(
                    icon: "trophy.fill",
                    title: "No standings yet",
                    message: "Play today's games to earn XP and climb the leaderboard."
                )
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 8) {
                        ForEach(viewModel.players) { player in
                            PlayerStandingRow(
                                player: player,
                                isCurrentUser: player.userId == auth.user?.id
                            )
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, BKTabBar.scrollClearance)
                }
            }
        }
    }

    private func emptyState(icon: String, title: String, message: String) -> some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: icon)
                .font(.system(size: 44, weight: .bold))
                .foregroundStyle(BKTheme.accent)
            Text(title)
                .font(BKFont.headline(18))
                .foregroundStyle(BKTheme.textPrimary)
            Text(message)
                .font(BKFont.body(14))
                .multilineTextAlignment(.center)
                .foregroundStyle(BKTheme.textSecondary)
                .padding(.horizontal, 40)
            Spacer()
            Spacer()
        }
    }
}

struct PlayerStandingRow: View {
    let player: PlayerStandingDTO
    var isCurrentUser = false

    var body: some View {
        HStack(spacing: 12) {
            Text("\(player.rank)")
                .font(.system(size: 15, weight: .black, design: .rounded))
                .foregroundStyle(player.rank <= 3 ? BKTheme.accent : BKTheme.textMuted)
                .frame(width: 28, alignment: .center)

            avatarView
                .frame(width: 36, height: 36)
                .clipShape(Circle())

            Text(nameText)
                .font(BKFont.headline(15))
                .foregroundStyle(BKTheme.textPrimary)
                .lineLimit(1)

            Spacer(minLength: 8)

            HStack(spacing: 4) {
                Image(systemName: "bolt.fill")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(BKTheme.accent)
                Text("\(player.xp)")
                    .font(BKFont.headline(14))
                    .foregroundStyle(BKTheme.textPrimary)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(isCurrentUser ? BKTheme.cardElevated : BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(isCurrentUser ? BKTheme.accent.opacity(0.6) : .clear, lineWidth: 1.5)
        )
    }

    @ViewBuilder
    private var avatarView: some View {
        if isCurrentUser, let image = LocalProfile.loadAvatar() {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
        } else {
            PlayerAvatar(urlString: player.avatarUrl, size: 36) {
                BKTheme.cardElevated
                    .overlay {
                        Ph.userCircle.fill
                            .color(BKTheme.accent)
                            .frame(width: 22, height: 22)
                    }
            }
        }
    }

    private var nameText: String {
        let base = isCurrentUser ? (LocalProfile.nameOverride ?? player.displayName) : player.displayName
        return isCurrentUser ? "\(base) (You)" : base
    }
}

struct ExpandableTeamStandingRow: View {
    let team: TeamStandingDTO
    var currentUserId: String?

    @State private var isExpanded = false
    @State private var fans: [PlayerStandingDTO] = []
    @State private var isLoadingFans = false
    @State private var didLoadFans = false

    var body: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.22)) {
                    isExpanded.toggle()
                }
                if isExpanded, !didLoadFans {
                    Task { await loadFans() }
                }
            } label: {
                TeamStandingRow(team: team, showsChevron: true, isExpanded: isExpanded)
            }
            .buttonStyle(.plain)

            if isExpanded {
                VStack(spacing: 6) {
                    if isLoadingFans && fans.isEmpty {
                        ProgressView()
                            .tint(BKTheme.accent)
                            .padding(.vertical, 12)
                    } else if fans.isEmpty {
                        Text("No fans yet")
                            .font(BKFont.caption(11))
                            .foregroundStyle(BKTheme.textMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                    } else {
                        ForEach(fans) { player in
                            TeamFanRow(
                                player: player,
                                isCurrentUser: player.userId == currentUserId
                            )
                        }
                    }
                }
                .padding(.top, 6)
                .padding(.bottom, 4)
                .padding(.leading, 12)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(6)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func loadFans() async {
        isLoadingFans = true
        defer { isLoadingFans = false }
        do {
            let result = try await APIClient.shared.leagueTeamFans(teamId: team.teamId)
            fans = result.standings
            didLoadFans = true
        } catch {
            fans = []
            didLoadFans = false
        }
    }
}

struct TeamStandingRow: View {
    let team: TeamStandingDTO
    var showsChevron = false
    var isExpanded = false

    var body: some View {
        HStack(spacing: 12) {
            Text("\(team.rank)")
                .font(.system(size: 15, weight: .black, design: .rounded))
                .foregroundStyle(team.rank <= 3 ? BKTheme.accent : BKTheme.textMuted)
                .frame(width: 28, alignment: .center)

            AsyncImage(url: URL(string: team.logoUrl ?? "")) { image in
                image.resizable().scaledToFit()
            } placeholder: {
                Image(systemName: "shield.fill").foregroundStyle(BKTheme.textMuted)
            }
            .frame(width: 32, height: 32)

            VStack(alignment: .leading, spacing: 2) {
                Text(team.name)
                    .font(BKFont.headline(15))
                    .foregroundStyle(BKTheme.textPrimary)
                    .lineLimit(1)
                Text("\(team.members) \(team.members == 1 ? "fan" : "fans")")
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.textMuted)
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 2) {
                HStack(spacing: 4) {
                    Image(systemName: "bolt.fill")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(BKTheme.accent)
                    Text("\(team.totalXp)")
                        .font(BKFont.headline(15))
                        .foregroundStyle(BKTheme.textPrimary)
                }
                Text("total XP")
                    .font(BKFont.caption(9))
                    .foregroundStyle(BKTheme.textMuted)
            }

            if showsChevron {
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(BKTheme.textMuted)
                    .rotationEffect(.degrees(isExpanded ? 180 : 0))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}

private struct TeamFanRow: View {
    let player: PlayerStandingDTO
    var isCurrentUser = false

    private var displayName: String {
        let base = isCurrentUser ? (LocalProfile.nameOverride ?? player.displayName) : player.displayName
        return isCurrentUser ? "\(base) (You)" : base
    }

    var body: some View {
        HStack(spacing: 10) {
            Text("\(player.rank)")
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundStyle(BKTheme.textMuted)
                .frame(width: 22, alignment: .center)

            Group {
                if isCurrentUser, let image = LocalProfile.loadAvatar() {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                } else {
                    PlayerAvatar(urlString: player.avatarUrl, size: 28) {
                        BKTheme.cardElevated
                            .overlay {
                                Ph.userCircle.fill
                                    .color(BKTheme.accent)
                                    .frame(width: 16, height: 16)
                            }
                    }
                }
            }
            .frame(width: 28, height: 28)
            .clipShape(Circle())

            Text(displayName)
                .font(BKFont.headline(13))
                .foregroundStyle(BKTheme.textPrimary)
                .lineLimit(1)

            Spacer(minLength: 6)

            HStack(spacing: 3) {
                Image(systemName: "bolt.fill")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(BKTheme.accent)
                Text("\(player.xp)")
                    .font(BKFont.headline(13))
                    .foregroundStyle(BKTheme.textPrimary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(isCurrentUser ? BKTheme.cardElevated : BKTheme.background.opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - Local profile (client-side avatar + name override + prefs)

/// Avatar image, display-name override and reminder preference are stored on-device for snappy UI,
/// and synced to the server so leagues can show real names/photos to other players.
enum LocalProfile {
    private static let nameKey = "profile.displayNameOverride"
    private static let remindersKey = "profile.dailyRemindersOn"

    private static var avatarURL: URL {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("profile-avatar.jpg")
    }

    static func loadAvatar() -> UIImage? {
        guard let data = try? Data(contentsOf: avatarURL) else { return nil }
        return UIImage(data: data)
    }

    static func saveAvatar(_ data: Data) {
        let jpeg = compressAvatar(data) ?? data
        try? jpeg.write(to: avatarURL, options: .atomic)
    }

    static func removeAvatar() {
        try? FileManager.default.removeItem(at: avatarURL)
    }

    /// JPEG bytes ready to upload (resized / re-compressed).
    static func avatarUploadData() -> Data? {
        guard let data = try? Data(contentsOf: avatarURL) else { return nil }
        return compressAvatar(data) ?? data
    }

    static var nameOverride: String? {
        get {
            let value = UserDefaults.standard.string(forKey: nameKey)?.trimmingCharacters(in: .whitespacesAndNewlines)
            return (value?.isEmpty == false) ? value : nil
        }
        set { UserDefaults.standard.set(newValue, forKey: nameKey) }
    }

    static var remindersOn: Bool {
        get { UserDefaults.standard.bool(forKey: remindersKey) }
        set { UserDefaults.standard.set(newValue, forKey: remindersKey) }
    }

    /// Clear on-device profile (avatar + name override) so it doesn't carry over to the next account.
    static func reset() {
        removeAvatar()
        UserDefaults.standard.removeObject(forKey: nameKey)
    }

    /// Downscale to ≤256px and JPEG-compress for upload / local storage.
    private static func compressAvatar(_ data: Data, maxSide: CGFloat = 256, quality: CGFloat = 0.72) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        let longest = max(image.size.width, image.size.height)
        let scale = longest > maxSide ? maxSide / longest : 1
        let size = CGSize(width: max(1, image.size.width * scale), height: max(1, image.size.height * scale))
        let renderer = UIGraphicsImageRenderer(size: size)
        let resized = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        return resized.jpegData(compressionQuality: quality)
    }
}

/// Pushes local name/avatar up to the server when the device has newer profile data.
enum ProfileSync {
    @MainActor
    static func pushLocalToServer(auth: AuthManager) async {
        guard auth.isAuthenticated else { return }

        if let localName = LocalProfile.nameOverride,
           !localName.isEmpty,
           localName != auth.user?.displayName {
            if let updated = try? await APIClient.shared.updateDisplayName(localName) {
                auth.applyProfile(updated)
            }
        }

        if let jpeg = LocalProfile.avatarUploadData(), auth.user?.avatarUrl == nil {
            if let updated = try? await APIClient.shared.uploadAvatar(jpegData: jpeg) {
                auth.applyProfile(updated)
            }
        } else if LocalProfile.loadAvatar() == nil {
            await restoreRemoteAvatar(auth: auth)
        }
    }

    @MainActor
    static func saveName(_ name: String, auth: AuthManager) async {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        LocalProfile.nameOverride = trimmed
        if let updated = try? await APIClient.shared.updateDisplayName(trimmed) {
            auth.applyProfile(updated)
        }
    }

    @MainActor
    static func saveAvatarImage(_ image: UIImage, auth: AuthManager) async {
        guard let data = image.jpegData(compressionQuality: 0.9) else { return }
        LocalProfile.saveAvatar(data)
        guard let jpeg = LocalProfile.avatarUploadData() else { return }
        do {
            auth.applyProfile(try await APIClient.shared.uploadAvatar(jpegData: jpeg))
        } catch {
            auth.errorMessage = "Your photo was saved on this device but couldn't be backed up. Please try again."
        }
    }

    @MainActor
    static func removeAvatar(auth: AuthManager) async {
        LocalProfile.removeAvatar()
        do {
            auth.applyProfile(try await APIClient.shared.clearAvatar())
        } catch {
            auth.errorMessage = "Your profile photo couldn't be removed from your account. Please try again."
        }
    }

    @MainActor
    private static func restoreRemoteAvatar(auth: AuthManager) async {
        guard let urlString = auth.user?.avatarUrl, let url = URL(string: urlString) else { return }
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        guard
            let (data, response) = try? await URLSession.shared.data(for: request),
            let http = response as? HTTPURLResponse,
            (200..<300).contains(http.statusCode),
            UIImage(data: data) != nil
        else { return }
        LocalProfile.saveAvatar(data)
    }
}

/// Self-contained local daily reminder (no backend / push infra needed).
enum DailyReminder {
    private static let legacyIdentifier = "daily-games-reminder"
    private static let identifierPrefix = "daily-games-reminder-"
    private static let reminderHour = 19

    static func enable() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        guard granted else { return false }
        await scheduleRolling(completedCount: 0, totalCount: DailyPlayOrder.playableModes.count)
        return true
    }

    static func refresh(for bundle: DailyBundleDTO, modes: [GameModeMetaDTO]) async {
        guard LocalProfile.remindersOn else { return }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard settings.authorizationStatus == .authorized ||
                settings.authorizationStatus == .provisional ||
                settings.authorizationStatus == .ephemeral else { return }

        let enabledIds = Set(
            modes
                .filter(\.isAvailable)
                .map { GameModeCatalog.normalizedModeId($0.id) }
        )
        let availableModes = DailyPlayOrder.availableModes(in: bundle).filter {
            enabledIds.isEmpty || enabledIds.contains($0.rawValue)
        }
        let completedCount = availableModes.filter { bundle.isCompleted($0) }.count
        await scheduleRolling(
            completedCount: completedCount,
            totalCount: availableModes.count
        )
    }

    static func disable() {
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
    }

    private static func scheduleRolling(completedCount: Int, totalCount: Int) async {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        let ourIdentifiers = pending
            .map(\.identifier)
            .filter { $0 == legacyIdentifier || $0.hasPrefix(identifierPrefix) }
        center.removePendingNotificationRequests(withIdentifiers: ourIdentifiers)

        let calendar = Calendar.current
        let now = Date()
        let startOfToday = calendar.startOfDay(for: now)
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"

        for dayOffset in 0..<7 {
            guard let day = calendar.date(byAdding: .day, value: dayOffset, to: startOfToday),
                  let fireDate = calendar.date(
                    bySettingHour: reminderHour,
                    minute: 0,
                    second: 0,
                    of: day
                  ),
                  fireDate > now else { continue }

            // Once today's set is complete, do not send another notification today.
            if dayOffset == 0, totalCount > 0, completedCount >= totalCount {
                continue
            }

            let content = UNMutableNotificationContent()
            if dayOffset == 0, completedCount > 0 {
                content.title = "Finish today's games"
                content.body = "Finish your games to keep your daily streak alive."
            } else {
                let count = totalCount > 0 ? totalCount : DailyPlayOrder.playableModes.count
                content.title = "Your \(count) daily games are ready"
                content.body = "Play today's set and keep your daily streak alive."
            }
            content.sound = .default

            let components = calendar.dateComponents(
                [.year, .month, .day, .hour, .minute],
                from: fireDate
            )
            let request = UNNotificationRequest(
                identifier: identifierPrefix + formatter.string(from: day),
                content: content,
                trigger: UNCalendarNotificationTrigger(
                    dateMatching: components,
                    repeats: false
                )
            )
            try? await center.add(request)
        }
    }
}

struct ProfileTabView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(\.requestReview) private var requestReview
    @Environment(\.modelContext) private var modelContext

    @State private var avatarImage: UIImage?
    @State private var photoItem: PhotosPickerItem?
    @State private var showPhotoPicker = false
    @State private var showAvatarOptions = false
    @State private var showEditName = false
    @State private var draftName = ""
    @State private var remindersOn = LocalProfile.remindersOn
    @State private var showSignOutConfirm = false
    @State private var showDeleteConfirm = false
    @State private var showIntrosResetAlert = false
    @State private var xpBreakdownScope: ProfileXpScope?

    private var displayName: String {
        LocalProfile.nameOverride ?? auth.user?.displayName ?? "Player"
    }

    private var initials: String {
        let parts = displayName.split(separator: " ")
        let letters = parts.prefix(2).compactMap { $0.first.map(String.init) }.joined()
        return letters.isEmpty ? "BK" : letters.uppercased()
    }

    private var currentXp: Int { auth.user?.xp ?? 0 }
    private var rankProgress: PlayerRankProgress { PlayerRank.progress(for: currentXp) }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 20) {
                header
                    .padding(.top, 28)
                statsCard
                accountSection
                aboutSection
                dangerSection
                versionLabel
            }
            .padding(.horizontal, 16)
            .padding(.bottom, BKTabBar.scrollClearance)
        }
        .background(BKTheme.background)
        .onAppear { avatarImage = LocalProfile.loadAvatar() }
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
        .confirmationDialog("Profile photo", isPresented: $showAvatarOptions, titleVisibility: .visible) {
            Button("Choose Photo") { showPhotoPicker = true }
            if avatarImage != nil {
                Button("Remove Photo", role: .destructive) {
                    Task {
                        await ProfileSync.removeAvatar(auth: auth)
                        avatarImage = nil
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Edit name", isPresented: $showEditName) {
            TextField("Display name", text: $draftName)
            Button("Save") {
                Task { await ProfileSync.saveName(draftName, auth: auth) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This name shows on your profile and leagues.")
        }
        .alert("How-to-play screens restored", isPresented: $showIntrosResetAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("The intro will show again the next time you open each game.")
        }
        .alert(
            "Something went wrong",
            isPresented: Binding(
                get: { auth.errorMessage != nil },
                set: { if !$0 { auth.errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { auth.errorMessage = nil }
        } message: {
            Text(auth.errorMessage ?? "Please try again.")
        }
        .confirmationDialog("Sign out of Ball Knowledge?", isPresented: $showSignOutConfirm, titleVisibility: .visible) {
            Button("Sign Out", role: .destructive) {
                Task { await auth.signOut(context: modelContext) }
            }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Delete your account? This can't be undone.", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("Delete Account", role: .destructive) {
                Task { await auth.deleteAccount(context: modelContext) }
            }
            Button("Cancel", role: .cancel) {}
        }
        .sheet(item: $xpBreakdownScope) { scope in
            ProfileXpBreakdownView(
                scope: scope,
                headerTotal: scope == .total ? (auth.user?.xp ?? 0) : (auth.user?.todayXp ?? 0)
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(spacing: 14) {
            Button { showAvatarOptions = true } label: {
                ZStack(alignment: .bottomTrailing) {
                    avatarView
                    Circle()
                        .fill(BKTheme.accent)
                        .frame(width: 30, height: 30)
                        .overlay {
                            Image(systemName: "camera.fill")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(BKTheme.background)
                        }
                        .overlay(Circle().stroke(BKTheme.background, lineWidth: 3))
                }
            }
            .buttonStyle(.plain)

            VStack(spacing: 10) {
                Button {
                    draftName = displayName
                    showEditName = true
                } label: {
                    HStack(spacing: 6) {
                        Text(displayName)
                            .font(BKFont.title(24))
                            .foregroundStyle(BKTheme.textPrimary)
                        Image(systemName: "pencil")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(BKTheme.textMuted)
                    }
                }
                .buttonStyle(.plain)

                Text("\(rankProgress.emoji)  \(rankProgress.title)")
                    .font(BKFont.headline(15))
                    .foregroundStyle(BKTheme.textPrimary)
                    .padding(.bottom, 4)

                VStack(spacing: 7) {
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            Capsule()
                                .fill(BKTheme.cardElevated)
                            Capsule()
                                .fill(BKTheme.accent)
                                .frame(width: geometry.size.width * rankProgress.fraction(at: currentXp))
                        }
                    }
                    .frame(height: 6)

                    HStack {
                        Text("\(currentXp.formatted()) XP")
                        Spacer()
                        if let remaining = rankProgress.remaining(at: currentXp),
                           let nextEmoji = rankProgress.nextEmoji,
                           let nextTitle = rankProgress.nextTitle {
                            Text("\(remaining.formatted()) XP to \(nextEmoji) \(nextTitle)")
                        } else {
                            Text("Top rank reached")
                        }
                    }
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.textMuted)
                }
                .frame(maxWidth: 250)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    private var avatarView: some View {
        Group {
            if let avatarImage {
                Image(uiImage: avatarImage)
                    .resizable()
                    .scaledToFill()
            } else {
                PlayerAvatar(urlString: auth.user?.avatarUrl, size: 96) {
                    LinearGradient(
                        colors: [BKTheme.cardElevated, BKTheme.card],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    .overlay {
                        Text(initials)
                            .font(.system(size: 34, weight: .black, design: .rounded))
                            .foregroundStyle(BKTheme.accent)
                    }
                }
            }
        }
        .frame(width: 96, height: 96)
        .clipShape(Circle())
        .overlay(Circle().stroke(BKTheme.accent.opacity(0.4), lineWidth: 2))
    }

    // MARK: Stats

    private var statsCard: some View {
        HStack(spacing: 0) {
            Button {
                xpBreakdownScope = .total
            } label: {
                stat(value: "\(auth.user?.xp ?? 0)", label: "TOTAL XP", icon: "bolt.fill", tint: BKTheme.accent)
            }
            .buttonStyle(.plain)

            divider

            stat(value: "\(auth.user?.streak ?? 0)", label: "DAY STREAK", icon: "flame.fill", tint: BKTheme.streak)

            divider

            Button {
                xpBreakdownScope = .today
            } label: {
                stat(value: "\(auth.user?.todayXp ?? 0)", label: "XP TODAY", icon: "calendar", tint: BKTheme.textPrimary)
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 18)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }

    private func stat(value: String, label: String, icon: String, tint: Color) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(tint)
            Text(value)
                .font(.system(size: 20, weight: .black, design: .rounded))
                .foregroundStyle(BKTheme.textPrimary)
            Text(label)
                .font(BKFont.caption(9))
                .foregroundStyle(BKTheme.textMuted)
        }
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
    }

    private var divider: some View {
        Rectangle().fill(BKTheme.cardElevated).frame(width: 1, height: 40)
    }

    // MARK: Sections

    private var accountSection: some View {
        settingsCard(title: "ACCOUNT") {
            SettingsRow(icon: "person.fill", title: "Edit name") {
                draftName = displayName
                showEditName = true
            }
            rowDivider
            SettingsRow(icon: "photo.fill", title: "Change photo") {
                showAvatarOptions = true
            }
            rowDivider
            SettingsToggleRow(
                icon: "bell.badge.fill",
                title: "Daily reminder",
                isOn: $remindersOn
            )
            .onChange(of: remindersOn) { _, isOn in
                Task {
                    if isOn {
                        let granted = await DailyReminder.enable()
                        remindersOn = granted
                        LocalProfile.remindersOn = granted
                    } else {
                        DailyReminder.disable()
                        LocalProfile.remindersOn = false
                    }
                }
            }
            rowDivider
            SettingsRow(icon: "questionmark.circle.fill", title: "Show game intros again") {
                GameIntroPreferences.reset()
                showIntrosResetAlert = true
            }
        }
    }

    private var aboutSection: some View {
        settingsCard(title: "ABOUT") {
            SettingsRow(icon: "star.fill", title: "Rate Ball Knowledge") {
                requestReview()
            }
            rowDivider
            shareRow
            rowDivider
            SettingsLinkRow(icon: "lock.shield.fill", title: "Privacy Policy", url: AppConfig.privacyPolicyURL)
            rowDivider
            SettingsLinkRow(icon: "doc.text.fill", title: "Terms of Service", url: AppConfig.termsOfServiceURL)
        }
    }

    private var shareRow: some View {
        ShareLink(item: AppConfig.shareURL) {
            SettingsRowLabel(icon: "square.and.arrow.up.fill", title: "Share with friends")
        }
        .buttonStyle(.plain)
    }

    private var dangerSection: some View {
        VStack(spacing: 12) {
            Button { showSignOutConfirm = true } label: {
                Text("Sign Out")
                    .font(BKFont.headline(15))
                    .foregroundStyle(BKTheme.textPrimary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                    .background(BKTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)

            Button { showDeleteConfirm = true } label: {
                Text("Delete Account")
                    .font(BKFont.body(14))
                    .foregroundStyle(BKTheme.wrong)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.plain)

            #if DEBUG
            Button("Reset onboarding (dev)") {
                UserDefaults.standard.removeObject(forKey: UserDefaultsKeys.hasCompletedOnboarding)
                Task { await auth.signOut(context: modelContext) }
            }
            .font(BKFont.caption())
            .foregroundStyle(BKTheme.textMuted)
            #endif
        }
    }

    private var versionLabel: some View {
        Text("Ball Knowledge \(appVersion)")
            .font(BKFont.caption(11))
            .foregroundStyle(BKTheme.textMuted)
            .padding(.top, 4)
    }

    // MARK: Helpers

    @ViewBuilder
    private func settingsCard<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(BKFont.caption(11))
                .foregroundStyle(BKTheme.textMuted)
                .padding(.leading, 4)
                .padding(.bottom, 8)
            VStack(spacing: 0) { content() }
                .background(BKTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 16))
        }
    }

    private var rowDivider: some View {
        Rectangle().fill(BKTheme.cardElevated).frame(height: 1).padding(.leading, 52)
    }

    private var appVersion: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "v\(v) (\(b))"
    }

}

// MARK: - Settings rows

private struct SettingsRowLabel: View {
    let icon: String
    let title: String
    var trailing: String?

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(BKTheme.accent)
                .frame(width: 24)
            Text(title)
                .font(BKFont.body(15))
                .foregroundStyle(BKTheme.textPrimary)
            Spacer()
            if let trailing {
                Text(trailing)
                    .font(BKFont.body(14))
                    .foregroundStyle(BKTheme.textMuted)
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(BKTheme.textMuted)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
        .contentShape(Rectangle())
    }
}

private struct SettingsRow: View {
    let icon: String
    let title: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            SettingsRowLabel(icon: icon, title: title)
        }
        .buttonStyle(.plain)
    }
}

private struct SettingsLinkRow: View {
    let icon: String
    let title: String
    let url: URL

    var body: some View {
        Link(destination: url) {
            SettingsRowLabel(icon: icon, title: title)
        }
        .buttonStyle(.plain)
    }
}

private struct SettingsToggleRow: View {
    let icon: String
    let title: String
    @Binding var isOn: Bool

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(BKTheme.accent)
                .frame(width: 24)
            Text(title)
                .font(BKFont.body(15))
                .foregroundStyle(BKTheme.textPrimary)
            Spacer()
            Toggle("", isOn: $isOn)
                .labelsHidden()
                .tint(BKTheme.accent)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }
}
