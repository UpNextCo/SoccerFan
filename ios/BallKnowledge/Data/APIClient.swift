import Foundation

enum APIError: LocalizedError {
    case invalidResponse
    case server(String)
    case unauthorized

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Invalid server response"
        case .server(let msg): return msg
        case .unauthorized: return "Please sign in again"
        }
    }
}

actor APIClient {
    static let shared = APIClient()

    private var token: String? { KeychainHelper.loadToken() }

    func setToken(_ token: String) {
        KeychainHelper.saveToken(token)
    }

    func clearToken() {
        KeychainHelper.deleteToken()
    }

    func hasToken() -> Bool {
        token != nil
    }

    private func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        queryItems: [URLQueryItem]? = nil,
        body: Encodable? = nil,
        authorized: Bool = true
    ) async throws -> T {
        var components = URLComponents(
            url: AppConfig.apiBaseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )!
        if let queryItems, !queryItems.isEmpty {
            components.queryItems = queryItems
        }
        guard let url = components.url else {
            throw APIError.invalidResponse
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = method
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if authorized, let token {
            urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            urlRequest.httpBody = try JSONEncoder().encode(AnyEncodable(body))
        }

        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        if http.statusCode == 401 {
            throw APIError.unauthorized
        }

        let decoded = try JSONDecoder().decode(APIResponse<T>.self, from: data)
        if let error = decoded.error {
            throw APIError.server(error.message)
        }
        guard let result = decoded.data else {
            throw APIError.invalidResponse
        }
        return result
    }

    func authApple(identityToken: String, displayName: String?) async throws -> AuthResponseDTO {
        try await request(
            "auth/apple",
            method: "POST",
            body: AuthAppleRequestDTO(identityToken: identityToken, displayName: displayName),
            authorized: false
        )
    }

    func me() async throws -> UserProfileDTO {
        try await request("auth/me")
    }

    func deleteAccount() async throws {
        struct DeleteResponse: Decodable { let deleted: Bool }
        let _: DeleteResponse = try await request("auth/me", method: "DELETE")
    }

    func dailyToday() async throws -> DailyBundleDTO {
        try await request("daily/today")
    }

    func dailyComplete(_ body: DailyCompleteRequestDTO) async throws -> DailyCompleteResponseDTO {
        try await request("daily/complete", method: "POST", body: body)
    }

    func dailyGuess(_ body: DailyGuessRequestDTO) async throws -> GuessResultDTO {
        try await request("daily/guess", method: "POST", body: body)
    }

    func revealGuessWhoAnswer(date: String) async throws -> GuessWhoAnswerDTO {
        try await request("daily/guesswho/answer", queryItems: [URLQueryItem(name: "date", value: date)])
    }

    func guessWhoHint(date: String, known: [String]) async throws -> GuessWhoHintDTO {
        struct Body: Encodable { let date: String; let known: [String] }
        return try await request("daily/guesswho/hint", method: "POST", body: Body(date: date, known: known))
    }

    func validateTowerAnswer(date: String, floor: Int, answerType: String, value: String) async throws -> Bool {
        struct Body: Encodable {
            let date: String
            let floor: Int
            let answerType: String
            let value: String
        }
        struct Resp: Decodable { let correct: Bool }
        let resp: Resp = try await request(
            "daily/tower/validate",
            method: "POST",
            body: Body(date: date, floor: floor, answerType: answerType, value: value)
        )
        return resp.correct
    }

    func validateOneMoreAnswer(date: String, playerId: String) async throws -> (valid: Bool, statValue: Int) {
        struct Body: Encodable {
            let date: String
            let playerId: String
        }
        struct Resp: Decodable {
            let valid: Bool
            let statValue: Int
        }
        let resp: Resp = try await request(
            "daily/onemore/validate",
            method: "POST",
            body: Body(date: date, playerId: playerId)
        )
        return (resp.valid, resp.statValue)
    }

    func searchPlayers(query: String, currentTop5: Bool = false) async throws -> [PlayerSearchResultDTO] {
        var items = [URLQueryItem(name: "q", value: query)]
        if currentTop5 {
            items.append(URLQueryItem(name: "currentTop5", value: "1"))
        }
        return try await request("players/search", queryItems: items)
    }

    func teamLogo(club: String, league: String) async -> TeamLogoDTO? {
        let trimmedClub = club.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedClub.isEmpty else { return nil }

        do {
            return try await request(
                "teams/logo",
                queryItems: [
                    URLQueryItem(name: "club", value: trimmedClub),
                    URLQueryItem(name: "league", value: league.trimmingCharacters(in: .whitespacesAndNewlines)),
                ]
            )
        } catch {
            return nil
        }
    }

    func getPlayerCareerStats(playerId: String, league: TargetManLeague) async throws -> PlayerCareerStatsDTO {
        try await getPlayerCareerStats(playerId: playerId, leagueId: league.apiLeagueId)
    }

    func getPlayerCareerStats(playerId: String, leagueId: Int) async throws -> PlayerCareerStatsDTO {
        try await request(
            "players/\(playerId)/stats/career",
            queryItems: [URLQueryItem(name: "leagueId", value: String(leagueId))]
        )
    }

    func getTopStats(
        leagueId: Int,
        metric: CareerStatMetric,
        min: Int,
        limit: Int = 50
    ) async throws -> [TopStatPlayerDTO] {
        try await request(
            "stats/top",
            queryItems: [
                URLQueryItem(name: "leagueId", value: String(leagueId)),
                URLQueryItem(name: "metric", value: metric.rawValue),
                URLQueryItem(name: "min", value: String(min)),
                URLQueryItem(name: "limit", value: String(limit)),
            ]
        )
    }

    func getTopStats(
        league: TargetManLeague,
        metric: CareerStatMetric,
        min: Int,
        limit: Int = 50
    ) async throws -> [TopStatPlayerDTO] {
        try await getTopStats(leagueId: league.apiLeagueId, metric: metric, min: min, limit: limit)
    }

    /// Kept for existing call sites; prefer `getPlayerCareerStats`.
    func playerCareerStats(playerId: String, league: TargetManLeague) async throws -> PlayerCareerStatsDTO {
        try await getPlayerCareerStats(playerId: playerId, league: league)
    }

    func gameModes() async throws -> [GameModeMetaDTO] {
        try await request("games")
    }

    func leaguesMe() async throws -> MyLeagueDTO {
        try await request("leagues/me")
    }

    func leaguesWeekly() async throws -> PlayerStandingsDTO {
        try await request("leagues/weekly")
    }

    func leaguesOverall() async throws -> PlayerStandingsDTO {
        try await request("leagues/overall")
    }

    func leaguesTeams() async throws -> TeamStandingsDTO {
        try await request("leagues/teams")
    }

    func searchTeams(query: String) async throws -> [TeamSearchResultDTO] {
        try await request("teams/search", queryItems: [URLQueryItem(name: "q", value: query)])
    }

    func setFavoriteTeam(_ teamId: Int?) async throws {
        struct TeamBody: Encodable { let teamId: Int? }
        struct TeamResult: Decodable { let favoriteTeamId: Int? }
        let _: TeamResult = try await request("leagues/team", method: "PUT", body: TeamBody(teamId: teamId))
    }
}

private struct AnyEncodable: Encodable {
    private let encodeFunc: (Encoder) throws -> Void

    init(_ wrapped: Encodable) {
        encodeFunc = wrapped.encode
    }

    func encode(to encoder: Encoder) throws {
        try encodeFunc(encoder)
    }
}
