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
        case .home:
            Ph.house.weight(selected ? .fill : .regular)
        case .play:
            Ph.soccerBall.weight(selected ? .fill : .regular)
        case .daily:
            Ph.calendar.weight(selected ? .fill : .regular)
        case .leagues:
            Ph.chartBar.weight(selected ? .fill : .regular)
        case .profile:
            Ph.userCircle.weight(selected ? .fill : .regular)
        }
    }
}

struct BKTabBar: View {
    @Binding var selection: AppTab

    private struct Item {
        let tab: AppTab
        let title: String
    }

    private let items: [Item] = [
        Item(tab: .home, title: "Home"),
        Item(tab: .play, title: "Play"),
        Item(tab: .daily, title: "Daily"),
        Item(tab: .leagues, title: "Leagues"),
        Item(tab: .profile, title: "Profile"),
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
        if #available(iOS 26.0, *) {
            Color.clear
                .glassEffect(.regular.interactive(), in: .capsule)
        } else {
            Capsule()
                .fill(.ultraThinMaterial)
        }
    }
}
