import SwiftUI
import UIKit
import Lottie

struct DailyCompleteWinImage {
    let name: String
    let image: UIImage

    var usesFullWidth: Bool {
        name == "win9" || name == "win10"
    }
}

/// Once-per-day gate for the first-game streak toast.
enum DailyCompleteCelebration {
    static func hasShown(for date: String) -> Bool {
        UserDefaults.standard.string(forKey: UserDefaultsKeys.dailyCompleteCelebratedDate) == date
    }

    static func markShown(for date: String) {
        UserDefaults.standard.set(date, forKey: UserDefaultsKeys.dailyCompleteCelebratedDate)
    }

    /// Xcode copies these files from Resources/WinPics into the built app's resource root.
    static let winPicNames = (1...11).map { "win\($0)" }

    static func randomWinImage() -> DailyCompleteWinImage? {
        let shuffled = winPicNames.shuffled()
        for name in shuffled {
            if let image = loadWinImage(named: name) {
                return DailyCompleteWinImage(name: name, image: image)
            }
        }
        return nil
    }

    private static func loadWinImage(named name: String) -> UIImage? {
        let extensions = ["png", "PNG", "jpg", "jpeg"]
        for ext in extensions {
            if let url = Bundle.main.url(forResource: name, withExtension: ext),
               let image = UIImage(contentsOfFile: url.path) {
                return image
            }
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

struct RankUpCelebrationPayload: Equatable, Identifiable {
    var id: String { "\(newTitle)-\(newXp)" }
    let previousTitle: String
    let previousEmoji: String
    let newTitle: String
    let newEmoji: String
    let oldXp: Int
    let newXp: Int
    let startingProgress: Double

    static func make(from completion: DailyCompleteResponseDTO) -> RankUpCelebrationPayload? {
        let oldXp = max(0, completion.newXp - completion.xpEarned)
        let previous = PlayerRank.progress(for: oldXp)
        let next = PlayerRank.progress(for: completion.newXp)
        guard previous.title != next.title else { return nil }
        return RankUpCelebrationPayload(
            previousTitle: previous.title,
            previousEmoji: previous.emoji,
            newTitle: next.title,
            newEmoji: next.emoji,
            oldXp: oldXp,
            newXp: completion.newXp,
            startingProgress: previous.fraction(at: oldXp)
        )
    }
}

struct RankUpCelebrationView: View {
    let payload: RankUpCelebrationPayload
    let onDismiss: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var progress: Double
    @State private var showTitle = false
    @State private var showRank = false
    @State private var showContinue = false
    @State private var confettiToken = 0

    init(payload: RankUpCelebrationPayload, onDismiss: @escaping () -> Void) {
        self.payload = payload
        self.onDismiss = onDismiss
        _progress = State(initialValue: payload.startingProgress)
    }

    var body: some View {
        ZStack {
            BKTheme.background.ignoresSafeArea()
            HomeAmbientBackground()

            Circle()
                .fill(BKTheme.accent.opacity(0.11))
                .frame(width: 280, height: 280)
                .blur(radius: 32)
                .offset(y: -70)

            VStack(spacing: 0) {
                Spacer()

                VStack(spacing: 28) {
                    Text("LEVEL UP")
                        .font(BKFont.title(32))
                        .tracking(1.2)
                        .foregroundStyle(BKTheme.textPrimary)
                        .opacity(showTitle ? 1 : 0)
                        .offset(y: showTitle ? 0 : 14)

                    VStack(spacing: 9) {
                        GeometryReader { geometry in
                            ZStack(alignment: .leading) {
                                Capsule()
                                    .fill(BKTheme.cardElevated)
                                Capsule()
                                    .fill(BKTheme.accent)
                                    .frame(width: geometry.size.width * progress)
                            }
                        }
                        .frame(height: 9)

                        HStack {
                            Text("\(payload.previousEmoji) \(payload.previousTitle)")
                            Spacer()
                            Text("\(payload.newEmoji) \(payload.newTitle)")
                        }
                        .font(BKFont.caption(10))
                        .foregroundStyle(BKTheme.textMuted)
                    }
                    .padding(.horizontal, 8)

                    VStack(spacing: 10) {
                        Text(payload.newEmoji)
                            .font(.system(size: 76))
                        Text(payload.newTitle)
                            .font(BKFont.title(36))
                            .foregroundStyle(BKTheme.textPrimary)
                        Text("New rank unlocked")
                            .font(BKFont.body(14))
                            .foregroundStyle(BKTheme.textSecondary)
                    }
                    .opacity(showRank ? 1 : 0)
                    .scaleEffect(showRank ? 1 : 0.78)
                }
                .padding(.horizontal, 30)

                Spacer()

                GameResultExitBar(title: "CONTINUE", action: onDismiss)
                    .opacity(showContinue ? 1 : 0)
                    .allowsHitTesting(showContinue)
            }

            FootballConfettiView(burstToken: confettiToken)
                .allowsHitTesting(false)
        }
        .task { await runSequence() }
    }

    @MainActor
    private func runSequence() async {
        try? await Task.sleep(for: .milliseconds(160))
        withAnimation(.spring(response: 0.46, dampingFraction: 0.8)) {
            showTitle = true
        }

        try? await Task.sleep(for: .milliseconds(360))
        withAnimation(.easeInOut(duration: reduceMotion ? 0.01 : 1.05)) {
            progress = 1
        }
        if !reduceMotion {
            for _ in 0..<5 {
                try? await Task.sleep(for: .milliseconds(175))
                HapticManager.light()
            }
        }

        try? await Task.sleep(for: .milliseconds(180))
        withAnimation(.spring(response: 0.55, dampingFraction: 0.7)) {
            showRank = true
        }
        confettiToken += 1
        HapticManager.success()

        try? await Task.sleep(for: .milliseconds(520))
        withAnimation(.spring(response: 0.42, dampingFraction: 0.82)) {
            showContinue = true
        }
    }
}

/// Compact top toast after the first daily of the day — fire icon, count-up, "X day streak".
struct StreakToastBanner: View {
    let payload: DailyCompleteCelebrationPayload
    let onDismiss: () -> Void

    @State private var displayedStreak: Double
    @State private var pulse: CGFloat = 1

    init(payload: DailyCompleteCelebrationPayload, onDismiss: @escaping () -> Void) {
        self.payload = payload
        self.onDismiss = onDismiss
        _displayedStreak = State(initialValue: Double(payload.streakFrom))
    }

    var body: some View {
        HStack(spacing: 10) {
            StreakFireLottie()
                .frame(width: 36, height: 36)

            Text("")
                .modifier(CelebrationCountingNumber(value: displayedStreak))
                .font(BKFont.title(22))
                .foregroundStyle(BKTheme.streak)
                .monospacedDigit()
                .scaleEffect(pulse)

            Text("day streak")
                .font(BKFont.headline(15))
                .foregroundStyle(BKTheme.textPrimary)
                .lineLimit(1)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(BKTheme.streak.opacity(0.4), lineWidth: 1)
        )
        .padding(.horizontal, 16)
        .task { await runSequence() }
    }

    @MainActor
    private func runSequence() async {
        HapticManager.success()
        try? await Task.sleep(for: .milliseconds(280))
        if payload.streak > payload.streakFrom {
            withAnimation(.easeOut(duration: 0.55)) {
                displayedStreak = Double(payload.streak)
            }
            try? await Task.sleep(for: .milliseconds(280))
            withAnimation(.spring(response: 0.26, dampingFraction: 0.42)) {
                pulse = 1.14
            }
            withAnimation(.spring(response: 0.34, dampingFraction: 0.55)) {
                pulse = 1
            }
            HapticManager.success()
        }
        try? await Task.sleep(for: .milliseconds(1600))
        onDismiss()
    }
}

private struct StreakFireLottie: View {
    var body: some View {
        LottieView {
            try await DotLottieFile.named("streak-fire")
        } placeholder: {
            Ph.fire.fill
                .color(BKTheme.streak)
                .frame(width: 22, height: 22)
        }
        .looping()
        .resizable()
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
