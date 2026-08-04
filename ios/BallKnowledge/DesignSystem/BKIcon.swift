import SwiftUI

enum BKIcon {
    static func tabIcon(for tab: AppTab, selected: Bool, size: CGFloat = 32) -> some View {
        tabPhosphorIcon(for: tab, selected: selected)
            .color(selected ? BKTheme.accent : BKTheme.textMuted)
            .frame(width: size, height: size)
    }

    @ViewBuilder
    private static func tabPhosphorIcon(for tab: AppTab, selected: Bool) -> some View {
        switch tab {
        case .today:
            Ph.soccerBall.weight(selected ? .fill : .regular)
        case .vs:
            // Only the fill asset ships today — use it for both states.
            Ph.users.weight(.fill)
                .opacity(selected ? 1 : 0.72)
        case .leagues:
            Ph.chartBar.weight(selected ? .fill : .regular)
        case .you:
            Ph.userCircle.weight(selected ? .fill : .regular)
        }
    }
}

struct BKTabBar: View {
    @Binding var selection: AppTab

    /// Space to reserve at the bottom of scroll content so the last row can clear the floating bar.
    static let scrollClearance: CGFloat = 88

    private struct Item {
        let tab: AppTab
        let title: String
    }

    private let items: [Item] = [
        Item(tab: .today, title: "Today"),
        Item(tab: .vs, title: "VS"),
        Item(tab: .leagues, title: "Leagues"),
        Item(tab: .you, title: "You"),
    ]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(items, id: \.tab) { item in
                Button {
                    selection = item.tab
                } label: {
                    VStack(spacing: 4) {
                        BKIcon.tabIcon(for: item.tab, selected: selection == item.tab)
                        Text(item.title)
                            .font(BKFont.caption(10))
                            .foregroundStyle(selection == item.tab ? BKTheme.accent : BKTheme.textMuted)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background { tabBarGlassBackground }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    @ViewBuilder
    private var tabBarGlassBackground: some View {
        BKGlass.capsule(interactive: true)
    }
}

// MARK: - Liquid Glass

enum BKGlass {
    @ViewBuilder
    static func capsule(tint: Color? = nil, interactive: Bool = true) -> some View {
        if #available(iOS 26.0, *) {
            Color.clear
                .glassEffect(glassStyle(tint: tint, interactive: interactive), in: .capsule)
        } else {
            Capsule()
                .fill(.ultraThinMaterial)
        }
    }

    @ViewBuilder
    static func roundedRect(cornerRadius: CGFloat = 20, tint: Color? = nil, interactive: Bool = false) -> some View {
        if #available(iOS 26.0, *) {
            Color.clear
                .glassEffect(glassStyle(tint: tint, interactive: interactive), in: .rect(cornerRadius: cornerRadius))
        } else {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(.ultraThinMaterial)
        }
    }

    @available(iOS 26.0, *)
    private static func glassStyle(tint: Color?, interactive: Bool) -> Glass {
        switch (tint, interactive) {
        case (let color?, true):
            return .regular.interactive().tint(color)
        case (let color?, false):
            return .regular.tint(color)
        case (nil, true):
            return .regular.interactive()
        case (nil, false):
            return .regular
        }
    }
}
