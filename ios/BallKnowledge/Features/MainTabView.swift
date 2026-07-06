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
    case me = "My League"
    case teams = "Teams"
    case overall = "Overall"
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
            case .me:
                let result = try await APIClient.shared.leaguesMe()
                players = result.standings
                caption = "Top 5 promote · bottom 5 drop · resets Monday"
            case .teams:
                let result = try await APIClient.shared.leaguesTeams()
                teams = result.standings
                caption = "Ranked by average XP per fan this week"
            case .overall:
                let result = try await APIClient.shared.leaguesOverall()
                players = result.standings
                caption = "All-time XP leaders"
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
    @State private var scope: LeagueScope = .me
    @State private var viewModel = LeaguesViewModel()

    private var cohortSize: Int { viewModel.players.count }

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
                        ForEach(viewModel.teams) { TeamStandingRow(team: $0) }
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
                    message: "Play today's games to join this week's league and climb the table."
                )
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 8) {
                        ForEach(viewModel.players) { player in
                            PlayerStandingRow(
                                player: player,
                                isCurrentUser: player.userId == auth.user?.id,
                                zone: scope == .me ? zone(for: player.rank) : .none
                            )
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, BKTabBar.scrollClearance)
                }
            }
        }
    }

    private func zone(for rank: Int) -> StandingZone {
        guard cohortSize >= 12 else { return .none }
        if rank <= 5 { return .promotion }
        if rank > cohortSize - 5 { return .relegation }
        return .none
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

enum StandingZone {
    case promotion, relegation, none
}

struct PlayerStandingRow: View {
    let player: PlayerStandingDTO
    var isCurrentUser = false
    var zone: StandingZone = .none

    private var zoneColor: Color {
        switch zone {
        case .promotion: return BKTheme.accent
        case .relegation: return BKTheme.wrong
        case .none: return BKTheme.textMuted
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            Text("\(player.rank)")
                .font(.system(size: 15, weight: .black, design: .rounded))
                .foregroundStyle(zoneColor)
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
            BKTheme.cardElevated
                .overlay {
                    Ph.userCircle.fill
                        .color(BKTheme.accent)
                        .frame(width: 22, height: 22)
                }
        }
    }

    private var nameText: String {
        let base = isCurrentUser ? (LocalProfile.nameOverride ?? player.displayName) : player.displayName
        return isCurrentUser ? "\(base) (You)" : base
    }
}

struct TeamStandingRow: View {
    let team: TeamStandingDTO

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
                Text("\(Int(team.score))")
                    .font(BKFont.headline(15))
                    .foregroundStyle(BKTheme.textPrimary)
                Text("avg XP")
                    .font(BKFont.caption(9))
                    .foregroundStyle(BKTheme.textMuted)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

// MARK: - Local profile (client-side avatar + name override + prefs)

/// Avatar image, display-name override and reminder preference are stored on-device
/// (no backend endpoint exists yet for profile edits / avatar upload).
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
        try? data.write(to: avatarURL, options: .atomic)
    }

    static func removeAvatar() {
        try? FileManager.default.removeItem(at: avatarURL)
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
}

/// Self-contained local daily reminder (no backend / push infra needed).
enum DailyReminder {
    private static let identifier = "daily-games-reminder"

    static func enable() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        guard granted else { return false }

        let content = UNMutableNotificationContent()
        content.title = "Today's games are ready"
        content.body = "Keep your streak alive — play your daily 9."
        content.sound = .default

        var date = DateComponents()
        date.hour = 19
        let trigger = UNCalendarNotificationTrigger(dateMatching: date, repeats: true)
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)

        center.removePendingNotificationRequests(withIdentifiers: [identifier])
        try? await center.add(request)
        return true
    }

    static func disable() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier])
    }
}

struct ProfileTabView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(\.requestReview) private var requestReview

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

    private var displayName: String {
        LocalProfile.nameOverride ?? auth.user?.displayName ?? "Player"
    }

    private var initials: String {
        let parts = displayName.split(separator: " ")
        let letters = parts.prefix(2).compactMap { $0.first.map(String.init) }.joined()
        return letters.isEmpty ? "BK" : letters.uppercased()
    }

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
                    LocalProfile.saveAvatar(data)
                    avatarImage = image
                }
            }
        }
        .confirmationDialog("Profile photo", isPresented: $showAvatarOptions, titleVisibility: .visible) {
            Button("Choose Photo") { showPhotoPicker = true }
            if avatarImage != nil {
                Button("Remove Photo", role: .destructive) {
                    LocalProfile.removeAvatar()
                    avatarImage = nil
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Edit name", isPresented: $showEditName) {
            TextField("Display name", text: $draftName)
            Button("Save") {
                let trimmed = draftName.trimmingCharacters(in: .whitespacesAndNewlines)
                LocalProfile.nameOverride = trimmed.isEmpty ? nil : trimmed
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
        .confirmationDialog("Sign out of Ball Knowledge?", isPresented: $showSignOutConfirm, titleVisibility: .visible) {
            Button("Sign Out", role: .destructive) { Task { await auth.signOut() } }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Delete your account? This can't be undone.", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("Delete Account", role: .destructive) { Task { await auth.deleteAccount() } }
            Button("Cancel", role: .cancel) {}
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

            VStack(spacing: 6) {
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

                Text("Level \(auth.user?.level ?? 1) · \(levelTitle(auth.user?.level ?? 1))")
                    .font(BKFont.caption(13))
                    .foregroundStyle(BKTheme.accent)
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
        .frame(width: 96, height: 96)
        .clipShape(Circle())
        .overlay(Circle().stroke(BKTheme.accent.opacity(0.4), lineWidth: 2))
    }

    // MARK: Stats

    private var statsCard: some View {
        HStack(spacing: 0) {
            stat(value: "\(auth.user?.xp ?? 0)", label: "TOTAL XP", icon: "bolt.fill", tint: BKTheme.accent)
            divider
            stat(value: "\(auth.user?.streak ?? 0)", label: "DAY STREAK", icon: "flame.fill", tint: BKTheme.streak)
            divider
            stat(value: "\(auth.user?.todayXp ?? 0)", label: "XP TODAY", icon: "calendar", tint: BKTheme.textPrimary)
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
            SettingsLinkRow(icon: "doc.text.fill", title: "Terms of Service", url: AppConfig.privacyPolicyURL)
        }
    }

    private var shareRow: some View {
        ShareLink(item: URL(string: AppConfig.productionAPIURL)!) {
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
                UserDefaults.standard.removeObject(forKey: UserDefaultsKeys.completedPostSignInSetup)
                UserDefaults.standard.removeObject(forKey: UserDefaultsKeys.isDevAccount)
                LocalProfile.removeAvatar()
                LocalProfile.nameOverride = nil
                Task { await auth.signOut() }
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

    private func levelTitle(_ level: Int) -> String {
        switch level {
        case ..<3: return "Rookie"
        case 3..<5: return "Semi-Pro"
        case 5..<8: return "Pro"
        case 8..<12: return "Veteran"
        case 12..<18: return "World Class"
        default: return "Legend"
        }
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
