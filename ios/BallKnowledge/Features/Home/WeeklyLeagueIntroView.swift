import SwiftUI
import UIKit

/// One-shot intro for the weekly pyramid league (first visit to Weekly).
enum WeeklyLeagueIntro {
    static var hasShown: Bool {
        UserDefaults.standard.bool(forKey: UserDefaultsKeys.weeklyLeagueIntroShown)
    }

    static func markShown() {
        UserDefaults.standard.set(true, forKey: UserDefaultsKeys.weeklyLeagueIntroShown)
    }

    static func reset() {
        UserDefaults.standard.removeObject(forKey: UserDefaultsKeys.weeklyLeagueIntroShown)
    }

    /// Drop PNGs into `Resources/leaguepics/` as `league1`…`league7` (CL → Sunday).
    static let pyramid: [(id: String, label: String, imageName: String)] = [
        ("champions_league", "Champions League", "league1"),
        ("premier_league", "Premier League", "league2"),
        ("championship", "Championship", "league3"),
        ("league_one", "League One", "league4"),
        ("league_two", "League Two", "league5"),
        ("non_league", "Non-League", "league6"),
        ("sunday_league", "Sunday League", "league7"),
    ]

    static func imageName(forDivisionId id: String) -> String {
        pyramid.first(where: { $0.id == id })?.imageName ?? "league7"
    }

    static func loadImage(named name: String) -> UIImage? {
        let extensions = ["png", "PNG", "jpg", "jpeg"]
        for ext in extensions {
            if let url = Bundle.main.url(forResource: name, withExtension: ext),
               let image = UIImage(contentsOfFile: url.path) {
                return image
            }
            if let url = Bundle.main.url(forResource: name, withExtension: ext, subdirectory: "leaguepics"),
               let image = UIImage(contentsOfFile: url.path) {
                return image
            }
            if let path = Bundle.main.path(forResource: name, ofType: ext, inDirectory: "leaguepics"),
               let image = UIImage(contentsOfFile: path) {
                return image
            }
        }
        if let resourcePath = Bundle.main.resourcePath {
            for ext in extensions {
                let path = (resourcePath as NSString).appendingPathComponent("leaguepics/\(name).\(ext)")
                if let image = UIImage(contentsOfFile: path) { return image }
            }
        }
        return nil
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
        ZStack {
            BKTheme.background.ignoresSafeArea()

            heroBackground

            VStack(spacing: 0) {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 22) {
                        headerBlock
                            .opacity(showChrome ? 1 : 0)
                            .offset(y: showChrome ? 0 : 16)
                            .padding(.top, 28)

                        ladderBlock
                            .opacity(showLadder ? 1 : 0)
                            .offset(y: showLadder ? 0 : 18)

                        footerBlock
                            .opacity(showFooter ? 1 : 0)
                            .offset(y: showFooter ? 0 : 14)
                    }
                    .padding(.horizontal, 24)
                    .padding(.bottom, 20)
                }

                GameResultExitBar(title: "BEGIN PLAYING", action: onDismiss)
                    .opacity(ctaRevealed ? 1 : 0)
                    .allowsHitTesting(ctaRevealed)
            }

            FootballConfettiView(burstToken: confettiToken)
                .allowsHitTesting(false)
        }
        .task { await runSequence() }
    }

    private var heroBackground: some View {
        GeometryReader { geo in
            let topPad = geo.safeAreaInsets.top + 36
            ZStack(alignment: .top) {
                RadialGradient(
                    colors: [BKTheme.accent.opacity(0.22), .clear],
                    center: .top,
                    startRadius: 12,
                    endRadius: 300
                )
                .frame(height: geo.size.height * 0.55)

                if let heroImage {
                    Image(uiImage: heroImage)
                        .resizable()
                        .scaledToFit()
                        .frame(width: geo.size.width * 0.72)
                        .opacity(0.88)
                        .mask(
                            VStack(spacing: 0) {
                                Color.white
                                LinearGradient(
                                    stops: [
                                        .init(color: .white, location: 0),
                                        .init(color: .white.opacity(0.3), location: 0.4),
                                        .init(color: .clear, location: 1),
                                    ],
                                    startPoint: .top,
                                    endPoint: .bottom
                                )
                                .frame(height: 56)
                            }
                        )
                        .overlay(alignment: .bottom) {
                            LinearGradient(
                                stops: [
                                    .init(color: .clear, location: 0),
                                    .init(color: BKTheme.background.opacity(0.55), location: 0.4),
                                    .init(color: BKTheme.background, location: 1),
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                            .frame(height: 80)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, topPad)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
        }
        .ignoresSafeArea()
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
        .padding(.top, heroImage == nil ? 48 : 160)
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

            Text("Earn XP to join your table of 30. Finish top to promote — finish bottom and you drop a division.")
                .font(BKFont.body(13))
                .foregroundStyle(BKTheme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 8)
    }

    @ViewBuilder
    private func leagueThumb(named name: String, highlighted: Bool) -> some View {
        let size: CGFloat = highlighted ? 44 : 36
        if let image = WeeklyLeagueIntro.loadImage(named: name) {
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
        try? await Task.sleep(for: .milliseconds(180))
        withAnimation(.spring(response: 0.48, dampingFraction: 0.78)) {
            showChrome = true
        }
        confettiToken += 1
        HapticManager.success()

        try? await Task.sleep(for: .milliseconds(380))
        withAnimation(.spring(response: 0.48, dampingFraction: 0.8)) {
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
