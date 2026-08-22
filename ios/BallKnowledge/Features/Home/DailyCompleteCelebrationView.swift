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

/// Reward toast after the first daily of the day — drop in, flame burst, count-up, glow, slide out.
struct StreakToastBanner: View {
    let payload: DailyCompleteCelebrationPayload
    let onDismiss: () -> Void

    @State private var displayedStreak: Double
    @State private var flameScale: CGFloat = 0.55
    @State private var numberScale: CGFloat = 0.92
    @State private var glow: CGFloat = 0
    @State private var cardOffset: CGFloat = 0
    @State private var cardOpacity: Double = 1

    init(payload: DailyCompleteCelebrationPayload, onDismiss: @escaping () -> Void) {
        self.payload = payload
        self.onDismiss = onDismiss
        _displayedStreak = State(initialValue: Double(payload.streakFrom))
    }

    private var cardShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 22, style: .continuous)
    }

    var body: some View {
        VStack(spacing: 2) {
            ZStack {
                Circle()
                    .fill(BKTheme.streak.opacity(0.14 + Double(glow) * 0.16))
                    .frame(width: 108, height: 108)
                    .blur(radius: 22)
                    .scaleEffect(1 + glow * 0.28)

                HStack(alignment: .center, spacing: -2) {
                    StreakFireLottie()
                        .frame(width: 64, height: 64)
                        .scaleEffect(flameScale)
                        .offset(y: -8)
                        .allowsHitTesting(false)

                    Text("")
                        .modifier(CelebrationCountingNumber(value: displayedStreak))
                        .font(BKFont.title(58))
                        .foregroundStyle(BKTheme.textPrimary)
                        .tracking(-2)
                        .shadow(color: BKTheme.streak.opacity(0.28 + Double(glow) * 0.14), radius: 10, y: 0)
                        .scaleEffect(numberScale)
                        .offset(y: 2)
                        .fixedSize()
                }
                .offset(x: -6)
            }
            .frame(height: 78)

            Text("DAY STREAK")
                .font(BKFont.caption(13))
                .tracking(1.8)
                .foregroundStyle(BKTheme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 18)
        .padding(.bottom, 16)
        .background(BKTheme.cardElevated)
        .clipShape(cardShape)
        .overlay {
            cardShape
                .fill(
                    RadialGradient(
                        colors: [BKTheme.streak.opacity(Double(glow) * 0.18), .clear],
                        center: .center,
                        startRadius: 8,
                        endRadius: 170
                    )
                )
                .allowsHitTesting(false)
        }
        .padding(.horizontal, 16)
        .offset(y: cardOffset)
        .opacity(cardOpacity)
        .task { await runLoop() }
    }

    @MainActor
    private func runLoop() async {
        repeat {
            await playReward()
            #if DEBUG
            if AppConfig.previewDailyCompleteCelebration {
                try? await Task.sleep(for: .milliseconds(800))
                resetForReplay()
                continue
            }
            #endif
            onDismiss()
            break
        } while !Task.isCancelled
    }

    @MainActor
    private func playReward() async {
        displayedStreak = Double(payload.streakFrom)
        flameScale = 0.55
        numberScale = 0.92
        glow = 0
        cardOffset = 0
        cardOpacity = 1

        try? await Task.sleep(for: .milliseconds(80))
        withAnimation(.spring(response: 0.34, dampingFraction: 0.52)) {
            flameScale = 1.3
        }
        try? await Task.sleep(for: .milliseconds(220))
        withAnimation(.spring(response: 0.42, dampingFraction: 0.72)) {
            flameScale = 1
        }

        try? await Task.sleep(for: .milliseconds(140))
        if payload.streak > payload.streakFrom {
            HapticManager.light()
            withAnimation(.easeOut(duration: 0.42)) {
                displayedStreak = Double(payload.streak)
            }
            withAnimation(.spring(response: 0.28, dampingFraction: 0.45)) {
                numberScale = 1.12
            }
            try? await Task.sleep(for: .milliseconds(200))
            withAnimation(.easeOut(duration: 0.16)) {
                glow = 1
            }
            try? await Task.sleep(for: .milliseconds(180))
            withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) {
                numberScale = 1
            }
            withAnimation(.easeOut(duration: 0.55)) {
                glow = 0
            }
        }

        try? await Task.sleep(for: .milliseconds(1700))
        withAnimation(.easeIn(duration: 0.36)) {
            cardOffset = -36
            cardOpacity = 0
        }
        try? await Task.sleep(for: .milliseconds(360))
    }

    @MainActor
    private func resetForReplay() {
        displayedStreak = Double(payload.streakFrom)
        flameScale = 0.55
        numberScale = 0.92
        glow = 0
        cardOffset = -36
        cardOpacity = 0
        withAnimation(.spring(response: 0.42, dampingFraction: 0.82)) {
            cardOffset = 0
            cardOpacity = 1
        }
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
