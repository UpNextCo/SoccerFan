import SwiftUI

/// Consistent in-game XP HUD: a slim "X / MAX XP" progress bar mounted in each game's top strip so
/// the player always sees the XP earned so far and the max on offer.
struct GameXPBar: View {
    let current: Int
    let max: Int

    private var fraction: Double {
        guard max > 0 else { return 0 }
        return Swift.min(1, Swift.max(0, Double(current) / Double(max)))
    }

    var body: some View {
        VStack(spacing: 5) {
            HStack(spacing: 4) {
                Text("XP")
                    .font(BKFont.caption(10))
                    .tracking(1.2)
                    .foregroundStyle(BKTheme.textMuted)
                Spacer()
                Text("\(current)")
                    .font(BKFont.headline(14))
                    .foregroundStyle(BKTheme.accent)
                    .contentTransition(.numericText())
                Text("/ \(max)")
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textMuted)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(BKTheme.card)
                    Capsule()
                        .fill(BKTheme.accent)
                        .frame(width: geo.size.width * fraction)
                }
            }
            .frame(height: 6)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: current)
    }
}

/// A transient "+N XP" that floats up and fades, fired by incrementing `trigger`. Attach near the
/// action that scored (e.g. over the board / the picked card).
private struct XPPopModifier: ViewModifier {
    let amount: Int
    let trigger: Int
    var alignment: Alignment = .top

    @State private var visible = false
    @State private var offsetY: CGFloat = 0
    @State private var opacity: Double = 0
    @State private var shown = 0

    func body(content: Content) -> some View {
        content.overlay(alignment: alignment) {
            Text("+\(shown) XP")
                .font(BKFont.headline(18))
                .foregroundStyle(BKTheme.accent)
                .shadow(color: BKTheme.background.opacity(0.6), radius: 4, y: 1)
                .offset(y: offsetY)
                .opacity(opacity)
                .allowsHitTesting(false)
                .onChange(of: trigger) { _, _ in fire() }
        }
    }

    private func fire() {
        guard amount > 0 else { return }
        shown = amount
        offsetY = 8
        opacity = 1
        withAnimation(.easeOut(duration: 1.0)) { offsetY = -34 }
        withAnimation(.easeIn(duration: 0.35).delay(0.65)) { opacity = 0 }
    }
}

extension View {
    /// Float a "+N XP" pop whenever `trigger` changes (only when `amount > 0`).
    func xpPop(amount: Int, trigger: Int, alignment: Alignment = .top) -> some View {
        modifier(XPPopModifier(amount: amount, trigger: trigger, alignment: alignment))
    }
}

/// Consistent end-of-game XP line for result screens: the big earned number over the mode max.
/// Losses show the real earned XP (which may be 0), never a misleading "nothing".
struct XPResultSummary: View {
    let earned: Int
    let max: Int
    var animated: Bool = true

    var body: some View {
        VStack(spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(earned)")
                    .font(BKFont.title(46))
                    .foregroundStyle(earned > 0 ? BKTheme.accent : BKTheme.textMuted)
                    .contentTransition(.numericText())
                Text("/ \(max) XP")
                    .font(BKFont.headline(16))
                    .foregroundStyle(BKTheme.textMuted)
            }
            Text("XP EARNED")
                .font(BKFont.caption(11))
                .tracking(1.2)
                .foregroundStyle(BKTheme.textMuted)
        }
    }
}
