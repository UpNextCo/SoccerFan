import SwiftUI

/// Fixed bottom exit button for full-screen game result views.
struct GameResultExitBar: View {
    var title: String = "BACK TO GAMES"
    var showsBackground: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(BKFont.headline(16))
                .foregroundStyle(BKTheme.background)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 18)
                .background(BKTheme.accent)
                .clipShape(Capsule())
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 16)
        .background(showsBackground ? BKTheme.background : Color.clear)
    }
}

/// Scrollable result content with a pinned exit bar at the bottom.
struct GameResultScreen<Content: View>: View {
    var exitTitle: String = "BACK TO GAMES"
    let onExit: () -> Void
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(showsIndicators: false) {
                content()
                    .padding(.bottom, 24)
            }
            GameResultExitBar(title: exitTitle, action: onExit)
        }
        .background(BKTheme.background.ignoresSafeArea())
    }
}
