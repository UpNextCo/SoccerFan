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
        body: Encodable? = nil,
        authorized: Bool = true
    ) async throws -> T {
        var urlRequest = URLRequest(url: AppConfig.apiBaseURL.appendingPathComponent(path))
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

    func searchPlayers(query: String) async throws -> [PlayerSearchResultDTO] {
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        return try await request("players/search?q=\(encoded)")
    }

    func gameModes() async throws -> [GameModeMetaDTO] {
        try await request("games")
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
