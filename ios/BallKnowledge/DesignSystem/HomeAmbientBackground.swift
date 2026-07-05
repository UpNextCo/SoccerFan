import SwiftUI

/// Soft, drifting light atmosphere for the home hero.
struct HomeAmbientBackground: View {
    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate

            GeometryReader { geo in
                let size = geo.size

                ZStack {
                    BKTheme.background

                    RadialGradient(
                        colors: [
                            Color(hex: "0C2218").opacity(0.72),
                            BKTheme.background.opacity(0.35),
                            BKTheme.background,
                        ],
                        center: UnitPoint(
                            x: 0.5 + 0.06 * CGFloat(sin(t * 0.1)),
                            y: 0.06 + 0.02 * CGFloat(cos(t * 0.14))
                        ),
                        startRadius: 0,
                        endRadius: max(size.width, size.height) * 0.55
                    )

                    rotatingWash(time: t, size: size)

                    glowOrb(
                        time: t,
                        size: size,
                        seed: 0,
                        base: CGPoint(x: size.width * 0.12, y: size.height * 0.02),
                        drift: CGSize(width: 72, height: 44),
                        diameter: 300,
                        core: BKTheme.accent.opacity(0.16),
                        blur: 58
                    )

                    glowOrb(
                        time: t,
                        size: size,
                        seed: 1.7,
                        base: CGPoint(x: size.width * 0.88, y: size.height * 0.08),
                        drift: CGSize(width: 56, height: 52),
                        diameter: 240,
                        core: Color(hex: "00AA55").opacity(0.11),
                        blur: 50
                    )

                    glowOrb(
                        time: t,
                        size: size,
                        seed: 3.1,
                        base: CGPoint(x: size.width * 0.52, y: -size.height * 0.04),
                        drift: CGSize(width: 38, height: 28),
                        diameter: 180 + 28 * CGFloat(sin(t * 0.32 + 1.2)),
                        core: BKTheme.accent.opacity(0.05 + 0.03 * CGFloat(sin(t * 0.45))),
                        blur: 42
                    )
                }
            }
        }
        .overlay { contentFade }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }

    private var contentFade: some View {
        LinearGradient(
            stops: [
                .init(color: .clear, location: 0),
                .init(color: .clear, location: 0.34),
                .init(color: BKTheme.background.opacity(0.65), location: 0.52),
                .init(color: BKTheme.background, location: 0.68),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .allowsHitTesting(false)
    }

    private func rotatingWash(time: TimeInterval, size: CGSize) -> some View {
        AngularGradient(
            stops: [
                .init(color: .clear, location: 0),
                .init(color: BKTheme.accent.opacity(0.04), location: 0.22),
                .init(color: .clear, location: 0.45),
                .init(color: Color(hex: "006633").opacity(0.03), location: 0.68),
                .init(color: .clear, location: 1),
            ],
            center: .center,
            angle: .degrees(time * 5.5)
        )
        .frame(width: size.width * 1.6, height: size.height * 0.9)
        .blur(radius: 72)
        .opacity(0.62)
        .offset(y: -size.height * 0.08)
        .blendMode(.plusLighter)
    }

    private func glowOrb(
        time: TimeInterval,
        size: CGSize,
        seed: Double,
        base: CGPoint,
        drift: CGSize,
        diameter: CGFloat,
        core: Color,
        blur: CGFloat
    ) -> some View {
        let x = base.x + drift.width * CGFloat(sin(time * 0.11 + seed))
        let y = base.y + drift.height * CGFloat(cos(time * 0.09 + seed * 0.6))

        return Circle()
            .fill(
                RadialGradient(
                    colors: [core, core.opacity(0.35), .clear],
                    center: .center,
                    startRadius: 0,
                    endRadius: diameter * 0.5
                )
            )
            .frame(width: diameter, height: diameter)
            .blur(radius: blur)
            .position(x: x, y: y)
            .blendMode(.plusLighter)
    }
}
