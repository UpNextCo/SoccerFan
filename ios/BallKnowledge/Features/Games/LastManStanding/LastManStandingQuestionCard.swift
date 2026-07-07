import SwiftUI

struct LastManStandingQuestionCard: View {
    let question: LMSQuestion
    let isInteractive: Bool
    let onSelect: (String) -> Void

    private var showsClubOptions: Bool {
        switch question.type {
        case .whichClub, .imageBadge:
            return true
        case .oddOneOut:
            let sub = question.subPrompt?.lowercased() ?? ""
            return sub.contains("clubs")
                || (sub.contains("club") && !sub.contains("never played for"))
        default:
            return false
        }
    }

    var body: some View {
        VStack(spacing: 12) {
            promptHeader

            switch question.type {
            case .higherLower:
                higherLowerOptions
            case .careerPath:
                careerPathBody
            case .imageBadge:
                imageHeader
                textClubOptionGrid
            case .oddOneOut, .whichClub:
                if showsClubOptions {
                    clubOptionGrid
                } else {
                    playerOptionGrid
                }
            }
        }
    }

    @ViewBuilder
    private var promptHeader: some View {
        VStack(spacing: 8) {
            if question.signature {
                Text("FINAL QUESTION")
                    .font(BKFont.caption(10))
                    .tracking(1.2)
                    .foregroundStyle(BKTheme.accent)
                Text("Signature Round")
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textSecondary)
            } else {
                Text("QUESTION \(question.slot)")
                    .font(BKFont.caption(10))
                    .tracking(0.8)
                    .foregroundStyle(BKTheme.textMuted)
            }
            Text(question.prompt)
                .font(BKFont.headline(18))
                .foregroundStyle(BKTheme.textPrimary)
                .multilineTextAlignment(.center)
            if let sub = question.subPrompt, !sub.isEmpty {
                if cluePlayerNames(from: sub) != nil {
                    cluePlayerRow(sub)
                } else {
                    Text(sub)
                        .font(BKFont.body(13))
                        .foregroundStyle(BKTheme.textSecondary)
                        .multilineTextAlignment(.center)
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity)
        .background(BKTheme.cardElevated.opacity(0.95))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    @ViewBuilder
    private func cluePlayerRow(_ sub: String) -> some View {
        let names = sub.split(separator: "·").map { $0.trimmingCharacters(in: .whitespaces) }
        HStack(spacing: 12) {
            ForEach(Array(names.enumerated()), id: \.offset) { _, name in
                if let option = question.options.first(where: { $0.label == name }) {
                    VStack(spacing: 4) {
                        PlayerAvatar(urlString: option.headshotUrl, size: 40)
                        Text(option.label)
                            .font(BKFont.caption(10))
                            .foregroundStyle(BKTheme.textSecondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    Text(name)
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.textSecondary)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(.top, 4)
    }

    private func cluePlayerNames(from sub: String) -> [String]? {
        guard question.type == .whichClub, sub.contains("·") else { return nil }
        return sub.split(separator: "·").map { String($0.trimmingCharacters(in: .whitespaces)) }
    }

    private var higherLowerOptions: some View {
        HStack(spacing: 10) {
            ForEach(question.options) { option in
                Button { onSelect(option.id) } label: {
                    playerOptionCard(option, avatarSize: 72, compact: false)
                }
                .disabled(!isInteractive)
                .opacity(isInteractive ? 1 : 0.55)
            }
        }
    }

    @ViewBuilder
    private var careerPathBody: some View {
        if let clubs = question.presentation?.careerClubs, !clubs.isEmpty {
            VStack(spacing: 0) {
                ForEach(Array(clubs.enumerated()), id: \.offset) { index, club in
                    HStack(spacing: 10) {
                        TeamBadgeImage(club: club.name, league: "", logoURL: club.logoUrl.flatMap(URL.init(string:)), size: 36) {
                            Text(GuessWhoDisplay.clubAbbrev(club.name))
                                .font(BKFont.caption(10))
                                .foregroundStyle(BKTheme.textMuted)
                                .frame(width: 36, height: 36)
                                .background(BKTheme.card)
                                .clipShape(Circle())
                        }
                        Text(club.name)
                            .font(BKFont.body(15))
                            .foregroundStyle(BKTheme.textPrimary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    if index < clubs.count - 1 {
                        Image(systemName: "arrow.down")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(BKTheme.textMuted)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
            .padding(.vertical, 14)
            .padding(.horizontal, 16)
            .background(BKTheme.card.opacity(0.85))
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        playerOptionList
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
                        .frame(maxHeight: 112)
                        .blur(radius: question.presentation?.imageBlur ?? 6)
                        .padding(12)
                default:
                    RoundedRectangle(cornerRadius: 12)
                        .fill(BKTheme.card)
                        .frame(height: 88)
                }
            }
            .frame(maxWidth: .infinity)
            .background(BKTheme.card.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }

    private var playerOptionList: some View {
        VStack(spacing: 8) {
            ForEach(question.options) { option in
                Button { onSelect(option.id) } label: {
                    careerPathPlayerOptionCard(option)
                }
                .disabled(!isInteractive)
                .opacity(isInteractive ? 1 : 0.55)
            }
        }
    }

    private var playerOptionGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            ForEach(question.options) { option in
                Button { onSelect(option.id) } label: {
                    playerOptionCard(option, avatarSize: 56, compact: false)
                }
                .disabled(!isInteractive)
                .opacity(isInteractive ? 1 : 0.55)
            }
        }
    }

    private var clubOptionGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            ForEach(question.options) { option in
                Button { onSelect(option.id) } label: {
                    clubOptionCard(option)
                }
                .disabled(!isInteractive)
                .opacity(isInteractive ? 1 : 0.55)
            }
        }
    }

    private var textClubOptionGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            ForEach(question.options) { option in
                Button { onSelect(option.id) } label: {
                    textClubOptionCard(option)
                }
                .disabled(!isInteractive)
                .opacity(isInteractive ? 1 : 0.55)
            }
        }
    }

    private func careerPathPlayerOptionCard(_ option: LMSOption) -> some View {
        HStack(spacing: 12) {
            PlayerAvatar(urlString: option.headshotUrl, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(option.label)
                    .font(BKFont.body(15))
                    .foregroundStyle(BKTheme.textPrimary)
                    .multilineTextAlignment(.leading)
                if let position = option.position, !position.isEmpty {
                    Text(GuessWhoDisplay.positionAbbrev(position))
                        .font(BKFont.caption(11))
                        .foregroundStyle(BKTheme.textMuted)
                }
            }
            Spacer(minLength: 0)
            if let nat = option.nationality, !nat.isEmpty {
                Text(GuessWhoDisplay.nationalityFlag(nat))
                    .font(.system(size: 28))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    private func playerOptionCard(_ option: LMSOption, avatarSize: CGFloat, compact: Bool) -> some View {
        Group {
            if compact {
                HStack(spacing: 12) {
                    PlayerAvatar(urlString: option.headshotUrl, size: avatarSize)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(option.label)
                            .font(BKFont.body(15))
                            .foregroundStyle(BKTheme.textPrimary)
                            .multilineTextAlignment(.leading)
                        if let nat = option.nationality, !nat.isEmpty {
                            Text(GuessWhoDisplay.nationalityFlag(nat))
                                .font(.system(size: 14))
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            } else {
                VStack(spacing: 8) {
                    PlayerAvatar(urlString: option.headshotUrl, size: avatarSize)
                    Text(option.label)
                        .font(BKFont.headline(compact ? 14 : 15))
                        .foregroundStyle(BKTheme.textPrimary)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)
                    if let nat = option.nationality, !nat.isEmpty {
                        Text(GuessWhoDisplay.nationalityFlag(nat))
                            .font(.system(size: 15))
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, compact ? 10 : 14)
                .padding(.horizontal, 8)
            }
        }
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: compact ? 12 : 14))
        .overlay(
            RoundedRectangle(cornerRadius: compact ? 12 : 14)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    private func textClubOptionCard(_ option: LMSOption) -> some View {
        Text(option.label)
            .font(BKFont.body(14))
            .foregroundStyle(BKTheme.textPrimary)
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .minimumScaleFactor(0.85)
            .frame(maxWidth: .infinity, minHeight: 72)
            .padding(.vertical, 12)
            .padding(.horizontal, 8)
            .background(BKTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
            )
    }

    private func clubOptionCard(_ option: LMSOption) -> some View {
        VStack(spacing: 8) {
            TeamBadgeImage(club: option.label, league: "", logoURL: option.teamLogoUrl.flatMap(URL.init(string:)), size: 44) {
                Text(GuessWhoDisplay.clubAbbrev(option.label))
                    .font(BKFont.caption(11))
                    .foregroundStyle(BKTheme.textMuted)
                    .frame(width: 44, height: 44)
                    .background(BKTheme.cardElevated)
                    .clipShape(Circle())
            }
            Text(option.label)
                .font(BKFont.body(13))
                .foregroundStyle(BKTheme.textPrimary)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.85)
        }
        .frame(maxWidth: .infinity, minHeight: 96)
        .padding(.vertical, 10)
        .padding(.horizontal, 8)
        .background(BKTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
        )
    }
}

struct LMSCheckResultDTO: Codable {
    let correct: Bool
    let reveal: String?
}
