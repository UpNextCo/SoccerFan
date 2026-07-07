import SwiftUI

struct LastManStandingQuestionCard: View {
    let question: LMSQuestion
    let isInteractive: Bool
    let onSelect: (String) -> Void

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
                optionList
            case .oddOneOut, .whichClub:
                if question.presentation?.layout == .grid || question.type == .oddOneOut {
                    gridOptions
                } else {
                    optionList
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
                Text(sub)
                    .font(BKFont.body(13))
                    .foregroundStyle(BKTheme.textSecondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity)
        .background(BKTheme.cardElevated.opacity(0.95))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private var higherLowerOptions: some View {
        HStack(spacing: 10) {
            ForEach(question.options) { option in
                Button { onSelect(option.id) } label: {
                    Text(option.label)
                        .font(BKFont.headline(16))
                        .foregroundStyle(BKTheme.textPrimary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity, minHeight: 88)
                        .padding(.horizontal, 8)
                        .background(BKTheme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .strokeBorder(Color.white.opacity(0.1), lineWidth: 1)
                        )
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
                    Text(club.name)
                        .font(BKFont.body(15))
                        .foregroundStyle(BKTheme.textPrimary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                    if index < clubs.count - 1 {
                        Image(systemName: "arrow.down")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(BKTheme.textMuted)
                    }
                }
            }
            .padding(.vertical, 14)
            .padding(.horizontal, 16)
            .background(BKTheme.card.opacity(0.85))
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        optionList
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
                        .frame(maxHeight: 72)
                        .blur(radius: question.presentation?.imageBlur ?? 10)
                        .padding(20)
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

    private var optionList: some View {
        VStack(spacing: 8) {
            ForEach(question.options) { option in
                optionButton(option)
            }
        }
    }

    private var gridOptions: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            ForEach(question.options) { option in
                optionButton(option)
            }
        }
    }

    private func optionButton(_ option: LMSOption) -> some View {
        Button { onSelect(option.id) } label: {
            Text(option.label)
                .font(BKFont.body(15))
                .foregroundStyle(BKTheme.textPrimary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, minHeight: 48)
                .padding(.horizontal, 10)
                .background(BKTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
                )
        }
        .disabled(!isInteractive)
        .opacity(isInteractive ? 1 : 0.55)
    }
}

struct LMSCheckResultDTO: Codable {
    let correct: Bool
    let reveal: String?
}
