import SwiftUI
import UIKit

/// One-shot intro for the weekly pyramid league.
/// If the build is installed mid-week, wait until the next London Monday.
/// If it is installed on Monday, that week is eligible immediately.
enum WeeklyLeagueIntro {
    static var hasShown: Bool {
        UserDefaults.standard.bool(forKey: UserDefaultsKeys.weeklyLeagueIntroShown)
    }

    static func markShown() {
        UserDefaults.standard.set(true, forKey: UserDefaultsKeys.weeklyLeagueIntroShown)
    }

    static func reset() {
        let defaults = UserDefaults.standard
        defaults.set(false, forKey: UserDefaultsKeys.weeklyLeagueIntroShown)
        defaults.set(londonWeekStartString(), forKey: UserDefaultsKeys.weeklyLeagueIntroEligibleWeek)
    }

    static func shouldPresent(currentWeekStart: String, now: Date = .now) -> Bool {
        guard !hasShown else { return false }
        return currentWeekStart >= eligibleWeekStart(now: now)
    }

    /// First launch of this build: Monday this week if today is Monday, otherwise next Monday.
    private static func eligibleWeekStart(now: Date = .now) -> String {
        let defaults = UserDefaults.standard
        let key = UserDefaultsKeys.weeklyLeagueIntroEligibleWeek
        if let stored = defaults.string(forKey: key), !stored.isEmpty {
            return stored
        }
        let thisWeek = londonWeekStartString(now: now)
        let eligible = isLondonMonday(now: now) ? thisWeek : nextWeekStart(after: thisWeek)
        defaults.set(eligible, forKey: key)
        return eligible
    }

    private static var londonCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/London") ?? .gmt
        calendar.firstWeekday = 2
        return calendar
    }

    private static var londonDateFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = londonCalendar
        formatter.timeZone = londonCalendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }

    static func londonWeekStartString(now: Date = .now) -> String {
        let calendar = londonCalendar
        let weekday = calendar.component(.weekday, from: now)
        let daysFromMonday = (weekday + 5) % 7
        let monday = calendar.date(
            byAdding: .day,
            value: -daysFromMonday,
            to: calendar.startOfDay(for: now)
        ) ?? now
        return londonDateFormatter.string(from: monday)
    }

    private static func isLondonMonday(now: Date) -> Bool {
        londonCalendar.component(.weekday, from: now) == 2
    }

    private static func nextWeekStart(after weekStart: String) -> String {
        let calendar = londonCalendar
        guard let monday = londonDateFormatter.date(from: weekStart),
              let next = calendar.date(byAdding: .day, value: 7, to: monday)
        else { return weekStart }
        return londonDateFormatter.string(from: next)
    }

    /// Trophy art in `Resources/GameTiles/` — filenames match the files dropped there.
    static let pyramid: [(id: String, label: String, imageName: String)] = [
        ("champions_league", "Champions League", "championsleague"),
        ("premier_league", "Premier League", "premierleague"),
        ("championship", "Championship", "championship"),
        ("league_one", "League One", "leagueone"),
        ("league_two", "League Two", "leaguetwo"),
        ("non_league", "Non-League", "nonleague"),
        ("sunday_league", "Sunday League", "sundayleague"),
    ]

    static func imageName(forDivisionId id: String) -> String {
        pyramid.first(where: { $0.id == id })?.imageName ?? "sundayleague"
    }

    private static var fullCache: [String: UIImage] = [:]
    private static var thumbCache: [String: UIImage] = [:]

    static func loadImage(named name: String) -> UIImage? {
        if let cached = fullCache[name] { return cached }
        guard let url = GameModeTileArt.imageURL(named: name),
              let image = UIImage(contentsOfFile: url.path) else { return nil }
        fullCache[name] = image
        return image
    }

    /// Downsampled square for the ladder — avoids uploading full stadium tiles as GPU textures.
    static func loadThumb(named name: String, pointSize: CGFloat = 44) -> UIImage? {
        let key = "\(name)-\(Int(pointSize))"
        if let cached = thumbCache[key] { return cached }
        guard let full = loadImage(named: name) else { return nil }

        let format = UIGraphicsImageRendererFormat.default()
        format.scale = UIScreen.main.scale
        format.opaque = true
        let size = CGSize(width: pointSize, height: pointSize)
        let thumb = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            let scale = max(size.width / full.size.width, size.height / full.size.height)
            let drawSize = CGSize(width: full.size.width * scale, height: full.size.height * scale)
            let origin = CGPoint(
                x: (size.width - drawSize.width) / 2,
                y: (size.height - drawSize.height) / 2
            )
            full.draw(in: CGRect(origin: origin, size: drawSize))
        }
        thumbCache[key] = thumb
        return thumb
    }

    static func preloadPyramidThumbs() {
        for tier in pyramid {
            _ = loadThumb(named: tier.imageName)
        }
    }

    /// Sunday 24:00 Europe/London for the current weekly league week.
    static func weekEndDate(weekEnd: String?, weekStart: String?) -> Date? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/London") ?? .gmt
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"

        if let weekEnd, let sunday = formatter.date(from: weekEnd) {
            return calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: sunday))
        }
        if let weekStart, let monday = formatter.date(from: weekStart) {
            return calendar.date(byAdding: .day, value: 7, to: calendar.startOfDay(for: monday))
        }
        return nil
    }

    static func endsCaption(weekEnd: String?, weekStart: String?, now: Date = .now) -> String {
        guard let end = weekEndDate(weekEnd: weekEnd, weekStart: weekStart) else {
            return "Ends Sunday"
        }
        let remaining = end.timeIntervalSince(now)
        if remaining <= 0 { return "Ends soon" }

        let hoursTotal = Int(remaining / 3600)
        let days = hoursTotal / 24
        let hours = hoursTotal % 24

        if days >= 1 {
            let dayPart = days == 1 ? "1 day" : "\(days) days"
            if hours == 0 { return "Ends in \(dayPart)" }
            let hourPart = hours == 1 ? "1 hour" : "\(hours) hours"
            return "Ends in \(dayPart) \(hourPart)"
        }
        if hoursTotal >= 1 {
            return hoursTotal == 1 ? "Ends in 1 hour" : "Ends in \(hoursTotal) hours"
        }
        let minutes = max(1, Int(remaining / 60))
        return minutes == 1 ? "Ends in 1 minute" : "Ends in \(minutes) minutes"
    }
}

struct WeeklyLeagueIntroPayload: Equatable, Identifiable {
    var id: String { division }
    let division: String
    let divisionLabel: String
}

/// Full-screen explainer styled like the daily-complete win card.
struct WeeklyLeagueIntroView: View {
    let payload: WeeklyLeagueIntroPayload
    let onDismiss: () -> Void

    @State private var showChrome = false
    @State private var showLadder = false
    @State private var showFooter = false
    @State private var ctaRevealed = false
    @State private var confettiToken = 0

    private var heroImage: UIImage? {
        WeeklyLeagueIntro.loadImage(named: WeeklyLeagueIntro.imageName(forDivisionId: payload.division))
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            BKTheme.background.ignoresSafeArea()

            heroBackground

            ScrollView(showsIndicators: false) {
                VStack(spacing: 22) {
                    headerBlock
                        .opacity(showChrome ? 1 : 0)
                        .offset(y: showChrome ? 0 : 16)
                        .padding(.top, 28)

                    ladderBlock
                        .opacity(showLadder ? 1 : 0)

                    footerBlock
                        .opacity(showFooter ? 1 : 0)
                        .offset(y: showFooter ? 0 : 14)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 120)
            }

            GameResultExitBar(title: "BEGIN PLAYING", showsBackground: false, action: onDismiss)
                .opacity(ctaRevealed ? 1 : 0)
                .allowsHitTesting(ctaRevealed)

            FootballConfettiView(
                burstToken: confettiToken,
                particleCount: 36,
                includesSoccerBalls: false
            )
            .allowsHitTesting(false)
        }
        .presentationBackground(BKTheme.background)
        .task { await runSequence() }
    }

    private var heroBackground: some View {
        GeometryReader { geo in
            let heroHeight = max(geo.size.width * 1.05, geo.size.height * 0.50)
            let fadeHeight = min(160, heroHeight * 0.38)
            ZStack(alignment: .top) {
                if let heroImage {
                    Image(uiImage: heroImage)
                        .resizable()
                        .scaledToFill()
                        .frame(width: geo.size.width, height: heroHeight)
                        .clipped()
                        .mask(
                            VStack(spacing: 0) {
                                Color.white
                                LinearGradient(
                                    stops: [
                                        .init(color: .white, location: 0),
                                        .init(color: .white.opacity(0.35), location: 0.42),
                                        .init(color: .clear, location: 1),
                                    ],
                                    startPoint: .top,
                                    endPoint: .bottom
                                )
                                .frame(height: fadeHeight)
                            }
                        )
                        .overlay(alignment: .bottom) {
                            LinearGradient(
                                stops: [
                                    .init(color: .clear, location: 0),
                                    .init(color: BKTheme.background.opacity(0.45), location: 0.4),
                                    .init(color: BKTheme.background, location: 1),
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                            .frame(height: fadeHeight)
                        }
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
        }
        .ignoresSafeArea(edges: .top)
        .allowsHitTesting(false)
    }

    private var headerBlock: some View {
        VStack(spacing: 10) {
            Text("YOU'RE IN")
                .font(BKFont.caption(13))
                .tracking(2.2)
                .foregroundStyle(BKTheme.accent)

            Text(payload.divisionLabel.uppercased())
                .font(BKFont.title(34))
                .foregroundStyle(BKTheme.textPrimary)
                .tracking(0.8)
                .multilineTextAlignment(.center)

            Text("Your division for this week's league")
                .font(BKFont.body(15))
                .foregroundStyle(BKTheme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, heroImage == nil ? 48 : 236)
    }

    private var ladderBlock: some View {
        VStack(spacing: 0) {
            ForEach(Array(WeeklyLeagueIntro.pyramid.enumerated()), id: \.element.id) { index, tier in
                let isYou = tier.id == payload.division
                HStack(spacing: 12) {
                    leagueThumb(named: tier.imageName, highlighted: isYou)

                    Text(tier.label)
                        .font(BKFont.headline(isYou ? 16 : 14))
                        .foregroundStyle(isYou ? BKTheme.textPrimary : BKTheme.textSecondary)

                    Spacer(minLength: 8)

                    if isYou {
                        Text("YOU")
                            .font(BKFont.caption(11))
                            .tracking(1.0)
                            .foregroundStyle(BKTheme.background)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(BKTheme.accent)
                            .clipShape(Capsule())
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(isYou ? BKTheme.cardElevated : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(isYou ? BKTheme.accent.opacity(0.55) : .clear, lineWidth: 1.5)
                )

                if index < WeeklyLeagueIntro.pyramid.count - 1 {
                    Rectangle()
                        .fill(BKTheme.textMuted.opacity(0.18))
                        .frame(width: 2, height: 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.leading, 30)
                }
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 8)
        .background(Color(hex: "121212"))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var footerBlock: some View {
        VStack(spacing: 8) {
            Text("A new weekly league starts every Monday")
                .font(BKFont.headline(15))
                .foregroundStyle(BKTheme.textPrimary)
                .multilineTextAlignment(.center)

            Text("Earn XP to join a 20-player league. Top 5 are promoted, bottom 5 relegated. Champions League is the top 20 scorers across CL and Premier League.")
                .font(BKFont.body(13))
                .foregroundStyle(BKTheme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 8)
    }

    @ViewBuilder
    private func leagueThumb(named name: String, highlighted: Bool) -> some View {
        let size: CGFloat = highlighted ? 44 : 36
        if let image = WeeklyLeagueIntro.loadThumb(named: name) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        } else {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(BKTheme.cardElevated)
                .frame(width: size, height: size)
                .overlay {
                    Image(systemName: "trophy.fill")
                        .font(.system(size: highlighted ? 16 : 13, weight: .bold))
                        .foregroundStyle(highlighted ? BKTheme.accent : BKTheme.textMuted)
                }
        }
    }

    @MainActor
    private func runSequence() async {
        WeeklyLeagueIntro.preloadPyramidThumbs()

        try? await Task.sleep(for: .milliseconds(180))
        withAnimation(.spring(response: 0.48, dampingFraction: 0.78)) {
            showChrome = true
        }
        confettiToken += 1
        HapticManager.success()

        try? await Task.sleep(for: .milliseconds(380))
        withAnimation(.easeOut(duration: 0.26)) {
            showLadder = true
        }
        HapticManager.light()

        try? await Task.sleep(for: .milliseconds(320))
        withAnimation(.spring(response: 0.42, dampingFraction: 0.82)) {
            showFooter = true
        }

        try? await Task.sleep(for: .milliseconds(360))
        withAnimation(.spring(response: 0.42, dampingFraction: 0.82)) {
            ctaRevealed = true
        }
    }
}
