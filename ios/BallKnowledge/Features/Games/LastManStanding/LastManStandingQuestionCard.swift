import SwiftUI

struct LastManStandingQuestionCard: View {
    let question: LMSQuestion
    let isInteractive: Bool
    let customSearchQuery: String
    let customSearchResults: [PlayerSearchResultDTO]
    let isSearchingCustomAnswer: Bool
    let onCustomSearchChange: (String) -> Void
    let onCustomPlayerSelect: (PlayerSearchResultDTO) -> Void
    let onSelect: (String) -> Void
    @FocusState private var customSearchFocused: Bool

    private enum Layout {
        static let sectionSpacing: CGFloat = 14
        static let blockSpacing: CGFloat = 20
    }

    private var showsClubOptions: Bool {
        switch question.type {
        case .whichClub, .imageBadge:
            return true
        case .oddOneOut:
            let sub = question.subPrompt?.lowercased() ?? ""
            return sub.contains("clubs")
                || (sub.contains("club") && !sub.contains("never played for"))
        case .higherLower, .careerPath, .customImage, .customQuestion:
            return false
        }
    }

    var body: some View {
        VStack(
            spacing: question.type == .imageBadge || question.type == .customImage
                ? 20
                : Layout.sectionSpacing
        ) {
            promptHeader
            questionBody
        }
    }

    @ViewBuilder
    private var questionBody: some View {
        switch question.type {
        case .higherLower:
            higherLowerOptions
        case .careerPath:
            careerPathBody
        case .imageBadge:
            VStack(spacing: 24) {
                imageHeader
                textClubOptionGrid
            }
        case .customImage:
            VStack(spacing: 22) {
                customImageHeader
                customImageOptionGrid
            }
        case .customQuestion:
            customQuestionSearch
        case .oddOneOut, .whichClub:
            if showsClubOptions {
                clubOptionGrid
            } else {
                playerOptionGrid
            }
        }
    }

    @ViewBuilder
    private var promptHeader: some View {
        VStack(spacing: 12) {
            if question.signature {
                Text("FINAL QUESTION")
                    .font(BKFont.caption(10))
                    .tracking(1.2)
                    .foregroundStyle(BKTheme.accent)
            }
            Text(question.prompt)
                .font(BKFont.title(24))
                .foregroundStyle(BKTheme.textPrimary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if let sub = question.subPrompt, !sub.isEmpty {
                if cluePlayerNames(from: sub) != nil {
                    cluePlayerRow(sub)
                } else {
                    Text(sub)
                        .font(BKFont.body(15))
                        .foregroundStyle(BKTheme.textSecondary)
                        .multilineTextAlignment(.center)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func cluePlayerRow(_ sub: String) -> some View {
        let names = sub.split(separator: "·").map { $0.trimmingCharacters(in: .whitespaces) }
        HStack(spacing: 8) {
            ForEach(Array(names.enumerated()), id: \.offset) { _, name in
                if let option = question.options.first(where: { $0.label == name }) {
                    VStack(spacing: 2) {
                        PlayerAvatar(urlString: option.headshotUrl, size: 32)
                        Text(option.label)
                            .font(BKFont.caption(9))
                            .foregroundStyle(BKTheme.textSecondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    Text(name)
                        .font(BKFont.caption(10))
                        .foregroundStyle(BKTheme.textSecondary)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(.top, 2)
    }

    private func cluePlayerNames(from sub: String) -> [String]? {
        guard question.type == .whichClub, sub.contains("·") else { return nil }
        return sub.split(separator: "·").map { String($0.trimmingCharacters(in: .whitespaces)) }
    }

    private var higherLowerOptions: some View {
        HStack(spacing: 14) {
            ForEach(question.options) { option in
                Button { onSelect(option.id) } label: {
                    playerOptionCard(option, avatarSize: 64, compact: false)
                }
                .buttonStyle(LMSOptionButtonStyle())
                .disabled(!isInteractive)
                .opacity(isInteractive ? 1 : 0.5)
            }
        }
    }

    @ViewBuilder
    private var careerPathBody: some View {
        VStack(spacing: Layout.blockSpacing) {
            if let clubs = question.presentation?.careerClubs, !clubs.isEmpty {
                careerPathClubRow(clubs)
            }
            playerOptionGrid
        }
    }

    private func careerPathClubRow(_ clubs: [LMSCareerClub]) -> some View {
        let metrics = careerPathMetrics(for: clubs.count)
        return HStack(spacing: metrics.spacing) {
            ForEach(Array(clubs.enumerated()), id: \.offset) { index, club in
                if index > 0 {
                    Image(systemName: "chevron.right")
                        .font(.system(size: metrics.arrowSize, weight: .bold))
                        .foregroundStyle(BKTheme.textMuted)
                }
                VStack(spacing: metrics.verticalSpacing) {
                    TeamBadgeImage(club: club.name, league: "", logoURL: club.logoUrl.flatMap(URL.init(string:)), size: metrics.badgeSize) {
                        Text(GuessWhoDisplay.clubAbbrev(club.name))
                            .font(.system(size: metrics.labelSize, weight: .bold))
                            .foregroundStyle(BKTheme.textMuted)
                            .frame(width: metrics.badgeSize, height: metrics.badgeSize)
                            .background(BKTheme.card.opacity(0.6))
                            .clipShape(Circle())
                    }
                    Text(club.name)
                        .font(BKFont.caption(metrics.labelSize))
                        .foregroundStyle(BKTheme.textSecondary)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .minimumScaleFactor(0.75)
                        .frame(width: metrics.labelWidth)
                    if club.note == "loan" {
                        Text("LOAN")
                            .font(.system(size: metrics.loanSize, weight: .bold, design: .rounded))
                            .foregroundStyle(BKTheme.accentMuted)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 2)
    }

    private struct CareerPathMetrics {
        let badgeSize: CGFloat
        let labelWidth: CGFloat
        let labelSize: CGFloat
        let loanSize: CGFloat
        let arrowSize: CGFloat
        let spacing: CGFloat
        let verticalSpacing: CGFloat
    }

    private func careerPathMetrics(for count: Int) -> CareerPathMetrics {
        switch count {
        case 4:
            return CareerPathMetrics(
                badgeSize: 38, labelWidth: 62, labelSize: 9,
                loanSize: 7, arrowSize: 9, spacing: 5, verticalSpacing: 4
            )
        case 5:
            return CareerPathMetrics(
                badgeSize: 34, labelWidth: 51, labelSize: 8.5,
                loanSize: 6.5, arrowSize: 8, spacing: 3, verticalSpacing: 3
            )
        case 6...:
            return CareerPathMetrics(
                badgeSize: 30, labelWidth: 42, labelSize: 8,
                loanSize: 6, arrowSize: 7, spacing: 2, verticalSpacing: 3
            )
        default:
            return CareerPathMetrics(
                badgeSize: 42, labelWidth: 78, labelSize: 10,
                loanSize: 7.5, arrowSize: 11, spacing: 8, verticalSpacing: 5
            )
        }
    }

    @ViewBuilder
    private var imageHeader: some View {
        if let urlString = question.presentation?.imageUrl, let url = URL(string: urlString) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFit()
                        .frame(maxHeight: 80)
                        .blur(radius: question.presentation?.imageBlur ?? 6)
                        .padding(8)
                default:
                    RoundedRectangle(cornerRadius: 10)
                        .fill(BKTheme.card.opacity(0.5))
                        .frame(height: 64)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder
    private var customImageHeader: some View {
        if let urlString = question.presentation?.imageUrl, let url = URL(string: urlString) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFit()
                        .frame(width: 270)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                default:
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(BKTheme.card.opacity(0.5))
                        .frame(width: 270, height: 140)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var playerOptionGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
            ForEach(question.options) { option in
                Button { onSelect(option.id) } label: {
                    compactPlayerOptionCard(option)
                }
                .buttonStyle(LMSOptionButtonStyle())
                .disabled(!isInteractive)
                .opacity(isInteractive ? 1 : 0.5)
            }
        }
    }

    private var clubOptionGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            ForEach(question.options) { option in
                Button { onSelect(option.id) } label: {
                    clubOptionCard(option)
                }
                .buttonStyle(LMSOptionButtonStyle())
                .disabled(!isInteractive)
                .opacity(isInteractive ? 1 : 0.5)
            }
        }
    }

    private var textClubOptionGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            ForEach(question.options) { option in
                Button { onSelect(option.id) } label: {
                    textClubOptionCard(option)
                }
                .buttonStyle(LMSOptionButtonStyle())
                .disabled(!isInteractive)
                .opacity(isInteractive ? 1 : 0.5)
            }
        }
    }

    private var customImageOptionGrid: some View {
        LazyVGrid(
            columns: [GridItem(.flexible()), GridItem(.flexible())],
            spacing: 8
        ) {
            ForEach(question.options) { option in
                Button { onSelect(option.id) } label: {
                    HStack(spacing: 8) {
                        TeamBadgeImage(
                            club: option.label,
                            league: "",
                            logoURL: option.teamLogoUrl.flatMap(URL.init(string:)),
                            size: 30
                        ) {
                            Text(GuessWhoDisplay.clubAbbrev(option.label))
                                .font(BKFont.caption(9))
                                .foregroundStyle(BKTheme.textMuted)
                                .frame(width: 30, height: 30)
                                .background(BKTheme.cardElevated)
                                .clipShape(Circle())
                        }
                        Text(option.label)
                            .font(BKFont.body(13))
                            .foregroundStyle(BKTheme.textPrimary)
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                            .minimumScaleFactor(0.82)
                    }
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(BKTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        LMSVisualStyle.cardStroke(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                        )
                    )
                }
                .buttonStyle(LMSOptionButtonStyle())
                .disabled(!isInteractive)
                .opacity(isInteractive ? 1 : 0.5)
            }
        }
    }

    private var customQuestionSearch: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(BKTheme.textMuted)
                TextField(
                    "Search player",
                    text: Binding(
                        get: { customSearchQuery },
                        set: onCustomSearchChange
                    )
                )
                .font(BKFont.body(15))
                .foregroundStyle(BKTheme.textPrimary)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .focused($customSearchFocused)
                .disabled(!isInteractive)
                if isSearchingCustomAnswer {
                    ProgressView()
                        .scaleEffect(0.75)
                        .tint(BKTheme.accent)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 13)
            .background(BKTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                LMSVisualStyle.cardStroke(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                )
            )

            if customSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 {
                if customSearchResults.isEmpty && !isSearchingCustomAnswer {
                    Text("No players found")
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.textMuted)
                        .padding(.vertical, 12)
                } else {
                    VStack(spacing: 6) {
                        ForEach(Array(customSearchResults.prefix(6))) { player in
                            Button {
                                customSearchFocused = false
                                onCustomPlayerSelect(player)
                            } label: {
                                HStack(spacing: 10) {
                                    PlayerAvatar(urlString: player.headshotUrl, size: 38) {
                                        PlayerSilhouette(size: 38)
                                    }
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(player.name)
                                            .font(BKFont.headline(14))
                                            .foregroundStyle(BKTheme.textPrimary)
                                        Text(player.club)
                                            .font(BKFont.caption(10))
                                            .foregroundStyle(BKTheme.textMuted)
                                            .lineLimit(1)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundStyle(BKTheme.textMuted)
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 9)
                                .background(BKTheme.card.opacity(0.9))
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            }
                            .buttonStyle(.plain)
                            .disabled(!isInteractive)
                        }
                    }
                }
            } else {
                Text("Type at least two letters")
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textMuted)
                    .padding(.vertical, 8)
            }
        }
    }

    private func compactPlayerOptionCard(_ option: LMSOption) -> some View {
        VStack(spacing: 8) {
            PlayerAvatar(urlString: option.headshotUrl, size: 52) {
                PlayerSilhouette(size: 52)
            }
            Text(option.label)
                .font(BKFont.headline(16))
                .foregroundStyle(BKTheme.textPrimary)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.85)
            playerMetaRow(option)
        }
        .frame(maxWidth: .infinity, minHeight: 108)
        .padding(.vertical, 14)
        .padding(.horizontal, 8)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(LMSVisualStyle.cardStroke(RoundedRectangle(cornerRadius: 12, style: .continuous)))
    }

    private func playerOptionCard(_ option: LMSOption, avatarSize: CGFloat, compact: Bool) -> some View {
        VStack(spacing: 10) {
            PlayerAvatar(urlString: option.headshotUrl, size: avatarSize) {
                PlayerSilhouette(size: avatarSize)
            }
            Text(option.label)
                .font(BKFont.headline(16))
                .foregroundStyle(BKTheme.textPrimary)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.85)
            playerMetaRow(option)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .padding(.horizontal, 10)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: LMSVisualStyle.optionRadius, style: .continuous))
        .overlay(LMSVisualStyle.cardStroke(RoundedRectangle(cornerRadius: LMSVisualStyle.optionRadius, style: .continuous)))
    }

    @ViewBuilder
    private func playerMetaRow(_ option: LMSOption) -> some View {
        let hasNationality = !(option.nationality?.isEmpty ?? true)
        let hasPosition = !(option.position?.isEmpty ?? true)
        if hasNationality || hasPosition {
            HStack(spacing: 6) {
                if hasNationality, let nat = option.nationality {
                    Text(GuessWhoDisplay.nationalityFlag(nat))
                        .font(.system(size: 15))
                }
                if hasPosition, let position = option.position {
                    Text(GuessWhoDisplay.positionAbbrev(position))
                        .font(BKFont.caption(11))
                        .tracking(0.5)
                        .foregroundStyle(BKTheme.textMuted)
                }
            }
        }
    }

    private func textClubOptionCard(_ option: LMSOption) -> some View {
        Text(option.label)
            .font(BKFont.body(13))
            .foregroundStyle(BKTheme.textPrimary)
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .minimumScaleFactor(0.85)
            .frame(maxWidth: .infinity, minHeight: 64)
            .padding(.vertical, 10)
            .padding(.horizontal, 6)
            .background(BKTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(LMSVisualStyle.cardStroke(RoundedRectangle(cornerRadius: 12, style: .continuous)))
    }

    private func clubOptionCard(_ option: LMSOption) -> some View {
        VStack(spacing: 6) {
            TeamBadgeImage(club: option.label, league: "", logoURL: option.teamLogoUrl.flatMap(URL.init(string:)), size: 36) {
                Text(GuessWhoDisplay.clubAbbrev(option.label))
                    .font(BKFont.caption(10))
                    .foregroundStyle(BKTheme.textMuted)
                    .frame(width: 36, height: 36)
                    .background(BKTheme.cardElevated)
                    .clipShape(Circle())
            }
            Text(option.label)
                .font(BKFont.body(12))
                .foregroundStyle(BKTheme.textPrimary)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.85)
        }
        .frame(maxWidth: .infinity, minHeight: 80)
        .padding(.vertical, 8)
        .padding(.horizontal, 6)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(LMSVisualStyle.cardStroke(RoundedRectangle(cornerRadius: 12, style: .continuous)))
    }
}

struct LMSStartResultDTO: Codable {
    let token: String
    let questionCount: Int
}

struct LMSCheckResultDTO: Codable {
    let correct: Bool
    let reveal: String?
    let nextToken: String?
    let status: String?
    let questionsSurvived: Int?
}

struct OneMoreStartResultDTO: Codable {
    let token: String
    let roundCount: Int
}

struct OneMoreCheckResultDTO: Codable {
    let correct: Bool
    let values: [String: Int]
    let nextToken: String?
    let status: String?
}
