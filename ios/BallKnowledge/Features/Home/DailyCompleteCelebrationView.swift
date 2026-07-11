import SwiftUI
import UIKit

/// Once-per-day gate for the "all 7 complete" homepage celebration.
enum DailyCompleteCelebration {
    static func hasShown(for date: String) -> Bool {
        UserDefaults.standard.string(forKey: UserDefaultsKeys.dailyCompleteCelebratedDate) == date
    }

    static func markShown(for date: String) {
        UserDefaults.standard.set(date, forKey: UserDefaultsKeys.dailyCompleteCelebratedDate)
    }

    /// Drop `winN.png` into `Resources/WinPics/` — folder reference, same pattern as GameTiles.
    static let winPicNames = (1...11).map { "win\($0)" }

    static func randomWinImage() -> UIImage? {
        let shuffled = winPicNames.shuffled()
        for name in shuffled {
            if let image = loadWinImage(named: name) { return image }
        }
        return nil
    }

    private static func loadWinImage(named name: String) -> UIImage? {
        let extensions = ["png", "PNG", "jpg", "jpeg"]
        for ext in extensions {
            if let url = Bundle.main.url(forResource: name, withExtension: ext, subdirectory: "WinPics"),
               let image = UIImage(contentsOfFile: url.path) {
                return image
            }
            if let path = Bundle.main.path(forResource: name, ofType: ext, inDirectory: "WinPics"),
               let image = UIImage(contentsOfFile: path) {
                return image
            }
        }
        if let resourcePath = Bundle.main.resourcePath {
            for ext in extensions {
                let path = (resourcePath as NSString).appendingPathComponent("WinPics/\(name).\(ext)")
                if let image = UIImage(contentsOfFile: path) { return image }
            }
        }
        return nil
    }
}

struct DailyCompleteCelebrationPayload: Equatable, Identifiable {
    var id: String { date }
    let date: String
    let todayXp: Int
    let streak: Int

    /// Streak value before today's clear (for the +1 count-up).
    var streakFrom: Int { max(0, streak - 1) }
}

/// Full-screen celebration after clearing all 7 dailies — XP rolls up, then streak ticks +1.
struct DailyCompleteCelebrationView: View {
    let payload: DailyCompleteCelebrationPayload
    let onDismiss: () -> Void

    @State private var confettiToken = 0
    @State private var showChrome = false
    @State private var displayedXp: Double = 0
    @State private var displayedStreak: Double = 0
    @State private var xpPulse: CGFloat = 1
    @State private var streakPulse: CGFloat = 1
    @State private var streakRevealed = false
    @State private var ctaRevealed = false
    @State private var winImage: UIImage? = DailyCompleteCelebration.randomWinImage()

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()

            winHeroBackground

            VStack(spacing: 0) {
                Spacer(minLength: 0)

                VStack(spacing: 20) {
                    headerBlock
                        .opacity(showChrome ? 1 : 0)
                        .offset(y: showChrome ? 0 : 16)

                    xpBlock
                        .opacity(showChrome ? 1 : 0)
                        .offset(y: showChrome ? 0 : 20)

                    streakBlock
                        .opacity(streakRevealed ? 1 : 0)
                        .offset(y: streakRevealed ? 0 : 18)
                        .scaleEffect(streakRevealed ? 1 : 0.92)
                }
                .padding(.horizontal, 28)
                .padding(.bottom, 16)

                GameResultExitBar(title: "CONTINUE", action: onDismiss)
                    .opacity(ctaRevealed ? 1 : 0)
                    .allowsHitTesting(ctaRevealed)
            }

            FootballConfettiView(burstToken: confettiToken)
                .allowsHitTesting(false)
        }
        .task { await runSequence() }
    }

    private var winHeroBackground: some View {
        GeometryReader { geo in
            let topPad = geo.safeAreaInsets.top + 88
            Group {
                if let winImage {
                    Image(uiImage: winImage)
                        .resizable()
                        .scaledToFit()
                        .frame(width: geo.size.width * 0.8)
                        .opacity(0.78)
                        // Short, strong dissolve only at the bottom edge — image stays crisp above.
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
                                .frame(height: 64)
                            }
                        )
                        .overlay(alignment: .bottom) {
                            LinearGradient(
                                stops: [
                                    .init(color: .clear, location: 0),
                                    .init(color: BKTheme.background.opacity(0.5), location: 0.35),
                                    .init(color: BKTheme.background, location: 1),
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                            .frame(height: 72)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, topPad)
                } else {
                    RadialGradient(
                        colors: [BKTheme.accent.opacity(0.18), .clear],
                        center: .top,
                        startRadius: 20,
                        endRadius: 280
                    )
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
            Ph.checkCircle.fill
                .color(BKTheme.accent)
                .frame(width: 48, height: 48)

            Text("DAILY COMPLETE")
                .font(BKFont.title(28))
                .foregroundStyle(BKTheme.textPrimary)
                .tracking(0.5)

            Text("All 7 games cleared")
                .font(BKFont.body(15))
                .foregroundStyle(BKTheme.textSecondary)
        }
    }

    private var xpBlock: some View {
        HStack(alignment: .center, spacing: 16) {
            Ph.lightning.fill
                .color(BKTheme.accent)
                .frame(width: 40, height: 40)

            VStack(alignment: .center, spacing: 4) {
                Text("")
                    .modifier(CelebrationCountingNumber(value: displayedXp))
                    .font(BKFont.title(44))
                    .foregroundStyle(BKTheme.accent)
                    .monospacedDigit()
                    .scaleEffect(xpPulse)

                Text("XP TODAY")
                    .font(BKFont.caption(12))
                    .tracking(1.4)
                    .foregroundStyle(BKTheme.textMuted)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
        .padding(.horizontal, 20)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var streakBlock: some View {
        HStack(alignment: .center, spacing: 16) {
            Ph.fire.fill
                .color(BKTheme.streak)
                .frame(width: 40, height: 40)

            VStack(alignment: .center, spacing: 4) {
                Text("")
                    .modifier(CelebrationCountingNumber(value: displayedStreak))
                    .font(BKFont.title(44))
                    .foregroundStyle(BKTheme.streak)
                    .monospacedDigit()
                    .scaleEffect(streakPulse)

                Text("DAY STREAK")
                    .font(BKFont.caption(12))
                    .tracking(1.4)
                    .foregroundStyle(BKTheme.textMuted)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
        .padding(.horizontal, 20)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    @MainActor
    private func runSequence() async {
        displayedXp = 0
        displayedStreak = Double(payload.streakFrom)

        // Beat 1 — chrome + confetti
        try? await Task.sleep(for: .milliseconds(180))
        withAnimation(.spring(response: 0.48, dampingFraction: 0.78)) {
            showChrome = true
        }
        confettiToken += 1
        HapticManager.success()

        // Beat 2 — XP count-up
        try? await Task.sleep(for: .milliseconds(420))
        let xpDuration = xpCountDuration(for: payload.todayXp)
        withAnimation(.easeOut(duration: xpDuration)) {
            displayedXp = Double(payload.todayXp)
        }
        await tickHaptics(during: xpDuration, ticks: min(8, max(3, payload.todayXp / 120)))
        withAnimation(.spring(response: 0.28, dampingFraction: 0.45)) {
            xpPulse = 1.1
        }
        withAnimation(.spring(response: 0.32, dampingFraction: 0.55)) {
            xpPulse = 1
        }
        HapticManager.light()

        // Beat 3 — streak reveal + +1 tick
        try? await Task.sleep(for: .milliseconds(380))
        withAnimation(.spring(response: 0.45, dampingFraction: 0.76)) {
            streakRevealed = true
        }
        HapticManager.light()

        try? await Task.sleep(for: .milliseconds(520))
        if payload.streak > payload.streakFrom {
            withAnimation(.easeOut(duration: 0.55)) {
                displayedStreak = Double(payload.streak)
            }
            try? await Task.sleep(for: .milliseconds(280))
            withAnimation(.spring(response: 0.26, dampingFraction: 0.42)) {
                streakPulse = 1.16
            }
            withAnimation(.spring(response: 0.34, dampingFraction: 0.55)) {
                streakPulse = 1
            }
            HapticManager.success()
        }

        // Beat 4 — CTA
        try? await Task.sleep(for: .milliseconds(420))
        withAnimation(.spring(response: 0.42, dampingFraction: 0.82)) {
            ctaRevealed = true
        }
    }

    private func xpCountDuration(for xp: Int) -> TimeInterval {
        switch xp {
        case ..<400: return 0.9
        case ..<900: return 1.15
        case ..<1500: return 1.35
        default: return 1.5
        }
    }

    @MainActor
    private func tickHaptics(during duration: TimeInterval, ticks: Int) async {
        guard ticks > 0 else { return }
        let step = duration / Double(ticks)
        for _ in 0..<ticks {
            try? await Task.sleep(for: .seconds(step))
            HapticManager.light()
        }
    }
}

/// Integer roll-up driven by SwiftUI animation transactions.
private struct CelebrationCountingNumber: AnimatableModifier {
    var value: Double
    var animatableData: Double {
        get { value }
        set { value = newValue }
    }

    func body(content: Content) -> some View {
        Text("\(Int(value.rounded()))")
    }
}
