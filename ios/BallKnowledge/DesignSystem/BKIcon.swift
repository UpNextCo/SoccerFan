import SwiftUI
import PhosphorSwift

enum BKIcon {
    static func tabIcon(for tab: AppTab, selected: Bool, size: CGFloat = 32) -> some View {
        Group {
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
                Ph.user.weight(selected ? .fill : .regular)
            }
        }
        .color(selected ? BKTheme.accent : BKTheme.textMuted)
        .frame(width: size, height: size)
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
        VStack(spacing: 0) {
            Divider().background(BKTheme.cardElevated)

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
                        .padding(.top, 8)
                        .padding(.bottom, 4)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 4)
            .background(BKTheme.background)
        }
    }
}
