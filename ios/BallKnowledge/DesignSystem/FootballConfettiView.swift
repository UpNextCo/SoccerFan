import SwiftUI

/// Full-screen confetti burst. Pass an incrementing `burstToken` each time you want a new burst.
struct FootballConfettiView: View {
    let burstToken: Int

    @State private var particles: [ConfettiParticle] = []
    @State private var startTime: Date?
    @State private var isActive = false
    @State private var now = Date()

    private let gravity: Double = 520
    private let timer = Timer.publish(every: 1.0 / 60.0, on: .main, in: .common).autoconnect()

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                ForEach(particles) { particle in
                    particleView(particle, in: geometry.size)
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .onReceive(timer) { date in
            guard isActive else { return }
            now = date
        }
        .task(id: burstToken) {
            guard burstToken > 0 else { return }
            startTime = Date()
            now = Date()
            particles = ConfettiParticle.makeBurst()
            isActive = true
            try? await Task.sleep(for: .seconds(GuessWhoTiming.confettiDuration))
            isActive = false
            particles = []
            startTime = nil
        }
    }

    @ViewBuilder
    private func particleView(_ particle: ConfettiParticle, in size: CGSize) -> some View {
        if let start = startTime, size.width > 0, size.height > 0 {
            let elapsed = now.timeIntervalSince(start)
            let t = elapsed - particle.delay

            if t > 0, t < particle.lifetime {
                let fadeStart = particle.lifetime * 0.55
                let opacity = t > fadeStart
                    ? max(0, 1 - (t - fadeStart) / (particle.lifetime - fadeStart))
                    : 1

                if opacity > 0.01 {
                    let x = particle.originX * size.width + particle.velocityX * t
                    let y = particle.originY * size.height + particle.velocityY * t + 0.5 * gravity * t * t
                    let rotation = Angle(radians: particle.rotation + particle.spin * t)

                    Group {
                        switch particle.kind {
                        case .rectangle:
                            RoundedRectangle(cornerRadius: 1.5)
                                .fill(particle.color)
                                .frame(width: particle.width, height: particle.height)
                        case .circle:
                            Circle()
                                .fill(particle.color)
                                .frame(width: particle.width, height: particle.width)
                        case .soccerball:
                            Ph.soccerBall.fill
                                .color(.white)
                                .frame(width: particle.width * 1.4, height: particle.width * 1.4)
                        }
                    }
                    .rotationEffect(rotation)
                    .opacity(opacity)
                    .position(x: x, y: y)
                }
            }
        }
    }
}

private struct ConfettiParticle: Identifiable {
    enum Kind {
        case rectangle, circle, soccerball
    }

    let id = UUID()
    let kind: Kind
    /// Normalized 0–1 screen position
    let originX: Double
    let originY: Double
    let velocityX: Double
    let velocityY: Double
    let rotation: Double
    let spin: Double
    let width: Double
    let height: Double
    let color: Color
    let delay: Double
    let lifetime: Double

    static func makeBurst(count: Int = 100) -> [ConfettiParticle] {
        let colors: [Color] = [
            BKTheme.accent,
            BKTheme.accentMuted,
            .white,
            Color(hex: "FFD700"),
            BKTheme.streak,
        ]

        return (0..<count).map { i in
            let roll = Double.random(in: 0...1)
            let kind: Kind
            if roll < 0.12 {
                kind = .soccerball
            } else if roll < 0.55 {
                kind = .rectangle
            } else {
                kind = .circle
            }

            let w = Double.random(in: 8...14)
            let h = kind == .rectangle ? Double.random(in: 12...22) : w

            return ConfettiParticle(
                kind: kind,
                originX: Double.random(in: 0.05...0.95),
                originY: Double.random(in: -0.05...0.08),
                velocityX: Double.random(in: -180...180),
                velocityY: Double.random(in: 80...320),
                rotation: Double.random(in: 0...(2 * .pi)),
                spin: Double.random(in: -8...8),
                width: w,
                height: h,
                color: colors[i % colors.count],
                delay: Double.random(in: 0...0.25),
                lifetime: Double.random(in: 2.0...2.8)
            )
        }
    }
}
