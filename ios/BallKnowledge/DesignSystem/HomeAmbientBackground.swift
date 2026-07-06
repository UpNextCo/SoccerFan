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
                            Color(hex: "0C2218").opacity(0.58),
                            BKTheme.background.opacity(0.26),
                            BKTheme.background,
                        ],
                        center: UnitPoint(
                            x: 0.5 + 0.06 * CGFloat(sin(t * 0.1)),
                            y: 0.06 + 0.02 * CGFloat(cos(t * 0.14))
                        ),
                        startRadius: 0,
                        endRadius: max(size.width, size.height) * 0.55
                    )

                    ambientRotatingWash(time: t, size: size)
                    ambientGlowOrbs(time: t, size: size)
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
}

/// The home hero's drifting green glow orbs + wash, WITHOUT the opaque page-black base — so it can
/// be layered on top of another background (e.g. the One More stadium photo) and just adds light.
struct AmbientGlowOverlay: View {
    /// Multiplier on orb/wash intensity (1 = same as the home hero).
    var intensity: Double = 1.0

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            GeometryReader { geo in
                let size = geo.size
                ZStack {
                    ambientRotatingWash(time: t, size: size, intensity: intensity)
                    ambientGlowOrbs(time: t, size: size, intensity: intensity)
                }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}

// MARK: - Shared ambient primitives

@ViewBuilder
private func ambientGlowOrbs(time: TimeInterval, size: CGSize, intensity: Double = 1.0) -> some View {
    ambientGlowOrb(
        time: time, size: size, seed: 0,
        base: CGPoint(x: size.width * 0.12, y: size.height * 0.02),
        drift: CGSize(width: 72, height: 44), diameter: 300,
        core: BKTheme.accent.opacity(0.11 * intensity), blur: 58
    )
    ambientGlowOrb(
        time: time, size: size, seed: 1.7,
        base: CGPoint(x: size.width * 0.88, y: size.height * 0.08),
        drift: CGSize(width: 56, height: 52), diameter: 240,
        core: Color(hex: "00AA55").opacity(0.075 * intensity), blur: 50
    )
    ambientGlowOrb(
        time: time, size: size, seed: 3.1,
        base: CGPoint(x: size.width * 0.52, y: -size.height * 0.04),
        drift: CGSize(width: 38, height: 28),
        diameter: 180 + 28 * CGFloat(sin(time * 0.32 + 1.2)),
        core: BKTheme.accent.opacity((0.035 + 0.025 * CGFloat(sin(time * 0.45))) * intensity), blur: 42
    )
}

private func ambientRotatingWash(time: TimeInterval, size: CGSize, intensity: Double = 1.0) -> some View {
    AngularGradient(
        stops: [
            .init(color: .clear, location: 0),
            .init(color: BKTheme.accent.opacity(0.028), location: 0.22),
            .init(color: .clear, location: 0.45),
            .init(color: Color(hex: "006633").opacity(0.02), location: 0.68),
            .init(color: .clear, location: 1),
        ],
        center: .center,
        angle: .degrees(time * 5.5)
    )
    .frame(width: size.width * 1.6, height: size.height * 0.9)
    .blur(radius: 72)
    .opacity(0.48 * intensity)
    .offset(y: -size.height * 0.08)
    .blendMode(.plusLighter)
}

private func ambientGlowOrb(
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
