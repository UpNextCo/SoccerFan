import SwiftUI

enum ProfileXpScope: String, Identifiable {
    case total
    case today

    var id: String { rawValue }

    var title: String {
        switch self {
        case .total: return "Total XP"
        case .today: return "XP Today"
        }
    }

    var subtitle: String {
        switch self {
        case .total: return "XP earned across every game you've played."
        case .today: return "XP earned from today's games."
        }
    }
}

struct ProfileXpBreakdownView: View {
    let scope: ProfileXpScope
    var headerTotal: Int

    @Environment(\.dismiss) private var dismiss
    @State private var rows: [XpByModeRowDTO] = []
    @State private var isLoading = true
    @State private var loadFailed = false

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && rows.isEmpty {
                    ProgressView()
                        .tint(BKTheme.accent)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if loadFailed && rows.isEmpty {
                    ContentUnavailableView(
                        "Couldn't load XP",
                        systemImage: "bolt.slash.fill",
                        description: Text("Check your connection and try again.")
                    )
                } else {
                    listContent
                }
            }
            .background(BKTheme.background.ignoresSafeArea())
            .navigationTitle(scope.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                        .foregroundStyle(BKTheme.accent)
                }
            }
            .task { await load() }
        }
    }

    private var listContent: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(headerTotal.formatted()) XP")
                        .font(.system(size: 28, weight: .black, design: .rounded))
                        .foregroundStyle(BKTheme.textPrimary)
                    Text(scope.subtitle)
                        .font(BKFont.caption(12))
                        .foregroundStyle(BKTheme.textMuted)
                }
                .padding(.horizontal, 4)

                VStack(spacing: 0) {
                    ForEach(Array(displayRows.enumerated()), id: \.element.id) { index, row in
                        ProfileXpGameRow(
                            modeId: row.modeId,
                            xp: scope == .total ? row.totalXp : row.todayXp
                        )
                        if index < displayRows.count - 1 {
                            Rectangle()
                                .fill(BKTheme.cardElevated)
                                .frame(height: 1)
                                .padding(.leading, 68)
                        }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .background(BKTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 28)
        }
    }

    private var displayRows: [XpByModeRowDTO] {
        let playable = DailyPlayOrder.playableModes.map(\.rawValue)
        let playableSet = Set(playable)
        let byId = Dictionary(uniqueKeysWithValues: rows.map { ($0.modeId, $0) })

        var ordered = playable.map { modeId in
            byId[modeId] ?? XpByModeRowDTO(modeId: modeId, totalXp: 0, todayXp: 0)
        }
        let extras = rows.filter { !playableSet.contains($0.modeId) }
        ordered.append(contentsOf: extras)

        switch scope {
        case .total:
            return ordered.sorted { lhs, rhs in
                if lhs.totalXp != rhs.totalXp { return lhs.totalXp > rhs.totalXp }
                return title(for: lhs.modeId) < title(for: rhs.modeId)
            }
        case .today:
            return ordered.sorted { lhs, rhs in
                if lhs.todayXp != rhs.todayXp { return lhs.todayXp > rhs.todayXp }
                return title(for: lhs.modeId) < title(for: rhs.modeId)
            }
        }
    }

    private func title(for modeId: String) -> String {
        GameModeID(rawValue: GameModeCatalog.normalizedModeId(modeId))?.title
            ?? modeId.replacingOccurrences(of: "_", with: " ").uppercased()
    }

    private func load() async {
        isLoading = true
        loadFailed = false
        defer { isLoading = false }
        do {
            let response = try await APIClient.shared.xpByMode()
            rows = response.modes
        } catch {
            loadFailed = true
        }
    }
}

private struct ProfileXpGameRow: View {
    let modeId: String
    let xp: Int

    private let iconSize: CGFloat = 52
    private let iconCornerRadius: CGFloat = 12

    private var normalizedModeId: String {
        GameModeCatalog.normalizedModeId(modeId)
    }

    private var tileArtImageName: String? {
        GameModeTileArt.bundleImageName(for: normalizedModeId)
    }

    private var title: String {
        GameModeID(rawValue: normalizedModeId)?.title
            ?? normalizedModeId.replacingOccurrences(of: "_", with: " ").uppercased()
    }

    var body: some View {
        HStack(spacing: 14) {
            thumbnail
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(BKTheme.textPrimary)
                .lineLimit(1)
            Spacer(minLength: 8)
            Text("\(xp.formatted()) XP")
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundStyle(xp > 0 ? BKTheme.accent : BKTheme.textMuted)
        }
        .padding(.vertical, 12)
    }

    private var thumbnail: some View {
        ZStack {
            BKTheme.tileIconBackdrop
            if let tileArtImageName {
                GameModeBundleImage(name: tileArtImageName)
                    .scaledToFill()
                    .frame(width: iconSize, height: iconSize, alignment: .top)
                    .scaleEffect(BKTheme.tileIconScale)
                    .brightness(BKTheme.tileIconBrightness)
            }
        }
        .frame(width: iconSize, height: iconSize)
        .clipShape(RoundedRectangle(cornerRadius: iconCornerRadius, style: .continuous))
    }
}
