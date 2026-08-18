import Foundation

enum LastManStandingSeed {
    static func makeServerPrompt(from dto: LastManStandingPuzzleDTO) -> LMSPrompt? {
        let questions = dto.questions.compactMap { mapQuestion($0) }
        guard questions.count == LMSGameState.totalQuestions else { return nil }
        return LMSPrompt(id: dto.puzzleId, date: dto.date, questions: questions)
    }

    private static func mapQuestion(_ dto: LastManStandingQuestionDTO) -> LMSQuestion? {
        guard let type = LMSQuestionType(rawValue: dto.type) else { return nil }
        guard type == .customQuestion || type == .missingClub || type == .customText || !dto.options.isEmpty else { return nil }
        let layout = dto.presentation?.layout.flatMap { LMSPresentationLayout(rawValue: $0) }
        let presentation = dto.presentation.map { pres in
            LMSPresentation(
                layout: layout,
                imageUrl: pres.imageUrl,
                imageBlur: pres.imageBlur,
                careerClubs: pres.careerClubs?.map {
                    LMSCareerClub(name: $0.name, logoUrl: $0.logoUrl, note: $0.note, missing: $0.missing ?? false)
                },
                cluePlayers: pres.cluePlayers?.map {
                    LMSCluePlayer(
                        id: $0.id,
                        name: $0.name,
                        headshotUrl: $0.headshotUrl,
                        nationality: $0.nationality,
                        position: $0.position
                    )
                }
            )
        }
        return LMSQuestion(
            id: dto.id,
            type: type,
            slot: dto.slot,
            signature: dto.signature ?? false,
            prompt: dto.prompt,
            subPrompt: dto.subPrompt,
            options: dto.options.map {
                LMSOption(
                    id: $0.id,
                    label: $0.label,
                    headshotUrl: $0.headshotUrl,
                    teamLogoUrl: $0.teamLogoUrl,
                    nationality: $0.nationality,
                    position: $0.position
                )
            },
            presentation: presentation
        )
    }
}
