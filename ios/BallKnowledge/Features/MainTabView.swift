import SwiftUI
import PhotosUI
import StoreKit
import UserNotifications

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
            .padding(.bottom, 72)

            BKTabBar(selection: $selectedTab)
        }
        .background(BKTheme.background)
    }
}

struct LeaguesTabView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Ph.trophy.fill
                    .color(.yellow)
                    .frame(width: 48, height: 48)
                Text("Weekly Leagues")
                    .font(BKFont.title())
                    .foregroundStyle(BKTheme.textPrimary)
                Text("Compete in Bronze, Silver and Gold leagues. Coming soon.")
                    .font(BKFont.body())
                    .multilineTextAlignment(.center)
                    .foregroundStyle(BKTheme.textSecondary)
                    .padding(.horizontal, 32)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(BKTheme.background)
            .navigationTitle("Leagues")
        }
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

    private var displayName: String {
        LocalProfile.nameOverride ?? auth.user?.displayName ?? "Player"
    }

    private var initials: String {
        let parts = displayName.split(separator: " ")
        let letters = parts.prefix(2).compactMap { $0.first.map(String.init) }.joined()
        return letters.isEmpty ? "BK" : letters.uppercased()
    }

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 20) {
                    header
                    statsCard
                    accountSection
                    aboutSection
                    dangerSection
                    versionLabel
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 20)
            }
            .background(BKTheme.background)
            .navigationTitle("You")
            .navigationBarTitleDisplayMode(.large)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
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
