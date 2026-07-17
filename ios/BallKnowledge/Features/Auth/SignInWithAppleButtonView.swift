import SwiftUI
import AuthenticationServices

struct SignInWithAppleButtonView: View {
    var onSignedIn: (String, String?) -> Void
    var onError: (String) -> Void

    init(
        onSignedIn: @escaping (String, String?) -> Void,
        onError: @escaping (String) -> Void = { _ in }
    ) {
        self.onSignedIn = onSignedIn
        self.onError = onError
    }

    var body: some View {
        SignInWithAppleButton(.signIn) { request in
            request.requestedScopes = [.fullName, .email]
        } onCompletion: { result in
            switch result {
            case .success(let auth):
                guard
                    let credential = auth.credential as? ASAuthorizationAppleIDCredential,
                    let tokenData = credential.identityToken,
                    let token = String(data: tokenData, encoding: .utf8)
                else { return }

                let name = [credential.fullName?.givenName, credential.fullName?.familyName]
                    .compactMap { $0 }
                    .joined(separator: " ")
                onSignedIn(token, name.isEmpty ? nil : name)
            case .failure(let error):
                if let authorizationError = error as? ASAuthorizationError,
                   authorizationError.code == .canceled {
                    return
                }
                onError(error.localizedDescription)
            }
        }
        .signInWithAppleButtonStyle(.white)
        .frame(height: 54)
        .clipShape(Capsule())
    }
}
